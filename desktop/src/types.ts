export interface Workspace {
  path: string;
  name: string;
  added_at: number;
}

export interface SnapshotFile {
  path: string;
  backupPath: string;
  size: number;
  eventType: "change" | "delete" | "rename" | "create";
  renamedTo?: string;
}

export interface Snapshot {
  id: string;
  timestamp: number;
  files: SnapshotFile[];
  message?: string;
}

export interface WorkspaceStats {
  snapshots: number;
  total_files: number;
  total_size: number;
  unique_files: number;
}

export interface RestoreResult {
  restored: number;
  failed: number;
  deleted: number;
}
