import { join } from "path";
import { readFileSync, existsSync } from "fs";

export interface ShieldConfig {
  workspace: string;
  vaultDir: string;
  excludePatterns: string[];
  maxBackupAgeDays: number;
}

export const DEFAULT_VAULT_NAME = ".shield";
export const SNAPSHOTS_DIR = "snapshots";
export const INDEX_FILE = "index.json";

export const DEFAULT_EXCLUDE_PATTERNS = [
  "**/.*",
  "**/.*/**",
  "node_modules",
  "node_modules/**",
  "**/*.db",
  "**/*.sqlite",
  "**/*.sqlite3",
  "**/*.log",
  "**/*.tmp",
  "**/*.swp",
  "**/*.lock",
  "**/*.lck",
  "**/*.pid",
  "**/*.idx",
  "**/*.etl",
  "**/*.evtx",
  "**/*.evt",
  "**/*.trace",
  "**/*.out",
  "**/*.asl",
  "**/~*",
  "**/Thumbs.db",
  "**/__pycache__",
  "**/__pycache__/**",
  "**/*.pyc",
  "**/dist",
  "**/dist/**",
  "**/build",
  "**/build/**",
  "**/coverage",
  "**/coverage/**",
  "**/AppData/Local/Temp/**",
  "**/AppData/Local/Microsoft/**",
  "**/AppData/Roaming/Microsoft/**",
  "**/Windows/Temp/**",
  "**/Library/Caches/**"
];

export function getDefaultConfig(workspace: string): ShieldConfig {
  const excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS];
  
  // Read .gitignore file if it exists and add its patterns
  const gitignorePath = join(workspace, ".gitignore");
  if (existsSync(gitignorePath)) {
    try {
      const gitignoreContent = readFileSync(gitignorePath, "utf-8");
      const gitignorePatterns = gitignoreContent
        .split("\n")
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("#")); // Remove empty lines and comments
      
      excludePatterns.push(...gitignorePatterns);
    } catch (error) {
      console.warn("Failed to read .gitignore file:", error);
    }
  }
  
  return {
    workspace: workspace,
    vaultDir: join(workspace, DEFAULT_VAULT_NAME),
    excludePatterns: excludePatterns,
    maxBackupAgeDays: 7,
  };
}

export function getSnapshotsDir(config: ShieldConfig): string {
  return join(config.vaultDir, SNAPSHOTS_DIR);
}

export function getIndexPath(config: ShieldConfig): string {
  return join(config.vaultDir, INDEX_FILE);
}
