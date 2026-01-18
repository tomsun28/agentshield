import { resolve } from "path";
import { existsSync } from "fs";
import { spawn } from "child_process";
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
  exec <command>         Snapshot workspace, run command, then allow restore
  snapshot [path]        Take a one-time snapshot of all files
  restore [file]         Restore a file to its backed-up version
  list                   List all backups
  clean [--days=N]       Remove backups older than N days (default: 7)
  status                 Show backup statistics
  help                   Show this help message

Options:
  --path=<dir>           Specify workspace directory
  --days=<N>             For clean command: max age in days

Examples:
  shield watch ./my-project
  shield exec -- npm run agent-task
  shield restore src/index.ts
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
  const backupManager = new BackupManager(config);
  const watcher = new ShieldWatcher(config, backupManager);
  
  watcher.start();
  
  process.on("SIGINT", () => {
    console.log("\n");
    watcher.stop();
    const stats = backupManager.getStats();
    console.log(`\n📊 Session summary: ${stats.totalBackups} backups, ${stats.uniqueFiles} unique files`);
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
  
  const fileArg = options.args[0];
  
  if (!fileArg) {
    const backups = backupManager.getAllBackups();
    if (backups.length === 0) {
      console.log("No backups available");
      return;
    }
    
    console.log("Available backups (use 'shield restore <file>' to restore):\n");
    const uniqueFiles = new Map<string, typeof backups[0]>();
    for (const backup of backups) {
      if (!uniqueFiles.has(backup.originalPath)) {
        uniqueFiles.set(backup.originalPath, backup);
      }
    }
    
    for (const [path, backup] of uniqueFiles) {
      console.log(`  ${path} (${formatTimeAgo(backup.timestamp)})`);
    }
    return;
  }
  
  console.log(`🔄 Restoring: ${fileArg}`);
  const success = backupManager.restoreLatest(fileArg);
  if (success) {
    console.log(`✓ Restored: ${fileArg}`);
  } else {
    console.log(`✗ Failed to restore: ${fileArg}`);
    process.exit(1);
  }
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
  
  for (const backup of backups.slice(0, 50)) {
    const timeStr = formatTimeAgo(backup.timestamp);
    const sizeStr = formatBytes(backup.size);
    console.log(`  ${backup.originalPath}`);
    console.log(`    └─ ${timeStr} | ${sizeStr}`);
  }
  
  if (backups.length > 50) {
    console.log(`\n  ... and ${backups.length - 50} more`);
  }
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
}
