import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  renameSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  createHardlinkBackup,
  smartBackup,
  backupFromBuffer,
  isHardlinked,
  getHardlinkCount,
  isSameDevice,
  clearHardlinkCache,
  getBackupStats,
  resetBackupStats,
  recordBackupResult,
  BackupResult,
} from "./hardlink.js";

import { BackupManager } from "./backup.js";
import { getDefaultConfig } from "./config.js";

const TEST_DIR = join(tmpdir(), "agentshield-hardlink-test-" + Date.now());
const WORKSPACE_DIR = join(TEST_DIR, "workspace");
const BACKUP_DIR = join(TEST_DIR, "backup");

function setupTestDirs() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(WORKSPACE_DIR, { recursive: true });
  mkdirSync(BACKUP_DIR, { recursive: true });
}

function cleanupTestDirs() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe("Hardlink Utilities", () => {
  beforeEach(() => {
    setupTestDirs();
    clearHardlinkCache();
    resetBackupStats();
  });

  afterEach(() => {
    cleanupTestDirs();
  });

  describe("createHardlinkBackup", () => {
    test("should create hardlink for existing file", () => {
      const sourceFile = join(WORKSPACE_DIR, "test.txt");
      const backupFile = join(BACKUP_DIR, "test.txt.backup");

      writeFileSync(sourceFile, "Hello World");

      const result = createHardlinkBackup(sourceFile, backupFile);

      expect(result.success).toBe(true);
      expect(result.method).toBe("hardlink");
      expect(existsSync(backupFile)).toBe(true);
      expect(readFileSync(backupFile, "utf-8")).toBe("Hello World");
    });

    test("should verify hardlink shares inode", () => {
      const sourceFile = join(WORKSPACE_DIR, "test.txt");
      const backupFile = join(BACKUP_DIR, "test.txt.backup");

      writeFileSync(sourceFile, "Hello World");
      createHardlinkBackup(sourceFile, backupFile);

      const sourceStat = statSync(sourceFile);
      const backupStat = statSync(backupFile);

      // Same inode indicates hardlink
      expect(sourceStat.ino).toBe(backupStat.ino);
      expect(sourceStat.nlink).toBe(2);
      expect(backupStat.nlink).toBe(2);
    });

    test("should fail gracefully for non-existent source", () => {
      const sourceFile = join(WORKSPACE_DIR, "nonexistent.txt");
      const backupFile = join(BACKUP_DIR, "nonexistent.txt.backup");

      const result = createHardlinkBackup(sourceFile, backupFile);

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not exist");
    });

    test("should create parent directories for backup", () => {
      const sourceFile = join(WORKSPACE_DIR, "test.txt");
      const backupFile = join(BACKUP_DIR, "deep", "nested", "dir", "test.txt.backup");

      writeFileSync(sourceFile, "Nested backup test");

      const result = createHardlinkBackup(sourceFile, backupFile);

      expect(result.success).toBe(true);
      expect(existsSync(backupFile)).toBe(true);
    });
  });

  describe("smartBackup", () => {
    test("should use hardlink for delete event", () => {
      const sourceFile = join(WORKSPACE_DIR, "to-delete.txt");
      const backupFile = join(BACKUP_DIR, "to-delete.backup");

      writeFileSync(sourceFile, "Will be deleted");

      const result = smartBackup(sourceFile, backupFile, "delete");

      expect(result.success).toBe(true);
      expect(result.method).toBe("hardlink");
      expect(existsSync(backupFile)).toBe(true);
    });

    test("should use hardlink for rename event", () => {
      const sourceFile = join(WORKSPACE_DIR, "original.txt");
      const backupFile = join(BACKUP_DIR, "original.backup");

      writeFileSync(sourceFile, "Will be renamed");

      const result = smartBackup(sourceFile, backupFile, "rename");

      expect(result.success).toBe(true);
      expect(result.method).toBe("hardlink");
    });

    test("should use copy for change event with content buffer", () => {
      const sourceFile = join(WORKSPACE_DIR, "changed.txt");
      const backupFile = join(BACKUP_DIR, "changed.backup");
      const oldContent = Buffer.from("Old content");

      writeFileSync(sourceFile, "New content");

      const result = smartBackup(sourceFile, backupFile, "change", oldContent);

      expect(result.success).toBe(true);
      expect(result.method).toBe("copy");
      expect(readFileSync(backupFile, "utf-8")).toBe("Old content");
    });

    test("should succeed for create event without backup", () => {
      const sourceFile = join(WORKSPACE_DIR, "new.txt");
      const backupFile = join(BACKUP_DIR, "new.backup");

      const result = smartBackup(sourceFile, backupFile, "create");

      expect(result.success).toBe(true);
      // Create events don't actually create backup files
      expect(existsSync(backupFile)).toBe(false);
    });

    test("should use content buffer when source deleted for delete event", () => {
      const sourceFile = join(WORKSPACE_DIR, "already-deleted.txt");
      const backupFile = join(BACKUP_DIR, "already-deleted.backup");
      const content = Buffer.from("Preserved content");

      // Source doesn't exist but we have content
      const result = smartBackup(sourceFile, backupFile, "delete", content);

      expect(result.success).toBe(true);
      expect(result.method).toBe("copy");
      expect(readFileSync(backupFile, "utf-8")).toBe("Preserved content");
    });

    test("should use hardlink from renamedTo path when source is gone for rename event", () => {
      const originalFile = join(WORKSPACE_DIR, "original-gone.txt");
      const renamedFile = join(WORKSPACE_DIR, "renamed-exists.txt");
      const backupFile = join(BACKUP_DIR, "original-gone.backup");

      // Only the renamed file exists
      writeFileSync(renamedFile, "Content after rename");

      const result = smartBackup(originalFile, backupFile, "rename", undefined, renamedFile);

      expect(result.success).toBe(true);
      expect(result.method).toBe("hardlink");
      expect(existsSync(backupFile)).toBe(true);
      
      // Verify it's a hardlink (same inode)
      const renamedStat = statSync(renamedFile);
      const backupStat = statSync(backupFile);
      expect(renamedStat.ino).toBe(backupStat.ino);
    });

    test("should fallback to content when both source and renamedTo are gone", () => {
      const originalFile = join(WORKSPACE_DIR, "both-gone-original.txt");
      const renamedFile = join(WORKSPACE_DIR, "both-gone-renamed.txt");
      const backupFile = join(BACKUP_DIR, "both-gone.backup");
      const content = Buffer.from("Fallback content");

      // Neither file exists
      const result = smartBackup(originalFile, backupFile, "rename", content, renamedFile);

      expect(result.success).toBe(true);
      expect(result.method).toBe("copy");
      expect(readFileSync(backupFile, "utf-8")).toBe("Fallback content");
    });
  });

  describe("backupFromBuffer", () => {
    test("should write buffer content to target", () => {
      const content = Buffer.from("Buffer content test");
      const targetFile = join(BACKUP_DIR, "from-buffer.txt");

      const result = backupFromBuffer(content, targetFile);

      expect(result.success).toBe(true);
      expect(result.method).toBe("copy");
      expect(readFileSync(targetFile, "utf-8")).toBe("Buffer content test");
    });

    test("should handle binary content", () => {
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE]);
      const targetFile = join(BACKUP_DIR, "binary.bin");

      const result = backupFromBuffer(binaryContent, targetFile);

      expect(result.success).toBe(true);
      expect(readFileSync(targetFile)).toEqual(binaryContent);
    });
  });

  describe("isHardlinked and getHardlinkCount", () => {
    test("should detect non-hardlinked file", () => {
      const file = join(WORKSPACE_DIR, "single.txt");
      writeFileSync(file, "Single file");

      expect(isHardlinked(file)).toBe(false);
      expect(getHardlinkCount(file)).toBe(1);
    });

    test("should detect hardlinked file", () => {
      const file = join(WORKSPACE_DIR, "linked.txt");
      const link = join(BACKUP_DIR, "linked.txt");

      writeFileSync(file, "Hardlinked file");
      createHardlinkBackup(file, link);

      expect(isHardlinked(file)).toBe(true);
      expect(isHardlinked(link)).toBe(true);
      expect(getHardlinkCount(file)).toBe(2);
      expect(getHardlinkCount(link)).toBe(2);
    });

    test("should return 0 for non-existent file", () => {
      expect(getHardlinkCount(join(WORKSPACE_DIR, "nonexistent.txt"))).toBe(0);
      expect(isHardlinked(join(WORKSPACE_DIR, "nonexistent.txt"))).toBe(false);
    });
  });

  describe("isSameDevice", () => {
    test("should return true for files on same device", () => {
      const file1 = join(WORKSPACE_DIR, "file1.txt");
      const file2 = join(WORKSPACE_DIR, "file2.txt");

      writeFileSync(file1, "File 1");
      writeFileSync(file2, "File 2");

      expect(isSameDevice(file1, file2)).toBe(true);
    });

    test("should return false if file doesn't exist", () => {
      const file1 = join(WORKSPACE_DIR, "exists.txt");
      const file2 = join(WORKSPACE_DIR, "not-exists.txt");

      writeFileSync(file1, "Exists");

      expect(isSameDevice(file1, file2)).toBe(false);
    });
  });

  describe("Backup Statistics", () => {
    test("should track hardlink backups", () => {
      resetBackupStats();

      const result: BackupResult = { success: true, method: "hardlink" };
      recordBackupResult(result, 1000);

      const stats = getBackupStats();
      expect(stats.hardlinks).toBe(1);
      expect(stats.hardlinkSavedBytes).toBe(1000);
      expect(stats.copies).toBe(0);
    });

    test("should track copy backups", () => {
      resetBackupStats();

      const result: BackupResult = { success: true, method: "copy" };
      recordBackupResult(result, 500);

      const stats = getBackupStats();
      expect(stats.copies).toBe(1);
      expect(stats.hardlinks).toBe(0);
    });

    test("should track failures", () => {
      resetBackupStats();

      const result: BackupResult = { success: false, method: "copy", error: "Test error" };
      recordBackupResult(result, 0);

      const stats = getBackupStats();
      expect(stats.failures).toBe(1);
    });
  });
});

