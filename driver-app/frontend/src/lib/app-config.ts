import { useEffect, useState } from "react";
import { api } from "./api";

/**
 * Deployment flags fetched from the backend once per app load.
 *
 * These exist for decisions the app must make BEFORE calling the endpoint
 * they gate. The dashboard pre-check is the motivating case: asking the
 * pre-check endpoint whether pre-checking is enabled would mean uploading
 * the photo — 1-3 MB of the driver's mobile data — just to be told no.
 */
export interface AppConfig {
  dashboardPrecheckEnabled: boolean;
}

/**
 * Used while the fetch is in flight and if it fails. Mirrors the backend's
 * own defaults, so a driver on a flaky connection gets the behavior the
 * deployment is most likely configured for rather than a silent downgrade.
 */
const DEFAULT_CONFIG: AppConfig = {
  dashboardPrecheckEnabled: true,
};

function normalize(raw: unknown): AppConfig {
  const record = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    dashboardPrecheckEnabled:
      typeof record.dashboardPrecheckEnabled === "boolean"
        ? record.dashboardPrecheckEnabled
        : DEFAULT_CONFIG.dashboardPrecheckEnabled,
  };
}

/**
 * Fetched once and shared. Config changes on a running backend need a
 * restart anyway, so a per-session read is the right granularity — and it
 * keeps every camera open from re-requesting the same booleans.
 */
let configPromise: Promise<AppConfig> | null = null;

export function loadAppConfig(): Promise<AppConfig> {
  if (!configPromise) {
    configPromise = api
      .get<unknown>("/api/config")
      .then(normalize)
      .catch(() => DEFAULT_CONFIG);
  }
  return configPromise;
}

export function useAppConfig(): AppConfig {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let active = true;
    loadAppConfig().then((next) => {
      if (active) setConfig(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return config;
}
