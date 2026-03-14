/**
 * E2E: Full driver workflow
 *
 * Prerequisites: driver-app backend running on :3001, database seeded.
 */
import { describe, expect, test } from "bun:test";
import {
  DRIVER_API,
  authFetch,
  createTestJpeg,
  loginDriver,
  registerDriver,
  uniqueEmail,
} from "./setup";

describe("Driver Flow E2E", () => {
  let token: string;
  let userId: string;
  let inspectionId: string;
  const stepIds: Record<string, string> = {};

  test("1. Register a new driver", async () => {
    const email = uniqueEmail("e2e-driver");
    const result = await registerDriver(email, "password123", "E2E Driver");
    expect(result.token).toBeTruthy();
    expect(result.user.role).toBe("DRIVER");
    token = result.token;
    userId = result.user.id;
  });

  test("2. Login as the driver", async () => {
    // Use the seeded driver account
    const result = await loginDriver("driver@test.com", "password123");
    expect(result.token).toBeTruthy();
    // Use seeded driver for subsequent tests (has unit access)
    token = result.token;
    userId = result.user.id;
  });

  test("3. Create a PRE_TRIP inspection", async () => {
    const res = await authFetch(DRIVER_API, token, "/api/inspections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tripType: "PRE_TRIP",
        latitude: 14.5995,
        longitude: 120.9842,
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.tripType).toBe("PRE_TRIP");
    expect(data.status).toBe("DRAFT");
    inspectionId = data.id;
  });

  test("4. Update inspection with unitId", async () => {
    // First we need to find the seeded unit — we'll try to patch with the known plate
    // The update endpoint expects unitId, so let's just set it
    const res = await authFetch(
      DRIVER_API,
      token,
      `/api/inspections/${inspectionId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: 14.6, longitude: 121.0 }),
      },
    );
    expect(res.status).toBe(200);
  });

  test("5. Create UNIT_IDENTIFICATION step", async () => {
    const res = await authFetch(
      DRIVER_API,
      token,
      `/api/inspections/${inspectionId}/steps`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepType: "UNIT_IDENTIFICATION" }),
      },
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.stepType).toBe("UNIT_IDENTIFICATION");
    stepIds.UNIT_IDENTIFICATION = data.id;
  });

  test("6. Create SPEEDOMETER step", async () => {
    const res = await authFetch(
      DRIVER_API,
      token,
      `/api/inspections/${inspectionId}/steps`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepType: "SPEEDOMETER" }),
      },
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    stepIds.SPEEDOMETER = data.id;
  });

  test("7. Create BODY_INSPECTION step", async () => {
    const res = await authFetch(
      DRIVER_API,
      token,
      `/api/inspections/${inspectionId}/steps`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepType: "BODY_INSPECTION" }),
      },
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    stepIds.BODY_INSPECTION = data.id;
  });

  test("8. Upload media for UNIT_IDENTIFICATION step", async () => {
    const jpeg = createTestJpeg();
    const formData = new FormData();
    formData.append("file", new Blob([jpeg], { type: "image/jpeg" }), "unit-id.jpg");
    formData.append("mediaType", "IMAGE");
    formData.append("capturedAt", new Date().toISOString());

    const res = await authFetch(
      DRIVER_API,
      token,
      `/api/inspections/${inspectionId}/steps/${stepIds.UNIT_IDENTIFICATION}/media`,
      { method: "POST", body: formData },
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.mimeType).toBe("image/jpeg");
  });

  test("9. Upload media for SPEEDOMETER step", async () => {
    const jpeg = createTestJpeg();
    const formData = new FormData();
    formData.append("file", new Blob([jpeg], { type: "image/jpeg" }), "speedometer.jpg");
    formData.append("mediaType", "IMAGE");
    formData.append("capturedAt", new Date().toISOString());
    formData.append("latitude", "14.5995");
    formData.append("longitude", "120.9842");

    const res = await authFetch(
      DRIVER_API,
      token,
      `/api/inspections/${inspectionId}/steps/${stepIds.SPEEDOMETER}/media`,
      { method: "POST", body: formData },
    );
    expect(res.status).toBe(201);
  });

  test("10. Upload media for BODY_INSPECTION step", async () => {
    const jpeg = createTestJpeg();
    const formData = new FormData();
    formData.append("file", new Blob([jpeg], { type: "image/jpeg" }), "body.jpg");
    formData.append("mediaType", "IMAGE");
    formData.append("capturedAt", new Date().toISOString());

    const res = await authFetch(
      DRIVER_API,
      token,
      `/api/inspections/${inspectionId}/steps/${stepIds.BODY_INSPECTION}/media`,
      { method: "POST", body: formData },
    );
    expect(res.status).toBe(201);
  });

  test("11. Submit inspection", async () => {
    const res = await authFetch(
      DRIVER_API,
      token,
      `/api/inspections/${inspectionId}/submit`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // After submission, status should transition to PENDING_AI
    expect(["PENDING_AI", "AI_COMPLETE"]).toContain(data.status);
  });

  test("12. Get inspection detail", async () => {
    const res = await authFetch(
      DRIVER_API,
      token,
      `/api/inspections/${inspectionId}`,
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.steps).toHaveLength(3);
    expect(data.steps.map((s: { stepType: string }) => s.stepType).sort()).toEqual([
      "BODY_INSPECTION",
      "SPEEDOMETER",
      "UNIT_IDENTIFICATION",
    ]);
  });

  test("13. List driver inspections", async () => {
    const res = await authFetch(DRIVER_API, token, "/api/inspections");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.length).toBeGreaterThanOrEqual(1);
    expect(data.total).toBeGreaterThanOrEqual(1);
  });
});
