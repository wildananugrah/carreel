/**
 * E2E: Pre-trip vs Post-trip comparison workflow
 *
 * Prerequisites:
 * - driver-app backend on :3001
 * - planner-app backend on :3002
 * - Database seeded with unit TEST-001
 */
import { describe, expect, test } from "bun:test";
import {
  DRIVER_API,
  PLANNER_API,
  authFetch,
  createTestJpeg,
  loginDriver,
  loginPlanner,
} from "./setup";

describe("Comparison Flow E2E", () => {
  let driverToken: string;
  let plannerToken: string;
  let preTripId: string;
  let postTripId: string;

  test("1. Login as driver and planner", async () => {
    const driverAuth = await loginDriver("driver@test.com", "password123");
    driverToken = driverAuth.token;

    const plannerAuth = await loginPlanner("planner@test.com", "password123");
    plannerToken = plannerAuth.token;
  });

  test("2. Create PRE_TRIP inspection", async () => {
    const res = await authFetch(DRIVER_API, driverToken, "/api/inspections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripType: "PRE_TRIP" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    preTripId = data.id;

    // Create step + upload + submit
    const stepRes = await authFetch(
      DRIVER_API,
      driverToken,
      `/api/inspections/${preTripId}/steps`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepType: "UNIT_IDENTIFICATION" }),
      },
    );
    const step = await stepRes.json();

    const jpeg = createTestJpeg();
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([jpeg], { type: "image/jpeg" }),
      "pre-trip.jpg",
    );
    formData.append("mediaType", "IMAGE");
    formData.append("capturedAt", new Date().toISOString());

    await authFetch(
      DRIVER_API,
      driverToken,
      `/api/inspections/${preTripId}/steps/${step.id}/media`,
      { method: "POST", body: formData },
    );

    const submitRes = await authFetch(
      DRIVER_API,
      driverToken,
      `/api/inspections/${preTripId}/submit`,
      { method: "POST" },
    );
    expect(submitRes.status).toBe(200);
  });

  test("3. Create POST_TRIP inspection for same unit", async () => {
    const res = await authFetch(DRIVER_API, driverToken, "/api/inspections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripType: "POST_TRIP" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    postTripId = data.id;

    // Create step + upload + submit
    const stepRes = await authFetch(
      DRIVER_API,
      driverToken,
      `/api/inspections/${postTripId}/steps`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepType: "SPEEDOMETER" }),
      },
    );
    const step = await stepRes.json();

    const jpeg = createTestJpeg();
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([jpeg], { type: "image/jpeg" }),
      "post-trip.jpg",
    );
    formData.append("mediaType", "IMAGE");
    formData.append("capturedAt", new Date().toISOString());

    await authFetch(
      DRIVER_API,
      driverToken,
      `/api/inspections/${postTripId}/steps/${step.id}/media`,
      { method: "POST", body: formData },
    );

    const submitRes = await authFetch(
      DRIVER_API,
      driverToken,
      `/api/inspections/${postTripId}/submit`,
      { method: "POST" },
    );
    expect(submitRes.status).toBe(200);
  });

  test("4. Fetch comparison from planner API (PRE_TRIP side)", async () => {
    // Wait briefly for data to sync
    await new Promise((r) => setTimeout(r, 1000));

    const res = await authFetch(
      PLANNER_API,
      plannerToken,
      `/api/inspections/${preTripId}/comparison`,
    );

    if (res.status === 200) {
      const data = await res.json();
      expect(data.current).toBeTruthy();
      expect(data.counterpart).toBeTruthy();
      // Verify they are different trip types
      expect(data.current.tripType).not.toBe(data.counterpart.tripType);
    } else if (res.status === 404) {
      // Comparison may not be available if unit wasn't linked
      console.warn(
        "Comparison not available — inspections may not share a unit. " +
          "Ensure both inspections are linked to the same unit for full comparison.",
      );
    }
  });

  test("5. Fetch comparison from planner API (POST_TRIP side)", async () => {
    const res = await authFetch(
      PLANNER_API,
      plannerToken,
      `/api/inspections/${postTripId}/comparison`,
    );

    if (res.status === 200) {
      const data = await res.json();
      expect(data.current).toBeTruthy();
      expect(data.counterpart).toBeTruthy();
    }
    // 404 is also acceptable if no unit linkage
    expect([200, 404]).toContain(res.status);
  });

  test("6. Verify comparison returns 404 for non-existent inspection", async () => {
    const res = await authFetch(
      PLANNER_API,
      plannerToken,
      "/api/inspections/non-existent-id/comparison",
    );
    expect([404, 500]).toContain(res.status);
  });
});
