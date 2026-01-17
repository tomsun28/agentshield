import { homedir } from "os";
import { join } from "path";

export interface ShieldConfig {
  workspace: string;
  vaultDir: string;
  excludePatterns: string[];
  maxBackupAgeDays: number;
}

export const DEFAULT_VAULT_NAME = ".agent_shield";
export const SNAPSHOTS_DIR = "snapshots";
export const INDEX_FILE = "index.json";

export const DEFAULT_EXCLUDE_PATTERNS = [
  ".git",
  ".git/**",
  "node_modules",
  "node_modules/**",
  ".agent_shield",
  ".agent_shield/**",
  "**/*.log",
  "**/*.tmp",
  "**/*.swp",
  "**/*.swo",
  "**/~*",
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/__pycache__",
  "**/__pycache__/**",
  "**/*.pyc",
  "**/dist",
  "**/dist/**",
  "**/build",
  "**/build/**",
  "**/.next",
  "**/.next/**",
  "**/.nuxt",
  "**/.nuxt/**",
  "**/coverage",
  "**/coverage/**",
  "**/.cache",
  "**/.cache/**",
];

export function getDefaultConfig(workspace: string): ShieldConfig {
  return {
    workspace: workspace,
    vaultDir: join(workspace, DEFAULT_VAULT_NAME),
    excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
    maxBackupAgeDays: 7,
  };
}

export function getSnapshotsDir(config: ShieldConfig): string {
  return join(config.vaultDir, SNAPSHOTS_DIR);
}

export function getIndexPath(config: ShieldConfig): string {
  return join(config.vaultDir, INDEX_FILE);
}
