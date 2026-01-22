import {
  linkSync,
  copyFileSync,
  statSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { dirname } from "path";
import { platform } from "os";

/**
 * Hardlink backup utility with cross-platform support
 * 
 * Hardlink vs Copy strategy:
 * - DELETE: Use hardlink (original will be deleted, hardlink preserves content)
 * - RENAME: Use hardlink (similar to delete)
 * - CHANGE: Must copy first (modifications would affect hardlink)
 * - CREATE: No backup needed (file didn't exist before)
 * 
 * Fallback to copy when:
 * - Cross-filesystem (different mount points)
 * - Windows without proper permissions
 * - Any hardlink failure
 */

export type BackupMethod = "hardlink" | "copy";

export interface BackupResult {
  success: boolean;
  method: BackupMethod;
  error?: string;
}

// Cache for hardlink capability check per device
const hardlinkCapabilityCache = new Map<number, boolean>();

/**
 * Check if the current platform supports hardlinks
 */
export function platformSupportsHardlinks(): boolean {
  // All major platforms support hardlinks, but Windows has restrictions
  return true;
}

/**
 * Check if two paths are on the same filesystem/device
 */
export function isSameDevice(path1: string, path2: string): boolean {
  try {
    const stat1 = statSync(path1);
    const stat2 = statSync(path2);
    return stat1.dev === stat2.dev;
  } catch {
    return false;
  }
}

/**
 * Check if hardlinks work for a given device
 * Results are cached per device ID
 */
export function canCreateHardlink(sourcePath: string): boolean {
  try {
    const stat = statSync(sourcePath);
    
    // Check cache first
    if (hardlinkCapabilityCache.has(stat.dev)) {
      return hardlinkCapabilityCache.get(stat.dev)!;
    }
    
    // For Windows, we'll try and cache the result
    // For Unix-like systems, hardlinks should work if on same device
    if (platform() === "win32") {
      // On Windows, we'll determine this on first actual attempt
      // and cache the result
      return true; // Assume true, will fallback if fails
    }
    
    // Unix-like systems: hardlinks work for regular files on same device
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Cache hardlink capability result for a device
 */
export function cacheHardlinkCapability(deviceId: number, canHardlink: boolean): void {
  hardlinkCapabilityCache.set(deviceId, canHardlink);
}

/**
 * Get device ID for a path
 */
export function getDeviceId(filePath: string): number | null {
  try {
    return statSync(filePath).dev;
  } catch {
    return null;
  }
}

/**
 * Create a hardlink backup of a file
 * Falls back to copy if hardlink fails
 * 
 * @param sourcePath - Original file path (the file to backup)
 * @param targetPath - Backup destination path
 * @returns BackupResult with success status and method used
 */
export function createHardlinkBackup(sourcePath: string, targetPath: string): BackupResult {
  if (!existsSync(sourcePath)) {
    return {
      success: false,
      method: "copy",
      error: `Source file does not exist: ${sourcePath}`,
    };
  }

  // Ensure target directory exists
  const targetDir = dirname(targetPath);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // Check if source and target are on same device
  const sourceDevice = getDeviceId(sourcePath);
  const targetDirDevice = getDeviceId(targetDir);
  
  if (sourceDevice !== null && targetDirDevice !== null && sourceDevice !== targetDirDevice) {
    // Different devices, must use copy
    return copyFallback(sourcePath, targetPath, "Cross-device link not permitted");
  }

  // Check cached capability
  if (sourceDevice !== null && hardlinkCapabilityCache.has(sourceDevice)) {
    if (!hardlinkCapabilityCache.get(sourceDevice)) {
      return copyFallback(sourcePath, targetPath, "Hardlinks not supported (cached)");
    }
  }

  // Try to create hardlink
  try {
    linkSync(sourcePath, targetPath);
    
    // Cache success for this device
    if (sourceDevice !== null) {
      cacheHardlinkCapability(sourceDevice, true);
    }
    
    return {
      success: true,
      method: "hardlink",
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    
    // Cache failure for this device on Windows
    if (platform() === "win32" && sourceDevice !== null) {
      // EPERM or EXDEV indicate hardlinks won't work
      if (error.code === "EPERM" || error.code === "EXDEV" || error.code === "ENOTSUP") {
        cacheHardlinkCapability(sourceDevice, false);
      }
    }
    
    // Fallback to copy
    return copyFallback(sourcePath, targetPath, error.message);
  }
}

/**
 * Fallback to file copy when hardlink fails
 */
function copyFallback(sourcePath: string, targetPath: string, reason: string): BackupResult {
  try {
    copyFileSync(sourcePath, targetPath);
    return {
      success: true,
      method: "copy",
      error: `Hardlink fallback: ${reason}`,
    };
  } catch (copyErr) {
    const error = copyErr as NodeJS.ErrnoException;
    return {
      success: false,
      method: "copy",
      error: `Copy also failed: ${error.message}`,
    };
  }
}

/**
 * Backup file content from a Buffer
 * This is used for CHANGE events where we have the old content in memory
 * (Content-based backup - always uses write, not hardlink)
 */
export function backupFromBuffer(content: Buffer, targetPath: string): BackupResult {
  try {
    const targetDir = dirname(targetPath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    
    writeFileSync(targetPath, content);
    return {
      success: true,
      method: "copy", // It's a write from buffer, semantically a copy
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    return {
      success: false,
      method: "copy",
      error: error.message,
    };
  }
}

/**
 * Smart backup that chooses the best method based on event type
 * 
 * Strategy:
 * - DELETE/RENAME: Try hardlink first (file will be removed from original location)
 * - CHANGE: If content buffer provided, write from buffer; otherwise copy
 * - CREATE: No backup needed (return success with no action)
 * 
 * @param sourcePath - Original file path
 * @param targetPath - Backup destination path
 * @param eventType - Type of file event
 * @param content - Optional content buffer (for CHANGE events with pre-read content)
 * @param renamedTo - Optional new path for rename events (to create hardlink from new location)
 */
export function smartBackup(
  sourcePath: string,
  targetPath: string,
  eventType: "delete" | "rename" | "change" | "create",
  content?: Buffer,
  renamedTo?: string
): BackupResult {
  switch (eventType) {
    case "create":
      // No backup needed for newly created files
      return {
        success: true,
        method: "hardlink",
      };

    case "delete":
    case "rename":
      // For delete/rename, we want to preserve the file content
      // Hardlink is ideal here since the original will be removed
      if (existsSync(sourcePath)) {
        return createHardlinkBackup(sourcePath, targetPath);
      } else if (eventType === "rename" && renamedTo && existsSync(renamedTo)) {
        // For rename: original path gone, but new path has the same content
        // Create hardlink from the new location
        return createHardlinkBackup(renamedTo, targetPath);
      } else if (content) {
        // File already removed, use provided content
        return backupFromBuffer(content, targetPath);
      } else {
        return {
          success: false,
          method: "copy",
          error: "Source file does not exist and no content provided",
        };
      }

    case "change":
      // For change events, we have the old content in memory
      // We must write it to backup (not hardlink, since file is being modified)
      if (content) {
        return backupFromBuffer(content, targetPath);
      } else if (existsSync(sourcePath)) {
        // No pre-read content, read current file (which may already be modified)
        // This is a fallback - ideally content should be provided
        try {
          const fileContent = readFileSync(sourcePath);
          return backupFromBuffer(fileContent, targetPath);
        } catch (err) {
          return {
            success: false,
            method: "copy",
            error: `Failed to read file for backup: ${(err as Error).message}`,
          };
        }
      } else {
        return {
          success: false,
          method: "copy",
          error: "No content to backup for change event",
        };
      }

    default:
      return {
        success: false,
        method: "copy",
        error: `Unknown event type: ${eventType}`,
      };
  }
}

/**
 * Get backup statistics
 */
export interface BackupStats {
  hardlinks: number;
  copies: number;
  failures: number;
  hardlinkSavedBytes: number; // Approximate bytes saved via hardlinks
}

let backupStats: BackupStats = {
  hardlinks: 0,
  copies: 0,
  failures: 0,
  hardlinkSavedBytes: 0,
};

export function recordBackupResult(result: BackupResult, fileSize: number): void {
  if (result.success) {
    if (result.method === "hardlink") {
      backupStats.hardlinks++;
      backupStats.hardlinkSavedBytes += fileSize;
    } else {
      backupStats.copies++;
    }
  } else {
    backupStats.failures++;
  }
}

export function getBackupStats(): BackupStats {
  return { ...backupStats };
}

export function resetBackupStats(): void {
  backupStats = {
    hardlinks: 0,
    copies: 0,
    failures: 0,
    hardlinkSavedBytes: 0,
  };
}

/**
 * Check if a file is a hardlink (has more than 1 link)
 */
export function isHardlinked(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    return stat.nlink > 1;
  } catch {
    return false;
  }
}

/**
 * Get the number of hardlinks for a file
 */
export function getHardlinkCount(filePath: string): number {
  try {
    const stat = statSync(filePath);
    return stat.nlink;
  } catch {
    return 0;
  }
}

/**
 * Clear the hardlink capability cache
 * Useful for testing or when mount points change
 */
export function clearHardlinkCache(): void {
  hardlinkCapabilityCache.clear();
}
