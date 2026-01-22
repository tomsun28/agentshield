#!/bin/bash
set -e

# AgentShield Desktop Package Script
# Creates desktop app releases with bundled CLI binary
# Output format: shield_desktop_{os}_{arch}.{ext}
#
# Usage:
#   ./package_desktop.sh              # Build for current platform
#   ./package_desktop.sh darwin:arm64 # Build for specific platform (requires cross-compilation setup)
#   ./package_desktop.sh all          # Build for all platforms (CI only)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DESKTOP_DIR="$PROJECT_ROOT/desktop"
TAURI_DIR="$DESKTOP_DIR/src-tauri"
BIN_DIR="$TAURI_DIR/bin"
DIST_DIR="$PROJECT_ROOT/releases"
NAME="shield_desktop"

# Get version from desktop tauri.conf.json
VERSION=$(node -p "require('$TAURI_DIR/tauri.conf.json').version")

echo "📦 Packaging AgentShield Desktop v$VERSION"
echo "=========================================="

# Create directories
mkdir -p "$BIN_DIR"
mkdir -p "$DIST_DIR"

# Detect current platform
detect_platform() {
    local os arch
    
    case "$(uname -s)" in
        Darwin) os="darwin" ;;
        Linux) os="linux" ;;
        MINGW*|MSYS*|CYGWIN*) os="windows" ;;
        *) echo "Unsupported OS"; exit 1 ;;
    esac
    
    case "$(uname -m)" in
        x86_64|amd64) arch="amd64" ;;
        arm64|aarch64) arch="arm64" ;;
        *) echo "Unsupported architecture"; exit 1 ;;
    esac
    
    echo "$os:$arch"
}

# Get Rust target triple from os:arch format
get_rust_target() {
    local os=$1
    local arch=$2
    
    case "$os:$arch" in
        darwin:arm64) echo "aarch64-apple-darwin" ;;
        darwin:amd64) echo "x86_64-apple-darwin" ;;
        linux:amd64) echo "x86_64-unknown-linux-gnu" ;;
        linux:arm64) echo "aarch64-unknown-linux-gnu" ;;
        windows:amd64) echo "x86_64-pc-windows-msvc" ;;
        *) echo ""; return 1 ;;
    esac
}

# Build CLI binary for a specific target
build_cli() {
    local os=$1
    local arch=$2
    local bun_target output_file
    
    case "$os:$arch" in
        darwin:arm64) bun_target="bun-darwin-arm64"; output_file="shield" ;;
        darwin:amd64) bun_target="bun-darwin-x64"; output_file="shield" ;;
        linux:amd64) bun_target="bun-linux-x64"; output_file="shield" ;;
        linux:arm64) bun_target="bun-linux-arm64"; output_file="shield" ;;
        windows:amd64) bun_target="bun-windows-x64"; output_file="shield.exe" ;;
        *) echo "Unsupported platform: $os:$arch"; exit 1 ;;
    esac
    
    echo "🔨 Building CLI for $os/$arch..."
    cd "$PROJECT_ROOT"
    
    # Clean previous CLI binary
    rm -f "$BIN_DIR/shield" "$BIN_DIR/shield.exe" 2>/dev/null || true
    
    bun build --compile --target="$bun_target" ./src/index.ts --outfile "$BIN_DIR/$output_file"
    chmod +x "$BIN_DIR/$output_file" 2>/dev/null || true
    echo "✅ CLI binary built: $BIN_DIR/$output_file"
}

# Build desktop app
build_desktop() {
    local os=$1
    local arch=$2
    local rust_target
    local current_platform
    
    echo ""
    echo "🖥️  Building Desktop App for $os/$arch..."
    
    cd "$DESKTOP_DIR"
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "📥 Installing desktop dependencies..."
        pnpm install
    fi
    
    # Get Rust target triple
    rust_target=$(get_rust_target "$os" "$arch")
    current_platform=$(detect_platform)
    
    # Clean previous build artifacts for this target
    echo "🧹 Cleaning previous build..."
    rm -rf "$TAURI_DIR/target/release/bundle" 2>/dev/null || true
    
    # Build Tauri app with target
    if [ "$os:$arch" = "$current_platform" ]; then
        # Building for current platform - no cross-compilation needed
        echo "🔨 Building for current platform..."
        pnpm tauri build
    else
        # Cross-compilation - requires proper toolchain setup
        echo "🔨 Cross-compiling for $rust_target..."
        echo "⚠️  Note: Cross-compilation requires proper toolchain setup"
        
        # Ensure Rust target is installed
        rustup target add "$rust_target" 2>/dev/null || true
        
        pnpm tauri build --target "$rust_target"
    fi
    
    echo "✅ Desktop app built"
}

