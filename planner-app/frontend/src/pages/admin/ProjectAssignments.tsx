import { useCallback, useEffect, useMemo, useState } from "react";
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

interface DriverAssignmentView {
  id: string;
  projectId: string;
  driverId: string;
  driverEmail: string;
  driverName: string;
  plannerId: string;
  plannerEmail: string;
  plannerName: string;
  assignedBy: string;
  createdAt: string;
}

export function ProjectAssignments() {
  const { projectId } = useParams<{ projectId: string }>();
  const [members, setMembers] = useState<ProjectMemberView[]>([]);
  const [assignments, setAssignments] = useState<DriverAssignmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [membersData, assignmentsData] = await Promise.all([
        api.get<ProjectMemberView[]>(`/api/admin/projects/${projectId}/members`),
        api.get<DriverAssignmentView[]>(
          `/api/admin/projects/${projectId}/assignments`,
        ),
      ]);
      setMembers(membersData);
      setAssignments(assignmentsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assignments");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const drivers = useMemo(
    () => members.filter((m) => m.role === "DRIVER"),
    [members],
  );
  const planners = useMemo(
    () =>
      members.filter(
        (m) => m.role === "PLANNER" || m.role === "PROJECT_ADMIN",
      ),
    [members],
  );

  const assignmentsByDriver = useMemo(() => {
    const map = new Map<string, DriverAssignmentView[]>();
    for (const a of assignments) {
      const list = map.get(a.driverId) ?? [];
      list.push(a);
      map.set(a.driverId, list);
    }
    return map;
  }, [assignments]);

  const driverCountByPlanner = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assignments) {
      map.set(a.plannerId, (map.get(a.plannerId) ?? 0) + 1);
    }
    return map;
  }, [assignments]);

  const handleAddAssignment = async (driverId: string, plannerId: string) => {
    if (!projectId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/admin/projects/${projectId}/assignments`, {
        driverId,
        plannerId,
      });
      setAddingFor(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add assignment");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveAssignment = async (assignmentId: string) => {
    if (!projectId) return;
    try {
      await api.delete(
        `/api/admin/projects/${projectId}/assignments/${assignmentId}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove assignment");
    }
  };

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
              Driver-Planner Assignments
            </p>
            <h1 className="text-2xl font-black text-white mt-1">
              {projectId?.slice(0, 8) ?? "Project"}
            </h1>
            <p className="text-xs text-[#666] mt-1">
              {drivers.length} drivers {"\u00B7"} {planners.length} planners {"\u00B7"} {assignments.length} assignments
            </p>
          </div>
          {projectId && (
            <Link
              to={`/admin/projects/${projectId}/members`}
              className="px-4 py-2 bg-[#1a1a1a] border border-[#2a2a2a] text-[#C0C0C0] text-sm font-bold rounded-lg hover:border-[#F5C518] hover:text-[#F5C518] transition-colors"
            >
              {"\u2190"} Members
            </Link>
          )}
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
        ) : drivers.length === 0 ? (
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-12 text-center text-[#666]">
            No drivers in this project yet.{" "}
            <Link
              to={`/admin/projects/${projectId}/members`}
              className="text-[#F5C518] hover:text-[#F5D848]"
            >
              Invite drivers via the Members page
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2a2a2a]">
                <h2 className="text-sm font-bold text-white">
                  Drivers ({drivers.length})
                </h2>
              </div>
              <div className="divide-y divide-[#2a2a2a]">
                {drivers.map((driver) => {
                  const driverAssignments =
                    assignmentsByDriver.get(driver.userId) ?? [];
                  const assignedPlannerIds = new Set(
                    driverAssignments.map((a) => a.plannerId),
                  );
                  const availablePlanners = planners.filter(
                    (p) => !assignedPlannerIds.has(p.userId),
                  );

                  return (
                    <div key={driver.userId} className="px-4 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 mb-2">
                            <p className="text-sm font-bold text-white">
                              {driver.fullName}
                            </p>
                            <p className="text-xs text-[#888]">
                              {driver.email}
                            </p>
                          </div>

                          {driverAssignments.length === 0 ? (
                            <div className="flex items-center gap-2 text-xs text-[#D4A800]">
                              <span>{"\u26A0"}</span>
                              <span>No planner assigned — only project admins will see this driver's inspections</span>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {driverAssignments.map((a) => (
                                <span
                                  key={a.id}
                                  className="inline-flex items-center gap-1.5 px-2 py-1 bg-[#111] border border-[#2a2a2a] rounded-full text-[11px] text-[#C0C0C0]"
                                >
                                  {a.plannerName}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveAssignment(a.id)}
                                    className="text-[#666] hover:text-red-400 transition-colors"
                                    aria-label={`Remove ${a.plannerName}`}
                                  >
                                    {"\u00D7"}
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="shrink-0">
                          {addingFor === driver.userId ? (
                            <div className="flex items-center gap-1.5">
                              <select
                                onChange={(e) => {
                                  const plannerId = e.target.value;
                                  if (plannerId) {
                                    handleAddAssignment(driver.userId, plannerId);
                                  }
                                }}
                                disabled={submitting || availablePlanners.length === 0}
                                className="px-2 py-1 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-xs focus:outline-none focus:border-[#F5C518]"
                                defaultValue=""
                              >
                                <option value="" disabled>
                                  Pick planner...
                                </option>
                                {availablePlanners.map((p) => (
                                  <option key={p.userId} value={p.userId}>
                                    {p.fullName}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => setAddingFor(null)}
                                className="text-xs text-[#666] hover:text-white px-1"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAddingFor(driver.userId)}
                              disabled={availablePlanners.length === 0}
                              className="px-3 py-1 bg-[#111] border border-[#2a2a2a] text-xs text-[#F5C518] rounded-lg hover:bg-[#1f1f1f] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              {"\u002B"} Add planner
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl overflow-hidden h-fit">
              <div className="px-4 py-3 border-b border-[#2a2a2a]">
                <h2 className="text-sm font-bold text-white">
                  Planners ({planners.length})
                </h2>
              </div>
              {planners.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#666] italic">
                  No planners in this project
                </div>
              ) : (
                <div className="divide-y divide-[#2a2a2a]">
                  {planners.map((planner) => {
                    const count = driverCountByPlanner.get(planner.userId) ?? 0;
                    return (
                      <div
                        key={planner.userId}
                        className="px-4 py-3 flex items-center justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white truncate">
                            {planner.fullName}
                          </p>
                          <p className="text-[11px] text-[#666] truncate">
                            {planner.email}
                          </p>
                        </div>
                        <span className="text-[11px] text-[#F5C518] font-bold ml-3 shrink-0">
                          {count} {count === 1 ? "driver" : "drivers"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