describe("BackupManager with Hardlinks", () => {
  let manager: BackupManager;
  
  beforeEach(() => {
    setupTestDirs();
    clearHardlinkCache();
    
    const config = getDefaultConfig(WORKSPACE_DIR);
    manager = new BackupManager(config);
    manager.resetHardlinkStats();
  });

  afterEach(() => {
    cleanupTestDirs();
  });

  describe("Scenario: Delete file", () => {
    test("should backup file with hardlink before delete", () => {
      const testFile = join(WORKSPACE_DIR, "to-delete.txt");
      writeFileSync(testFile, "Content to preserve");
      const content = readFileSync(testFile);

      const snapshot = manager.createSnapshot([
        {
          relativePath: "to-delete.txt",
          eventType: "delete",
          content,
        },
      ]);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.files.length).toBe(1);
      expect(snapshot!.files[0].backupMethod).toBe("hardlink");

      // Simulate delete
      unlinkSync(testFile);
      expect(existsSync(testFile)).toBe(false);

      // Restore should work
      const restoreResult = manager.restoreSnapshot(snapshot!.id);
      expect(restoreResult.restored).toBe(1);
      expect(existsSync(testFile)).toBe(true);
      expect(readFileSync(testFile, "utf-8")).toBe("Content to preserve");
    });
  });

  describe("Scenario: Modify file", () => {
    test("should backup old content before modification", () => {
      const testFile = join(WORKSPACE_DIR, "to-modify.txt");
      writeFileSync(testFile, "Original content");
      const oldContent = readFileSync(testFile);

      // Simulate modification
      writeFileSync(testFile, "Modified content");

      const snapshot = manager.createSnapshot([
        {
          relativePath: "to-modify.txt",
          eventType: "change",
          content: oldContent,
        },
      ]);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.files.length).toBe(1);
      expect(snapshot!.files[0].backupMethod).toBe("copy"); // Change uses copy

      // Restore should bring back original content
      const restoreResult = manager.restoreSnapshot(snapshot!.id);
      expect(restoreResult.restored).toBe(1);
      expect(readFileSync(testFile, "utf-8")).toBe("Original content");
    });
  });

  describe("Scenario: Create new file", () => {
    test("should record creation without actual backup", () => {
      const testFile = join(WORKSPACE_DIR, "new-file.txt");
      writeFileSync(testFile, "New file content");

      const snapshot = manager.createSnapshot([
        {
          relativePath: "new-file.txt",
          eventType: "create",
        },
      ]);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.files.length).toBe(1);
      expect(snapshot!.files[0].eventType).toBe("create");

      // Restore should delete the newly created file
      const restoreResult = manager.restoreSnapshot(snapshot!.id);
      expect(restoreResult.deleted).toBe(1);
      expect(existsSync(testFile)).toBe(false);
    });
  });

  describe("Scenario: Rename file", () => {
    test("should backup file with hardlink before rename", () => {
      const originalFile = join(WORKSPACE_DIR, "original.txt");
      const renamedFile = join(WORKSPACE_DIR, "renamed.txt");

      writeFileSync(originalFile, "Original file content");
      const content = readFileSync(originalFile);

      const snapshot = manager.createSnapshot([
        {
          relativePath: "original.txt",
          eventType: "rename",
          renamedTo: "renamed.txt",
          content,
        },
      ]);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.files[0].backupMethod).toBe("hardlink");
      expect(snapshot!.files[0].renamedTo).toBe("renamed.txt");

      // Simulate rename
      renameSync(originalFile, renamedFile);
      expect(existsSync(originalFile)).toBe(false);
      expect(existsSync(renamedFile)).toBe(true);

      // Restore should reverse the rename
      const restoreResult = manager.restoreSnapshot(snapshot!.id);
      expect(restoreResult.restored).toBe(1);
      expect(restoreResult.deleted).toBe(1);
      expect(existsSync(originalFile)).toBe(true);
      expect(existsSync(renamedFile)).toBe(false);
    });
  });

  describe("Scenario: Rename file (original already gone)", () => {
    test("should create hardlink from new path when original is gone", () => {
      const originalFile = join(WORKSPACE_DIR, "original.txt");
      const renamedFile = join(WORKSPACE_DIR, "renamed.txt");

      writeFileSync(originalFile, "Original file content for rename test");
      const content = readFileSync(originalFile);

      // Simulate rename happening BEFORE backup (realistic watcher scenario)
      renameSync(originalFile, renamedFile);
      expect(existsSync(originalFile)).toBe(false);
      expect(existsSync(renamedFile)).toBe(true);

      // Now create snapshot - original is gone, but renamedTo path exists
      const snapshot = manager.createSnapshot([
        {
          relativePath: "original.txt",
          eventType: "rename",
          renamedTo: "renamed.txt",
          content,
        },
      ]);

      expect(snapshot).not.toBeNull();
      // Should still use hardlink by using the new path!
      expect(snapshot!.files[0].backupMethod).toBe("hardlink");
      expect(snapshot!.files[0].renamedTo).toBe("renamed.txt");
      expect(snapshot!.files[0].size).toBeGreaterThan(0);

      // Verify the backup file is actually a hardlink to the renamed file
      const backupPath = join(
        WORKSPACE_DIR,
        ".shield",
        "snapshots",
        snapshot!.files[0].backupPath
      );
      expect(existsSync(backupPath)).toBe(true);
      
      // Both should have nlink > 1 if hardlinked
      const renamedStat = statSync(renamedFile);
      const backupStat = statSync(backupPath);
      expect(renamedStat.ino).toBe(backupStat.ino); // Same inode = hardlink
      expect(renamedStat.nlink).toBe(2);

      // Restore should work correctly
      const restoreResult = manager.restoreSnapshot(snapshot!.id);
      expect(restoreResult.restored).toBe(1);
      expect(restoreResult.deleted).toBe(1);
      expect(existsSync(originalFile)).toBe(true);
      expect(existsSync(renamedFile)).toBe(false);
      expect(readFileSync(originalFile, "utf-8")).toBe("Original file content for rename test");
    });
  });

  describe("Scenario: Move file", () => {
    test("should handle move as rename with different path", () => {
      const originalFile = join(WORKSPACE_DIR, "file.txt");
      mkdirSync(join(WORKSPACE_DIR, "subdir"), { recursive: true });
      const movedFile = join(WORKSPACE_DIR, "subdir", "file.txt");

      writeFileSync(originalFile, "File to move");
      const content = readFileSync(originalFile);

      const snapshot = manager.createSnapshot([
        {
          relativePath: "file.txt",
          eventType: "rename",
          renamedTo: "subdir/file.txt",
          content,
        },
      ]);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.files[0].backupMethod).toBe("hardlink");

      // Simulate move
      renameSync(originalFile, movedFile);

      // Restore
      const restoreResult = manager.restoreSnapshot(snapshot!.id);
      expect(restoreResult.restored).toBe(1);
      expect(existsSync(originalFile)).toBe(true);
    });
  });

  describe("Multiple files in snapshot", () => {
    test("should handle mixed event types", () => {
      // Setup files
      const deleteFile = join(WORKSPACE_DIR, "delete.txt");
      const modifyFile = join(WORKSPACE_DIR, "modify.txt");
      const createFile = join(WORKSPACE_DIR, "create.txt");
      const renameFile = join(WORKSPACE_DIR, "rename.txt");

      writeFileSync(deleteFile, "Delete me");
      writeFileSync(modifyFile, "Original");
      writeFileSync(renameFile, "Rename me");

      const deleteContent = readFileSync(deleteFile);
      const modifyContent = readFileSync(modifyFile);
      const renameContent = readFileSync(renameFile);

      // Simulate changes
      writeFileSync(createFile, "Newly created");
      writeFileSync(modifyFile, "Modified");

      const snapshot = manager.createSnapshot([
        { relativePath: "delete.txt", eventType: "delete", content: deleteContent },
        { relativePath: "modify.txt", eventType: "change", content: modifyContent },
        { relativePath: "create.txt", eventType: "create" },
        { relativePath: "rename.txt", eventType: "rename", renamedTo: "renamed.txt", content: renameContent },
      ]);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.files.length).toBe(4);

      // Verify backup methods
      const fileByPath = (path: string) => snapshot!.files.find(f => f.path === path)!;
      expect(fileByPath("delete.txt").backupMethod).toBe("hardlink");
      expect(fileByPath("modify.txt").backupMethod).toBe("copy");
      expect(fileByPath("rename.txt").backupMethod).toBe("hardlink");
    });
  });

  describe("Extended Statistics", () => {
    test("should track hardlink vs copy backups", () => {
      // Create files and backup with different methods
      const deleteFile = join(WORKSPACE_DIR, "delete.txt");
      const modifyFile = join(WORKSPACE_DIR, "modify.txt");

      writeFileSync(deleteFile, "Delete content");
      writeFileSync(modifyFile, "Modify content");

      const deleteContent = readFileSync(deleteFile);
      const modifyContent = readFileSync(modifyFile);

      manager.createSnapshot([
        { relativePath: "delete.txt", eventType: "delete", content: deleteContent },
        { relativePath: "modify.txt", eventType: "change", content: modifyContent },
      ]);

      const stats = manager.getExtendedStats();
      expect(stats.hardlinkBackups).toBe(1);
      expect(stats.copyBackups).toBe(1);
    });
  });

  describe("Edge cases", () => {
    test("should handle large files", () => {
      const largeFile = join(WORKSPACE_DIR, "large.bin");
      const largeContent = Buffer.alloc(10 * 1024 * 1024); // 10MB
      largeContent.fill(0x42);

      writeFileSync(largeFile, largeContent);
      const content = readFileSync(largeFile);

      const snapshot = manager.createSnapshot([
        { relativePath: "large.bin", eventType: "delete", content },
      ]);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.files[0].backupMethod).toBe("hardlink");
      expect(snapshot!.files[0].size).toBe(10 * 1024 * 1024);
    });

    test("should handle files with special characters in name", () => {
      const specialFile = join(WORKSPACE_DIR, "file with spaces & special!.txt");
      writeFileSync(specialFile, "Special content");
      const content = readFileSync(specialFile);

      const snapshot = manager.createSnapshot([
        { relativePath: "file with spaces & special!.txt", eventType: "delete", content },
      ]);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.files[0].backupMethod).toBe("hardlink");
    });

    test("should handle empty files", () => {
      const emptyFile = join(WORKSPACE_DIR, "empty.txt");
      writeFileSync(emptyFile, "");
      const content = readFileSync(emptyFile);

      const snapshot = manager.createSnapshot([
        { relativePath: "empty.txt", eventType: "delete", content },
      ]);

      expect(snapshot).not.toBeNull();
      // Empty file still gets hardlinked
      expect(snapshot!.files[0].size).toBe(0);
    });

    test("should handle deeply nested files", () => {
      const deepPath = "a/b/c/d/e/f/deep.txt";
      const deepFile = join(WORKSPACE_DIR, deepPath);
      mkdirSync(join(WORKSPACE_DIR, "a/b/c/d/e/f"), { recursive: true });
      writeFileSync(deepFile, "Deep content");
      const content = readFileSync(deepFile);

      const snapshot = manager.createSnapshot([
        { relativePath: deepPath, eventType: "delete", content },
      ]);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.files[0].path).toBe(deepPath);
    });

    test("should handle unicode filenames", () => {
      const unicodeFile = join(WORKSPACE_DIR, "中文文件名.txt");
      writeFileSync(unicodeFile, "Unicode content 你好");
      const content = readFileSync(unicodeFile);

      const snapshot = manager.createSnapshot([
        { relativePath: "中文文件名.txt", eventType: "delete", content },
      ]);

      expect(snapshot).not.toBeNull();
    });
  });
});

