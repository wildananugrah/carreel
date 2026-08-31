import { describe, expect, test } from "bun:test";
import type { InspectionStep } from "../../src/generated/prisma";
import type {
  DashboardPrecheckInput,
  DashboardPrecheckOutcome,
  IDashboardPrecheckProvider,
} from "../../src/interfaces/providers/dashboard-precheck.provider.interface";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import type {
  IInspectionRepository,
  InspectionWithRelations,
} from "../../src/interfaces/repositories/inspection.repository.interface";
import { PrecheckService } from "../../src/services/precheck.service";
import { HttpError } from "../../src/utils/http-error";
import { makeDriverScope, makeSuperAdminScope } from "../helpers/test-scope";

const mockLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

const CHECKED: DashboardPrecheckOutcome = {
  status: "CHECKED",
  result: {
    dashboardLit: true,
    odometer: { readable: true, valueKm: 45230, reasonCode: "OK" },
    fuel: {
      gaugeFound: true,
      readable: true,
      gaugeType: "ANALOG_NEEDLE",
      valuePct: 65,
      reasonCode: "OK",
    },
  },
};

interface SetupOptions {
  inspection?: InspectionWithRelations | null;
  step?: Partial<InspectionStep> | null;
  outcome?: DashboardPrecheckOutcome;
  enabled?: boolean;
}

function setup(options: SetupOptions = {}) {
  const calls: DashboardPrecheckInput[] = [];

  const inspection =
    options.inspection === undefined
      ? ({
          id: "insp-1",
          driverId: "test-driver",
          projectId: "project-1",
          status: "DRAFT",
        } as unknown as InspectionWithRelations)
      : options.inspection;

  const step =
    options.step === undefined
      ? ({
          id: "step-speedo",
          inspectionId: "insp-1",
          stepType: "SPEEDOMETER",
        } as unknown as InspectionStep)
      : (options.step as InspectionStep | null);

  const inspectionRepo: Partial<IInspectionRepository> = {
    findById: async () => inspection,
    findStepById: async () => step,
  };

  const provider: IDashboardPrecheckProvider = {
    check: async (input) => {
      calls.push(input);
      return options.outcome ?? CHECKED;
    },
  };

  const service = new PrecheckService(
    inspectionRepo as IInspectionRepository,
    provider,
    mockLogger,
    options.enabled ?? true,
  );

  return { service, calls };
}

const PHOTO = Buffer.from("fake-jpeg-bytes");

function run(
  service: PrecheckService,
  photo: Buffer = PHOTO,
  mimeType = "image/jpeg",
) {
  return service.checkDashboard(
    makeDriverScope(),
    "insp-1",
    "step-speedo",
    "test-driver",
    photo,
    mimeType,
  );
}

describe("PrecheckService.checkDashboard", () => {
  test("returns the provider's verdict for a valid speedometer step", async () => {
    const { service, calls } = setup();
    const outcome = await run(service);

    expect(outcome).toEqual(CHECKED);
    expect(calls).toHaveLength(1);
    expect(calls[0].mimeType).toBe("image/jpeg");
    expect(calls[0].photo.equals(PHOTO)).toBe(true);
  });

  test("passes an AI outage through as UNAVAILABLE rather than throwing", async () => {
    // The driver must never be trapped in the camera by infrastructure
    // trouble, so this is a 200 with a neutral verdict, not a 5xx.
    const unavailable: DashboardPrecheckOutcome = {
      status: "UNAVAILABLE",
      reason: "AI pre-check call failed",
    };
    const { service } = setup({ outcome: unavailable });

    expect(await run(service)).toEqual(unavailable);
  });

  test("rejects non-image payloads", async () => {
    const { service, calls } = setup();

    await expect(run(service, PHOTO, "video/mp4")).rejects.toThrow(HttpError);
    expect(calls).toHaveLength(0);
  });

  test("rejects an empty photo", async () => {
    const { service, calls } = setup();

    await expect(run(service, Buffer.alloc(0))).rejects.toThrow(HttpError);
    expect(calls).toHaveLength(0);
  });

  test("rejects a photo over the size cap without calling the AI", async () => {
    const { service, calls } = setup();
    const oversized = Buffer.alloc(12 * 1024 * 1024 + 1);

    await expect(run(service, oversized)).rejects.toThrow(HttpError);
    expect(calls).toHaveLength(0);
  });

  test("404s when the inspection is out of scope", async () => {
    const { service, calls } = setup({ inspection: null });

    await expect(run(service)).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(0);
  });

  test("404s when the inspection belongs to another driver", async () => {
    const { service, calls } = setup({
      inspection: {
        id: "insp-1",
        driverId: "someone-else",
        projectId: "project-1",
        status: "DRAFT",
      } as unknown as InspectionWithRelations,
    });

    await expect(run(service)).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(0);
  });

  test("allows a platform-bypass user to check another driver's step", async () => {
    const { service, calls } = setup({
      inspection: {
        id: "insp-1",
        driverId: "someone-else",
        projectId: "project-1",
        status: "DRAFT",
      } as unknown as InspectionWithRelations,
    });

    const outcome = await service.checkDashboard(
      makeSuperAdminScope(),
      "insp-1",
      "step-speedo",
      "support-user",
      PHOTO,
      "image/jpeg",
    );

    expect(outcome).toEqual(CHECKED);
    expect(calls).toHaveLength(1);
  });

  test("404s when the step does not exist", async () => {
    const { service, calls } = setup({ step: null });

    await expect(run(service)).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(0);
  });

  test("404s when the step belongs to a different inspection", async () => {
    const { service, calls } = setup({
      step: {
        id: "step-speedo",
        inspectionId: "other-inspection",
        stepType: "SPEEDOMETER",
      },
    });

    await expect(run(service)).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(0);
  });

  test("reports DISABLED without touching the DB or AI when turned off", async () => {
    // DASHBOARD_PRECHECK_ENABLED=false. A disabled feature must cost
    // nothing beyond the request itself.
    const { service, calls } = setup({ enabled: false });

    expect(await run(service)).toEqual({ status: "DISABLED" });
    expect(calls).toHaveLength(0);
  });

  test("DISABLED short-circuits ahead of validation, not after it", async () => {
    // A stale app sending anything at all should get the same cheap answer
    // rather than a 400 that implies the feature is running.
    const { service } = setup({ enabled: false });

    expect(await run(service, Buffer.alloc(0), "video/mp4")).toEqual({
      status: "DISABLED",
    });
  });

  test("400s for a non-SPEEDOMETER step", async () => {
    const { service, calls } = setup({
      step: {
        id: "step-speedo",
        inspectionId: "insp-1",
        stepType: "BODY_INSPECTION",
      },
    });

    await expect(run(service)).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(0);
  });
});
