use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const SHIELD_DIR: &str = ".shield";
const CONFIG_FILE: &str = "config.json";
const INDEX_FILE: &str = "index.json";
const SNAPSHOTS_DIR: &str = "snapshots";
const PID_FILE: &str = "shield.pid";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Workspace {
    pub path: String,
    pub name: String,
    pub added_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct GlobalConfig {
    pub workspaces: Vec<Workspace>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SnapshotFile {
    pub path: String,
    #[serde(rename = "backupPath")]
    pub backup_path: String,
    pub size: u64,
    #[serde(rename = "eventType")]
    pub event_type: String,
    #[serde(rename = "renamedTo")]
    pub renamed_to: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Snapshot {
    pub id: String,
    pub timestamp: i64,
    pub files: Vec<SnapshotFile>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupIndex {
    pub version: i32,
    pub snapshots: Vec<Snapshot>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceStats {
    pub snapshots: usize,
    pub total_files: usize,
    pub total_size: u64,
    pub unique_files: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RestoreResult {
    pub restored: u32,
    pub failed: u32,
    pub deleted: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShieldStatus {
    pub running: bool,
    pub pid: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub message: String,
}

fn get_global_config_path() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    home.join(SHIELD_DIR).join(CONFIG_FILE)
}

fn ensure_global_shield_dir() {
    let home = dirs::home_dir().expect("Could not find home directory");
    let shield_dir = home.join(SHIELD_DIR);
    if !shield_dir.exists() {
        fs::create_dir_all(&shield_dir).ok();
    }
}

fn load_global_config() -> GlobalConfig {
    let config_path = get_global_config_path();
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    GlobalConfig::default()
}

fn save_global_config(config: &GlobalConfig) -> Result<(), String> {
    ensure_global_shield_dir();
    let config_path = get_global_config_path();
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&config_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_workspace_index_path(workspace_path: &str) -> PathBuf {
    PathBuf::from(workspace_path).join(SHIELD_DIR).join(INDEX_FILE)
}

fn get_workspace_snapshots_dir(workspace_path: &str) -> PathBuf {
    PathBuf::from(workspace_path).join(SHIELD_DIR).join(SNAPSHOTS_DIR)
}

fn get_pid_file_path(workspace_path: &str) -> PathBuf {
    PathBuf::from(workspace_path).join(SHIELD_DIR).join(PID_FILE)
}

fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe {
            libc::kill(pid as i32, 0) == 0
        }
    }
    #[cfg(windows)]
    {
        use std::ptr::null_mut;
        unsafe {
            let handle = winapi::um::processthreadsapi::OpenProcess(
                winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                pid,
            );
            if handle.is_null() {
                false
            } else {
                winapi::um::handleapi::CloseHandle(handle);
                true
            }
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        false
    }
}

fn check_shield_running(workspace_path: &str) -> ShieldStatus {
    let pid_file = get_pid_file_path(workspace_path);
    
    if !pid_file.exists() {
        return ShieldStatus {
            running: false,
            pid: None,
        };
    }
    
    if let Ok(content) = fs::read_to_string(&pid_file) {
        if let Ok(pid) = content.trim().parse::<u32>() {
            if is_process_running(pid) {
                return ShieldStatus {
                    running: true,
                    pid: Some(pid),
                };
            }
        }
    }
    
    ShieldStatus {
        running: false,
        pid: None,
    }
}

fn find_shield_binary() -> Option<PathBuf> {
    if let Ok(path) = which::which("shield") {
        return Some(path);
    }
    
    if let Ok(home) = std::env::var("HOME") {
        let npm_global = PathBuf::from(&home).join(".npm-global/bin/shield");
        if npm_global.exists() {
            return Some(npm_global);
        }
        
        let cargo_bin = PathBuf::from(&home).join(".cargo/bin/shield");
        if cargo_bin.exists() {
            return Some(cargo_bin);
        }
    }
    
    if let Ok(path_env) = std::env::var("PATH") {
        for path in std::env::split_paths(&path_env) {
            let shield_path = path.join("shield");
            if shield_path.exists() {
                return Some(shield_path);
            }
        }
    }
    
    None
}

fn load_workspace_index(workspace_path: &str) -> BackupIndex {
    let index_path = get_workspace_index_path(workspace_path);
    if index_path.exists() {
        if let Ok(content) = fs::read_to_string(&index_path) {
            if let Ok(mut index) = serde_json::from_str::<BackupIndex>(&content) {
                for snapshot in &mut index.snapshots {
                    if snapshot.files.is_empty() {
                        snapshot.files = vec![];
                    }
                }
                return index;
            }
        }
    }
    BackupIndex {
        version: 2,
        snapshots: vec![],
    }
}

fn save_workspace_index(workspace_path: &str, index: &BackupIndex) -> Result<(), String> {
    let index_path = get_workspace_index_path(workspace_path);
    let content = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    fs::write(&index_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_workspaces() -> Vec<Workspace> {
    let config = load_global_config();
    config.workspaces
}

#[tauri::command]
fn add_workspace(path: String) -> Result<Workspace, String> {
    let path_buf = PathBuf::from(&path);
    
    if !path_buf.exists() {
        return Err("Directory does not exist".to_string());
    }
    
    if !path_buf.is_dir() {
        return Err("Path is not a directory".to_string());
    }
    
    let name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    
    let mut config = load_global_config();
    
    if config.workspaces.iter().any(|w| w.path == path) {
        return Err("Workspace already exists".to_string());
    }
    
    let workspace = Workspace {
        path: path.clone(),
        name,
        added_at: chrono::Utc::now().timestamp_millis(),
    };
    
    config.workspaces.push(workspace.clone());
    save_global_config(&config)?;
    
    Ok(workspace)
}

#[tauri::command]
fn remove_workspace(path: String) -> Result<(), String> {
    let mut config = load_global_config();
    config.workspaces.retain(|w| w.path != path);
    save_global_config(&config)?;
    Ok(())
}

#[tauri::command]
fn get_workspace_snapshots(workspace_path: String) -> Vec<Snapshot> {
    let index = load_workspace_index(&workspace_path);
    let mut snapshots = index.snapshots;
    snapshots.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    snapshots
}

#[tauri::command]
fn get_workspace_stats(workspace_path: String) -> WorkspaceStats {
    let index = load_workspace_index(&workspace_path);
    let mut unique_files = std::collections::HashSet::new();
    let mut total_files = 0;
    let mut total_size: u64 = 0;
    
    for snapshot in &index.snapshots {
        for file in &snapshot.files {
            unique_files.insert(file.path.clone());
            total_files += 1;
            total_size += file.size;
        }
    }
    
    WorkspaceStats {
        snapshots: index.snapshots.len(),
        total_files,
        total_size,
        unique_files: unique_files.len(),
    }
}

#[tauri::command]
fn restore_snapshot(workspace_path: String, snapshot_id: String) -> Result<RestoreResult, String> {
    let index = load_workspace_index(&workspace_path);
    let snapshots_dir = get_workspace_snapshots_dir(&workspace_path);
    
    let snapshot = index
        .snapshots
        .iter()
        .find(|s| s.id == snapshot_id)
        .ok_or("Snapshot not found")?;
    
    let mut restored = 0u32;
    let mut failed = 0u32;
    let mut deleted = 0u32;
    
    for file in &snapshot.files {
        let backup_full_path = snapshots_dir.join(&file.backup_path);
        let target_path = PathBuf::from(&workspace_path).join(&file.path);
        
        match file.event_type.as_str() {
            "delete" => {
                if backup_full_path.exists() {
                    if let Some(parent) = target_path.parent() {
                        fs::create_dir_all(parent).ok();
                    }
                    if fs::copy(&backup_full_path, &target_path).is_ok() {
                        restored += 1;
                    } else {
                        failed += 1;
                    }
                } else {
                    failed += 1;
                }
            }
            "rename" => {
                if let Some(renamed_to) = &file.renamed_to {
                    let renamed_path = PathBuf::from(&workspace_path).join(renamed_to);
                    if renamed_path.exists() {
                        if fs::remove_file(&renamed_path).is_ok() {
                            deleted += 1;
                        }
                    }
                }
                if backup_full_path.exists() {
                    if let Some(parent) = target_path.parent() {
                        fs::create_dir_all(parent).ok();
                    }
                    if fs::copy(&backup_full_path, &target_path).is_ok() {
                        restored += 1;
                    } else {
                        failed += 1;
                    }
                } else {
                    failed += 1;
                }
            }
            "create" => {
                if target_path.exists() {
                    if fs::remove_file(&target_path).is_ok() {
                        deleted += 1;
                    }
                }
            }
            "change" => {
                if backup_full_path.exists() {
                    if let Some(parent) = target_path.parent() {
                        fs::create_dir_all(parent).ok();
                    }
                    if fs::copy(&backup_full_path, &target_path).is_ok() {
                        restored += 1;
                    } else {
                        failed += 1;
                    }
                } else {
                    failed += 1;
                }
            }
            _ => {}
        }
    }
    
    Ok(RestoreResult {
        restored,
        failed,
        deleted,
    })
}

#[tauri::command]
fn clean_old_snapshots(workspace_path: String, max_age_days: i64) -> Result<(usize, u64), String> {
    let mut index = load_workspace_index(&workspace_path);
    let snapshots_dir = get_workspace_snapshots_dir(&workspace_path);
    let cutoff = chrono::Utc::now().timestamp_millis() - (max_age_days * 24 * 60 * 60 * 1000);
    
    let mut removed = 0usize;
    let mut freed_bytes = 0u64;
    
    let mut to_keep = vec![];
    
    for snapshot in index.snapshots {
        if snapshot.timestamp < cutoff {
            for file in &snapshot.files {
                let backup_path = snapshots_dir.join(&file.backup_path);
                if backup_path.exists() {
                    if let Ok(meta) = fs::metadata(&backup_path) {
                        freed_bytes += meta.len();
                    }
                    fs::remove_file(&backup_path).ok();
                }
            }
            removed += 1;
        } else {
            to_keep.push(snapshot);
        }
    }
    
    index.snapshots = to_keep;
    save_workspace_index(&workspace_path, &index)?;
    
    Ok((removed, freed_bytes))
}

#[tauri::command]
fn get_shield_status(workspace_path: String) -> ShieldStatus {
    check_shield_running(&workspace_path)
}

#[tauri::command]
fn start_shield(workspace_path: String) -> CommandResult {
    let shield_bin = match find_shield_binary() {
        Some(path) => path,
        None => {
            return CommandResult {
                success: false,
                message: "Shield binary not found. Please install shield first: npm install -g agentshield".to_string(),
            };
        }
    };
    
    let status = check_shield_running(&workspace_path);
    if status.running {
        return CommandResult {
            success: true,
            message: format!("Shield is already running (PID: {})", status.pid.unwrap_or(0)),
        };
    }
    
    let output = Command::new(&shield_bin)
        .arg("start")
        .arg(&workspace_path)
        .current_dir(&workspace_path)
        .output();
    
    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);
            
            if result.status.success() {
                std::thread::sleep(std::time::Duration::from_millis(500));
                let new_status = check_shield_running(&workspace_path);
                CommandResult {
                    success: true,
                    message: if new_status.running {
                        format!("Shield started successfully (PID: {})", new_status.pid.unwrap_or(0))
                    } else {
                        format!("Shield start command completed. {}", stdout.trim())
                    },
                }
            } else {
                CommandResult {
                    success: false,
                    message: format!("Failed to start shield: {}{}", stdout, stderr),
                }
            }
        }
        Err(e) => CommandResult {
            success: false,
            message: format!("Failed to execute shield command: {}", e),
        },
    }
}

#[tauri::command]
fn stop_shield(workspace_path: String) -> CommandResult {
    let shield_bin = match find_shield_binary() {
        Some(path) => path,
        None => {
            return CommandResult {
                success: false,
                message: "Shield binary not found".to_string(),
            };
        }
    };
    
    let status = check_shield_running(&workspace_path);
    if !status.running {
        return CommandResult {
            success: true,
            message: "Shield is not running".to_string(),
        };
    }
    
    let output = Command::new(&shield_bin)
        .arg("stop")
        .arg(&workspace_path)
        .current_dir(&workspace_path)
        .output();
    
    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);
            
            if result.status.success() {
                std::thread::sleep(std::time::Duration::from_millis(300));
                CommandResult {
                    success: true,
                    message: format!("Shield stopped successfully. {}", stdout.trim()),
                }
            } else {
                CommandResult {
                    success: false,
                    message: format!("Failed to stop shield: {}{}", stdout, stderr),
                }
            }
        }
        Err(e) => CommandResult {
            success: false,
            message: format!("Failed to execute shield command: {}", e),
        },
    }
}

#[tauri::command]
fn restore_snapshot_cmd(workspace_path: String, snapshot_id: String) -> CommandResult {
    let shield_bin = match find_shield_binary() {
        Some(path) => path,
        None => {
            return CommandResult {
                success: false,
                message: "Shield binary not found".to_string(),
            };
        }
    };
    
    let output = Command::new(&shield_bin)
        .arg("restore")
        .arg(&snapshot_id)
        .arg("--path")
        .arg(&workspace_path)
        .current_dir(&workspace_path)
        .output();
    
    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);
            
            if result.status.success() {
                CommandResult {
                    success: true,
                    message: stdout.trim().to_string(),
                }
            } else {
                CommandResult {
                    success: false,
                    message: format!("{}{}", stdout, stderr).trim().to_string(),
                }
            }
        }
        Err(e) => CommandResult {
            success: false,
            message: format!("Failed to execute restore command: {}", e),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_workspaces,
            add_workspace,
            remove_workspace,
            get_workspace_snapshots,
            get_workspace_stats,
            restore_snapshot,
            clean_old_snapshots,
            get_shield_status,
            start_shield,
            stop_shield,
            restore_snapshot_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
