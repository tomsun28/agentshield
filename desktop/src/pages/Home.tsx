import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Shield, Plus, Folder, Trash2, Clock, Play, Square, Loader2 } from "lucide-react";
import type { Workspace, WorkspaceStats, ShieldStatus, CommandResult } from "../types";
import { formatBytes, formatTimeAgo } from "../utils";

export default function Home() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [stats, setStats] = useState<Record<string, WorkspaceStats>>({});
  const [statuses, setStatuses] = useState<Record<string, ShieldStatus>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadWorkspaces = async () => {
    try {
      const ws = await invoke<Workspace[]>("get_workspaces");
      setWorkspaces(ws);

      const statsMap: Record<string, WorkspaceStats> = {};
      const statusMap: Record<string, ShieldStatus> = {};
      
      for (const w of ws) {
        try {
          const [s, st] = await Promise.all([
            invoke<WorkspaceStats>("get_workspace_stats", { workspacePath: w.path }),
            invoke<ShieldStatus>("get_shield_status", { workspacePath: w.path }),
          ]);
          statsMap[w.path] = s;
          statusMap[w.path] = st;
        } catch {
          statsMap[w.path] = { snapshots: 0, total_files: 0, total_size: 0, unique_files: 0 };
          statusMap[w.path] = { running: false, pid: null };
        }
      }
      setStats(statsMap);
      setStatuses(statusMap);
    } catch (err) {
      console.error("Failed to load workspaces:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspaces();
    const interval = setInterval(loadWorkspaces, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAddWorkspace = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Workspace Directory",
      });

      if (selected) {
        await invoke("add_workspace", { path: selected });
        setActionLoading(selected);
        const result = await invoke<CommandResult>("start_shield", { workspacePath: selected });
        if (!result.success) {
          console.warn("Failed to auto-start shield:", result.message);
        }
        setActionLoading(null);
        await loadWorkspaces();
      }
    } catch (err) {
      console.error("Failed to add workspace:", err);
      alert(`Failed to add workspace: ${err}`);
      setActionLoading(null);
    }
  };

  const handleToggleShield = async (e: React.MouseEvent, path: string, isRunning: boolean) => {
    e.stopPropagation();
    setActionLoading(path);
    
    try {
      const result = await invoke<CommandResult>(
        isRunning ? "stop_shield" : "start_shield",
        { workspacePath: path }
      );
      
      if (!result.success) {
        alert(result.message);
      }
      await loadWorkspaces();
    } catch (err) {
      console.error("Failed to toggle shield:", err);
      alert(`Failed to ${isRunning ? "stop" : "start"} shield: ${err}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveWorkspace = async (
    e: React.MouseEvent,
    path: string
  ) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to remove this workspace from protection list?")) {
      try {
        await invoke("remove_workspace", { path });
        await loadWorkspaces();
      } catch (err) {
        console.error("Failed to remove workspace:", err);
      }
    }
  };

  const handleCardClick = (workspace: Workspace) => {
    navigate(`/workspace/${encodeURIComponent(workspace.path)}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <header className="border-b border-slate-700/50 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl">
              <Shield className="w-8 h-8 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="text-xl font-bold text-white">AgentShield</h1>
                <span className="text-xs text-slate-500 font-mono">v{__APP_VERSION__}</span>
              </div>
              <p className="text-sm text-slate-400">Protect AI-Operated Workspaces</p>
            </div>
          </div>
          <button
            onClick={handleAddWorkspace}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-medium transition-colors cursor-pointer"
          >
            <Plus className="w-5 h-5" />
            Add Workspace
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {workspaces.length === 0 ? (
          <div className="text-center py-20">
            <div className="p-4 bg-slate-800/50 rounded-2xl inline-block mb-6">
              <Folder className="w-16 h-16 text-slate-500" />
            </div>
            <h2 className="text-2xl font-semibold text-white mb-2">
              No Protected Workspaces
            </h2>
            <p className="text-slate-400 mb-6 max-w-md mx-auto">
              Add a workspace to start protecting your files from accidental changes by AI agents.
            </p>
            <button
              onClick={handleAddWorkspace}
              className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-medium transition-colors cursor-pointer"
            >
              <Plus className="w-5 h-5" />
              Add Your First Workspace
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-slate-300 mb-4">
              Protected Workspaces ({workspaces.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {workspaces.map((workspace) => {
                const workspaceStats = stats[workspace.path];
                const status = statuses[workspace.path];
                const isRunning = status?.running || false;
                const isLoading = actionLoading === workspace.path;
                
                return (
                  <div
                    key={workspace.path}
                    onClick={() => handleCardClick(workspace)}
                    className="group relative bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-emerald-500/50 rounded-xl p-5 cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-emerald-500/5"
                  >
                    <div className="absolute top-3 right-3 flex items-center gap-1">
                      <button
                        onClick={(e) => handleToggleShield(e, workspace.path, isRunning)}
                        disabled={isLoading}
                        className={`p-2 rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed ${
                          isRunning 
                            ? "text-emerald-400 hover:text-red-400 hover:bg-red-500/10" 
                            : "text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                        }`}
                        title={isRunning ? "Stop protection" : "Start protection"}
                      >
                        {isLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isRunning ? (
                          <Square className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={(e) => handleRemoveWorkspace(e, workspace.path)}
                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                        title="Remove from protection list"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-start gap-3 mb-3">
                      <div className={`p-2 rounded-lg shrink-0 ${isRunning ? "bg-emerald-500/20" : "bg-slate-700/50"}`}>
                        <Folder className={`w-6 h-6 ${isRunning ? "text-emerald-400" : "text-slate-500"}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-white text-lg truncate">
                          {workspace.name}
                        </h3>
                        <p className="text-sm text-slate-500 truncate" title={workspace.path}>
                          {workspace.path}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-slate-400">
                      <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                        isRunning 
                          ? "bg-emerald-500/10 text-emerald-400" 
                          : "bg-slate-700/50 text-slate-500"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                        {isRunning ? "Protected" : "Stopped"}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>{workspaceStats?.snapshots || 0} snapshots</span>
                      </div>
                      <div>
                        {formatBytes(workspaceStats?.total_size || 0)}
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-700/50 text-xs text-slate-500">
                      Added {formatTimeAgo(workspace.added_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
