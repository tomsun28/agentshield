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
  exec <command>         Snapshot workspace, run command, then allow restore
  snapshot [path]        Take a one-time snapshot of all files
  restore                Restore all files to most recent backup
  list                   List all backups with timestamps
  clean [--days=N]       Remove backups older than N days (default: 7)
  status                 Show backup statistics
  help                   Show this help message

Restore Options:
  shield restore                    Restore all files to most recent backup
  shield restore --file=<path>      Restore only a specific file
  shield restore --time=<timestamp> Restore all files to a specific time

Options:
  --path=<dir>           Specify workspace directory
  --days=<N>             For clean command: max age in days
  --file=<path>          For restore: restore specific file only
  --time=<timestamp>     For restore: restore to specific timestamp

Examples:
  shield watch ./my-project
  shield exec -- npm run agent-task
  shield restore
  shield restore --file=src/index.ts
  shield restore --time=1737216000000
  shield list
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
    case "exec":
      await cmdExec(options, argv);
      break;
    case "snapshot":
      await cmdSnapshot(options);
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
    log(`📊 Session summary: ${stats.totalBackups} backups, ${stats.uniqueFiles} unique files`);
    process.exit(0);
  });
  
  process.on("SIGTERM", () => {
    watcher.stop();
    const stats = backupManager.getStats();
    log(`📊 Session summary: ${stats.totalBackups} backups, ${stats.uniqueFiles} unique files`);
    log(`Shield daemon stopped`);
    process.exit(0);
  });
  
  await new Promise(() => {});
}

async function cmdExec(options: CliOptions, rawArgv: string[]): Promise<void> {
  const dashDashIndex = rawArgv.indexOf("--");
  if (dashDashIndex === -1 || dashDashIndex === rawArgv.length - 1) {
    console.error("Usage: shield exec -- <command>");
    console.error("Example: shield exec -- npm run agent-task");
    process.exit(1);
  }
  
  const commandArgs = rawArgv.slice(dashDashIndex + 1);
  const pathArg = (options.flags["path"] as string) || ".";
  const workspace = resolve(pathArg);
  const config = getDefaultConfig(workspace);
  const backupManager = new BackupManager(config);
  
  console.log("🛡️  Shield Exec Mode");
  console.log("─".repeat(50));
  
  console.log("📸 Taking pre-execution snapshot...");
  const snapshot = backupManager.snapshotWorkspace();
  console.log(`✓ Snapshot complete: ${snapshot.backed} files backed up, ${snapshot.skipped} skipped`);
  console.log("─".repeat(50));
  
  console.log(`🚀 Running: ${commandArgs.join(" ")}`);
  console.log("─".repeat(50));
  
  const child = spawn(commandArgs[0], commandArgs.slice(1), {
    stdio: "inherit",
    shell: true,
    cwd: workspace,
  });
  
  await new Promise<void>((resolve, reject) => {
    child.on("close", (code) => {
      console.log("─".repeat(50));
      if (code === 0) {
        console.log("✓ Command completed successfully");
      } else {
        console.log(`⚠ Command exited with code ${code}`);
      }
      console.log("\n💡 To restore files, run: shield restore <file>");
      console.log("   To list all backups: shield list");
      resolve();
    });
    child.on("error", reject);
  });
}

