# 🛡️ AgentShield

[English](./README.md) | 中文

**给 Claude Code, Cowork, OpenCode, Eigent 等所有 AI Agent 套上一层盾牌 - 让你拥有"后悔药"。**

一个工作区历史版本管理工具，保护你的工作区免受 AI Agent 意外修改。

## ✨ 核心特性

- **⚡ 零拷贝备份** - 使用硬链接实现即时、节省空间的备份（10GB 文件 = 1ms 完成备份）
- **🕵️ 实时保护** - 监控工作区并在文件被修改前自动备份
- **📦 智能排除** - 自动忽略 `.git`、`node_modules`、构建产物等
- **🔒 原子执行模式** - 支持在运行代理命令前对整个工作区进行快照
- **⏮️ 轻松恢复** - 一个命令即可将任何文件回滚到原始状态

## 🚀 安装

### 桌面版

从 [Releases](https://github.com/tomsun28/agentshield/releases) 页面下载对应平台的安装包解压安装即可（支持 Windows, macOS, Linux）。

`shield_desktop_darwin_arm64.dmg` (macOS arm64)
`shield_desktop_darwin_x64.dmg` (macOS x64)
`shield_desktop_linux_arm64.tar.gz` (Linux arm64)
`shield_desktop_linux_x64.tar.gz` (Linux x64)
`shield_desktop_win_x64.exe` (Windows x64)

### CLI 版

**通过 npm 安装**

```bash
npm install -g agentshield
```

**通过二进制安装**

```bash
curl -fsSL https://github.com/tomsun28/agentshield/raw/main/install.sh | bash
```

或者从 [Releases](https://github.com/tomsun28/agentshield/releases) 页面下载对应平台的二进制可执行文件（支持 Windows, macOS, Linux）。

`shield_cli_darwin_arm64` (macOS arm64)
`shield_cli_darwin_x64` (macOS x64)
`shield_cli_linux_arm64` (Linux arm64)
`shield_cli_linux_x64` (Linux x64)
`shield_cli_win_x64.exe` (Windows x64)

## 📖 使用方法

### Watch 模式 (工作区实时保护)

> 支持后台守护进程模式 `shield start` 和前台模式 `shield watch`，选择其一即可.

```bash
# 监控当前目录 (后台模式)
shield start

# 监控指定目录 (后台模式)
shield start ./my-project

# 监控当前目录（前台模式）
shield watch

# 监控指定目录（前台模式）
shield watch ./my-project

# 停止后台进程
shield stop
shield stop ./my-project

# 检查状态
shield status
```

### 恢复文件

```bash
# 列出所有变更及快照点
shield list

# 恢复文件到特定快照点
shield restore <id>
```

### 状态和清理

```bash
# 显示备份统计和守护进程状态
shield status

# 删除7天前的备份（默认）
shield clean

# 删除3天前的备份
shield clean --days=3
```

## 🤝 贡献

非常欢迎提交 Issue 和 Pull Request！

## 📄 开源协议

[Apache License 2.0](./LICENSE)
