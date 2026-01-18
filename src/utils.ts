import { statSync, readdirSync, unlinkSync, rmdirSync } from "fs";
import { join, relative } from "path";

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function matchesPattern(filePath: string, patterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  
  for (const pattern of patterns) {
    if (pattern.includes("**")) {
      const regex = patternToRegex(pattern);
      if (regex.test(normalizedPath)) return true;
    } else if (pattern.includes("*")) {
      const regex = patternToRegex(pattern);
      if (regex.test(normalizedPath)) return true;
    } else {
      if (normalizedPath === pattern || 
          normalizedPath.startsWith(pattern + "/") ||
          normalizedPath.includes("/" + pattern + "/") ||
          normalizedPath.endsWith("/" + pattern)) {
        return true;
      }
    }
  }
  return false;
}

function patternToRegex(pattern: string): RegExp {
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "{{GLOBSTAR_SLASH}}")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR_SLASH}}/g, "(.*/)?" )
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`(^|/)${regex}($|/|$)`);
}

export function getAllFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        files.push(...getAllFiles(fullPath, baseDir));
      } else if (entry.isFile()) {
        files.push(relative(baseDir, fullPath));
      }
    }
  } catch (err) {
    // Ignore permission errors
  }
  
  return files;
}

export function removeEmptyDirs(dir: string): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        removeEmptyDirs(join(dir, entry.name));
      }
    }
    
    const remaining = readdirSync(dir);
    if (remaining.length === 0) {
      rmdirSync(dir);
    }
  } catch (err) {
    // Ignore errors
  }
}

export function parseTimestampFromBackup(filename: string): number | null {
  const match = filename.match(/^(\d+)_/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

export function getOriginalFilename(backupFilename: string): string {
  const match = backupFilename.match(/^\d+_(.+)$/);
  return match ? match[1] : backupFilename;
}
