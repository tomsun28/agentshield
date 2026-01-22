import { watch, FSWatcher, existsSync, readFileSync } from "fs";
import { join } from "path";
import { BackupManager, FileEventType } from "./backup.js";
import { ShieldConfig } from "./config.js";
import { getAllFiles } from "./utils.js";

export type LogFn = (message: string) => void;

interface TrackedFile {
  content: Buffer;
  timestamp: number;
}

// pending change
interface PendingChange {
  relativePath: string;
  eventType: FileEventType;
  content?: Buffer;
  renamedTo?: string;
}

export class ShieldWatcher {
  private config: ShieldConfig;
  private backupManager: BackupManager;
  private watcher: FSWatcher | null = null;
  private debounceMap: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs: number = 1000;
  private batchMs: number = 2000; // batch collect change time window
  private log: LogFn;
  private trackedFiles: Map<string, TrackedFile> = new Map();
  private pendingRenames: Map<string, { content: Buffer; timestamp: number }> = new Map();
  private restoreLockPath: string;
  
  // Track recently renamed files to prevent duplicate change events
  private recentlyRenamed: Set<string> = new Set();
  
  // snapshot batch process
  private pendingChanges: Map<string, PendingChange> = new Map();
  private batchTimeout: NodeJS.Timeout | null = null;

  constructor(config: ShieldConfig, backupManager: BackupManager, log?: LogFn) {
    this.config = config;
    this.backupManager = backupManager;
    this.log = log || console.log;
    this.restoreLockPath = join(this.config.vaultDir, "restore.lock");
  }

  start(): void {
    if (this.watcher) {
      this.log("Watcher already running");
      return;
    }

    this.log(`🚀 Shield started, protecting: ${this.config.workspace}`);
    this.log(`📁 Vault location: ${this.config.vaultDir}`);
    
    this.initializeTracking();
    
    this.log("─".repeat(50));

    this.watcher = watch(
      this.config.workspace,
      { recursive: true },
      (event, filename) => {
        if (!filename) return;

        if (existsSync(this.restoreLockPath)) {
          return;
        }
        
        const normalizedFilename = filename.replace(/\\/g, "/");
        
        if (normalizedFilename.startsWith(".shield") || this.backupManager.shouldExclude(normalizedFilename)) {
          return;
        }

        const fullPath = join(this.config.workspace, normalizedFilename);
        const fileExists = existsSync(fullPath);

        if (!fileExists) {
          this.handleFileDelete(normalizedFilename);
          return;
        }

        if (event === "rename") {
          this.handlePotentialRename(normalizedFilename);
          return;
        }

        const existingTimeout = this.debounceMap.get(normalizedFilename);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        const timeout = setTimeout(() => {
          this.debounceMap.delete(normalizedFilename);
          this.handleFileChange(normalizedFilename, "change");
        }, this.debounceMs);

        this.debounceMap.set(normalizedFilename, timeout);
      }
    );

    this.watcher.on("error", (err) => {
      this.log(`Watcher error: ${err.message}`);
    });
  }

  private initializeTracking(): void {
    const files = getAllFiles(this.config.workspace);
    let tracked = 0;
    
    for (const file of files) {
      if (this.backupManager.shouldExclude(file)) {
        continue;
      }
      
      const fullPath = join(this.config.workspace, file);
      try {
        const content = readFileSync(fullPath);
        this.trackedFiles.set(file, {
          content,
          timestamp: Date.now(),
        });
        tracked++;
      } catch {
        // ignore read errors
      }
    }
    
    this.log(`📋 Tracking ${tracked} existing files`);
  }

  private trackFile(relativePath: string): void {
    const fullPath = join(this.config.workspace, relativePath);
    try {
      if (existsSync(fullPath)) {
        const content = readFileSync(fullPath);
        this.trackedFiles.set(relativePath, {
          content,
          timestamp: Date.now(),
        });
      }
    } catch {
      // ignore read errors
    }
  }

