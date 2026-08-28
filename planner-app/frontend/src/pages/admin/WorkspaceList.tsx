import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

interface WorkspaceListItem {
  id: string;
  name: string;
  displayName: string;
  projectCount: number;
  memberCount: number;
  createdAt: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function WorkspaceList() {
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<WorkspaceListItem[]>("/api/admin/workspaces");
      setWorkspaces(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!createName.trim() || !createDisplayName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/admin/workspaces", {
        name: createName.trim(),
        displayName: createDisplayName.trim(),
      });
      setShowCreate(false);
      setCreateName("");
      setCreateDisplayName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[11px] font-bold text-[#666] tracking-[1px] uppercase">System</p>
            <h1 className="text-2xl font-black text-white mt-1">Workspaces</h1>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-[#F5C518] text-black text-sm font-bold rounded-lg hover:bg-[#F5D848] transition-colors"
          >
            {"\u002B"} New Workspace
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-12 text-center text-[#666]">
            Loading...
          </div>
        ) : workspaces.length === 0 ? (
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-12 text-center text-[#666]">
            No workspaces yet. Click "New Workspace" to create one.
          </div>
        ) : (
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2a2a2a]">
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase">
                    Slug
                  </th>
                  <th className="text-right px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase">
                    Projects
                  </th>
                  <th className="text-right px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase">
                    Members
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase">
                    Created
                  </th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {workspaces.map((w) => (
                  <tr key={w.id} className="hover:bg-[#1f1f1f] transition-colors">
                    <td className="px-4 py-3 text-sm font-bold text-white">{w.displayName}</td>
                    <td className="px-4 py-3 text-xs text-[#888] font-mono">{w.name}</td>
                    <td className="px-4 py-3 text-sm text-[#C0C0C0] text-right">
                      {w.projectCount}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#C0C0C0] text-right">{w.memberCount}</td>
                    <td className="px-4 py-3 text-xs text-[#888]">{formatDate(w.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/admin/workspaces/${w.id}`}
                        className="text-xs text-[#F5C518] hover:text-[#F5D848] font-bold"
                      >
                        View {"\u2192"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        // biome-ignore lint/a11y/useSemanticElements: backdrop acts as click-to-close, not a real button
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setShowCreate(false)}
          onKeyDown={(e) => e.key === "Escape" && setShowCreate(false)}
          role="button"
          tabIndex={0}
        >
          <div
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="text-lg font-bold text-white mb-4">New Workspace</h2>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="ws-name"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Slug (lowercase, hyphens)
                </label>
                <input
                  id="ws-name"
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="olx-autos"
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
                />
              </div>
              <div>
                <label
                  htmlFor="ws-display"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Display Name
                </label>
                <input
                  id="ws-display"
                  type="text"
                  value={createDisplayName}
                  onChange={(e) => setCreateDisplayName(e.target.value)}
                  placeholder="OLX Autos"
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-[#C0C0C0] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={submitting || !createName.trim() || !createDisplayName.trim()}
                className="px-4 py-2 bg-[#F5C518] text-black text-sm font-bold rounded-lg hover:bg-[#F5D848] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
