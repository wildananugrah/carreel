import type { DamageHint } from "../types/damage-hint";

const TOKEN_KEY = "carreel_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Fetch wrapper that retries on transient failures with exponential backoff.
 * Specifically handles the "user backgrounds the app mid-upload" scenario:
 * iOS Safari and Chrome on Android can pause the page and kill in-flight
 * fetches. When the page resumes, the request rejects with TypeError. We
 * retry up to 4 times (500ms, 1s, 2s, 4s ≈ 7.5s total) which usually rides
 * out the backgrounding window.
 *
 * Retries on:
 *   - TypeError / network errors (browser killed the connection)
 *   - HTTP 502, 503, 504 (transient server failure)
 *
 * Does NOT retry on:
 *   - User-cancelled aborts (signal.aborted) — bubbles up immediately
 *   - 4xx errors (caller bug, retry won't help)
 *   - Other 5xx (500/501/505+) — likely a real server problem
 */
async function fetchWithRetry(
  input: RequestInfo,
  init?: RequestInit,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (init?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const res = await fetch(input, init);
      const isTransient5xx =
        res.status === 502 || res.status === 503 || res.status === 504;
      if (!isTransient5xx || attempt === retries) return res;
    } catch (err) {
      if (init?.signal?.aborted) throw err;
      if (attempt === retries) throw err;
    }
    await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
  }
  // Unreachable — loop either returns or throws.
  throw new Error("fetchWithRetry: exhausted retries");
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetchWithRetry(path, {
    ...options,
    headers,
  });

  if (response.status === 401 && token) {
    clearToken();
    window.location.href = "/login";
    throw new ApiError(401, "Unauthorized");
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = "Request failed";
    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: string };
        message = parsed.error ?? message;
      } catch {}
    }
    throw new ApiError(response.status, message);
  }

  // 204 No Content (e.g. DELETE) and empty bodies have no JSON to parse —
  // short-circuit before response.json() throws "unexpected end of data".
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function getUploadSessionKey(inspectionId: string, stepId: string): string {
  return `upload_session_${inspectionId}_${stepId}`;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),

  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),

  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),

  upload: <T>(path: string, formData: FormData) =>
    apiFetch<T>(path, {
      method: "POST",
      body: formData,
    }),

  uploadChunked: async (
    inspectionId: string,
    stepId: string,
    file: File,
    meta: {
      capturedAt: string;
      latitude?: number;
      longitude?: number;
      durationSeconds?: number;
      tfDetectionHints?: DamageHint[];
    },
    onProgress: (progress: number) => void,
    signal?: AbortSignal,
  ) => {
    // Step 1: Init
    const initRes = await apiFetch<{
      sessionId: string;
      chunkSize: number;
      totalChunks: number;
      uploadedParts: number[];
    }>("/api/chunked-upload/init", {
      method: "POST",
      body: JSON.stringify({
        inspectionId,
        stepId,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        ...meta,
      }),
    });

    const { sessionId, chunkSize, totalChunks, uploadedParts } = initRes;

    // Store session in localStorage for resume
    localStorage.setItem(getUploadSessionKey(inspectionId, stepId), sessionId);

    const uploaded = new Set(uploadedParts);

    // Step 2: Upload chunks
    for (let i = 0; i < totalChunks; i++) {
      if (signal?.aborted) throw new Error("Upload cancelled");

      const partNumber = i + 1;
      if (uploaded.has(partNumber)) {
        onProgress(Math.round((partNumber / totalChunks) * 100));
        continue;
      }

      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      const buffer = await chunk.arrayBuffer();

      const token = getToken();
      const res = await fetchWithRetry(
        `/api/chunked-upload/${sessionId}/chunk?partNumber=${partNumber}`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: buffer,
          signal,
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, (body as { error?: string }).error ?? "Chunk upload failed");
      }

      onProgress(Math.round((partNumber / totalChunks) * 100));
    }

    // Step 3: Complete
    const result = await apiFetch<{
      id: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      mediaType: string;
      presignedUrl: string;
    }>(`/api/chunked-upload/${sessionId}/complete`, {
      method: "POST",
      body: JSON.stringify(
        meta.tfDetectionHints?.length ? { tfDetectionHints: meta.tfDetectionHints } : {},
      ),
    });

    // Clear localStorage
    localStorage.removeItem(getUploadSessionKey(inspectionId, stepId));

    return result;
  },

  resumeUpload: async (
    sessionId: string,
    inspectionId: string,
    stepId: string,
    file: File,
    onProgress: (progress: number) => void,
    signal?: AbortSignal,
  ) => {
    // Get status to know which chunks are done
    const status = await apiFetch<{
      totalChunks: number;
      uploadedParts: number[];
      chunkSize: number;
    }>(`/api/chunked-upload/${sessionId}/status`);

    const { totalChunks, uploadedParts, chunkSize } = status;
    const uploaded = new Set(uploadedParts);

    for (let i = 0; i < totalChunks; i++) {
      if (signal?.aborted) throw new Error("Upload cancelled");

      const partNumber = i + 1;
      if (uploaded.has(partNumber)) {
        onProgress(Math.round((partNumber / totalChunks) * 100));
        continue;
      }

      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      const buffer = await chunk.arrayBuffer();

      const token = getToken();
      const res = await fetchWithRetry(
        `/api/chunked-upload/${sessionId}/chunk?partNumber=${partNumber}`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: buffer,
          signal,
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, (body as { error?: string }).error ?? "Chunk upload failed");
      }

      onProgress(Math.round((partNumber / totalChunks) * 100));
    }

    const result = await apiFetch<{
      id: string;
      fileName: string;
    }>(`/api/chunked-upload/${sessionId}/complete`, { method: "POST" });

    localStorage.removeItem(getUploadSessionKey(inspectionId, stepId));

    return result;
  },

  cancelUpload: async (sessionId: string) => {
    await apiFetch(`/api/chunked-upload/${sessionId}`, { method: "DELETE" });
  },
};
