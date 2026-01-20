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
        
        this.trackFile(newPath);
        return;
      }
    }
    
    this.handleFileChange(newPath, "change");
  }

  private handleFileChange(relativePath: string, eventType: FileEventType): void {
    // 获取变更前的内容用于备份
    const tracked = this.trackedFiles.get(relativePath);
    const content = tracked?.content;
    
    // 更新跟踪状态
    this.trackFile(relativePath);
    
    // 添加到待处理队列
    this.addPendingChange({
      relativePath,
      eventType,
      content,
    });
  }

  /**
   * 添加待处理的变更到队列，批量创建快照
   */
  private addPendingChange(change: PendingChange): void {
    // 恢复过程中不记录变更
    if (existsSync(this.restoreLockPath)) {
      return;
    }
    // 使用 Map 去重，同一文件只保留最新的变更
    this.pendingChanges.set(change.relativePath, change);
    
    // 重置批量处理定时器
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
      
      this.log("Shield stopped");
    }
  }
}
