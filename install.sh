#!/bin/bash
set -e

# AgentShield Installation Script
# Usage: curl -fsSL https://github.com/tomsun28/agentshield/raw/main/install.sh | bash
#
# Environment variables:
#   VERSION    - Specific version to install (default: latest)
#   INSTALL_DIR - Installation directory (default: /usr/local/bin)

REPO="tomsun28/agentshield"
NAME="shield"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Detect OS
detect_os() {
    local os
    os="$(uname -s)"
    case "$os" in
        Linux*)  echo "linux" ;;
        Darwin*) echo "darwin" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *) error "Unsupported operating system: $os" ;;
    esac
}

# Detect architecture
detect_arch() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        x86_64|amd64) echo "amd64" ;;
        aarch64|arm64) echo "arm64" ;;
        *) error "Unsupported architecture: $arch" ;;
    esac
}

# Get latest version from GitHub API
get_latest_version() {
    local latest
    latest=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    if [ -z "$latest" ]; then
        error "Failed to get latest version. Please specify VERSION environment variable."
    fi
    echo "$latest"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Main installation function
main() {
    echo ""
    echo "🛡️  AgentShield Installer"
    echo "========================="
    echo ""

    # Check dependencies
    if ! command_exists curl; then
        error "curl is required but not installed."
    fi

    # Detect platform
    local os arch
    os=$(detect_os)
    arch=$(detect_arch)
    info "Detected platform: ${os}/${arch}"

    # Get version
    local version
    if [ -n "$VERSION" ]; then
        version="$VERSION"
    else
        info "Fetching latest version..."
        version=$(get_latest_version)
    fi
    info "Installing version: ${version}"

    # Determine file extension
    local ext="tar.gz"
    if [ "$os" = "windows" ]; then
        ext="zip"
    fi

    # Build download URL
    local archive_name="${NAME}_${os}_${arch}.${ext}"
    local download_url="https://github.com/$REPO/releases/download/${version}/${archive_name}"
    
    info "Downloading ${archive_name}..."

    # Create temp directory
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf $tmp_dir" EXIT

    # Download archive
    if ! curl -fsSL "$download_url" -o "$tmp_dir/$archive_name"; then
        error "Failed to download from: $download_url"
    fi

    # Extract archive
    info "Extracting..."
    cd "$tmp_dir"
    if [ "$ext" = "zip" ]; then
        if command_exists unzip; then
            unzip -q "$archive_name"
        else
            error "unzip is required to extract Windows archive"
        fi
    else
        tar -xzf "$archive_name"
    fi

    # Find binary
    local binary_name="$NAME"
    if [ "$os" = "windows" ]; then
        binary_name="${NAME}.exe"
    fi

    if [ ! -f "$binary_name" ]; then
        error "Binary not found in archive"
    fi

    # Install binary
    info "Installing to ${INSTALL_DIR}/${binary_name}..."
    
    # Check if we need sudo
    if [ -w "$INSTALL_DIR" ]; then
        mv "$binary_name" "$INSTALL_DIR/"
        chmod +x "$INSTALL_DIR/$binary_name"
    else
        warn "Requires sudo to install to $INSTALL_DIR"
        sudo mv "$binary_name" "$INSTALL_DIR/"
        sudo chmod +x "$INSTALL_DIR/$binary_name"
    fi

    # Verify installation
    if command_exists "$NAME"; then
        echo ""
        success "AgentShield installed successfully! 🎉"
        echo ""
        info "Version: $($INSTALL_DIR/$binary_name --version 2>/dev/null || echo $version)"
        info "Location: $INSTALL_DIR/$binary_name"
        echo ""
        echo "Get started:"
        echo "  $NAME --help     # Show help"
        echo "  $NAME start      # Start watching current directory"
        echo "  $NAME status     # Check status"
        echo ""
    else
        warn "Installation completed, but '$NAME' is not in PATH."
        warn "Add $INSTALL_DIR to your PATH or run: $INSTALL_DIR/$binary_name"
    fi
}

main "$@"
