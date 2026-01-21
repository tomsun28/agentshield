import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Clock,
  FileText,
  Trash2,
  Edit3,
  PlusCircle,
  RotateCcw,
  Check,
  X,
  Loader2,
  History,
} from "lucide-react";
import type { Snapshot, RestoreResult, WorkspaceStats } from "../types";
import { formatBytes, formatTimeAgo, formatDate } from "../utils";

export default function WorkspaceHistory() {
  const { path } = useParams<{ path: string }>();
  const navigate = useNavigate();
  const decodedPath = path ? decodeURIComponent(path) : "";
  const workspaceName = decodedPath.split("/").pop() || "Workspace";

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<{
    id: string;
    result: RestoreResult;
  } | null>(null);

  const loadData = async () => {
    if (!decodedPath) return;

    try {
      setLoading(true);
      const [snapshotsData, statsData] = await Promise.all([
        invoke<Snapshot[]>("get_workspace_snapshots", {
          workspacePath: decodedPath,
        }),
        invoke<WorkspaceStats>("get_workspace_stats", {
          workspacePath: decodedPath,
        }),
      ]);
      setSnapshots(snapshotsData);
      setStats(statsData);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [decodedPath]);

  const handleRestore = async (snapshotId: string) => {
    if (
      !confirm(
        "Are you sure you want to restore this snapshot? This will revert files to their previous state."
      )
    ) {
      return;
    }

    setRestoring(snapshotId);
    setRestoreResult(null);

    try {
      const result = await invoke<RestoreResult>("restore_snapshot", {
        workspacePath: decodedPath,
        snapshotId,
      });
      setRestoreResult({ id: snapshotId, result });
    } catch (err) {
      console.error("Failed to restore:", err);
      alert(`Failed to restore: ${err}`);
    } finally {
      setRestoring(null);
    }
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "delete":
        return <Trash2 className="w-4 h-4 text-red-400" />;
      case "rename":
        return <Edit3 className="w-4 h-4 text-yellow-400" />;
      case "create":
        return <PlusCircle className="w-4 h-4 text-green-400" />;
      default:
        return <FileText className="w-4 h-4 text-blue-400" />;
    }
  };

  const getEventLabel = (eventType: string) => {
    switch (eventType) {
      case "delete":
        return "Deleted";
      case "rename":
        return "Renamed";
      case "create":
        return "Created";
      default:
        return "Changed";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-2 text-white text-lg">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <header className="border-b border-slate-700/50 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5 text-slate-400" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-white truncate">
                {workspaceName}
              </h1>
              <p className="text-sm text-slate-500 truncate">{decodedPath}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="text-2xl font-bold text-white">
                {stats.snapshots}
              </div>
              <div className="text-sm text-slate-400">Snapshots</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="text-2xl font-bold text-white">
                {stats.unique_files}
              </div>
              <div className="text-sm text-slate-400">Unique Files</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="text-2xl font-bold text-white">
                {stats.total_files}
              </div>
              <div className="text-sm text-slate-400">Total Changes</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="text-2xl font-bold text-white">
                {formatBytes(stats.total_size)}
              </div>
              <div className="text-sm text-slate-400">Total Size</div>
            </div>
          </div>
        )}

        <h2 className="text-lg font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <History className="w-5 h-5" />
          Version History
        </h2>

        {snapshots.length === 0 ? (
          <div className="text-center py-16 bg-slate-800/30 rounded-xl border border-slate-700/50">
            <Clock className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-300 mb-2">
              No Snapshots Yet
            </h3>
            <p className="text-slate-500 max-w-md mx-auto">
              Snapshots will appear here when Shield detects file changes in this
              workspace. Start Shield with{" "}
              <code className="bg-slate-800 px-2 py-0.5 rounded text-emerald-400">
                shield start
              </code>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden"
              >
                <div className="p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm text-emerald-400">
                        {snapshot.id}
                      </span>
                      <span className="text-slate-500 text-sm">·</span>
                      <span className="text-slate-400 text-sm">
                        {formatTimeAgo(snapshot.timestamp)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatDate(snapshot.timestamp)} · {snapshot.files.length}{" "}
                      file(s)
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {restoreResult?.id === snapshot.id && (
                      <div className="flex items-center gap-1 text-sm">
                        {restoreResult.result.restored > 0 && (
                          <span className="text-green-400 flex items-center gap-1">
                            <Check className="w-4 h-4" />
                            {restoreResult.result.restored} restored
                          </span>
                        )}
                        {restoreResult.result.deleted > 0 && (
                          <span className="text-yellow-400 ml-2">
                            {restoreResult.result.deleted} removed
                          </span>
                        )}
                        {restoreResult.result.failed > 0 && (
                          <span className="text-red-400 flex items-center gap-1 ml-2">
                            <X className="w-4 h-4" />
                            {restoreResult.result.failed} failed
                          </span>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => handleRestore(snapshot.id)}
                      disabled={restoring === snapshot.id}
                      className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {restoring === snapshot.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RotateCcw className="w-4 h-4" />
                      )}
                      Restore
                    </button>
                  </div>
                </div>

                <div className="border-t border-slate-700/50 bg-slate-900/30 px-4 py-3">
                  <div className="space-y-1.5">
                    {snapshot.files.slice(0, 5).map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-sm"
                      >
                        {getEventIcon(file.eventType)}
                        <span className="text-slate-300 truncate flex-1 font-mono text-xs">
                          {file.path}
                          {file.renamedTo && (
                            <span className="text-slate-500">
                              {" "}
                              → {file.renamedTo}
                            </span>
                          )}
                        </span>
                        <span className="text-slate-500 text-xs shrink-0">
                          {getEventLabel(file.eventType)}
                        </span>
                      </div>
                    ))}
                    {snapshot.files.length > 5 && (
                      <div className="text-slate-500 text-xs pl-6">
                        ... and {snapshot.files.length - 5} more files
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
