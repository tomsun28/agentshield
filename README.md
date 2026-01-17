# AgentShield 🛡️

**Instant file protection for AI agent operations** - A hardlink-based zero-copy backup system that protects your codebase from unintended AI modifications.

## Features

- **Zero-Copy Backups**: Uses hardlinks for instant, space-efficient backups (10GB file = 1ms backup)
- **Real-time Protection**: Watches your workspace and automatically backs up files before changes
- **Smart Exclusions**: Automatically ignores `.git`, `node_modules`, build artifacts, etc.
- **Atomic Exec Mode**: Snapshot entire workspace before running agent commands
- **Easy Restore**: One command to roll back any file to its original state
- **Single Binary**: Compile to standalone executable - no runtime dependencies

## Installation

### From Source (requires Bun)

```bash
# Install dependencies
bun install

# Run directly
bun run src/index.ts --help

# Build standalone binary
bun run build
```

### Standalone Binary

After building, you get a single `agent-shield` binary that works without Bun or Node.js:

```bash
./agent-shield --help
```

## Usage

### Watch Mode (Real-time Protection)

```bash
# Watch current directory
agent-shield watch

# Watch specific directory
agent-shield watch ./my-project
```

Files are automatically backed up when they're about to be modified. Press `Ctrl+C` to stop.

### Exec Mode (Recommended for Agent Tasks)

```bash
# Snapshot workspace, run command, then allow easy restore
agent-shield exec -- npm run agent-task
agent-shield exec -- python ai_script.py
agent-shield exec --path=./my-project -- cargo run
```

This mode:
1. Takes a full snapshot before the command runs
2. Executes your agent command
3. Allows you to easily restore any modified files

### One-time Snapshot

```bash
# Take a snapshot of current directory
agent-shield snapshot

# Take a snapshot of specific directory  
agent-shield snapshot ./my-project
```

### Restore Files

```bash
# List all available backups
agent-shield restore

# Restore specific file to latest backup
agent-shield restore src/index.ts

# List all backups with details
agent-shield list
```

### Cleanup Old Backups

```bash
# Remove backups older than 7 days (default)
agent-shield clean

# Remove backups older than 3 days
agent-shield clean --days=3
```

### Check Status

```bash
agent-shield status
```

## How It Works

### Hardlink Magic

When AgentShield backs up a file, it uses **hardlinks** instead of copying:

```
Original: /project/src/index.ts  ──┐
                                   ├──► Same data blocks on disk
Backup:   /.agent_shield/123_src__index.ts ──┘
```

- **Instant**: Creating a hardlink takes ~1ms regardless of file size
- **Zero Extra Space**: Both files point to the same data blocks
- **Copy-on-Write**: When the original is modified, the backup retains the old content

### Fallback for Cross-Partition

If hardlinks fail (e.g., backup on different partition), AgentShield automatically falls back to streaming copy with a warning.

## Integration Example

For AI agent developers, integrate AgentShield to offer "Undo Agent Changes":

```typescript
import { spawn } from "child_process";

// Before agent runs
spawn("agent-shield", ["snapshot", "./workspace"]);

// Run your agent
await runAgent();

// Offer restore UI
// User clicks "Undo" → spawn("agent-shield", ["restore", "file.ts"]);
```

## Directory Structure

```
your-project/
├── src/
├── package.json
└── .agent_shield/          # Hidden vault
    ├── index.json          # Backup index
    └── snapshots/          # Backup files
        ├── 1234567890_src__index.ts
        └── 1234567891_src__utils.ts
```

## Build for Distribution

```bash
# macOS (current platform)
bun run build

# Cross-compile
bun run build:windows  # → agent-shield.exe
bun run build:linux    # → agent-shield-linux

# Build all platforms
bun run build:all
```

## Default Exclusions

These patterns are automatically excluded from backup:

- `.git`, `.git/**`
- `node_modules`, `node_modules/**`
- `*.log`, `*.tmp`, `*.swp`
- `dist/`, `build/`, `.next/`, `.nuxt/`
- `coverage/`, `.cache/`
- `__pycache__/`, `*.pyc`
- `.DS_Store`, `Thumbs.db`

## License

MIT
