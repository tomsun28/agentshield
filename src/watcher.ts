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

export class ShieldWatcher {
  private config: ShieldConfig;
  private backupManager: BackupManager;
  private watcher: FSWatcher | null = null;
  private debounceMap: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs: number = 1000;
  private log: LogFn;
  private trackedFiles: Map<string, TrackedFile> = new Map();
  private pendingRenames: Map<string, { content: Buffer; timestamp: number }> = new Map();
  private restoreLockPath: string;

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
      const pending = this.pendingRenames.get(relativePath);
      if (pending) {
        this.pendingRenames.delete(relativePath);
        const entry = this.backupManager.backupDeletedFile(relativePath, pending.content);
        if (entry) {
          this.log(`[🛡️ Shield] Deleted file backed up: ${relativePath}`);
        }
      }
      this.trackedFiles.delete(relativePath);
    }, 500);
  }

  private handlePotentialRename(newPath: string): void {
    for (const [oldPath, pending] of this.pendingRenames.entries()) {
      if (oldPath !== newPath) {
        this.pendingRenames.delete(oldPath);
        this.trackedFiles.delete(oldPath);
        
        const entry = this.backupManager.backupRenamedFile(oldPath, newPath, pending.content);
        if (entry) {
          this.log(`[🛡️ Shield] Renamed file backed up: ${oldPath} → ${newPath}`);
        }
        
        this.trackFile(newPath);
        return;
      }
    }
    
    this.handleFileChange(newPath, "change");
  }

  private handleFileChange(relativePath: string, eventType: FileEventType): void {
    this.trackFile(relativePath);
    const entry = this.backupManager.backupFile(relativePath, false, eventType);
    if (entry) {
      this.log(`[🛡️ Shield] Original version locked: ${relativePath}`);
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      
      for (const timeout of this.debounceMap.values()) {
        clearTimeout(timeout);
      }
      this.debounceMap.clear();
      
      this.log("Shield stopped");
    }
  }

  resetSession(): void {
    this.backupManager.resetSession();
    this.log("─".repeat(50));
    this.log("🔄 New session started, protection state reset");
  }
}