async function cmdSnapshot(options: CliOptions): Promise<void> {
  const config = await getConfig(options);
  const backupManager = new BackupManager(config);
  
  console.log("📸 Taking snapshot...");
  const result = backupManager.snapshotWorkspace();
  console.log(`✓ Complete: ${result.backed} files backed up, ${result.skipped} skipped`);
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
  
  const fileFlag = options.flags["file"] as string | undefined;
  const timeFlag = options.flags["time"] as string | undefined;
  
  const backups = backupManager.getAllBackups();
  if (backups.length === 0) {
    console.log("No backups available");
    return;
  }

  if (fileFlag && timeFlag) {
    const timestamp = parseInt(timeFlag, 10);
    if (isNaN(timestamp)) {
      console.error(`Error: Invalid timestamp: ${timeFlag}`);
      process.exit(1);
    }
    console.log(`🔄 Restoring file '${fileFlag}' to timestamp ${timestamp}...`);
    const success = backupManager.restoreFileToTime(fileFlag, timestamp);
    if (success) {
      console.log(`✓ Restored: ${fileFlag} to version at ${new Date(timestamp).toISOString()}`);
    } else {
      console.log(`✗ Failed to restore: ${fileFlag}`);
      process.exit(1);
    }
    return;
  }

  if (fileFlag) {
    console.log(`🔄 Restoring file: ${fileFlag}`);
    const success = backupManager.restoreLatest(fileFlag);
    if (success) {
      console.log(`✓ Restored: ${fileFlag}`);
    } else {
      console.log(`✗ Failed to restore: ${fileFlag}`);
      process.exit(1);
    }
    return;
  }

  if (timeFlag) {
    const timestamp = parseInt(timeFlag, 10);
    if (isNaN(timestamp)) {
      console.error(`Error: Invalid timestamp: ${timeFlag}`);
      process.exit(1);
    }
    console.log(`🔄 Restoring all files to timestamp ${timestamp} (${new Date(timestamp).toISOString()})...`);
    const result = backupManager.restoreToTime(timestamp);
    console.log(`✓ Restored ${result.restored} files, ${result.failed} failed, ${result.deleted} cleaned`);
    return;
  }

  console.log("🔄 Restoring all files to most recent backup...");
  const result = backupManager.restoreAllLatest();
  console.log(`✓ Restored ${result.restored} files, ${result.failed} failed, ${result.deleted} cleaned`);
}

async function cmdList(options: CliOptions): Promise<void> {
  const config = await getConfig(options);
  const backupManager = new BackupManager(config);
  
  const backups = backupManager.getAllBackups();
  
  if (backups.length === 0) {
    console.log("No backups found");
    return;
  }
  
  console.log(`📋 All Backups (${backups.length} total)\n`);
  console.log("  Use 'shield restore --time=<timestamp>' to restore to a specific time\n");
  
  for (const backup of backups.slice(0, 50)) {
    const timeStr = formatTimeAgo(backup.timestamp);
    const sizeStr = formatBytes(backup.size);
    const dateStr = new Date(backup.timestamp).toISOString();
    const eventType = backup.eventType || "change";
    const eventIcon = eventType === "delete" ? "🗑️" : eventType === "rename" ? "📝" : "📄";
    
    console.log(`  ${eventIcon} ${backup.originalPath}`);
    console.log(`    └─ ${timeStr} | ${sizeStr} | timestamp: ${backup.timestamp}`);
    console.log(`       ${dateStr}${backup.renamedFrom ? ` (renamed from: ${backup.renamedFrom})` : ""}`);
  }
  
  if (backups.length > 50) {
    console.log(`\n  ... and ${backups.length - 50} more`);
  }
  
  console.log("\n📌 Legend: 📄 changed | 🗑️ deleted | 📝 renamed");
}

async function cmdClean(options: CliOptions): Promise<void> {
  const config = await getConfig(options);
  const backupManager = new BackupManager(config);
  
  const days = parseInt(options.flags["days"] as string) || 7;
  
  console.log(`🧹 Cleaning backups older than ${days} days...`);
  const result = backupManager.cleanOldBackups(days);
  console.log(`✓ Removed ${result.removed} backups, freed ${formatBytes(result.freedBytes)}`);
}

async function cmdStatus(options: CliOptions): Promise<void> {
  const config = await getConfig(options);
  const backupManager = new BackupManager(config);
  
  const stats = backupManager.getStats();
  
  console.log("📊 Shield Status\n");
  console.log(`  Workspace:      ${config.workspace}`);
  console.log(`  Vault:          ${config.vaultDir}`);
  console.log(`  Total Backups:  ${stats.totalBackups}`);
  console.log(`  Unique Files:   ${stats.uniqueFiles}`);
  console.log(`  Total Size:     ${formatBytes(stats.totalSize)}`);
  console.log(`  Sessions:       ${stats.sessions}`);
  
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
  
  const child = spawn(process.execPath, [scriptPath, ...args], {
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
