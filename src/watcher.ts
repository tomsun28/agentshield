import { watch, FSWatcher } from "fs";
import { join, relative } from "path";
import { BackupManager } from "./backup";
import { ShieldConfig } from "./config";

export class ShieldWatcher {
  private config: ShieldConfig;
  private backupManager: BackupManager;
  private watcher: FSWatcher | null = null;
  private debounceMap: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs: number = 50;

  constructor(config: ShieldConfig, backupManager: BackupManager) {
    this.config = config;
    this.backupManager = backupManager;
  }

  start(): void {
    if (this.watcher) {
      console.log("Watcher already running");
      return;
    }

    console.log(`🚀 Shield started, protecting: ${this.config.workspace}`);
    console.log(`📁 Vault location: ${this.config.vaultDir}`);
    console.log("─".repeat(50));

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
      console.error("Watcher error:", err);
    });
  }

  private handleFileChange(relativePath: string): void {
    const entry = this.backupManager.backupFile(relativePath);
    if (entry) {
      console.log(`[🛡️ Shield] Original version locked: ${relativePath}`);
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
      
      console.log("Shield stopped");
    }
  }

  resetSession(): void {
    this.backupManager.resetSession();
    console.log("─".repeat(50));
    console.log("🔄 New session started, protection state reset");
  }
}
