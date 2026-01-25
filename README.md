# 🛡️ AgentShield

English | [中文](./README_CN.md)

**An Undo Button for AI on Your Local Computer**

Nowadays, more and more people use Cowork & Claude Code to manipulate files locally.
It’s powerful — but when AI goes crazy, your workspace can be permanently messed up.

One weekend, after playing football and heading home, an idea suddenly hit me.
I spent the whole weekend hacking together **AgentShield** — a safety shield for AI-driven agent.

AgentShield protects your workspace in real time. When things go wrong, you can rollback everything with one click. Think of it as a **regret pill for AI.**


![demo](./desktop/demo.png)

### What AgentShield Does

- 🛡 Real-time file monitoring & snapshot
- ⏪ One-click rollback when AI messes things up
- 💻 Desktop app + CLI, zero-copy, low disk overhead

### How It Works (No Coding Required)

1. Download the desktop app [Download here](https://github.com/tomsun28/agentshield/releases)
2. Select your workspace folder and protect it
3. Let AI work freely
4. If disaster happens → Click **Rollback**

Download the corresponding platform installation package from the [Releases](https://github.com/tomsun28/agentshield/releases) page and extract it to install (supports Windows, macOS, Linux).

- `shield_desktop_darwin_arm64.dmg` (macOS arm64)
- `shield_desktop_darwin_x64.dmg` (macOS x64)
- `shield_desktop_linux_arm64.tar.gz` (Linux arm64)
- `shield_desktop_linux_x64.tar.gz` (Linux x64)
- `shield_desktop_win_x64.exe` (Windows x64)

For MacOS if you see “AgentShield.app is damaged and can’t be opened”, run the following command in Terminal:
```
sudo xattr -rd com.apple.quarantine /Applications/AgentShield.app
```

### Who Is This For?

- Cowork, Claude Code, OpenCode, Eigent and others AI Agent users
- Designers & writers using AI locally
- Non-technical users automating workflows
- Developers running multiple agents 24/7

### And CLI Version

**Via npm installation**

```bash
npm install -g agentshield
```

**Via binary installation**

```bash
curl -fsSL https://github.com/tomsun28/agentshield/raw/main/install.sh | bash
```

Or download the executable binary for your platform from the [Releases](https://github.com/tomsun28/agentshield/releases) page (supports Windows, macOS, Linux).

## 🤝 Contributing

Issues and Pull Requests are very welcome!

## 📄 License

[Apache License 2.0](./LICENSE)
