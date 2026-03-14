/**
 * E2E test helpers — base URLs, register/login, cleanup.
 * Assumes driver-app backend on :3001 and planner-app backend on :3002.
 */

export const DRIVER_API = process.env.DRIVER_API_URL ?? "http://localhost:3001";
export const PLANNER_API =
  process.env.PLANNER_API_URL ?? "http://localhost:3002";

export interface AuthResult {
  token: string;
  user: { id: string; email: string; fullName: string; role: string };
}

/** Register a new user on the driver backend. */
export async function registerDriver(
  email: string,
  password: string,
  fullName: string,
): Promise<AuthResult> {
  const res = await fetch(`${DRIVER_API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, fullName }),
  });
  if (!res.ok) {
    throw new Error(
      `Register driver failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

/** Register a new user on the planner backend. */
export async function registerPlanner(
  email: string,
  password: string,
  fullName: string,
): Promise<AuthResult> {
  const res = await fetch(`${PLANNER_API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, fullName }),
  });
  if (!res.ok) {
    throw new Error(
      `Register planner failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

/** Login on the driver backend. */
export async function loginDriver(
  email: string,
  password: string,
): Promise<AuthResult> {
  const res = await fetch(`${DRIVER_API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Login driver failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Login on the planner backend. */
export async function loginPlanner(
  email: string,
  password: string,
): Promise<AuthResult> {
  const res = await fetch(`${PLANNER_API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Login planner failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Authenticated fetch helper. */
export function authFetch(
  baseUrl: string,
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

/** Create a minimal 1x1 JPEG buffer for upload tests. */
export function createTestJpeg(): Buffer {
  // Minimal valid JPEG: SOI + JFIF APP0 + minimal frame
  return Buffer.from(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc40000ffc4000000ffda00080101000003100000017ffd9",
    "hex",
  );
}

/** Generate a unique email for test isolation. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.com`;
}