# Get bundle directory (handles cross-compilation paths)
get_bundle_dir() {
    local os=$1
    local arch=$2
    local rust_target current_platform bundle_dir
    
    rust_target=$(get_rust_target "$os" "$arch")
    current_platform=$(detect_platform)
    
    if [ "$os:$arch" = "$current_platform" ]; then
        bundle_dir="$TAURI_DIR/target/release/bundle"
    else
        bundle_dir="$TAURI_DIR/target/$rust_target/release/bundle"
    fi
    
    echo "$bundle_dir"
}

# Package the output
package_output() {
    local os=$1
    local arch=$2
    local archive_name ext bundle_dir
    
    echo ""
    echo "📁 Packaging output..."
    
    bundle_dir=$(get_bundle_dir "$os" "$arch")
    echo "📂 Looking for bundles in: $bundle_dir"
    
    case "$os" in
        darwin)
            ext="dmg"
            local dmg_file=$(find "$bundle_dir/dmg" -name "*.dmg" 2>/dev/null | head -1)
            if [ -n "$dmg_file" ] && [ -f "$dmg_file" ]; then
                archive_name="${NAME}_${os}_${arch}.${ext}"
                cp "$dmg_file" "$DIST_DIR/$archive_name"
                echo "✅ Created: $archive_name"
            else
                echo "⚠️  No .dmg found"
            fi
            
            # Also copy the .app as tar.gz
            local app_file=$(find "$bundle_dir/macos" -name "*.app" -type d 2>/dev/null | head -1)
            if [ -n "$app_file" ] && [ -d "$app_file" ]; then
                archive_name="${NAME}_${os}_${arch}.tar.gz"
                cd "$(dirname "$app_file")"
                tar -czf "$DIST_DIR/$archive_name" "$(basename "$app_file")"
                echo "✅ Created: $archive_name"
            else
                echo "⚠️  No .app found"
            fi
            ;;
        linux)
            # AppImage
            local appimage_file=$(find "$bundle_dir/appimage" -name "*.AppImage" 2>/dev/null | head -1)
            if [ -n "$appimage_file" ] && [ -f "$appimage_file" ]; then
                archive_name="${NAME}_${os}_${arch}.AppImage"
                cp "$appimage_file" "$DIST_DIR/$archive_name"
                chmod +x "$DIST_DIR/$archive_name"
                echo "✅ Created: $archive_name"
            else
                echo "⚠️  No .AppImage found"
            fi
            
            # deb
            local deb_file=$(find "$bundle_dir/deb" -name "*.deb" 2>/dev/null | head -1)
            if [ -n "$deb_file" ] && [ -f "$deb_file" ]; then
                archive_name="${NAME}_${os}_${arch}.deb"
                cp "$deb_file" "$DIST_DIR/$archive_name"
                echo "✅ Created: $archive_name"
            else
                echo "⚠️  No .deb found"
            fi
            
            # rpm
            local rpm_file=$(find "$bundle_dir/rpm" -name "*.rpm" 2>/dev/null | head -1)
            if [ -n "$rpm_file" ] && [ -f "$rpm_file" ]; then
                archive_name="${NAME}_${os}_${arch}.rpm"
                cp "$rpm_file" "$DIST_DIR/$archive_name"
                echo "✅ Created: $archive_name"
            else
                echo "⚠️  No .rpm found"
            fi
            ;;
        windows)
            # MSI installer
            local msi_file=$(find "$bundle_dir/msi" -name "*.msi" 2>/dev/null | head -1)
            if [ -n "$msi_file" ] && [ -f "$msi_file" ]; then
                archive_name="${NAME}_${os}_${arch}.msi"
                cp "$msi_file" "$DIST_DIR/$archive_name"
                echo "✅ Created: $archive_name"
            else
                echo "⚠️  No .msi found"
            fi
            
            # NSIS installer
            local nsis_file=$(find "$bundle_dir/nsis" -name "*.exe" 2>/dev/null | head -1)
            if [ -n "$nsis_file" ] && [ -f "$nsis_file" ]; then
                archive_name="${NAME}_${os}_${arch}_setup.exe"
                cp "$nsis_file" "$DIST_DIR/$archive_name"
                echo "✅ Created: $archive_name"
            else
                echo "⚠️  No NSIS .exe found"
            fi
            ;;
    esac
}

