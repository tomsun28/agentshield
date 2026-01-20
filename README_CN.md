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

### 通过 npm 安装

```bash
npm install -g agentshield
```

### 二进制安装

```bash
curl -fsSL https://github.com/tomsun28/agentshield/raw/main/install.sh | bash
```

或者从 [Releases](https://github.com/tomsun28/agentshield/releases) 页面下载对应平台的二进制可执行文件（支持 Windows, macOS, Linux）。

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

### Exec 模式（推荐用于代理任务）

```bash
# 快照工作区，运行命令，然后允许轻松恢复
shield exec -- npm run agent-task
shield exec -- python ai_script.py
shield exec --path=./my-project -- cargo run
```

此模式会：
1. 在命令运行前创建完整快照
2. 执行你的代理命令
3. 允许你轻松恢复任何修改过的文件

### 恢复文件

```bash
# 列出所有备份及时间戳（用于 --time 选项）
shield list

# 恢复所有文件到最近的备份
shield restore

# 仅恢复特定文件到其最新备份
shield restore --file=src/index.ts

# 恢复所有文件到特定时间戳
shield restore --time=1737216000000

# 恢复特定文件到特定时间戳
shield restore --file=src/index.ts --time=1737216000000
```

### 列出备份

```bash
# 列出所有备份详情，包括时间戳
shield list
```

`list` 命令显示：
- 文件路径及事件类型图标（📄 修改、🗑️ 删除、📝 重命名）
- 相对时间和文件大小
- 精确时间戳（用于 `--time` 选项）
- ISO 日期字符串
- 重命名历史（如适用）

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