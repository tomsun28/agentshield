# 🛡️ AgentShield

[English](./README.md) | 中文

**给 AI 操作本地电脑加一颗"后悔药"**

现在越来越多的人使用 Cowork 和 Claude Code 在本地操作文件。
这很强大 — 但当 AI 发疯时，你的工作区可能会被永久搞乱。

一个周末，踢完足球回家后，我突然有了一个想法。
我花了整个周末时间编写了 **AgentShield** — 一个为 AI 驱动的代理提供的安全护盾。

AgentShield 实时保护你的工作区。当出现问题时，你可以一键回滚所有内容。可以把它想象成 **AI 的后悔药**。

![demo](./desktop/demo.png)

### AgentShield 的功能

- 🛡 实时文件监控和快照
- ⏪ 当 AI 搞砸时一键回滚
- � 桌面应用 + CLI，零拷贝，低磁盘开销

### 使用方法（无需编码）

1. 下载桌面应用 [点击下载](https://github.com/tomsun28/agentshield/releases)
2. 选择你的工作区文件夹并保护它
3. 让 AI 自由工作
4. 如果发生灾难 → 点击 **回滚**

从 [Releases](https://github.com/tomsun28/agentshield/releases) 页面下载对应平台的安装包解压安装即可（支持 Windows, macOS, Linux）。

- `shield_desktop_darwin_arm64.dmg` (macOS arm64)
- `shield_desktop_darwin_x64.dmg` (macOS x64)
- `shield_desktop_linux_arm64.tar.gz` (Linux arm64)
- `shield_desktop_linux_x64.tar.gz` (Linux x64)
- `shield_desktop_win_x64.exe` (Windows x64)

MacOS 用户若遇到"AgentShield.app 已损坏且无法打开"的提示，可在终端运行以下命令：
```
sudo xattr -rd com.apple.quarantine /Applications/AgentShield.app
```

### 适用人群

- Cowork、Claude Code、OpenCode、Eigent 等 AI Agent 用户
- 在本地使用 AI 的设计师和作家
- 自动化工作流的非技术用户
- 24/7 运行多个代理的开发者

### 还有 CLI 版本

**通过 npm 安装**

```bash
npm install -g agentshield
```

**通过二进制安装**

```bash
curl -fsSL https://github.com/tomsun28/agentshield/raw/main/install.sh | bash
```

或者从 [Releases](https://github.com/tomsun28/agentshield/releases) 页面下载对应平台的可执行二进制文件（支持 Windows, macOS, Linux）。

## 🤝 贡献

非常欢迎提交 Issue 和 Pull Request！

## 📄 开源协议

[Apache License 2.0](./LICENSE)
