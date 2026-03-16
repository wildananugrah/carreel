import { beforeEach, describe, expect, test } from "bun:test";
import type {
  AIAnalysis,
  Alert,
  DamageMarker,
  InspectionStep,
  MediaFile,
  TelemetryData,
  Unit,
} from "../../src/generated/prisma";
import type { IAIProvider } from "../../src/interfaces/providers/ai.provider.interface";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import type { INotificationProvider } from "../../src/interfaces/providers/notification.provider.interface";
import type { IStorageProvider } from "../../src/interfaces/providers/storage.provider.interface";
import type { IAIAnalysisRepository } from "../../src/interfaces/repositories/ai-analysis.repository.interface";
import type { IAlertRepository } from "../../src/interfaces/repositories/alert.repository.interface";
import type {
  IInspectionRepository,
  InspectionWithRelations,
} from "../../src/interfaces/repositories/inspection.repository.interface";
import type { IMediaFileRepository } from "../../src/interfaces/repositories/media-file.repository.interface";
import type { StepAnalysisJobData } from "../../src/jobs/step-analysis.job";
import { StepAnalysisJob } from "../../src/jobs/step-analysis.job";

const mockLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

function createMockMediaFile(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    id: "media-1",
    stepId: "step-1",
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    mediaType: "IMAGE",
    fileSize: 1024,
    minioKey: "inspections/photo.jpg",
    minioBucket: "carreel-images",
    latitude: null,
    longitude: null,
    capturedAt: new Date(),
    durationSeconds: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockStep(
  overrides: Partial<InspectionStep> = {},
): InspectionStep {
  return {
    id: "step-1",
    inspectionId: "insp-1",
    stepType: "UNIT_IDENTIFICATION",
    status: "UPLOADED",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("StepAnalysisJob", () => {
  let job: StepAnalysisJob;
  let mockAI: IAIProvider;
  let mockStorage: IStorageProvider;
  let mockInspectionRepo: IInspectionRepository;
  let mockMediaRepo: IMediaFileRepository;
  let mockAIAnalysisRepo: IAIAnalysisRepository;
  let mockNotification: INotificationProvider;
  let mockAlertRepo: IAlertRepository;
  let stepStatuses: Map<string, string>;
  let inspectionStatuses: Map<string, string>;
  let savedAnalyses: Array<{ stepId: string; status: string }>;
  let savedDamageMarkers: Array<unknown[]>;
  let savedTelemetry: Array<unknown>;
  let notifications: Array<{ userId: string; notification: unknown }>;
  let uploadedFiles: string[];
  let savedAlerts: Array<{
    inspectionId: string;
    alertType: string;
    message: string;
  }>;
  let mockUnit: Unit | null;

  beforeEach(() => {
    stepStatuses = new Map();
    inspectionStatuses = new Map();
    savedAnalyses = [];
    savedDamageMarkers = [];
    savedTelemetry = [];
    notifications = [];
    uploadedFiles = [];
    savedAlerts = [];
    mockUnit = null;

    mockAI = {
      analyzeImage: async () =>
        JSON.stringify({
          licensePlate: "ABC-123",
          make: "Toyota",
          model: "Corolla",
          color: "White",
          vin: null,
          confidence: 0.92,
          damages: [
            {
              damageType: "scratch",
              severity: "MINOR",
              description: "Small scratch on bumper",
              isNewDamage: true,
            },
          ],
        }),
      analyzeVideo: async () =>
        JSON.stringify({
          overallCondition: "GOOD",
          confidence: 0.88,
          damages: [],
        }),
      uploadVideoFile: async (filePath: string) => {
        uploadedFiles.push(filePath);
        return "gemini://file-uri";
      },
    };

    mockStorage = {
      upload: async () => "key",
      getPresignedUrl: async () => "https://presigned-url",
      download: async () => Buffer.from("fake-image-data"),
      delete: async () => {},
      ping: async () => true,
      initiateMultipartUpload: async () => "upload-id",
      uploadPart: async () => ({ part: 1, etag: "etag" }),
      completeMultipartUpload: async () => {},
      abortMultipartUpload: async () => {},
      statObject: async () => ({ size: 0, mimeType: "video/mp4" }),
      getObjectStream: async () => new ReadableStream(),
    };

    const steps = new Map<string, InspectionStep>();
    steps.set("step-1", createMockStep());
    steps.set(
      "step-2",
      createMockStep({ id: "step-2", stepType: "SPEEDOMETER" }),
    );

    mockInspectionRepo = {
      create: async () => ({}) as any,
      createWithSteps: async () => ({}) as any,
      findById: async (id: string) =>
        ({
          id,
          driverId: "driver-1",
          unitId: null,
          tripType: "PRE_TRIP",
          status: inspectionStatuses.get(id) ?? "PENDING_AI",
          linkedInspectionId: null,
          startedAt: new Date(),
          completedAt: null,
          latitude: null,
          longitude: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          unit: null,
          linkedInspection: null,
          linkedFrom: null,
          steps: [...steps.values()].map((s) => ({
            ...s,
            status: stepStatuses.get(s.id) ?? s.status,
            mediaFiles: [],
            aiAnalysis: null,
          })),
        }) as InspectionWithRelations,
      findByDriverId: async () => ({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      }),
      update: async () => ({}) as any,
      updateStatus: async (id: string, status: string) => {
        inspectionStatuses.set(id, status);
        return {} as any;
      },
      createStep: async () => ({}) as any,
      findStepById: async (stepId: string) => steps.get(stepId) ?? null,
      updateStepStatus: async (stepId: string, status: string) => {
        stepStatuses.set(stepId, status);
        const step = steps.get(stepId)!;
        return { ...step, status } as any;
      },
      delete: async () => {},
      findUnitByInspectionId: async () => mockUnit,
      updateUnitKm: async () => {},
    };

    mockMediaRepo = {
      create: async () => ({}) as any,
      findById: async () => null,
      findByStepId: async (stepId: string) => {
        if (stepId === "step-empty") return [];
        return [createMockMediaFile({ stepId })];
      },
    };

    mockAIAnalysisRepo = {
      createAnalysis: async (data) => {
        savedAnalyses.push({ stepId: data.stepId, status: data.status });
        return {
          id: `analysis-${savedAnalyses.length}`,
          ...data,
        } as any as AIAnalysis;
      },
      findByStepId: async () => null,
      createDamageMarkers: async (markers) => {
        savedDamageMarkers.push(markers);
        return markers as any as DamageMarker[];
      },
      createTelemetryData: async (data) => {
        savedTelemetry.push(data);
        return data as any as TelemetryData;
      },
    };

    mockNotification = {
      notify: async (userId, notification) => {
        notifications.push({ userId, notification });
      },
    };

    mockAlertRepo = {
      create: async (data) => {
        savedAlerts.push(data);
        return {
          id: `alert-${savedAlerts.length}`,
          ...data,
          isRead: false,
          createdAt: new Date(),
        } as any as Alert;
      },
    };

    job = new StepAnalysisJob(
      mockAI,
      mockStorage,
      mockInspectionRepo,
      mockMediaRepo,
      mockAIAnalysisRepo,
      mockNotification,
      mockLogger,
      mockAlertRepo,
    );
  });

  test("image analysis happy path: downloads, analyzes, saves AIAnalysis + DamageMarkers", async () => {
    const data: StepAnalysisJobData = {
      inspectionId: "insp-1",
      stepId: "step-1",
      stepType: "UNIT_IDENTIFICATION",
      driverId: "driver-1",
    };

    // Make all steps terminal so completion check triggers
    stepStatuses.set("step-2", "COMPLETED");

    await job.handle(data);

    // Step went through PROCESSING → COMPLETED
    expect(stepStatuses.get("step-1")).toBe("COMPLETED");

    // AIAnalysis saved as SUCCESS
    expect(savedAnalyses.length).toBe(1);
    expect(savedAnalyses[0].status).toBe("SUCCESS");
    expect(savedAnalyses[0].stepId).toBe("step-1");

    // DamageMarkers saved
    expect(savedDamageMarkers.length).toBe(1);
    expect(savedDamageMarkers[0].length).toBe(1);
  });

  test("video analysis happy path: temp file, upload to Gemini, analyze", async () => {
    // Override media to return a video file
    mockMediaRepo.findByStepId = async () => [
      createMockMediaFile({
        mimeType: "video/mp4",
        minioBucket: "carreel-videos",
        minioKey: "inspections/video.mp4",
      }),
    ];

    const data: StepAnalysisJobData = {
      inspectionId: "insp-1",
      stepId: "step-1",
      stepType: "BODY_INSPECTION",
      driverId: "driver-1",
    };

    stepStatuses.set("step-2", "COMPLETED");

    await job.handle(data);

    expect(stepStatuses.get("step-1")).toBe("COMPLETED");
    expect(uploadedFiles.length).toBe(1); // File was uploaded to Gemini
    expect(savedAnalyses[0].status).toBe("SUCCESS");
  });

  test("speedometer analysis saves TelemetryData", async () => {
    mockAI.analyzeImage = async () =>
      JSON.stringify({
        odometerKm: 45230,
        fuelLevelPct: 72,
        dashboardMatch: true,
        confidence: 0.95,
      });

    const data: StepAnalysisJobData = {
      inspectionId: "insp-1",
      stepId: "step-2",
      stepType: "SPEEDOMETER",
      driverId: "driver-1",
    };

    stepStatuses.set("step-1", "COMPLETED");

    await job.handle(data);

    expect(stepStatuses.get("step-2")).toBe("COMPLETED");
    expect(savedTelemetry.length).toBe(1);
    expect((savedTelemetry[0] as any).odometerKm).toBe(45230);
    expect((savedTelemetry[0] as any).fuelLevelPct).toBe(72);
  });

  test("all steps complete → inspection transitions to AI_COMPLETE + notification sent", async () => {
    stepStatuses.set("step-2", "COMPLETED");

    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-1",
      stepType: "UNIT_IDENTIFICATION",
      driverId: "driver-1",
    });

    expect(inspectionStatuses.get("insp-1")).toBe("AI_COMPLETE");
    expect(notifications.length).toBe(1);
    expect(notifications[0].userId).toBe("driver-1");
    expect((notifications[0].notification as any).type).toBe(
      "inspection_complete",
    );
  });

  test("AI failure → FAILED AIAnalysis, step FAILED, completion still checked", async () => {
    mockAI.analyzeImage = async () => {
      throw new Error("Gemini API error");
    };
    stepStatuses.set("step-2", "COMPLETED");

    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-1",
      stepType: "UNIT_IDENTIFICATION",
      driverId: "driver-1",
    });

    // Step marked FAILED
    expect(stepStatuses.get("step-1")).toBe("FAILED");

    // FAILED AIAnalysis saved
    expect(savedAnalyses.length).toBe(1);
    expect(savedAnalyses[0].status).toBe("FAILED");

    // Completion still checked — both steps terminal
    expect(inspectionStatuses.get("insp-1")).toBe("AI_COMPLETE");
  });

  test("no media files → step FAILED", async () => {
    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-empty",
      stepType: "UNIT_IDENTIFICATION",
      driverId: "driver-1",
    });

    expect(stepStatuses.get("step-empty")).toBe("FAILED");
    expect(savedAnalyses[0].status).toBe("FAILED");
  });

  test("not all steps terminal → inspection stays PENDING_AI", async () => {
    // step-2 is still UPLOADED (not terminal)
    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-1",
      stepType: "UNIT_IDENTIFICATION",
      driverId: "driver-1",
    });

    expect(stepStatuses.get("step-1")).toBe("COMPLETED");
    // Inspection status should NOT have been updated
    expect(inspectionStatuses.has("insp-1")).toBe(false);
    expect(notifications.length).toBe(0);
  });

  test("handles markdown-wrapped JSON response from Gemini", async () => {
    mockAI.analyzeImage = async () =>
      '```json\n{"licensePlate":"XYZ-789","make":null,"model":null,"color":"Red","vin":null,"confidence":0.8,"damages":[]}\n```';

    stepStatuses.set("step-2", "COMPLETED");

    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-1",
      stepType: "UNIT_IDENTIFICATION",
      driverId: "driver-1",
    });

    expect(stepStatuses.get("step-1")).toBe("COMPLETED");
    expect(savedAnalyses[0].status).toBe("SUCCESS");
    expect(savedDamageMarkers.length).toBe(0);
  });

  // --- Alert generation tests ---

  test("new damage detected → generates NEW_DAMAGE_DETECTED alert", async () => {
    stepStatuses.set("step-2", "COMPLETED");

    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-1",
      stepType: "UNIT_IDENTIFICATION",
      driverId: "driver-1",
    });

    const alert = savedAlerts.find(
      (a) => a.alertType === "NEW_DAMAGE_DETECTED",
    );
    expect(alert).toBeDefined();
    expect(alert!.inspectionId).toBe("insp-1");
  });

  test("major damage → generates HIGH_SEVERITY_DAMAGE alert", async () => {
    mockAI.analyzeImage = async () =>
      JSON.stringify({
        licensePlate: "ABC-123",
        confidence: 0.9,
        damages: [
          {
            damageType: "dent",
            severity: "MAJOR",
            description: "Large dent on door",
            isNewDamage: false,
          },
        ],
      });

    stepStatuses.set("step-2", "COMPLETED");

    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-1",
      stepType: "UNIT_IDENTIFICATION",
      driverId: "driver-1",
    });

    const alert = savedAlerts.find(
      (a) => a.alertType === "HIGH_SEVERITY_DAMAGE",
    );
    expect(alert).toBeDefined();
  });

  test("low fuel → generates LOW_FUEL alert", async () => {
    mockAI.analyzeImage = async () =>
      JSON.stringify({
        odometerKm: 45230,
        fuelLevelPct: 8,
        dashboardMatch: true,
        confidence: 0.95,
      });

    stepStatuses.set("step-1", "COMPLETED");

    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-2",
      stepType: "SPEEDOMETER",
      driverId: "driver-1",
    });

    const alert = savedAlerts.find((a) => a.alertType === "LOW_FUEL");
    expect(alert).toBeDefined();
    expect(alert!.message).toContain("8%");
  });

  test("AI failure → generates AI_FAILURE alert", async () => {
    mockAI.analyzeImage = async () => {
      throw new Error("Gemini API error");
    };
    stepStatuses.set("step-2", "COMPLETED");

    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-1",
      stepType: "UNIT_IDENTIFICATION",
      driverId: "driver-1",
    });

    const alert = savedAlerts.find((a) => a.alertType === "AI_FAILURE");
    expect(alert).toBeDefined();
    expect(alert!.message).toContain("Gemini API error");
  });

  // --- KM validation tests ---

  test("speedometer with unit: validates KM as reasonable", async () => {
    mockUnit = {
      id: "unit-1",
      licensePlate: "ABC-123",
      lastKnownKm: 40000,
    } as Unit;

    mockAI.analyzeImage = async () =>
      JSON.stringify({
        odometerKm: 40500,
        fuelLevelPct: 60,
        dashboardMatch: true,
        confidence: 0.95,
      });

    stepStatuses.set("step-1", "COMPLETED");

    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-2",
      stepType: "SPEEDOMETER",
      driverId: "driver-1",
    });

    expect(savedTelemetry.length).toBe(1);
    const telemetry = savedTelemetry[0] as any;
    expect(telemetry.previousKm).toBe(40000);
    expect(telemetry.kmDelta).toBe(500);
    expect(telemetry.kmReasonable).toBe(true);
    expect(
      savedAlerts.find((a) => a.alertType === "KM_ANOMALY"),
    ).toBeUndefined();
  });

  test("speedometer with unreasonable KM → generates KM_ANOMALY alert", async () => {
    mockUnit = {
      id: "unit-1",
      licensePlate: "ABC-123",
      lastKnownKm: 40000,
    } as Unit;

    mockAI.analyzeImage = async () =>
      JSON.stringify({
        odometerKm: 10000,
        fuelLevelPct: 60,
        dashboardMatch: true,
        confidence: 0.95,
      });

    stepStatuses.set("step-1", "COMPLETED");

    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-2",
      stepType: "SPEEDOMETER",
      driverId: "driver-1",
    });

    const telemetry = savedTelemetry[0] as any;
    expect(telemetry.kmReasonable).toBe(false);
    expect(telemetry.kmDelta).toBe(-30000);

    const alert = savedAlerts.find((a) => a.alertType === "KM_ANOMALY");
    expect(alert).toBeDefined();
  });

  test("speedometer without unit: no KM validation", async () => {
    mockUnit = null;

    mockAI.analyzeImage = async () =>
      JSON.stringify({
        odometerKm: 45230,
        fuelLevelPct: 60,
        dashboardMatch: true,
        confidence: 0.95,
      });

    stepStatuses.set("step-1", "COMPLETED");

    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-2",
      stepType: "SPEEDOMETER",
      driverId: "driver-1",
    });

    const telemetry = savedTelemetry[0] as any;
    expect(telemetry.kmReasonable).toBeUndefined();
    expect(telemetry.previousKm).toBeUndefined();
    expect(telemetry.kmDelta).toBeUndefined();
    expect(
      savedAlerts.find((a) => a.alertType === "KM_ANOMALY"),
    ).toBeUndefined();
  });
});
