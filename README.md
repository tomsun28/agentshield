# 🛡️ AgentShield

English | [中文](./README_CN.md)

**The missing safety layer for Claude Code, Cowork, OpenCode and all AI Agents - Your "regret pill" for AI-assisted development.**

A workspace history version management tool that protects your workspace from unintended AI Agent modifications.

## ✨ Features

- **⚡ Zero-Copy Backups** - Uses hardlinks for instant, space-efficient backups (10GB file = 1ms backup)
- **🕵️ Real-time Protection** - Watches your workspace and automatically backs up files before changes
- **📦 Smart Exclusions** - Automatically ignores `.git`, `node_modules`, build artifacts, etc.
- **🔒 Atomic Exec Mode** - Snapshot entire workspace before running agent commands
- **⏮️ Easy Restore** - One command to roll back any file to its original state

## 🚀 Installation

### Via npm

```bash
npm install -g agentshield
```

### Download Binary

Download the binary for your platform from the [Releases](https://github.com/tomsun28/agentshield/releases) page (supports Windows, macOS, Linux).

## 📖 Usage


### Watch Mode (Workspace Real-time Protection)

> Support background daemon mode `shield start` and foreground mode `shield watch`, choose one.

```bash
# Start background watch (recommended)
shield start

# Start background watch for specific directory
shield start ./my-project

# Watch current directory (foreground)
shield watch

# Watch specific directory (foreground)
shield watch ./my-project

# Stop background watch
shield stop
shield stop ./my-project

# Check status
shield status
```

### Exec Mode (Recommended for Agent Tasks)

```bash
# Snapshot workspace, run command, then allow easy restore
shield exec -- npm run agent-task
shield exec -- python ai_script.py
shield exec --path=./my-project -- cargo run
```

This mode:
1. Takes a full snapshot before the command runs
2. Executes your agent command
3. Allows you to easily restore any modified files

### One-time Snapshot

```bash
# Take a snapshot of current directory
shield snapshot

# Take a snapshot of specific directory  
shield snapshot ./my-project
```

### Restore Files

```bash
# List all available backups
shield restore

# Restore specific file to latest backup
shield restore src/index.ts

# List all backups with details
shield list
```

### Status and Cleanup

```bash
# Show backup statistics and daemon status
shield status

# Remove backups older than 7 days (default)
shield clean

# Remove backups older than 3 days
shield clean --days=3
```

## 🤝 Contributing

Issues and Pull Requests are very welcome!

## 📄 License

[Apache License 2.0](./LICENSE)
