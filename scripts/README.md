# Scripts Directory

This directory contains various utility scripts for the AgentShield project.

## bump-version.js

A version bump script that updates version numbers across the entire project, including both CLI and desktop components.

### Usage

```bash
# Auto-bump patch version (0.1.0 -> 0.1.1)
node scripts/bump-version.js

# Auto-bump minor version (0.1.0 -> 0.2.0)
node scripts/bump-version.js minor

# Auto-bump major version (0.1.0 -> 1.0.0)
node scripts/bump-version.js major

# Set custom version
node scripts/bump-version.js custom 1.2.3
```

### What it updates

- `package.json` - Main CLI package version
- `desktop/package.json` - Desktop app version
- `desktop/src-tauri/Cargo.toml` - Rust backend version

### Features

- **Semantic versioning support**: Automatically increments major, minor, or patch versions
- **Custom version setting**: Set any specific version number
- **Git integration**: Shows git status and suggests commit commands
- **Error handling**: Validates version format and provides clear error messages
- **Cross-platform**: Works on macOS, Linux, and Windows

### Examples

```bash
# Bump patch version for a bug fix
node scripts/bump-version.js patch

# Bump minor version for a new feature
node scripts/bump-version.js minor

# Bump major version for breaking changes
node scripts/bump-version.js major

# Set specific version for release
node scripts/bump-version.js custom 2.1.0
```

## Other Scripts

- `fix-shebang.js` - Fixes shebang lines in built binaries
- `package_cli.sh` - Packages CLI for multiple platforms
- `package_desktop.sh` - Packages desktop application
