import { watch, FSWatcher } from "fs";
import { BackupManager } from "./backup.js";
import { ShieldConfig } from "./config.js";

export type LogFn = (message: string) => void;

export class ShieldWatcher {
  private config: ShieldConfig;
  private backupManager: BackupManager;
  private watcher: FSWatcher | null = null;
  private debounceMap: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs: number = 1000;
  private log: LogFn;

  constructor(config: ShieldConfig, backupManager: BackupManager, log?: LogFn) {
    this.config = config;
    this.backupManager = backupManager;
    this.log = log || console.log;
  }

  start(): void {
    if (this.watcher) {
      this.log("Watcher already running");
      return;
    }

    this.log(`🚀 Shield started, protecting: ${this.config.workspace}`);
    this.log(`📁 Vault location: ${this.config.vaultDir}`);
    this.log("─".repeat(50));

    this.watcher = watch(
      this.config.workspace,
      { recursive: true },
      (event, filename) => {
        if (!filename) return;
        
        const normalizedFilename = filename.replace(/\\/g, "/");
        
        if (normalizedFilename.startsWith(".shield") || this.backupManager.shouldExclude(normalizedFilename)) {
          return;
        }

        const existingTimeout = this.debounceMap.get(normalizedFilename);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        const timeout = setTimeout(() => {
          this.debounceMap.delete(normalizedFilename);
          this.handleFileChange(normalizedFilename);
        }, this.debounceMs);

        this.debounceMap.set(normalizedFilename, timeout);
      }
    );

    this.watcher.on("error", (err) => {
      this.log(`Watcher error: ${err.message}`);
    });
  }

  private handleFileChange(relativePath: string): void {
    const entry = this.backupManager.backupFile(relativePath);
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
