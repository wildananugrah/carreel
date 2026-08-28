import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";

interface Workspace {
  id: string;
  name: string;
  displayName: string;
  bodyInspectionMode: "VIDEO" | "PHOTOS_8SIDE";
  additionalBodyPhotoCount: number;
  requiredBodySides: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * The 8 body sides in walk-around order, with the same Indonesian labels the
 * driver-app capture grid uses. A workspace picks which of these are mandatory;
 * the rest still get a capture slot in the driver app, marked "(Opsional)".
 */
const BODY_SIDES: { key: string; label: string }[] = [
  { key: "FRONT", label: "Depan" },
  { key: "FRONT_RIGHT", label: "Depan-Kanan" },
  { key: "RIGHT", label: "Kanan" },
  { key: "BACK_RIGHT", label: "Belakang-Kanan" },
  { key: "BACK", label: "Belakang" },
  { key: "BACK_LEFT", label: "Belakang-Kiri" },
  { key: "LEFT", label: "Kiri" },
  { key: "FRONT_LEFT", label: "Depan-Kiri" },
];

interface ProjectListItem {
  id: string;
  workspaceId: string;
  name: string;
  displayName: string;
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

export function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const [savingCount, setSavingCount] = useState(false);
  // Which side is mid-save, so only that checkbox shows a pending state.
  const [savingSides, setSavingSides] = useState<string | null>(null);
  // Local edit buffer for the "Foto Tambahan" count — saved explicitly via the
  // Update button (not on blur), with a "Tersimpan" confirmation.
  const [countInput, setCountInput] = useState(0);
  const [countSaved, setCountSaved] = useState(false);

  // Sync the buffer when the workspace loads or its saved count changes.
  const savedCount = workspace?.additionalBodyPhotoCount;
  useEffect(() => {
    if (savedCount !== undefined) setCountInput(savedCount);
  }, [savedCount]);

  async function handleCountChange(count: number) {
    if (!id || !workspace) return;
    setSavingCount(true);
    setError(null);
    setCountSaved(false);
    try {
      const updated = await api.patch<Workspace>(`/api/admin/workspaces/${id}`, {
        additionalBodyPhotoCount: count,
      });
      setWorkspace(updated);
      setCountSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update count");
    } finally {
      setSavingCount(false);
    }
  }

