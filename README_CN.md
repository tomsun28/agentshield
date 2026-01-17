# 🛡️ AgentShield

[English](./README.md) | 简体中文

给 AI Agent 套上一层盾牌 - 让你的 AI Agent 拥有"后悔药"。

**AI 代理的安全防护层** - 一个基于硬链接的零拷贝备份系统，保护你的工作区免受 AI 意外修改。

## ✨ 核心特性

- **⚡ 零拷贝备份** - 使用硬链接实现即时、节省空间的备份（10GB 文件 = 1ms 完成备份）
- **🕵️ 实时保护** - 监控工作区并在文件被修改前自动备份
- **📦 智能排除** - 自动忽略 `.git`、`node_modules`、构建产物等
- **🔒 原子执行模式** - 在运行代理命令前对整个工作区进行快照
- **⏮️ 轻松恢复** - 一个命令即可将任何文件回滚到原始状态

## 🚀 安装

### 通过 npm 安装

```bash
npm install -g agentshield
```

### 下载二进制文件

从 [Releases](https://github.com/tomsun28/agentshield/releases) 页面下载对应平台的二进制文件（支持 Windows, macOS, Linux）。

## 📖 使用方法

### Watch 模式（实时保护）

```bash
# 监控当前目录
shield watch

# 监控指定目录
shield watch ./my-project
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

### 一次性快照

```bash
# 创建当前目录的快照
shield snapshot

# 创建指定目录的快照  
shield snapshot ./my-project
```

### 恢复文件

```bash
# 列出所有可用的备份
shield restore

# 将特定文件恢复到最新备份
shield restore src/index.ts

# 列出所有备份详情
shield list
```

### 清理旧备份

```bash
# 删除7天前的备份（默认）
shield clean

# 删除3天前的备份
shield clean --days=3
```

## 🔍 默认排除项

以下模式会自动排除在备份之外：

- `.git`, `.git/**`
- `node_modules`, `node_modules/**`
- `*.log`, `*.tmp`, `*.swp`
- `dist/`, `build/`, `.next/`, `.nuxt/`
- `coverage/`, `.cache/`
- `__pycache__/`, `*.pyc`
- `.DS_Store`, `Thumbs.db`

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 开源协议

[Apache License 2.0](./LICENSE)