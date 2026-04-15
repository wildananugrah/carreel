import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Workspace {
  id: string;
  displayName: string;
  projects: Array<{ id: string; displayName: string }>;
}

interface Props {
  workspaces: Workspace[];
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (projectId: string) => void;
}

export function WorkspaceProjectPickerModal({
  workspaces,
  submitting,
  onCancel,
  onConfirm,
}: Props) {
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) {
        onCancel();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel, submitting]);

  const selectedWorkspace = workspaces.find((w) => w.id === workspaceId);
  const availableProjects = selectedWorkspace?.projects ?? [];
  const canContinue = workspaceId !== "" && projectId !== "" && !submitting;

  const element = (
    // biome-ignore lint/a11y/useSemanticElements: backdrop acts as click-to-close, not a real button
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="button"
      tabIndex={-1}
      onClick={() => {
        if (!submitting) onCancel();
      }}
      onKeyDown={() => {}}
    >
      <div
        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 w-full max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-picker-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h2 id="workspace-picker-title" className="text-white text-lg font-semibold">
          New Inspection
        </h2>
        <p className="text-neutral-500 text-sm mt-1">
          Select the workspace and project this inspection belongs to before starting.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="workspace-select" className="block text-neutral-400 text-sm mb-1.5">
              Workspace
            </label>
            <select
              id="workspace-select"
              value={workspaceId}
              disabled={submitting}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                setProjectId("");
              }}
              className="w-full h-11 px-3 text-base bg-[#171717] text-white border border-[#2a2a2a] rounded-lg placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:opacity-50"
            >
              <option value="">Select workspace...</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="project-select" className="block text-neutral-400 text-sm mb-1.5">
              Project
            </label>
            <select
              id="project-select"
              value={projectId}
              disabled={submitting || workspaceId === ""}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full h-11 px-3 text-base bg-[#171717] text-white border border-[#2a2a2a] rounded-lg placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:opacity-50"
            >
              <option value="">
                {workspaceId === "" ? "Select a workspace first" : "Select project..."}
              </option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="h-11 px-4 rounded-lg bg-[#1a1a1a] text-neutral-300 border border-[#2a2a2a] hover:bg-[#222222] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(projectId)}
            disabled={!canContinue}
            className="h-11 px-4 rounded-lg bg-yellow-400 text-black font-medium hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Starting..." : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(element, document.body);
}