  private handleFileDelete(relativePath: string): void {
    const tracked = this.trackedFiles.get(relativePath);
    
    if (tracked) {
      this.pendingRenames.set(relativePath, {
        content: tracked.content,
        timestamp: tracked.timestamp,
      });
    } else {
      const existingBackup = this.backupManager.getLatestBackupContent(relativePath);
      if (existingBackup) {
        this.pendingRenames.set(relativePath, {
          content: existingBackup.content,
          timestamp: existingBackup.timestamp,
        });
      }
    }

    setTimeout(() => {
      // not record change during restore
      if (existsSync(this.restoreLockPath)) {
        this.pendingRenames.delete(relativePath);
        this.trackedFiles.delete(relativePath);
        return;
      }
      const pending = this.pendingRenames.get(relativePath);
      if (pending) {
        this.pendingRenames.delete(relativePath);
        // use snapshot to record delete
        this.addPendingChange({
          relativePath,
          eventType: "delete",
          content: pending.content,
        });
      }
      this.trackedFiles.delete(relativePath);
    }, 500);
  }

  private handlePotentialRename(newPath: string): void {
    // Skip if this file was just renamed to (prevents duplicate events)
    if (this.recentlyRenamed.has(newPath)) {
      return;
    }
    
    for (const [oldPath, pending] of this.pendingRenames.entries()) {
      if (oldPath !== newPath) {
        this.pendingRenames.delete(oldPath);
        this.trackedFiles.delete(oldPath);
        
        // use the snapshot to record rename
        this.addPendingChange({
          relativePath: oldPath,
          eventType: "rename",
          content: pending.content,
          renamedTo: newPath,
        });
        
        // Mark as recently renamed to prevent duplicate change events
        this.recentlyRenamed.add(newPath);
        setTimeout(() => {
          this.recentlyRenamed.delete(newPath);
        }, this.debounceMs + 500);
        
        this.trackFile(newPath);
        return;
      }
    }
    
    this.handleFileChange(newPath, "change");
  }

  private handleFileChange(relativePath: string, eventType: FileEventType): void {
    // Skip if this file was just renamed to (prevents duplicate events)
    if (this.recentlyRenamed.has(relativePath)) {
      return;
    }
    
    // Get content before change for backup
    const tracked = this.trackedFiles.get(relativePath);
    const content = tracked?.content;
    
    // Update tracking status
    this.trackFile(relativePath);
    
    // Add to pending queue
    this.addPendingChange({
      relativePath,
      eventType,
      content,
    });
  }

  /**
   * Add pending changes to queue for batch snapshot creation
   */
  private addPendingChange(change: PendingChange): void {
    // Don't record changes during restore
    if (existsSync(this.restoreLockPath)) {
      return;
    }
    // Use Map to deduplicate, keep only the latest change for each file
    this.pendingChanges.set(change.relativePath, change);
    
    // Reset batch processing timer
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    
    this.batchTimeout = setTimeout(() => {
      this.flushPendingChanges();
    }, this.batchMs);
  }

  /**
   * flush pending changes to create snapshot
   */
  private flushPendingChanges(): void {
    if (this.pendingChanges.size === 0) {
      return;
    }
    
    // not create snapshot during restore
    if (existsSync(this.restoreLockPath)) {
      this.pendingChanges.clear();
      this.batchTimeout = null;
      return;
    }
    
    const changes = Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();
    this.batchTimeout = null;
    
    // create snapshot
    const snapshot = this.backupManager.createSnapshot(changes);
    
    if (snapshot) {
      const fileCount = snapshot.files.length;
      if (fileCount === 1) {
        this.log(`[🛡️ Shield] Snapshot created: ${snapshot.files[0].path}`);
      } else {
        this.log(`[🛡️ Shield] Snapshot created: ${fileCount} files (${snapshot.id})`);
        for (const file of snapshot.files) {
          this.log(`    └─ ${file.eventType}: ${file.path}`);
        }
      }
    }
  }

  stop(): void {
    if (this.watcher) {
      // flush pending changes
      this.flushPendingChanges();
      
      this.watcher.close();
      this.watcher = null;
      
      for (const timeout of this.debounceMap.values()) {
        clearTimeout(timeout);
      }
      this.debounceMap.clear();
      
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout);
        this.batchTimeout = null;
      }
      
      // Clean up state
      this.recentlyRenamed.clear();
      this.pendingRenames.clear();
      
      this.log("Shield stopped");
    }
  }
}