describe("Fallback Behavior", () => {
  beforeEach(() => {
    setupTestDirs();
    clearHardlinkCache();
    resetBackupStats();
  });

  afterEach(() => {
    cleanupTestDirs();
  });

  test("should fallback to copy when content provided and source missing", () => {
    const sourceFile = join(WORKSPACE_DIR, "missing.txt");
    const backupFile = join(BACKUP_DIR, "missing.backup");
    const content = Buffer.from("Preserved content");

    // File doesn't exist but we have content
    const result = smartBackup(sourceFile, backupFile, "delete", content);

    expect(result.success).toBe(true);
    expect(result.method).toBe("copy");
    expect(readFileSync(backupFile, "utf-8")).toBe("Preserved content");
  });

  test("should fail when source missing and no content for delete", () => {
    const sourceFile = join(WORKSPACE_DIR, "really-missing.txt");
    const backupFile = join(BACKUP_DIR, "really-missing.backup");

    const result = smartBackup(sourceFile, backupFile, "delete");

    expect(result.success).toBe(false);
  });
});

describe("Hardlink Preservation After Delete", () => {
  beforeEach(() => {
    setupTestDirs();
    clearHardlinkCache();
  });

  afterEach(() => {
    cleanupTestDirs();
  });

  test("backup content preserved after original deleted", () => {
    const sourceFile = join(WORKSPACE_DIR, "original.txt");
    const backupFile = join(BACKUP_DIR, "backup.txt");

    writeFileSync(sourceFile, "Important data");

    // Create hardlink backup
    const result = createHardlinkBackup(sourceFile, backupFile);
    expect(result.success).toBe(true);
    expect(result.method).toBe("hardlink");

    // Verify both files exist and share inode
    expect(getHardlinkCount(sourceFile)).toBe(2);

    // Delete original
    unlinkSync(sourceFile);
    expect(existsSync(sourceFile)).toBe(false);

    // Backup should still exist with content
    expect(existsSync(backupFile)).toBe(true);
    expect(readFileSync(backupFile, "utf-8")).toBe("Important data");
    expect(getHardlinkCount(backupFile)).toBe(1); // Now only 1 link
  });
});

