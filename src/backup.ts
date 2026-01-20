import { 
  existsSync, 
  mkdirSync, 
  copyFileSync, 
  statSync,
  readFileSync,
  writeFileSync,
  unlinkSync
} from "fs";
import { join, dirname } from "path";
import { ShieldConfig, getSnapshotsDir, getIndexPath } from "./config.js";
import { matchesPattern, removeEmptyDirs } from "./utils.js";

export type FileEventType = "change" | "delete" | "rename" | "create";

// File record in snapshot
export interface SnapshotFile {
  path: string;           // File relative path
  backupPath: string;     // Backup filename
  size: number;
  eventType: FileEventType;
  renamedTo?: string;     // New path when renamed
}

// Snapshot - A version point on the timeline
export interface Snapshot {
  id: string;             // snap_<timestamp>
  timestamp: number;      // Timestamp
  files: SnapshotFile[];  // List of changed files
  message?: string;       // Optional description
}

// Simplified index structure
export interface BackupIndex {
  version: number;
  snapshots: Snapshot[];
}

export class BackupManager {
  private config: ShieldConfig;
  private snapshotsDir: string;
  private indexPath: string;
  private index: BackupIndex;

  constructor(config: ShieldConfig) {
    this.config = config;
    this.snapshotsDir = getSnapshotsDir(config);
    this.indexPath = getIndexPath(config);
    
    this.ensureVaultExists();
    this.index = this.loadIndex();
  }

  private ensureVaultExists(): void {
    if (!existsSync(this.config.vaultDir)) {
      mkdirSync(this.config.vaultDir, { recursive: true });
    }
    if (!existsSync(this.snapshotsDir)) {
      mkdirSync(this.snapshotsDir, { recursive: true });
    }
  }

  private loadIndex(): BackupIndex {
    if (existsSync(this.indexPath)) {
      try {
        const data = readFileSync(this.indexPath, "utf-8");
        const parsed = JSON.parse(data);
        if (!parsed.snapshots) {
          parsed.snapshots = [];
        }
        if (!parsed.version) {
          parsed.version = 2;
        }
        // ensure each snapshot has a files array
        for (const snapshot of parsed.snapshots) {
          if (!snapshot.files) {
            snapshot.files = [];
          }
        }
        return parsed;
      } catch {
        return { version: 2, snapshots: [] };
      }
    }
    return { version: 2, snapshots: [] };
  }

