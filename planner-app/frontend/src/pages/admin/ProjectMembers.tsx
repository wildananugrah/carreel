import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api";

type ProjectRole = "PROJECT_ADMIN" | "PLANNER" | "DRIVER";

interface ProjectMemberView {
  id: string;
  projectId: string;
  userId: string;
  email: string;
  fullName: string;
  role: ProjectRole;
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

function roleLabel(role: ProjectRole): string {
  if (role === "PROJECT_ADMIN") return "Admin";
  if (role === "PLANNER") return "Planner";
  return "Driver";
}

function roleColor(role: ProjectRole): string {
  if (role === "PROJECT_ADMIN") return "text-[#F5C518]";
  if (role === "PLANNER") return "text-[#4DA3FF]";
  return "text-[#8DC26F]";
}

export function ProjectMembers() {
  const { projectId } = useParams<{ projectId: string }>();
  const [members, setMembers] = useState<ProjectMemberView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ProjectRole>("DRIVER");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ProjectMemberView[]>(
        `/api/admin/projects/${projectId}/members`,
      );
      setMembers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleInvite = async () => {
    if (!projectId || !inviteEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/admin/projects/${projectId}/members`, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setShowInvite(false);
      setInviteEmail("");
      setInviteRole("DRIVER");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite member");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (userId: string, fullName: string) => {
    if (!projectId) return;
    if (!window.confirm(`Remove ${fullName} from this project?`)) return;
    try {
      await api.delete(
        `/api/admin/projects/${projectId}/members/${userId}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const drivers = members.filter((m) => m.role === "DRIVER");
  const planners = members.filter((m) => m.role === "PLANNER");
  const admins = members.filter((m) => m.role === "PROJECT_ADMIN");

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <Link
          to="/"
          className="text-sm text-[#F5C518] hover:text-[#F5D848] mb-4 inline-block"
        >
          {"\u2190"} Back to dashboard
        </Link>

        <div className="flex items-start justify-between mt-2 mb-6">
          <div>
            <p className="text-[11px] font-bold text-[#666] tracking-[1px] uppercase">
              Project Members
            </p>
            <h1 className="text-2xl font-black text-white mt-1">
              {projectId?.slice(0, 8) ?? "Project"}
            </h1>
            <p className="text-xs text-[#666] mt-1">
              {members.length} total {"\u00B7"} {drivers.length} drivers{" "}
              {"\u00B7"} {planners.length} planners {"\u00B7"} {admins.length}{" "}
              admins
            </p>
          </div>
          <div className="flex gap-2">
            {projectId && (
              <Link
                to={`/admin/projects/${projectId}/assignments`}
                className="px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] text-[#C0C0C0] text-sm font-bold rounded-lg hover:border-[#F5C518] hover:text-[#F5C518] transition-colors"
              >
                Driver Assignments {"\u2192"}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setShowInvite(true)}
              className="px-4 py-2 bg-[#F5C518] text-black text-sm font-bold rounded-lg hover:bg-[#F5D848] transition-colors"
            >
              {"\u002B"} Invite Member
            </button>
          </div>
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
        ) : members.length === 0 ? (
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-12 text-center text-[#666]">
            No members yet. Click &quot;Invite Member&quot; to add someone.
          </div>
        ) : (
          <div className="space-y-4">
            <MemberSection
              title={`Drivers (${drivers.length})`}
              members={drivers}
              onRemove={handleRemove}
            />
            <MemberSection
              title={`Planners (${planners.length})`}
              members={planners}
              onRemove={handleRemove}
            />
            <MemberSection
              title={`Admins (${admins.length})`}
              members={admins}
              onRemove={handleRemove}
            />
          </div>
        )}
      </div>

      {showInvite && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setShowInvite(false)}
          onKeyDown={(e) => e.key === "Escape" && setShowInvite(false)}
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
            <h2 className="text-lg font-bold text-white mb-1">Invite Member</h2>
            <p className="text-xs text-[#666] mb-4">
              The user must already have an account. Email must match their
              registered email exactly.
            </p>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="invite-email"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Email
                </label>
                <input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
                />
              </div>
              <div>
                <label
                  htmlFor="invite-role"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Role in this project
                </label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as ProjectRole)}
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
                >
                  <option value="DRIVER">Driver</option>
                  <option value="PLANNER">Planner</option>
                  <option value="PROJECT_ADMIN">Project Admin</option>
                </select>
                <p className="text-[10px] text-[#666] mt-1">
                  Note: User&apos;s global role must match. DRIVER can only be
                  added as Driver; PLANNER can be Planner or Admin.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setShowInvite(false)}
                className="px-4 py-2 text-sm text-[#C0C0C0] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInvite}
                disabled={submitting || !inviteEmail.trim()}
                className="px-4 py-2 bg-[#F5C518] text-black text-sm font-bold rounded-lg hover:bg-[#F5D848] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Inviting..." : "Invite"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MemberSection({
  title,
  members,
  onRemove,
}: {
  title: string;
  members: ProjectMemberView[];
  onRemove: (userId: string, fullName: string) => void;
}) {
  if (members.length === 0) {
    return (
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#2a2a2a]">
          <h2 className="text-sm font-bold text-white">{title}</h2>
        </div>
        <div className="p-8 text-center text-[#666] text-xs italic">
          None yet
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#2a2a2a]">
        <h2 className="text-sm font-bold text-white">{title}</h2>
      </div>
      <table className="w-full">
        <tbody className="divide-y divide-[#2a2a2a]">
          {members.map((m) => (
            <tr key={m.id} className="hover:bg-[#1f1f1f] transition-colors">
              <td className="px-4 py-3 text-sm font-bold text-white">
                {m.fullName}
              </td>
              <td className="px-4 py-3 text-xs text-[#888]">{m.email}</td>
              <td
                className={`px-4 py-3 text-[10px] font-bold uppercase tracking-[1px] ${roleColor(m.role)}`}
              >
                {roleLabel(m.role)}
              </td>
              <td className="px-4 py-3 text-xs text-[#666] text-right">
                {formatDate(m.createdAt)}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onRemove(m.userId, m.fullName)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
