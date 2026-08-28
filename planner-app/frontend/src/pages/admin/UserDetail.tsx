import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";

interface AdminUserProjectMembership {
  projectId: string;
  projectName: string;
  projectDisplayName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceDisplayName: string;
  role: "PROJECT_ADMIN" | "PLANNER" | "DRIVER";
}

interface AdminUserListItem {
  id: string;
  email: string;
  fullName: string;
  role: "DRIVER" | "PLANNER";
  systemRole: "SUPER_ADMIN" | "USER";
  projectMemberships: AdminUserProjectMembership[];
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

function roleLabel(role: "PROJECT_ADMIN" | "PLANNER" | "DRIVER"): string {
  if (role === "PROJECT_ADMIN") return "Admin";
  if (role === "PLANNER") return "Planner";
  return "Driver";
}

function roleColor(role: "PROJECT_ADMIN" | "PLANNER" | "DRIVER"): string {
  if (role === "PROJECT_ADMIN") return "text-[#F5C518]";
  if (role === "PLANNER") return "text-[#4DA3FF]";
  return "text-[#8DC26F]";
}

export function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<AdminUserListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<AdminUserListItem>(`/api/admin/users/${id}`);
      setUser(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleSuperAdmin = async () => {
    if (!id || !user) return;
    const newRole = user.systemRole === "SUPER_ADMIN" ? "USER" : "SUPER_ADMIN";
    const confirmMsg =
      newRole === "SUPER_ADMIN"
        ? `Promote ${user.fullName} to SUPER_ADMIN? They will get full platform access.`
        : `Demote ${user.fullName} from SUPER_ADMIN?`;
    if (!window.confirm(confirmMsg)) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.patch(`/api/admin/users/${id}`, { systemRole: newRole });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!id || !user) return;
    if (
      !window.confirm(
        `Archive ${user.fullName}? They will be unable to log in. This is a soft delete — data is preserved.`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.delete(`/api/admin/users/${id}`);
      navigate("/admin/users");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive user");
      setSubmitting(false);
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

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-white">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <Link to="/admin/users" className="text-sm text-[#F5C518]">
            {"\u2190"} Back to users
          </Link>
          <div className="mt-6 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-12 text-center text-[#666]">
            User not found
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <Link
          to="/admin/users"
          className="text-sm text-[#F5C518] hover:text-[#F5D848] mb-4 inline-block"
        >
          {"\u2190"} Back to users
        </Link>

        <div className="flex items-start justify-between mt-2 mb-6">
          <div>
            <p className="text-[11px] font-bold text-[#666] tracking-[1px] uppercase">User</p>
            <h1 className="text-2xl font-black text-white mt-1">{user.fullName}</h1>
            <p className="text-xs text-[#666] mt-1">
              {user.email} {"\u00B7"} {user.role} {"\u00B7"} Joined {formatDate(user.createdAt)}
            </p>
          </div>
          <div>
            {user.systemRole === "SUPER_ADMIN" && (
              <span className="px-3 py-1 bg-[#F5C518]/10 border border-[#F5C518]/30 text-[#F5C518] text-[11px] font-bold rounded-full">
                Super Admin
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Project memberships */}
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-[#2a2a2a]">
            <h2 className="text-sm font-bold text-white">
              Project Memberships ({user.projectMemberships.length})
            </h2>
          </div>
          {user.projectMemberships.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#666] italic">
              Not a member of any project yet
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#2a2a2a]">
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase">
                    Workspace
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase">
                    Project
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase">
                    Role
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {user.projectMemberships.map((m) => (
                  <tr key={m.projectId} className="hover:bg-[#1f1f1f] transition-colors">
                    <td className="px-4 py-3 text-sm text-white">{m.workspaceDisplayName}</td>
                    <td className="px-4 py-3 text-sm text-[#C0C0C0]">{m.projectDisplayName}</td>
                    <td
                      className={`px-4 py-3 text-[10px] font-bold uppercase tracking-[1px] ${roleColor(m.role)}`}
                    >
                      {roleLabel(m.role)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Actions */}
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4 mb-6">
          <h3 className="text-sm font-bold text-white mb-3">Actions</h3>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleToggleSuperAdmin}
              disabled={submitting}
              className="px-4 py-2 bg-[#111] border border-[#2a2a2a] text-[#F5C518] text-sm font-bold rounded-lg hover:bg-[#1f1f1f] disabled:opacity-40 transition-colors"
            >
              {user.systemRole === "SUPER_ADMIN"
                ? "Demote from Super Admin"
                : "Promote to Super Admin"}
            </button>
          </div>
        </div>

        {/* Danger zone */}
        <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-4">
          <h3 className="text-sm font-bold text-red-400 mb-2">Danger zone</h3>
          <p className="text-xs text-[#888] mb-3">
            Archive this user. They will be unable to log in, but all their data (inspections,
            reviews, etc.) is preserved. Email is prefixed with "archived-{"{"}timestamp{"}"}-" to
            free up the original email.
          </p>
          <button
            type="button"
            onClick={handleArchive}
            disabled={submitting}
            className="px-4 py-2 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Archive User
          </button>
        </div>
      </div>
    </div>
  );
}
