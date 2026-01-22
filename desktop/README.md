# AgentShield Desktop

Desktop application for AgentShield - Protect your code from AI agent mistakes.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) package manager
- [Rust](https://rustup.rs/) toolchain
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: Visual Studio Build Tools with C++ workload
  - **Linux**: `build-essential`, `libwebkit2gtk-4.1-dev`, `libssl-dev`, `libayatana-appindicator3-dev`

## Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm tauri:dev
```

## Building

```bash
# Build for production (creates installer)
pnpm tauri:build

# Build with debug symbols
pnpm tauri:build:debug
```

### Build Output

After building, installers will be in `src-tauri/target/release/bundle/`:

| Platform | Format | Location |
|----------|--------|----------|
| macOS | .dmg, .app | `bundle/dmg/`, `bundle/macos/` |
| Windows | .msi, .exe | `bundle/msi/`, `bundle/nsis/` |
| Linux | .deb, .AppImage | `bundle/deb/`, `bundle/appimage/` |

## Icon Generation

To regenerate app icons from the source SVG:

```bash
pnpm icon
```

This uses `app-icon.svg` to generate all required icon formats.

## Project Structure

```
desktop/
├── src/                    # React frontend
│   ├── pages/             # Page components
│   ├── App.tsx            # Main app component
│   └── main.tsx           # Entry point
├── src-tauri/             # Rust backend
│   ├── src/lib.rs         # Tauri commands
│   ├── icons/             # App icons
│   └── tauri.conf.json    # Tauri configuration
├── app-icon.svg           # Source icon
└── package.json
```

## IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