  /**
   * Toggles one side in or out of the mandatory set. Unchecking the last
   * remaining side is refused here as well as in the backend — a workspace with
   * zero mandatory sides would make the body-inspection step meaningless.
   */
  async function handleSideToggle(side: string) {
    if (!id || !workspace) return;
    const current = workspace.requiredBodySides;
    const next = current.includes(side) ? current.filter((s) => s !== side) : [...current, side];
    if (next.length === 0) return;
    setSavingSides(side);
    setError(null);
    try {
      const updated = await api.patch<Workspace>(`/api/admin/workspaces/${id}`, {
        requiredBodySides: next,
      });
      setWorkspace(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update sides");
    } finally {
      setSavingSides(null);
    }
  }

  async function handleModeChange(mode: "VIDEO" | "PHOTOS_8SIDE") {
    if (!id || !workspace) return;
    setSavingMode(true);
    setError(null);
    try {
      const updated = await api.patch<Workspace>(`/api/admin/workspaces/${id}`, {
        bodyInspectionMode: mode,
      });
      setWorkspace(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update mode");
    } finally {
      setSavingMode(false);
    }
  }

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [ws, projs] = await Promise.all([
        api.get<Workspace>(`/api/admin/workspaces/${id}`),
        api.get<ProjectListItem[]>(`/api/admin/workspaces/${id}/projects`),
      ]);
      setWorkspace(ws);
      setProjects(projs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateProject = async () => {
    if (!id || !createName.trim() || !createDisplayName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/admin/workspaces/${id}/projects`, {
        name: createName.trim(),
        displayName: createDisplayName.trim(),
      });
      setShowCreate(false);
      setCreateName("");
      setCreateDisplayName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!id || !workspace) return;
    if (confirmDelete !== workspace.name) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.delete(`/api/admin/workspaces/${id}`);
      navigate("/admin/workspaces");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete workspace");
      setSubmitting(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!window.confirm("Delete this project? This cannot be undone.")) return;
    try {
      await api.delete(`/api/admin/projects/${projectId}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-white">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-12 text-center text-[#666]">
            Loading...
          </div>
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-white">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <Link to="/admin/workspaces" className="text-sm text-[#F5C518]">
            {"\u2190"} Back to workspaces
          </Link>
          <div className="mt-6 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-12 text-center text-[#666]">
            Workspace not found
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <Link
          to="/admin/workspaces"
          className="text-sm text-[#F5C518] hover:text-[#F5D848] mb-4 inline-block"
        >
          {"\u2190"} Back to workspaces
        </Link>

        <div className="flex items-start justify-between mt-2 mb-6">
          <div>
            <p className="text-[11px] font-bold text-[#666] tracking-[1px] uppercase">Workspace</p>
            <h1 className="text-2xl font-black text-white mt-1">{workspace.displayName}</h1>
            <p className="text-xs text-[#666] mt-1 font-mono">
              {workspace.name} {"\u00B7"} {formatDate(workspace.createdAt)}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Projects section */}
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
            <h2 className="text-sm font-bold text-white">Projects ({projects.length})</h2>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="px-3 py-1.5 bg-[#F5C518] text-black text-xs font-bold rounded-lg hover:bg-[#F5D848] transition-colors"
            >
              {"\u002B"} New Project
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="p-12 text-center text-[#666]">No projects in this workspace yet.</div>
          ) : (
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
                    Members
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase">
                    Created
                  </th>
                  <th className="w-40" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {projects.map((p) => (
                  <tr key={p.id} className="hover:bg-[#1f1f1f] transition-colors">
                    <td className="px-4 py-3 text-sm font-bold text-white">{p.displayName}</td>
                    <td className="px-4 py-3 text-xs text-[#888] font-mono">{p.name}</td>
                    <td className="px-4 py-3 text-sm text-[#C0C0C0] text-right">{p.memberCount}</td>
                    <td className="px-4 py-3 text-xs text-[#888]">{formatDate(p.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/admin/projects/${p.id}/members`}
                        className="text-xs text-[#F5C518] hover:text-[#F5D848] font-bold mr-3"
                      >
                        Manage
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDeleteProject(p.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Body inspection mode */}
        <div className="mt-8 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-1">Mode Inspeksi Body</h3>
          <p className="text-xs text-[#888] mb-3">
            Pilih bagaimana driver melakukan inspeksi body kendaraan untuk workspace ini.
          </p>
          <div className="flex gap-2">
            {(["VIDEO", "PHOTOS_8SIDE"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={savingMode}
                onClick={() => handleModeChange(mode)}
                className={
                  workspace.bodyInspectionMode === mode
                    ? "px-4 py-2 rounded-lg bg-[#F5C518] text-black text-sm font-bold disabled:opacity-40"
                    : "px-4 py-2 rounded-lg bg-[#111] text-[#C0C0C0] border border-[#2a2a2a] text-sm hover:bg-[#1f1f1f] disabled:opacity-40"
                }
              >
                {mode === "VIDEO" ? "Video" : "8 Foto Sisi"}
              </button>
            ))}
          </div>
          {workspace.bodyInspectionMode === "PHOTOS_8SIDE" && (
            <div className="mt-4">
              <p className="text-xs text-[#888] mb-1">
                Sisi Wajib ({workspace.requiredBodySides.length}/8)
              </p>
              <p className="text-xs text-[#666] mb-2">
                Sisi yang tidak dicentang tetap muncul di aplikasi driver, tapi ditandai
                "(Opsional)" dan tidak menghalangi submit.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {BODY_SIDES.map((side) => {
                  const checked = workspace.requiredBodySides.includes(side.key);
                  // Refuse to uncheck the last remaining mandatory side.
                  const isLastChecked = checked && workspace.requiredBodySides.length === 1;
                  return (
                    <label
                      key={side.key}
                      className={
                        isLastChecked
                          ? "flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111] border border-[#2a2a2a] text-sm opacity-60 cursor-not-allowed"
                          : "flex items-center gap-2 px-3 py-2 rounded-lg bg-[#111] border border-[#2a2a2a] text-sm cursor-pointer hover:bg-[#1f1f1f]"
                      }
                      title={isLastChecked ? "Minimal satu sisi harus wajib" : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={savingSides !== null || isLastChecked}
                        onChange={() => handleSideToggle(side.key)}
                        className="accent-[#F5C518] w-4 h-4 disabled:opacity-40"
                      />
                      <span className={checked ? "text-white" : "text-[#888]"}>{side.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div className="mt-4">
            <p className="text-xs text-[#888] mb-1">Foto Tambahan (jumlah, 0 = nonaktif)</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={10}
                value={countInput}
                disabled={savingCount}
                onChange={(e) => {
                  setCountInput(Math.max(0, Math.min(10, Math.floor(Number(e.target.value) || 0))));
                  setCountSaved(false);
                }}
                className="w-24 px-3 py-2 rounded-lg bg-[#111] text-white border border-[#2a2a2a] text-sm disabled:opacity-40"
              />
              <button
                type="button"
                disabled={savingCount || countInput === workspace.additionalBodyPhotoCount}
                onClick={() => handleCountChange(countInput)}
                className="px-4 py-2 rounded-lg bg-[#F5C518] text-black text-sm font-bold disabled:opacity-40"
              >
                {savingCount ? "Menyimpan…" : "Update"}
              </button>
              {countSaved && countInput === workspace.additionalBodyPhotoCount && (
                <span className="text-xs font-medium text-green-400">✓ Tersimpan</span>
              )}
            </div>
          </div>
        </div>

        {/* Danger zone */}
        <div className="mt-8 bg-red-500/5 border border-red-500/30 rounded-xl p-4">
          <h3 className="text-sm font-bold text-red-400 mb-2">Danger zone</h3>
          <p className="text-xs text-[#888] mb-3">
            Delete this workspace permanently. Soft-locked while projects exist.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={confirmDelete ?? ""}
              onChange={(e) => setConfirmDelete(e.target.value)}
              placeholder={`Type "${workspace.name}" to confirm`}
              className="flex-1 px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-red-500/50"
            />
            <button
              type="button"
              onClick={handleDeleteWorkspace}
              disabled={confirmDelete !== workspace.name || submitting}
              className="px-4 py-2 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Delete Workspace
            </button>
          </div>
        </div>
      </div>

      {/* Create project modal */}
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
            <h2 className="text-lg font-bold text-white mb-4">New Project</h2>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="proj-name"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Slug
                </label>
                <input
                  id="proj-name"
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="used-cars"
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
                />
              </div>
              <div>
                <label
                  htmlFor="proj-display"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Display Name
                </label>
                <input
                  id="proj-display"
                  type="text"
                  value={createDisplayName}
                  onChange={(e) => setCreateDisplayName(e.target.value)}
                  placeholder="OLX Used Cars"
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
                onClick={handleCreateProject}
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
