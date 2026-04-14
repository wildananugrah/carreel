import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  systemRole: "SUPER_ADMIN" | "USER" | "CARREEL_DRIVER_SUPPORT";
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

/**
 * Returns a deduplicated list of workspace display names from a user's
 * project memberships (a single workspace may contain multiple projects).
 */
function uniqueWorkspaces(
  memberships: AdminUserProjectMembership[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of memberships) {
    if (!seen.has(m.workspaceId)) {
      seen.add(m.workspaceId);
      result.push(m.workspaceDisplayName);
    }
  }
  return result;
}

function projectRoleColor(
  role: "PROJECT_ADMIN" | "PLANNER" | "DRIVER",
): string {
  if (role === "PROJECT_ADMIN") return "text-[#F5C518]";
  if (role === "PLANNER") return "text-[#4DA3FF]";
  return "text-[#8DC26F]";
}

function projectRoleShort(
  role: "PROJECT_ADMIN" | "PLANNER" | "DRIVER",
): string {
  if (role === "PROJECT_ADMIN") return "Admin";
  if (role === "PLANNER") return "Planner";
  return "Driver";
}

export function UserList() {
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createFullName, setCreateFullName] = useState("");
  const [createRole, setCreateRole] = useState<"DRIVER" | "PLANNER">("PLANNER");
  const [createPassword, setCreatePassword] = useState("");
  const [createSystemRole, setCreateSystemRole] = useState<
    "USER" | "SUPER_ADMIN" | "CARREEL_DRIVER_SUPPORT"
  >("USER");
  const [submitting, setSubmitting] = useState(false);

  const [editingUser, setEditingUser] = useState<AdminUserListItem | null>(
    null,
  );
  const [editFullName, setEditFullName] = useState("");
  const [editSystemRole, setEditSystemRole] = useState<
    "USER" | "SUPER_ADMIN" | "CARREEL_DRIVER_SUPPORT"
  >("USER");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (searchQuery?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = searchQuery
        ? `/api/admin/users?search=${encodeURIComponent(searchQuery)}`
        : "/api/admin/users";
      const data = await api.get<AdminUserListItem[]>(url);
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // CARREEL_DRIVER_SUPPORT can only be assigned to DRIVER global-role users.
  useEffect(() => {
    if (createSystemRole === "CARREEL_DRIVER_SUPPORT" && createRole !== "DRIVER") {
      setCreateRole("DRIVER");
    }
  }, [createSystemRole, createRole]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      load(search.trim() || undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, load]);

  const openEdit = (u: AdminUserListItem) => {
    setEditingUser(u);
    setEditFullName(u.fullName);
    setEditSystemRole(u.systemRole);
    setError(null);
  };

  const closeEdit = () => {
    setEditingUser(null);
    setEditFullName("");
    setEditSystemRole("USER");
  };

  const handleEditSave = async () => {
    if (!editingUser) return;
    const trimmedName = editFullName.trim();
    if (!trimmedName) return;

    const escalating =
      editingUser.systemRole !== editSystemRole &&
      (editSystemRole === "SUPER_ADMIN" ||
        editSystemRole === "CARREEL_DRIVER_SUPPORT");
    if (
      escalating &&
      !window.confirm(
        `Grant ${
          editSystemRole === "SUPER_ADMIN"
            ? "SUPER_ADMIN"
            : "CARREEL_DRIVER_SUPPORT"
        } to ${editingUser.fullName}? They will bypass all project filters.`,
      )
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.patch(`/api/admin/users/${editingUser.id}`, {
        fullName: trimmedName,
        systemRole: editSystemRole,
      });
      closeEdit();
      await load(search.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (u: AdminUserListItem) => {
    if (
      !window.confirm(
        `Archive ${u.fullName}? They will be unable to log in. This is a soft delete \u2014 data is preserved.`,
      )
    ) {
      return;
    }
    setDeletingId(u.id);
    setError(null);
    try {
      await api.delete(`/api/admin/users/${u.id}`);
      await load(search.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive user");
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreate = async () => {
    if (
      !createEmail.trim() ||
      !createFullName.trim() ||
      createPassword.length < 8
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/admin/users", {
        email: createEmail.trim(),
        fullName: createFullName.trim(),
        role: createRole,
        password: createPassword,
        systemRole: createSystemRole,
      });
      setShowCreate(false);
      setCreateEmail("");
      setCreateFullName("");
      setCreateRole("PLANNER");
      setCreatePassword("");
      setCreateSystemRole("USER");
      await load(search.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[11px] font-bold text-[#666] tracking-[1px] uppercase">
              System
            </p>
            <h1 className="text-2xl font-black text-white mt-1">All Users</h1>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-[#F5C518] text-black text-sm font-bold rounded-lg hover:bg-[#F5D848] transition-colors"
          >
            {"\u002B"} New User
          </button>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email or name..."
            className="w-full max-w-md px-3 py-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
          />
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
        ) : users.length === 0 ? (
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-12 text-center text-[#666]">
            {search ? "No users match your search." : "No users yet."}
          </div>
        ) : (
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-x-auto">
            <table className="w-full min-w-[1280px]">
              <thead>
                <tr className="border-b border-[#2a2a2a]">
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase whitespace-nowrap">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase whitespace-nowrap">
                    Email
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase whitespace-nowrap">
                    Global Role
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase whitespace-nowrap">
                    System Role
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase whitespace-nowrap">
                    Workspaces
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase whitespace-nowrap">
                    Projects
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase whitespace-nowrap">
                    Created
                  </th>
                  <th className="text-right px-4 py-3 text-[10px] font-bold text-[#666] tracking-[1px] uppercase whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {users.map((u) => {
                  const workspaces = uniqueWorkspaces(u.projectMemberships);
                  return (
                    <tr
                      key={u.id}
                      className="hover:bg-[#1f1f1f] transition-colors align-top"
                    >
                      <td className="px-4 py-3 text-sm font-bold text-white whitespace-nowrap">
                        {u.fullName}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#888] whitespace-nowrap">
                        {u.email}
                      </td>
                      <td className="px-4 py-3 text-[10px] font-bold uppercase tracking-[1px] text-[#C0C0C0] whitespace-nowrap">
                        {u.role}
                      </td>
                      <td className="px-4 py-3 text-[10px] font-bold uppercase tracking-[1px] whitespace-nowrap">
                        {u.systemRole === "SUPER_ADMIN" ? (
                          <span className="text-[#F5C518]">Super Admin</span>
                        ) : u.systemRole === "CARREEL_DRIVER_SUPPORT" ? (
                          <span className="text-[#4DA3FF]">Driver Support</span>
                        ) : (
                          <span className="text-[#666]">User</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#C0C0C0]">
                        {workspaces.length === 0 ? (
                          <span className="text-[#444] italic">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 max-w-[240px]">
                            {workspaces.map((w) => (
                              <span
                                key={w}
                                className="inline-block px-2 py-0.5 bg-[#111] border border-[#2a2a2a] rounded-full text-[10px] whitespace-nowrap"
                              >
                                {w}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#C0C0C0]">
                        {u.projectMemberships.length === 0 ? (
                          <span className="text-[#444] italic">—</span>
                        ) : (
                          <div className="flex flex-col gap-1 max-w-[280px]">
                            {u.projectMemberships.map((m) => (
                              <div
                                key={m.projectId}
                                className="flex items-center gap-2 whitespace-nowrap"
                              >
                                <span className="text-[11px] text-white">
                                  {m.projectDisplayName}
                                </span>
                                <span
                                  className={`text-[9px] font-bold uppercase tracking-[0.5px] ${projectRoleColor(m.role)}`}
                                >
                                  {projectRoleShort(m.role)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#888] whitespace-nowrap">
                        {formatDate(u.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            to={`/admin/users/${u.id}`}
                            className="text-xs text-[#888] hover:text-white font-bold"
                          >
                            View
                          </Link>
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            className="text-xs text-[#F5C518] hover:text-[#F5D848] font-bold"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(u)}
                            disabled={deletingId === u.id}
                            className="text-xs text-red-400 hover:text-red-300 font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {deletingId === u.id ? "Archiving..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
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
            <h2 className="text-lg font-bold text-white mb-4">New User</h2>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="user-email"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Email
                </label>
                <input
                  id="user-email"
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
                />
              </div>
              <div>
                <label
                  htmlFor="user-fullname"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Full Name
                </label>
                <input
                  id="user-fullname"
                  type="text"
                  value={createFullName}
                  onChange={(e) => setCreateFullName(e.target.value)}
                  placeholder="Full Name"
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
                />
              </div>
              <div>
                <label
                  htmlFor="user-role"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Global Role
                </label>
                <select
                  id="user-role"
                  value={createRole}
                  onChange={(e) =>
                    setCreateRole(e.target.value as "DRIVER" | "PLANNER")
                  }
                  disabled={createSystemRole === "CARREEL_DRIVER_SUPPORT"}
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <option value="DRIVER">Driver</option>
                  <option value="PLANNER">Planner</option>
                </select>
                <p className="text-[10px] text-[#666] mt-1">
                  Determines which app the user can log into.
                </p>
              </div>
              <div>
                <label
                  htmlFor="user-system-role"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  System Role
                </label>
                <select
                  id="user-system-role"
                  value={createSystemRole}
                  onChange={(e) =>
                    setCreateSystemRole(
                      e.target.value as
                        | "USER"
                        | "SUPER_ADMIN"
                        | "CARREEL_DRIVER_SUPPORT",
                    )
                  }
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
                >
                  <option value="USER">User</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                  <option value="CARREEL_DRIVER_SUPPORT">
                    Carreel Driver Support
                  </option>
                </select>
                <p className="text-[10px] text-[#666] mt-1">
                  Carreel Driver Support users log into the driver-app with
                  full cross-project access.
                </p>
              </div>
              <div>
                <label
                  htmlFor="user-password"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Password (min 8 chars)
                </label>
                <input
                  id="user-password"
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
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
                disabled={
                  submitting ||
                  !createEmail.trim() ||
                  !createFullName.trim() ||
                  createPassword.length < 8
                }
                className="px-4 py-2 bg-[#F5C518] text-black text-sm font-bold rounded-lg hover:bg-[#F5D848] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingUser && (
        // biome-ignore lint/a11y/useSemanticElements: backdrop acts as click-to-close, not a real button
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={closeEdit}
          onKeyDown={(e) => e.key === "Escape" && closeEdit()}
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
            <h2 className="text-lg font-bold text-white mb-1">Edit User</h2>
            <p className="text-xs text-[#666] mb-4">
              {editingUser.email} {"\u00B7"} {editingUser.role}
            </p>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="edit-user-fullname"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Full Name
                </label>
                <input
                  id="edit-user-fullname"
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  placeholder="Full Name"
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-user-system-role"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  System Role
                </label>
                <select
                  id="edit-user-system-role"
                  value={editSystemRole}
                  onChange={(e) =>
                    setEditSystemRole(
                      e.target.value as
                        | "USER"
                        | "SUPER_ADMIN"
                        | "CARREEL_DRIVER_SUPPORT",
                    )
                  }
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
                >
                  <option value="USER">User</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                  {editingUser.role === "DRIVER" && (
                    <option value="CARREEL_DRIVER_SUPPORT">
                      Carreel Driver Support
                    </option>
                  )}
                </select>
                <p className="text-[10px] text-[#666] mt-1">
                  Grants elevated platform access. Driver Support is available
                  only for driver-app users.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={closeEdit}
                className="px-4 py-2 text-sm text-[#C0C0C0] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEditSave}
                disabled={submitting || !editFullName.trim()}
                className="px-4 py-2 bg-[#F5C518] text-black text-sm font-bold rounded-lg hover:bg-[#F5D848] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
