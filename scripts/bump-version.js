#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const ROOT_PACKAGE_JSON = './package.json';
const DESKTOP_PACKAGE_JSON = './desktop/package.json';
const DESKTOP_CARGO_TOML = './desktop/src-tauri/Cargo.toml';
const CLI_TS_FILE = './src/cli.ts';

function parseVersion(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return { major, minor, patch };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function bumpVersion(version, type = 'patch') {
  const { major, minor, patch } = parseVersion(version);
  
  switch (type) {
    case 'major':
      return formatVersion({ major: major + 1, minor: 0, patch: 0 });
    case 'minor':
      return formatVersion({ major, minor: minor + 1, patch: 0 });
    case 'patch':
      return formatVersion({ major, minor, patch: patch + 1 });
    default:
      throw new Error(`Invalid bump type: ${type}. Use 'major', 'minor', or 'patch'.`);
  }
}

function updatePackageJson(filePath, newVersion) {
  const content = readFileSync(filePath, 'utf8');
  const packageJson = JSON.parse(content);
  packageJson.version = newVersion;
  writeFileSync(filePath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`Updated ${filePath} to version ${newVersion}`);
}

function updateCargoToml(filePath, newVersion) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let updated = false;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('version = ')) {
      lines[i] = `version = "${newVersion}"`;
      updated = true;
      break;
    }
  }
  
  if (!updated) {
    throw new Error(`Version field not found in ${filePath}`);
  }
  
  writeFileSync(filePath, lines.join('\n'));
  console.log(`Updated ${filePath} to version ${newVersion}`);
}

function updateCliTsVersion(filePath, newVersion) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let updated = false;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('const SHIELD_VERSION = ')) {
      lines[i] = `const SHIELD_VERSION = "${newVersion}";`;
      updated = true;
      break;
    }
  }
  
  if (!updated) {
    throw new Error(`SHIELD_VERSION constant not found in ${filePath}`);
  }
  
  writeFileSync(filePath, lines.join('\n'));
  console.log(`Updated ${filePath} to version ${newVersion}`);
}

function getCurrentVersion() {
  const rootPackage = JSON.parse(readFileSync(ROOT_PACKAGE_JSON, 'utf8'));
  return rootPackage.version;
}

function main() {
  const args = process.argv.slice(2);
  const bumpType = args[0] || 'patch';
  const targetVersion = args[1];
  
  if (!['major', 'minor', 'patch'].includes(bumpType) && !targetVersion) {
    console.error('Usage: node bump-version.js [major|minor|patch] [specific-version]');
    console.error('Examples:');
    console.error('  node bump-version.js patch    # Auto bump patch version');
    console.error('  node bump-version.js minor    # Auto bump minor version');
    console.error('  node bump-version.js major    # Auto bump major version');
    console.error('  node bump-version.js custom 1.2.3  # Set specific version');
    process.exit(1);
  }
  
  const currentVersion = getCurrentVersion();
  let newVersion;
  
  if (targetVersion) {
    newVersion = targetVersion;
    console.log(`Setting custom version from ${currentVersion} to ${newVersion}`);
  } else {
    newVersion = bumpVersion(currentVersion, bumpType);
    console.log(`Bumping ${bumpType} version from ${currentVersion} to ${newVersion}`);
  }
  
  try {
    // Update CLI package.json
    updatePackageJson(ROOT_PACKAGE_JSON, newVersion);
    
    // Update Desktop package.json
    updatePackageJson(DESKTOP_PACKAGE_JSON, newVersion);
    
    // Update Desktop Cargo.toml
    updateCargoToml(DESKTOP_CARGO_TOML, newVersion);
    
    // Update CLI TypeScript version constant
    updateCliTsVersion(CLI_TS_FILE, newVersion);
    
    console.log('\n✅ Version bump completed successfully!');
    console.log(`📦 All packages updated to version ${newVersion}`);
    
    // Optional: Show git status
    try {
      const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
      if (gitStatus.trim()) {
        console.log('\n📋 Git status:');
        console.log(gitStatus);
        console.log('\n💡 Commit with: git commit -am "chore: bump version to ' + newVersion + '"');
      }
    } catch (error) {
      // Not in a git repo, ignore
    }
    
  } catch (error) {
    console.error('❌ Error during version bump:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