# Clean up
cleanup() {
    echo ""
    echo "🧹 Cleaning up..."
    rm -rf "$BIN_DIR"
}

# Main build process
main() {
    local target_platform="${1:-}"
    local platform os arch
    local current_platform
    
    current_platform=$(detect_platform)
    
    if [ -z "$target_platform" ]; then
        # Build for current platform only (default)
        os="${current_platform%%:*}"
        arch="${current_platform##*:}"
        
        echo "🎯 Target: $os/$arch (current platform)"
        echo ""
        
        build_cli "$os" "$arch"
        build_desktop "$os" "$arch"
        package_output "$os" "$arch"
        
    elif [ "$target_platform" = "all" ]; then
        # Build for all supported platforms (CI mode)
        echo "🎯 Target: All supported platforms (CI mode)"
        echo "⚠️  Note: Cross-compilation requires proper toolchain setup on CI"
        echo ""
        
        # Define all supported platforms
        local platforms=(
            "darwin:arm64"
            "darwin:amd64" 
            "linux:amd64"
            "linux:arm64"
            "windows:amd64"
        )
        
        # Build for each platform
        for platform in "${platforms[@]}"; do
            os="${platform%%:*}"
            arch="${platform##*:}"
            
            echo "=========================================="
            echo "Building for $os/$arch"
            echo "=========================================="
            
            build_cli "$os" "$arch"
            build_desktop "$os" "$arch"
            package_output "$os" "$arch"
            
            echo ""
        done
    else
        # Build for specified platform
        os="${target_platform%%:*}"
        arch="${target_platform##*:}"
        
        echo "🎯 Target: $os/$arch"
        echo ""
        
        build_cli "$os" "$arch"
        build_desktop "$os" "$arch"
        package_output "$os" "$arch"
    fi
    
    cleanup
    
    # Generate checksums for desktop packages
    echo ""
    echo "🔐 Generating checksums..."
    cd "$DIST_DIR"
    if ls ${NAME}_* 1>/dev/null 2>&1; then
        shasum -a 256 ${NAME}_* > checksums_desktop.txt 2>/dev/null || sha256sum ${NAME}_* > checksums_desktop.txt 2>/dev/null || true
        if [ -f checksums_desktop.txt ]; then
            cat checksums_desktop.txt
        fi
    fi
    
    echo ""
    echo "=========================================="
    echo "✅ Desktop packaging complete!"
    echo ""
    echo "📂 Output directory: $DIST_DIR"
    ls -lh "$DIST_DIR"/${NAME}_* 2>/dev/null || echo "No packages found"
}

# Show help
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    echo "Usage: $0 [platform|all]"
    echo ""
    echo "Build AgentShield Desktop with bundled CLI binary."
    echo ""
    echo "Arguments:"
    echo "  (none)      Build for current platform (default)"
    echo "  platform    Target platform in format 'os:arch'"
    echo "  all         Build for all supported platforms (CI mode, requires cross-compilation)"
    echo ""
    echo "Supported platforms:"
    echo "  darwin:arm64   - macOS Apple Silicon"
    echo "  darwin:amd64   - macOS Intel"
    echo "  linux:amd64    - Linux x86_64"
    echo "  linux:arm64    - Linux ARM64"
    echo "  windows:amd64  - Windows x86_64"
    echo ""
    echo "Examples:"
    echo "  $0                    # Build for current platform"
    echo "  $0 darwin:arm64       # Build for macOS Apple Silicon"
    echo "  $0 linux:amd64        # Build for Linux x86_64"
    echo "  $0 all                # Build for all platforms (CI)"
    exit 0
fi

main "$@"
