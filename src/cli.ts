import { resolve, join } from "path";
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, appendFileSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { getDefaultConfig, ShieldConfig } from "./config.js";
import { BackupManager } from "./backup.js";
import { ShieldWatcher } from "./watcher.js";
import { formatBytes, formatTimeAgo } from "./utils.js";

interface CliOptions {
  command: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(args: string[]): CliOptions {
  const result: CliOptions = {
    command: args[0] || "help",
    args: [],
    flags: {},
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      result.flags[key] = value ?? true;
    } else if (arg.startsWith("-")) {
      result.flags[arg.slice(1)] = true;
    } else {
      result.args.push(arg);
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
🛡️  Shield - File Protection for AI Agents

Usage:
  shield <command> [options]

Commands:
  watch [path]           Start watching a directory (default: current dir)
  start [path]           Start watching in background (daemon mode)
  stop [path]            Stop background watching
  list                   List all snapshots (time-based versions)
  restore                Restore files from a snapshot
  clean [--days=N]       Remove snapshots older than N days (default: 7)
  status                 Show statistics
  help                   Show this help message

Restore Options:
  shield restore                      Interactive: show recent snapshots
  shield restore --id=<snapshot_id>   Restore a specific snapshot by ID
  shield restore --time=<timestamp>   Restore snapshot by timestamp
  shield restore --file=<path>        Restore a specific file to latest version

Options:
  --path=<dir>           Specify workspace directory
  --days=<N>             For clean: max age in days
  --id=<snapshot_id>     For restore: snapshot ID (e.g., snap_1737216000000)
  --time=<timestamp>     For restore: snapshot timestamp
  --file=<path>          For restore: specific file path

Examples:
  shield watch ./my-project
  shield start ./my-project
  shield list
  shield restore --id=snap_1737216000000
  shield restore --time=1737216000000
  shield restore --file=src/index.ts
  shield clean --days=3
  shield status
`);
}

export async function runCli(argv: string[]): Promise<void> {
  const options = parseArgs(argv.slice(2));
  
  switch (options.command) {
    case "watch":
      await cmdWatch(options);
      break;
    case "start":
      await cmdStart(options);
      break;
    case "stop":
      await cmdStop(options);
      break;
    case "restore":
      await cmdRestore(options);
      break;
    case "list":
      await cmdList(options);
      break;
    case "clean":
      await cmdClean(options);
      break;
    case "status":
      await cmdStatus(options);
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}

async function getConfig(options: CliOptions): Promise<ShieldConfig> {
  const pathArg = (options.flags["path"] as string) || options.args[0] || ".";
  const workspace = resolve(pathArg);
  
  if (!existsSync(workspace)) {
    console.error(`Error: Directory not found: ${workspace}`);
    process.exit(1);
  }
  
  return getDefaultConfig(workspace);
}

async function cmdWatch(options: CliOptions): Promise<void> {
  const config = await getConfig(options);
  const isDaemon = options.flags["daemon"] === true;
  const logFilePath = options.flags["log-file"] as string | undefined;
  
  const log = createLogger(logFilePath);
  
  if (!isDaemon) {
    const existingPid = checkExistingProcess(config);
    if (existingPid !== null) {
      log(`❌ Shield is already running in this workspace (PID: ${existingPid})`);
      log(`   Use 'shield stop' to stop it first, or 'shield status' to check.`);
      process.exit(1);
    }
  }
  
  const backupManager = new BackupManager(config);
  const watcher = new ShieldWatcher(config, backupManager, log);
  
  watcher.start();
  
  process.on("SIGINT", () => {
    log("");
    watcher.stop();
    const stats = backupManager.getStats();
    log(`📊 Session summary: ${stats.snapshots} snapshots, ${stats.uniqueFiles} unique files`);
    process.exit(0);
  });
  
  process.on("SIGTERM", () => {
    watcher.stop();
    const stats = backupManager.getStats();
    log(`📊 Session summary: ${stats.snapshots} snapshots, ${stats.uniqueFiles} unique files`);
    log(`Shield daemon stopped`);
    process.exit(0);
  });
  
  await new Promise(() => {});
}

async function cmdRestore(options: CliOptions): Promise<void> {
  const pathArg = (options.flags["path"] as string) || ".";
  const workspace = resolve(pathArg);
  
  if (!existsSync(workspace)) {
    console.error(`Error: Directory not found: ${workspace}`);
    process.exit(1);
  }
  
  const config = getDefaultConfig(workspace);
  const backupManager = new BackupManager(config);
  const restoreLockPath = join(config.vaultDir, "restore.lock");
  
  const idFlag = options.flags["id"] as string | undefined;
  const timeFlag = options.flags["time"] as string | undefined;
  const fileFlag = options.flags["file"] as string | undefined;
  
  const snapshots = backupManager.getAllSnapshots();
  
  if (snapshots.length === 0) {
    console.log("No snapshots available");
    return;
  }

  try {
    writeFileSync(restoreLockPath, `${Date.now()}`);

    // 按快照 ID 恢复
    if (idFlag) {
      console.log(`🔄 Restoring snapshot: ${idFlag}...`);
      const result = backupManager.restoreSnapshot(idFlag);
      if (result.restored > 0 || result.deleted > 0) {
        console.log(`✓ Restored ${result.restored} files, removed ${result.deleted} new files`);
      } else if (result.failed > 0) {
        console.log(`✗ Failed to restore: ${result.failed} files`);
        process.exit(1);
      } else {
        console.log(`✗ Snapshot not found: ${idFlag}`);
        process.exit(1);
      }
      return;
    }

    // 按时间戳恢复
    if (timeFlag) {
      const timestamp = parseInt(timeFlag, 10);
      if (isNaN(timestamp)) {
        console.error(`Error: Invalid timestamp: ${timeFlag}`);
        process.exit(1);
      }
      console.log(`🔄 Restoring snapshot at ${new Date(timestamp).toISOString()}...`);
      const result = backupManager.restoreToSnapshot(timestamp);
      if (result.restored > 0 || result.deleted > 0) {
        console.log(`✓ Restored ${result.restored} files, removed ${result.deleted} new files`);
      } else {
        console.log(`✗ No snapshot found at timestamp: ${timestamp}`);
        process.exit(1);
      }
      return;
    }

    // 恢复单个文件
    if (fileFlag) {
      console.log(`🔄 Restoring file: ${fileFlag}...`);
      const success = backupManager.restoreFile(fileFlag);
      if (success) {
        console.log(`✓ Restored: ${fileFlag}`);
      } else {
        console.log(`✗ Failed to restore: ${fileFlag}`);
        process.exit(1);
      }
      return;
    }

    // 显示最近的快照供选择
    console.log("📋 Recent Snapshots (use --id=<snapshot_id> to restore)\n");
    for (const snapshot of snapshots.slice(0, 10)) {
      const timeStr = formatTimeAgo(snapshot.timestamp);
      const dateStr = new Date(snapshot.timestamp).toISOString();
      const fileCount = snapshot.files.length;
      
      console.log(`  📦 ${snapshot.id}`);
      console.log(`    └─ ${timeStr} | ${fileCount} file(s) | ${dateStr}`);
      for (const file of snapshot.files.slice(0, 5)) {
        const icon = file.eventType === "delete" ? "🗑️" : 
                     file.eventType === "rename" ? "📝" : 
                     file.eventType === "create" ? "✨" : "📄";
        console.log(`       ${icon} ${file.path}`);
      }
      if (snapshot.files.length > 5) {
        console.log(`       ... and ${snapshot.files.length - 5} more files`);
      }
      console.log("");
    }
    
    if (snapshots.length > 10) {
      console.log(`  ... and ${snapshots.length - 10} more snapshots (use 'shield list' to see all)`);
    }
    
    console.log("\n📌 Legend: 📄 changed | 🗑️ deleted | 📝 renamed | ✨ created");
    console.log("\n💡 Usage: shield restore --id=snap_XXXXX");

  } finally {
    try {
      if (existsSync(restoreLockPath)) {
        unlinkSync(restoreLockPath);
      }
    } catch {
      // ignore
    }
  }
}

async function cmdList(options: CliOptions): Promise<void> {
  const config = await getConfig(options);
  const backupManager = new BackupManager(config);
  
  const snapshots = backupManager.getAllSnapshots();
  
  if (snapshots.length === 0) {
    console.log("No snapshots found");
    console.log("\n💡 Snapshots are created automatically when Shield detects file changes.");
    return;
  }
  
  console.log(`�� All Snapshots (${snapshots.length} total)\n`);
  
  for (const snapshot of snapshots.slice(0, 30)) {
    const timeStr = formatTimeAgo(snapshot.timestamp);
    const dateStr = new Date(snapshot.timestamp).toISOString();
    const fileCount = snapshot.files.length;
    const totalSize = snapshot.files.reduce((sum, f) => sum + f.size, 0);
    
    console.log(`  📦 ${snapshot.id}`);
    console.log(`    └─ ${timeStr} | ${fileCount} file(s) | ${formatBytes(totalSize)} | ${dateStr}`);
    
    for (const file of snapshot.files) {
      const icon = file.eventType === "delete" ? "🗑️" : 
                   file.eventType === "rename" ? "📝" : 
                   file.eventType === "create" ? "✨" : "📄";
      const suffix = file.renamedTo ? ` → ${file.renamedTo}` : "";
      console.log(`       ${icon} ${file.path}${suffix}`);
    }
    console.log("");
  }
  
  if (snapshots.length > 30) {
    console.log(`  ... and ${snapshots.length - 30} more snapshots`);
  }
  
  console.log("📌 Legend: 📄 changed | 🗑️ deleted | 📝 renamed | ✨ created");
  console.log("\n💡 To restore: shield restore --id=<snapshot_id>");
}

async function cmdClean(options: CliOptions): Promise<void> {
  const config = await getConfig(options);
  const backupManager = new BackupManager(config);
  
  const days = parseInt(options.flags["days"] as string) || 7;
  
  console.log(`🧹 Cleaning snapshots older than ${days} days...`);
  const result = backupManager.cleanOldSnapshots(days);
  console.log(`✓ Removed ${result.removed} snapshots, freed ${formatBytes(result.freedBytes)}`);
}

async function cmdStatus(options: CliOptions): Promise<void> {
  const config = await getConfig(options);
  const backupManager = new BackupManager(config);
  
  const stats = backupManager.getStats();
  
  console.log("📊 Shield Status\n");
  console.log(`  Workspace:      ${config.workspace}`);
  console.log(`  Vault:          ${config.vaultDir}`);
  console.log(`  Snapshots:      ${stats.snapshots}`);
  console.log(`  Total Files:    ${stats.totalFiles}`);
  console.log(`  Unique Files:   ${stats.uniqueFiles}`);
  console.log(`  Total Size:     ${formatBytes(stats.totalSize)}`);
  
  const pidFile = getPidFilePath(config);
  if (existsSync(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    if (isProcessRunning(pid)) {
      console.log(`  Background:     Running (PID: ${pid})`);
    } else {
      console.log(`  Background:     Stale PID file (process not running)`);
    }
  } else {
    console.log(`  Background:     Not running`);
  }
}

const PID_FILE = "shield.pid";
const LOG_FILE = "shield.log";

function getPidFilePath(config: ShieldConfig): string {
  return join(config.vaultDir, PID_FILE);
}

function getLogFilePath(config: ShieldConfig): string {
  return join(config.vaultDir, LOG_FILE);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ensureShieldDir(config: ShieldConfig): void {
  if (!existsSync(config.vaultDir)) {
    mkdirSync(config.vaultDir, { recursive: true });
  }
}

function checkExistingProcess(config: ShieldConfig): number | null {
  const pidFile = getPidFilePath(config);
  if (!existsSync(pidFile)) {
    return null;
  }
  
  const pidStr = readFileSync(pidFile, "utf-8").trim();
  const pid = parseInt(pidStr, 10);
  
  if (isNaN(pid)) {
    return null;
  }
  
  if (isProcessRunning(pid)) {
    return pid;
  }
  
  unlinkSync(pidFile);
  return null;
}

function stopProcess(pid: number): boolean {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", pid.toString(), "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

function createLogger(logFilePath?: string): (message: string) => void {
  if (logFilePath) {
    return (message: string) => {
      const timestamp = new Date().toISOString();
      appendFileSync(logFilePath, `[${timestamp}] ${message}\n`);
    };
  }
  return (message: string) => console.log(message);
}

async function cmdStart(options: CliOptions): Promise<void> {
  const config = await getConfig(options);
  
  const existingPid = checkExistingProcess(config);
  if (existingPid !== null) {
    console.error(`❌ Shield is already running in this workspace (PID: ${existingPid})`);
    console.error(`   Use 'shield stop' to stop it first, or 'shield status' to check.`);
    process.exit(1);
  }
  
  ensureShieldDir(config);
  
  const logFile = getLogFilePath(config);
  const pidFile = getPidFilePath(config);
  
  const timestamp = new Date().toISOString();
  appendFileSync(logFile, `\n${"─".repeat(50)}\n[${timestamp}] Shield daemon starting...\n`);
  
  const scriptPath = process.argv[1];
  const args = ["watch", "--daemon", `--log-file=${logFile}`, config.workspace];
  
  const isWindows = process.platform === "win32";
  
  const isCompiledBinary = scriptPath.startsWith("/$bunfs/") || 
    resolve(process.execPath) === resolve(scriptPath);
  
  const spawnArgs = isCompiledBinary ? args : [scriptPath, ...args];
  
  const child = spawn(process.execPath, spawnArgs, {
    detached: true,
    stdio: "ignore",
    cwd: config.workspace,
    ...(isWindows ? { windowsHide: true } : {}),
  });
  
  if (!child.pid) {
    console.error("❌ Failed to start background process");
    process.exit(1);
  }
  
  writeFileSync(pidFile, child.pid.toString());
  
  child.unref();
  
  await new Promise((resolve) => setTimeout(resolve, 300));
  
  if (isProcessRunning(child.pid)) {
    console.log(`🛡️  Shield started in background`);
    console.log(`   PID: ${child.pid}`);
    console.log(`   Workspace: ${config.workspace}`);
    console.log(`   Log file: ${logFile}`);
    console.log(`\n   Use 'shield stop' to stop monitoring`);
  } else {
    console.error("❌ Background process failed to start");
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }
    process.exit(1);
  }
}

async function cmdStop(options: CliOptions): Promise<void> {
  const config = await getConfig(options);
  const pidFile = getPidFilePath(config);
  const logFile = getLogFilePath(config);
  
  if (!existsSync(pidFile)) {
    console.log("⚠️  No Shield process is running in this workspace");
    return;
  }
  
  const pidStr = readFileSync(pidFile, "utf-8").trim();
  const pid = parseInt(pidStr, 10);
  
  if (isNaN(pid)) {
    console.error("❌ Invalid PID file");
    unlinkSync(pidFile);
    process.exit(1);
  }
  
  if (!isProcessRunning(pid)) {
    console.log("⚠️  Shield process is not running (stale PID file)");
    unlinkSync(pidFile);
    return;
  }
  
  console.log(`🛑 Stopping Shield (PID: ${pid})...`);
  
  const stopped = stopProcess(pid);
  
  if (stopped) {
    let attempts = 0;
    const maxAttempts = 10;
    while (isProcessRunning(pid) && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      attempts++;
    }
    
    if (!isProcessRunning(pid)) {
      if (existsSync(pidFile)) {
        unlinkSync(pidFile);
      }
      
      const timestamp = new Date().toISOString();
      if (existsSync(logFile)) {
        appendFileSync(logFile, `[${timestamp}] Shield daemon stopped\n${"─".repeat(50)}\n`);
      }
      
      console.log("✓ Shield stopped successfully");
    } else {
      console.error("❌ Failed to stop Shield process");
      console.error(`   You may need to manually kill PID ${pid}`);
      process.exit(1);
    }
  } else {
    console.error("❌ Failed to send stop signal");
    process.exit(1);
  }
}
