import { 
  existsSync, 
  mkdirSync, 
  linkSync, 
  copyFileSync, 
  statSync,
  readFileSync,
  writeFileSync,
  unlinkSync
} from "fs";
import { join, dirname } from "path";
import { ShieldConfig, getSnapshotsDir, getIndexPath } from "./config.js";
import { matchesPattern, getAllFiles, removeEmptyDirs } from "./utils.js";

export type FileEventType = "change" | "delete" | "rename";

export interface BackupEntry {
  originalPath: string;
  backupPath: string;
  timestamp: number;
  size: number;
  sessionId: string;
  eventType?: FileEventType;
  renamedFrom?: string;
}

export interface BackupIndex {
  entries: BackupEntry[];
  sessions: { [sessionId: string]: { startTime: number; endTime?: number } };
}

export class BackupManager {
  private config: ShieldConfig;
  private snapshotsDir: string;
  private indexPath: string;
  private index: BackupIndex;
  private currentSessionId: string;
  private protectedInSession: Set<string> = new Set();

  constructor(config: ShieldConfig) {
    this.config = config;
    this.snapshotsDir = getSnapshotsDir(config);
    this.indexPath = getIndexPath(config);
    this.currentSessionId = `session_${Date.now()}`;
    
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
        return JSON.parse(data);
      } catch {
        return { entries: [], sessions: {} };
      }
    }
    return { entries: [], sessions: {} };
  }

  private saveIndex(): void {
    writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  shouldExclude(filePath: string): boolean {
    return matchesPattern(filePath, this.config.excludePatterns);
  }

  backupFile(
    relativePath: string, 
    forceFullCopy: boolean = false,
    eventType: FileEventType = "change",
    renamedFrom?: string
  ): BackupEntry | null {
    const fullPath = join(this.config.workspace, relativePath);
    
    if (this.shouldExclude(relativePath)) {
      return null;
    }

    if (this.protectedInSession.has(fullPath)) {
      return null;
    }

    if (!existsSync(fullPath)) {
      return null;
    }

    try {
      const stats = statSync(fullPath);
      if (!stats.isFile()) {
        return null;
      }

      const timestamp = Date.now();
      const safeFilename = relativePath.replace(/[/\\]/g, "__");
      const backupFilename = `${timestamp}_${safeFilename}`;
      const backupPath = join(this.snapshotsDir, backupFilename);

      mkdirSync(dirname(backupPath), { recursive: true });

      if (forceFullCopy) {
        copyFileSync(fullPath, backupPath);
      } else {
        try {
          linkSync(fullPath, backupPath);
        } catch (err) {
          copyFileSync(fullPath, backupPath);
        }
      }

      const entry: BackupEntry = {
        originalPath: relativePath,
        backupPath: backupFilename,
        timestamp,
        size: stats.size,
        sessionId: this.currentSessionId,
        eventType,
        renamedFrom,
      };

      this.index.entries.push(entry);
      this.protectedInSession.add(fullPath);
      this.saveIndex();

      return entry;
    } catch (err) {
      console.error(`Failed to backup ${relativePath}:`, err);
      return null;
    }
  }

  backupDeletedFile(relativePath: string, content: Buffer): BackupEntry | null {
    if (this.shouldExclude(relativePath)) {
      return null;
    }

    try {
      const timestamp = Date.now();
      const safeFilename = relativePath.replace(/[/\\]/g, "__");
      const backupFilename = `${timestamp}_${safeFilename}`;
      const backupPath = join(this.snapshotsDir, backupFilename);

      mkdirSync(dirname(backupPath), { recursive: true });
      writeFileSync(backupPath, content);

      const entry: BackupEntry = {
        originalPath: relativePath,
        backupPath: backupFilename,
        timestamp,
        size: content.length,
        sessionId: this.currentSessionId,
        eventType: "delete",
      };

      this.index.entries.push(entry);
      this.saveIndex();

      return entry;
    } catch (err) {
      console.error(`Failed to backup deleted file ${relativePath}:`, err);
      return null;
    }
  }

  snapshotWorkspace(): { total: number; backed: number; skipped: number } {
    const files = getAllFiles(this.config.workspace);
    let backed = 0;
    let skipped = 0;

    for (const file of files) {
      if (this.shouldExclude(file)) {
        skipped++;
        continue;
      }

      const entry = this.backupFile(file, true);
      if (entry) {
        backed++;
      } else {
        skipped++;
      }
    }

    return { total: files.length, backed, skipped };
  }

  resetSession(): void {
    if (this.index.sessions[this.currentSessionId]) {
      this.index.sessions[this.currentSessionId].endTime = Date.now();
    }
    
    this.currentSessionId = `session_${Date.now()}`;
    this.index.sessions[this.currentSessionId] = { startTime: Date.now() };
    this.protectedInSession.clear();
    this.saveIndex();
  }

  getBackupsForFile(relativePath: string): BackupEntry[] {
    return this.index.entries
      .filter(e => e.originalPath === relativePath)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getAllBackups(): BackupEntry[] {
    return [...this.index.entries].sort((a, b) => b.timestamp - a.timestamp);
  }

  restoreFile(entry: BackupEntry): boolean {
    const backupFullPath = join(this.snapshotsDir, entry.backupPath);
    const targetPath = join(this.config.workspace, entry.originalPath);

    if (!existsSync(backupFullPath)) {
      console.error(`Backup file not found: ${entry.backupPath}`);
      return false;
    }

    try {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(backupFullPath, targetPath);
      return true;
    } catch (err) {
      console.error(`Failed to restore ${entry.originalPath}:`, err);
      return false;
    }
  }

  restoreLatest(relativePath: string): boolean {
    const backups = this.getBackupsForFile(relativePath);
    if (backups.length === 0) {
      console.error(`No backups found for: ${relativePath}`);
      return false;
    }
    return this.restoreFile(backups[0]);
  }

  restoreAllLatest(): { restored: number; failed: number; deleted: number } {
    const latestByFile = new Map<string, BackupEntry>();
    
    for (const entry of this.index.entries) {
      const existing = latestByFile.get(entry.originalPath);
      if (!existing || entry.timestamp > existing.timestamp) {
        latestByFile.set(entry.originalPath, entry);
      }
    }

    let restored = 0;
    let failed = 0;
    let deleted = 0;

    for (const entry of latestByFile.values()) {
      if (entry.eventType === "delete") {
        const targetPath = join(this.config.workspace, entry.originalPath);
        if (existsSync(targetPath)) {
          try {
            unlinkSync(targetPath);
            deleted++;
          } catch {
            // ignore
          }
        }
        if (this.restoreFile(entry)) {
          restored++;
        } else {
          failed++;
        }
      } else if (entry.eventType === "rename" && entry.renamedFrom) {
        const currentPath = join(this.config.workspace, entry.originalPath);
        if (existsSync(currentPath)) {
          try {
            unlinkSync(currentPath);
            deleted++;
          } catch {
            // ignore
          }
        }
        if (this.restoreFile(entry)) {
          restored++;
        } else {
          failed++;
        }
      } else {
        if (this.restoreFile(entry)) {
          restored++;
        } else {
          failed++;
        }
      }
    }

    return { restored, failed, deleted };
  }

  restoreToTime(targetTimestamp: number): { restored: number; failed: number; deleted: number } {
    const entriesBeforeTime = this.index.entries
      .filter(e => e.timestamp <= targetTimestamp)
      .sort((a, b) => b.timestamp - a.timestamp);

    const latestByFile = new Map<string, BackupEntry>();
    for (const entry of entriesBeforeTime) {
      if (!latestByFile.has(entry.originalPath)) {
        latestByFile.set(entry.originalPath, entry);
      }
    }

    let restored = 0;
    let failed = 0;
    let deleted = 0;

    for (const entry of latestByFile.values()) {
      if (entry.eventType === "delete") {
        const targetPath = join(this.config.workspace, entry.originalPath);
        if (existsSync(targetPath)) {
          try {
            unlinkSync(targetPath);
            deleted++;
          } catch {
            // ignore
          }
        }
        if (this.restoreFile(entry)) {
          restored++;
        } else {
          failed++;
        }
      } else if (entry.eventType === "rename" && entry.renamedFrom) {
        const currentPath = join(this.config.workspace, entry.originalPath);
        if (existsSync(currentPath)) {
          try {
            unlinkSync(currentPath);
            deleted++;
          } catch {
            // ignore
          }
        }
        if (this.restoreFile(entry)) {
          restored++;
        } else {
          failed++;
        }
      } else {
        if (this.restoreFile(entry)) {
          restored++;
        } else {
          failed++;
        }
      }
    }

    return { restored, failed, deleted };
  }

  restoreFileToTime(relativePath: string, targetTimestamp: number): boolean {
    const backups = this.getBackupsForFile(relativePath)
      .filter(e => e.timestamp <= targetTimestamp);
    
    if (backups.length === 0) {
      console.error(`No backups found for: ${relativePath} at or before timestamp ${targetTimestamp}`);
      return false;
    }
    return this.restoreFile(backups[0]);
  }

  getBackupByTimestamp(timestamp: number): BackupEntry | null {
    return this.index.entries.find(e => e.timestamp === timestamp) || null;
  }

  getUniqueTimestamps(): number[] {
    const timestamps = new Set(this.index.entries.map(e => e.timestamp));
    return Array.from(timestamps).sort((a, b) => b - a);
  }

  restoreSession(sessionId: string): { restored: number; failed: number } {
    const sessionEntries = this.index.entries.filter(e => e.sessionId === sessionId);
    let restored = 0;
    let failed = 0;

    const latestByFile = new Map<string, BackupEntry>();
    for (const entry of sessionEntries) {
      const existing = latestByFile.get(entry.originalPath);
      if (!existing || entry.timestamp < existing.timestamp) {
        latestByFile.set(entry.originalPath, entry);
      }
    }

    for (const entry of latestByFile.values()) {
      if (this.restoreFile(entry)) {
        restored++;
      } else {
        failed++;
      }
    }

    return { restored, failed };
  }

  cleanOldBackups(maxAgeDays: number): { removed: number; freedBytes: number } {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    let removed = 0;
    let freedBytes = 0;

    const toRemove: BackupEntry[] = [];
    const toKeep: BackupEntry[] = [];

    for (const entry of this.index.entries) {
      if (entry.timestamp < cutoff) {
        toRemove.push(entry);
      } else {
        toKeep.push(entry);
      }
    }

    for (const entry of toRemove) {
      const backupPath = join(this.snapshotsDir, entry.backupPath);
      try {
        if (existsSync(backupPath)) {
          const stats = statSync(backupPath);
          unlinkSync(backupPath);
          freedBytes += stats.size;
          removed++;
        }
      } catch (err) {
        // Ignore removal errors
      }
    }

    this.index.entries = toKeep;
    this.saveIndex();

    removeEmptyDirs(this.snapshotsDir);

    return { removed, freedBytes };
  }

  getStats(): { 
    totalBackups: number; 
    totalSize: number; 
    uniqueFiles: number;
    sessions: number;
  } {
    const uniqueFiles = new Set(this.index.entries.map(e => e.originalPath));
    const totalSize = this.index.entries.reduce((sum, e) => sum + e.size, 0);
    
    return {
      totalBackups: this.index.entries.length,
      totalSize,
      uniqueFiles: uniqueFiles.size,
      sessions: Object.keys(this.index.sessions).length,
    };
  }
}
