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
import { matchesPattern, getAllFiles, removeEmptyDirs } from "./utils.js";

export type FileEventType = "change" | "delete" | "rename" | "create";

// 快照中的文件记录
export interface SnapshotFile {
  path: string;           // 文件相对路径
  backupPath: string;     // 备份文件名
  size: number;
  eventType: FileEventType;
  renamedTo?: string;     // 重命名时的新路径
}

// 快照 - 时间线上的一个版本点
export interface Snapshot {
  id: string;             // snap_<timestamp>
  timestamp: number;      // 时间戳
  files: SnapshotFile[];  // 变更的文件列表
  message?: string;       // 可选描述
}

// 简化的索引结构
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
   * 创建快照 - 将多个文件变更打包成一个快照
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

      const fullPath = join(this.config.workspace, relativePath);
      const safeFilename = relativePath.replace(/[/\\]/g, "__");
      const backupFilename = `${timestamp}_${safeFilename}`;
      const backupPath = join(this.snapshotsDir, backupFilename);

      try {
        mkdirSync(dirname(backupPath), { recursive: true });

        let fileSize = 0;

        if (eventType === "delete" || eventType === "rename") {
          // 删除或重命名：保存变更前的内容
          if (content) {
            writeFileSync(backupPath, content);
            fileSize = content.length;
          }
        } else if (eventType === "change") {
          // 修改：保存变更前的内容
          if (content) {
            writeFileSync(backupPath, content);
            fileSize = content.length;
          }
        } else if (eventType === "create") {
          // 新建文件：不需要保存内容，只记录路径
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
   * 获取所有快照，按时间倒序
   */
  getAllSnapshots(): Snapshot[] {
    return [...this.index.snapshots].sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 根据 ID 获取快照
   */
  getSnapshotById(snapshotId: string): Snapshot | null {
    return this.index.snapshots.find(s => s.id === snapshotId) || null;
  }

  /**
   * 根据时间戳获取快照
   */
  getSnapshotByTimestamp(timestamp: number): Snapshot | null {
    return this.index.snapshots.find(s => s.timestamp === timestamp) || null;
  }

  /**
   * 获取某个文件的所有备份版本
   */
  getFileHistory(relativePath: string): Array<{ snapshot: Snapshot; file: SnapshotFile }> {
    const history: Array<{ snapshot: Snapshot; file: SnapshotFile }> = [];
    
    for (const snapshot of this.index.snapshots) {
      const file = snapshot.files.find(f => f.path === relativePath);
      if (file) {
        history.push({ snapshot, file });
      }
    }
    
    return history.sort((a, b) => b.snapshot.timestamp - a.snapshot.timestamp);
  }

  /**
   * 获取文件最新的备份内容
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
   * 恢复快照 - 批量恢复快照中的所有文件
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

    for (const file of snapshot.files) {
      const backupFullPath = join(this.snapshotsDir, file.backupPath);
      const targetPath = join(this.config.workspace, file.path);

      try {
        if (file.eventType === "delete") {
          // 文件被删除了，恢复它
          if (existsSync(backupFullPath)) {
            mkdirSync(dirname(targetPath), { recursive: true });
            copyFileSync(backupFullPath, targetPath);
            restored++;
          } else {
            failed++;
          }
        } else if (file.eventType === "rename" && file.renamedTo) {
          // 文件被重命名了，恢复原名并删除新名
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
          // 文件是新创建的，删除它
          if (existsSync(targetPath)) {
            unlinkSync(targetPath);
            deleted++;
          }
        } else if (file.eventType === "change") {
          // 文件被修改了，恢复原版本
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
   * 恢复到指定时间戳的快照
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
   * 恢复单个文件到最新备份
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
   * 清理旧快照
   */
  cleanOldSnapshots(maxAgeDays: number): { removed: number; freedBytes: number } {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    let removed = 0;
    let freedBytes = 0;

    const toKeep: Snapshot[] = [];

    for (const snapshot of this.index.snapshots) {
      if (snapshot.timestamp < cutoff) {
        // 删除快照中的备份文件
        for (const file of snapshot.files) {
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
   * 获取统计信息
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

    for (const snapshot of this.index.snapshots) {
      for (const file of snapshot.files) {
        uniqueFiles.add(file.path);
        totalFiles++;
        totalSize += file.size;
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
