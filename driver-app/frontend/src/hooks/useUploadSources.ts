import { useAuth } from "../lib/auth";

export interface UploadSources {
  allowCamera: boolean;
  allowFile: boolean;
}

/**
 * Resolves whether the current user may capture media from the camera,
 * the file picker, or both. Reads VITE_UPLOAD_SOURCE (values: "both" |
 * "camera" | "file"; defaults to "both") and then overrides it to grant
 * full access — camera AND file — when the signed-in user has system
 * role CARREEL_DRIVER_SUPPORT. Support users run demos and troubleshoot
 * real driver issues, so they need to upload reference media regardless
 * of the production camera-only lockout.
 */
export function useUploadSources(): UploadSources {
  const { user } = useAuth();
  const source = (import.meta.env.VITE_UPLOAD_SOURCE as string) || "both";

  if (user?.systemRole === "CARREEL_DRIVER_SUPPORT") {
    return { allowCamera: true, allowFile: true };
  }

  return {
    allowCamera: source === "camera" || source === "both",
    allowFile: source === "file" || source === "both",
  };
}
