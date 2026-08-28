import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api";

interface CandidateUser {
  id: string;
  email: string;
  fullName: string;
  role: "DRIVER" | "PLANNER";
}

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

  const [candidates, setCandidates] = useState<CandidateUser[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const comboboxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ProjectMemberView[]>(`/api/admin/projects/${projectId}/members`);
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

  // Debounced candidate search. Refetches when query or role changes.
  useEffect(() => {
    if (!showInvite || !projectId) return;
    const trimmed = inviteEmail.trim();
    if (trimmed.length < 2) {
      setCandidates([]);
      setCandidatesLoading(false);
      return;
    }
    setCandidatesLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.get<CandidateUser[]>(
          `/api/admin/projects/${projectId}/members/search-candidates?q=${encodeURIComponent(trimmed)}&role=${inviteRole}`,
        );
        setCandidates(data);
        setHighlightedIndex(data.length > 0 ? 0 : -1);
      } catch {
        setCandidates([]);
        setHighlightedIndex(-1);
      } finally {
        setCandidatesLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [inviteEmail, inviteRole, projectId, showInvite]);

  // Close the suggestions dropdown on outside click.
  useEffect(() => {
    if (!showSuggestions) return;
    const onDown = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showSuggestions]);

  const selectCandidate = (candidate: CandidateUser) => {
    setInviteEmail(candidate.email);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  };

  const handleEmailKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || candidates.length === 0) {
      if (e.key === "ArrowDown" && candidates.length > 0) {
        setShowSuggestions(true);
        setHighlightedIndex(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % candidates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i - 1 + candidates.length) % candidates.length);
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < candidates.length) {
        e.preventDefault();
        selectCandidate(candidates[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const resetInviteForm = () => {
    setShowInvite(false);
    setInviteEmail("");
    setInviteRole("DRIVER");
    setCandidates([]);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  };

  const handleInvite = async () => {
    if (!projectId || !inviteEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/admin/projects/${projectId}/members`, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      resetInviteForm();
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
      await api.delete(`/api/admin/projects/${projectId}/members/${userId}`);
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
        <Link to="/" className="text-sm text-[#F5C518] hover:text-[#F5D848] mb-4 inline-block">
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
              {members.length} total {"\u00B7"} {drivers.length} drivers {"\u00B7"}{" "}
              {planners.length} planners {"\u00B7"} {admins.length} admins
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
        // biome-ignore lint/a11y/useSemanticElements: backdrop acts as click-to-close, not a real button
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={resetInviteForm}
          onKeyDown={(e) => e.key === "Escape" && resetInviteForm()}
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
              The user must already have an account. Email must match their registered email
              exactly.
            </p>

            <div className="space-y-4">
              <div ref={comboboxRef} className="relative">
                <label
                  htmlFor="invite-email"
                  className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
                >
                  Email
                </label>
                <input
                  id="invite-email"
                  type="text"
                  role="combobox"
                  autoComplete="off"
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onKeyDown={handleEmailKeyDown}
                  placeholder="Type email or name..."
                  aria-autocomplete="list"
                  aria-expanded={showSuggestions}
                  aria-controls="invite-email-suggestions"
                  className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
                />
                {showSuggestions && inviteEmail.trim().length >= 2 && (
                  <div
                    id="invite-email-suggestions"
                    role="listbox"
                    className="absolute left-0 right-0 top-full mt-1 bg-[#111] border border-[#2a2a2a] rounded-lg shadow-xl max-h-64 overflow-y-auto z-10"
                  >
                    {candidatesLoading ? (
                      <div className="px-3 py-2 text-xs text-[#666]">Searching...</div>
                    ) : candidates.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-[#666]">No matching users</div>
                    ) : (
                      candidates.map((c, idx) => (
                        <button
                          type="button"
                          key={c.id}
                          role="option"
                          aria-selected={idx === highlightedIndex}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                          onClick={() => selectCandidate(c)}
                          className={`w-full text-left px-3 py-2 border-b border-[#2a2a2a] last:border-b-0 transition-colors ${
                            idx === highlightedIndex ? "bg-[#1f1f1f]" : "hover:bg-[#1a1a1a]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-bold text-white truncate">
                                {c.fullName}
                              </div>
                              <div className="text-[11px] text-[#888] truncate">{c.email}</div>
                            </div>
                            <span
                              className={`text-[9px] font-bold uppercase tracking-[0.5px] shrink-0 ${
                                c.role === "DRIVER" ? "text-[#8DC26F]" : "text-[#4DA3FF]"
                              }`}
                            >
                              {c.role}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
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
                  Note: User&apos;s global role must match. DRIVER can only be added as Driver;
                  PLANNER can be Planner or Admin.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={resetInviteForm}
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
        <div className="p-8 text-center text-[#666] text-xs italic">None yet</div>
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
              <td className="px-4 py-3 text-sm font-bold text-white">{m.fullName}</td>
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