describe("Realistic Rename Workflow", () => {
  let manager: BackupManager;

  beforeEach(() => {
    setupTestDirs();
    clearHardlinkCache();

    const config = getDefaultConfig(WORKSPACE_DIR);
    manager = new BackupManager(config);
    manager.resetHardlinkStats();
  });

  afterEach(() => {
    cleanupTestDirs();
  });

  test("full rename workflow: file renamed before backup is created", () => {
    // This simulates what happens in the real watcher:
    // 1. File A exists
    // 2. User renames A -> B
    // 3. Watcher detects A is gone, saves content to pendingRenames
    // 4. Watcher detects B appears, matches with pending rename
    // 5. Snapshot is created AFTER the rename has completed
    // 6. At this point, A doesn't exist, only B exists
    // 7. We should still create a hardlink from B (not copy from content)

    const originalPath = "document.txt";
    const renamedPath = "document_renamed.txt";
    const originalFile = join(WORKSPACE_DIR, originalPath);
    const renamedFile = join(WORKSPACE_DIR, renamedPath);
    const content = "Important document content that should be hardlinked";

    // Step 1: Create original file
    writeFileSync(originalFile, content);
    const originalContent = readFileSync(originalFile);

    // Step 2: Simulate rename (this happens before backup)
    renameSync(originalFile, renamedFile);
    expect(existsSync(originalFile)).toBe(false);
    expect(existsSync(renamedFile)).toBe(true);

    // Step 3: Create snapshot (mimics watcher behavior after detecting rename)
    const snapshot = manager.createSnapshot([
      {
        relativePath: originalPath,
        eventType: "rename",
        renamedTo: renamedPath,
        content: originalContent, // Watcher saved this before file was renamed
      },
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.files.length).toBe(1);

    const snapshotFile = snapshot!.files[0];
    expect(snapshotFile.path).toBe(originalPath);
    expect(snapshotFile.eventType).toBe("rename");
    expect(snapshotFile.renamedTo).toBe(renamedPath);
    
    // KEY ASSERTION: Should use hardlink even though original is gone
    expect(snapshotFile.backupMethod).toBe("hardlink");
    expect(snapshotFile.size).toBeGreaterThan(0);

    // Verify the backup file exists and is a hardlink to renamedFile
    const backupFullPath = join(
      WORKSPACE_DIR,
      ".shield",
      "snapshots",
      snapshotFile.backupPath
    );
    expect(existsSync(backupFullPath)).toBe(true);

    const renamedStat = statSync(renamedFile);
    const backupStat = statSync(backupFullPath);
    expect(renamedStat.ino).toBe(backupStat.ino); // Same inode = hardlink
    expect(renamedStat.nlink).toBe(2); // Two links: renamed file + backup

    // Step 4: Restore should work correctly
    const restoreResult = manager.restoreSnapshot(snapshot!.id);
    expect(restoreResult.restored).toBe(1);
    expect(restoreResult.deleted).toBe(1);
    expect(existsSync(originalFile)).toBe(true);
    expect(existsSync(renamedFile)).toBe(false);
    expect(readFileSync(originalFile, "utf-8")).toBe(content);
  });

  test("multiple renames in same snapshot should all use hardlinks", () => {
    // Create multiple files
    interface TestFile {
      original: string;
      renamed: string;
      content: string;
      savedContent?: Buffer;
    }

    const files: TestFile[] = [
      { original: "file1.txt", renamed: "file1_new.txt", content: "Content 1" },
      { original: "file2.txt", renamed: "file2_new.txt", content: "Content 2" },
      { original: "file3.txt", renamed: "file3_new.txt", content: "Content 3" },
    ];

    // Create and then rename all files
    for (const f of files) {
      const origPath = join(WORKSPACE_DIR, f.original);
      const newPath = join(WORKSPACE_DIR, f.renamed);
      writeFileSync(origPath, f.content);
      const savedContent = readFileSync(origPath);
      renameSync(origPath, newPath);
      f.savedContent = savedContent;
    }

    // Create snapshot with all renames
    const snapshot = manager.createSnapshot(
      files.map((f) => ({
        relativePath: f.original,
        eventType: "rename" as const,
        renamedTo: f.renamed,
        content: f.savedContent,
      }))
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.files.length).toBe(3);

    // All should use hardlink
    for (const file of snapshot!.files) {
      expect(file.backupMethod).toBe("hardlink");
      expect(file.eventType).toBe("rename");
    }

    // Verify hardlink count on renamed files
    for (const f of files) {
      const renamedPath = join(WORKSPACE_DIR, f.renamed);
      expect(getHardlinkCount(renamedPath)).toBe(2);
    }
  });
});
