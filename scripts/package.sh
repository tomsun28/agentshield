#!/bin/bash
set -e

# AgentShield Package Script
# Creates release archives with standardized naming: {name}_{os}_{arch}.{ext}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_ROOT/releases"
NAME="shield"

# Get version from package.json
VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")

echo "📦 Packaging AgentShield v$VERSION"
echo "=================================="

# Clean and create dist directory
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Build targets: target_name:output_file:os:arch:ext
TARGETS=(
    "bun-darwin-arm64:shield:darwin:arm64:tar.gz"
    "bun-darwin-x64:shield:darwin:amd64:tar.gz"
    "bun-linux-x64:shield:linux:amd64:tar.gz"
    "bun-linux-arm64:shield:linux:arm64:tar.gz"
    "bun-windows-x64:shield.exe:windows:amd64:zip"
)

cd "$PROJECT_ROOT"

for target in "${TARGETS[@]}"; do
    IFS=':' read -r bun_target output_file os arch ext <<< "$target"
    
    archive_name="${NAME}_${os}_${arch}.${ext}"
    echo ""
    echo "🔨 Building for $os/$arch..."
    
    # Build binary
    bun build --compile --target="$bun_target" ./src/index.ts --outfile "$output_file"
    
    # Create archive
    echo "📁 Creating $archive_name..."
    if [ "$ext" = "zip" ]; then
        zip -j "$DIST_DIR/$archive_name" "$output_file" LICENSE README.md
    else
        tar -czvf "$DIST_DIR/$archive_name" "$output_file" LICENSE README.md
    fi
    
    # Clean up binary
    rm -f "$output_file"
    
    echo "✅ $archive_name created"
done

# Generate checksums
echo ""
echo "🔐 Generating checksums..."
cd "$DIST_DIR"
shasum -a 256 *.tar.gz *.zip > checksums.txt
cat checksums.txt

echo ""
echo "=================================="
echo "✅ All packages created in $DIST_DIR"
ls -lh "$DIST_DIR"