  private saveIndex(): void {
    writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  shouldExclude(filePath: string): boolean {
    return matchesPattern(filePath, this.config.excludePatterns);
  }

  /**
   * Create snapshot - Package multiple file changes into one snapshot
   */
  createSnapshot(files: Array<{
    relativePath: string;
    eventType: FileEventType;
    content?: Buffer;
    renamedTo?: string;
  }>, message?: string): Snapshot | null {
    if (files.length === 0) {
      return null;
    }

    const timestamp = Date.now();
    const snapshotId = `snap_${timestamp}`;
    const snapshotFiles: SnapshotFile[] = [];

    for (const file of files) {
      const { relativePath, eventType, content, renamedTo } = file;
      
      if (this.shouldExclude(relativePath)) {
        continue;
      }

      const safeFilename = relativePath.replace(/[/\\]/g, "__");
      const backupFilename = `${timestamp}_${safeFilename}`;
      const backupPath = join(this.snapshotsDir, backupFilename);

      try {
        mkdirSync(dirname(backupPath), { recursive: true });

        let fileSize = 0;

        if (eventType === "delete" || eventType === "rename") {
          // Delete or rename: Save content before change
          if (content) {
            writeFileSync(backupPath, content);
            fileSize = content.length;
          }
        } else if (eventType === "change") {
          // Modify: Save content before change
          if (content) {
            writeFileSync(backupPath, content);
            fileSize = content.length;
          }
        } else if (eventType === "create") {
          // New file: No need to save content, just record path
          fileSize = 0;
        }

        snapshotFiles.push({
          path: relativePath,
          backupPath: backupFilename,
          size: fileSize,
          eventType,
          renamedTo,
        });

      } catch (err) {
        console.error(`Failed to backup ${relativePath}:`, err);
      }
    }

    if (snapshotFiles.length === 0) {
      return null;
    }

    const snapshot: Snapshot = {
      id: snapshotId,
      timestamp,
      files: snapshotFiles,
      message,
    };

    this.index.snapshots.push(snapshot);
    this.saveIndex();

    return snapshot;
  }

  /**
   * Get all snapshots, sorted by time in descending order
   */
  getAllSnapshots(): Snapshot[] {
    const snapshots = this.index.snapshots || [];
    return [...snapshots].sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get snapshot by ID
   */
  getSnapshotById(snapshotId: string): Snapshot | null {
    return this.index.snapshots.find(s => s.id === snapshotId) || null;
  }

  /**
   * Get snapshot by timestamp
   */
  getSnapshotByTimestamp(timestamp: number): Snapshot | null {
    return this.index.snapshots.find(s => s.timestamp === timestamp) || null;
  }

  /**
   * Get all backup versions of a file
   */
  getFileHistory(relativePath: string): Array<{ snapshot: Snapshot; file: SnapshotFile }> {
    const history: Array<{ snapshot: Snapshot; file: SnapshotFile }> = [];
    
    for (const snapshot of this.index.snapshots || []) {
      const files = snapshot.files || [];
      const file = files.find(f => f.path === relativePath);
      if (file) {
        history.push({ snapshot, file });
      }
    }
    
    return history.sort((a, b) => b.snapshot.timestamp - a.snapshot.timestamp);
  }

  /**
   * Get latest backup content of a file
   */
  getLatestBackupContent(relativePath: string): { content: Buffer; timestamp: number } | null {
    const history = this.getFileHistory(relativePath);
    if (history.length === 0) {
      return null;
    }

    const latest = history[0];
    const backupFullPath = join(this.snapshotsDir, latest.file.backupPath);

    try {
      if (existsSync(backupFullPath)) {
        const content = readFileSync(backupFullPath);
        return { content, timestamp: latest.snapshot.timestamp };
      }
    } catch {
      // ignore read errors
    }

    return null;
  }

  /**
   * Restore snapshot - Batch restore all files in snapshot
   */
  restoreSnapshot(snapshotId: string): { restored: number; failed: number; deleted: number } {
    const snapshot = this.getSnapshotById(snapshotId);
    if (!snapshot) {
      console.error(`Snapshot not found: ${snapshotId}`);
      return { restored: 0, failed: 0, deleted: 0 };
    }

    let restored = 0;
    let failed = 0;
    let deleted = 0;

    for (const file of snapshot.files || []) {
      const backupFullPath = join(this.snapshotsDir, file.backupPath);
      const targetPath = join(this.config.workspace, file.path);

      try {
        if (file.eventType === "delete") {
          // File was deleted, restore it
          if (existsSync(backupFullPath)) {
            mkdirSync(dirname(targetPath), { recursive: true });
            copyFileSync(backupFullPath, targetPath);
            restored++;
          } else {
            failed++;
          }
        } else if (file.eventType === "rename" && file.renamedTo) {
          // File was renamed, restore original name and delete new name
          const renamedPath = join(this.config.workspace, file.renamedTo);
          if (existsSync(renamedPath)) {
            unlinkSync(renamedPath);
            deleted++;
          }
          if (existsSync(backupFullPath)) {
            mkdirSync(dirname(targetPath), { recursive: true });
            copyFileSync(backupFullPath, targetPath);
            restored++;
          } else {
            failed++;
          }
        } else if (file.eventType === "create") {
          // File is newly created, delete it
          if (existsSync(targetPath)) {
            unlinkSync(targetPath);
            deleted++;
          }
        } else if (file.eventType === "change") {
          // File was modified, restore original version
          if (existsSync(backupFullPath)) {
            mkdirSync(dirname(targetPath), { recursive: true });
            copyFileSync(backupFullPath, targetPath);
            restored++;
          } else {
            failed++;
          }
        }
      } catch (err) {
        console.error(`Failed to restore ${file.path}:`, err);
        failed++;
      }
    }

    return { restored, failed, deleted };
  }

  /**
   * Restore to snapshot at specified timestamp
   */
  restoreToSnapshot(timestamp: number): { restored: number; failed: number; deleted: number } {
    const snapshot = this.getSnapshotByTimestamp(timestamp);
    if (!snapshot) {
      console.error(`No snapshot found at timestamp: ${timestamp}`);
      return { restored: 0, failed: 0, deleted: 0 };
    }
    return this.restoreSnapshot(snapshot.id);
  }

  /**
   * Restore single file to latest backup
   */
  restoreFile(relativePath: string): boolean {
    const history = this.getFileHistory(relativePath);
    if (history.length === 0) {
      console.error(`No backups found for: ${relativePath}`);
      return false;
    }

    const latest = history[0];
    const backupFullPath = join(this.snapshotsDir, latest.file.backupPath);
    const targetPath = join(this.config.workspace, relativePath);

    if (!existsSync(backupFullPath)) {
      console.error(`Backup file not found: ${latest.file.backupPath}`);
      return false;
    }

    try {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(backupFullPath, targetPath);
      return true;
    } catch (err) {
      console.error(`Failed to restore ${relativePath}:`, err);
      return false;
    }
  }

  /**
   * Clean old snapshots
   */
  cleanOldSnapshots(maxAgeDays: number): { removed: number; freedBytes: number } {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    let removed = 0;
    let freedBytes = 0;

    const toKeep: Snapshot[] = [];

    for (const snapshot of this.index.snapshots || []) {
      if (snapshot.timestamp < cutoff) {
        // Delete backup files in snapshot
        for (const file of snapshot.files || []) {
          const backupPath = join(this.snapshotsDir, file.backupPath);
          try {
            if (existsSync(backupPath)) {
              const stats = statSync(backupPath);
              unlinkSync(backupPath);
              freedBytes += stats.size;
            }
          } catch {
            // ignore
          }
        }
        removed++;
      } else {
        toKeep.push(snapshot);
      }
    }

    this.index.snapshots = toKeep;
    this.saveIndex();

    removeEmptyDirs(this.snapshotsDir);

    return { removed, freedBytes };
  }

  /**
   * Get statistics
   */
  getStats(): { 
    snapshots: number;
    totalFiles: number;
    totalSize: number;
    uniqueFiles: number;
  } {
    const uniqueFiles = new Set<string>();
    let totalFiles = 0;
    let totalSize = 0;

    for (const snapshot of this.index.snapshots || []) {
      for (const file of snapshot.files || []) {
        uniqueFiles.add(file.path);
        totalFiles++;
        totalSize += file.size || 0;
      }
    }
    
    return {
      snapshots: this.index.snapshots.length,
      totalFiles,
      totalSize,
      uniqueFiles: uniqueFiles.size,
    };
  }
}
