import { beforeEach, describe, expect, test } from "bun:test";
import type {
  AIAnalysis,
  Alert,
  DamageMarker,
  InspectionStep,
  MediaFile,
  TelemetryData,
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
import type { UserScope } from "../../src/types/scope";

const mockLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

const BODY_SIDES = [
  "FRONT",
  "FRONT_RIGHT",
  "RIGHT",
  "BACK_RIGHT",
  "BACK",
  "BACK_LEFT",
  "LEFT",
  "FRONT_LEFT",
] as const;

function createMockStep(
  overrides: Partial<InspectionStep> = {},
): InspectionStep {
  return {
    id: "step-1",
    inspectionId: "insp-1",
    projectId: "test-project",
    stepType: "BODY_INSPECTION",
    status: "UPLOADED",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** 8 IMAGE media files, one per body side, distinct ids/keys. */
function createEightPhotos(stepId: string): MediaFile[] {
  return BODY_SIDES.map(
    (side, i) =>
      ({
        id: `media-${side}`,
        stepId,
        projectId: "test-project",
        fileName: `photo-${side}.jpg`,
        mimeType: "image/jpeg",
        mediaType: "IMAGE",
        bodySide: side,
        fileSize: 1024,
        minioKey: `inspections/photo-${i}.jpg`,
        minioBucket: "carreel-images",
        latitude: null,
        longitude: null,
        capturedAt: new Date(),
        durationSeconds: null,
        createdAt: new Date(),
      }) as MediaFile,
  );
}

describe("StepAnalysisJob — 8-photo body inspection", () => {
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
  let savedDamageMarkers: Array<
    Array<{ mediaFileId: string } & Record<string, unknown>>
  >;
  let savedAlerts: Array<{
    inspectionId: string;
    alertType: string;
    message: string;
  }>;
  let analyzeImagesCalls: Array<{ imagesLength: number }>;

  beforeEach(() => {
    stepStatuses = new Map();
    inspectionStatuses = new Map();
    savedAnalyses = [];
    savedDamageMarkers = [];
    savedAlerts = [];
    analyzeImagesCalls = [];

    let imagesCallCount = 0;

    mockAI = {
      analyzeImage: async () => "{}",
      analyzeImages: async (images) => {
        imagesCallCount += 1;
        analyzeImagesCalls.push({ imagesLength: images.length });
        if (imagesCallCount === 1) {
          // Pass 1: verification → Match, no recapture
          return JSON.stringify({
            analisisVerifikasi: "Cocok",
            statusVerifikasi: "Match",
            confidence: 0.9,
            screenRecaptureDetected: false,
          });
        }
        // Pass 2: damage detection → one damage on FRONT_RIGHT
        return JSON.stringify({
          visualAnalysis: "Visual review of all 8 sides",
          overallCondition: "FAIR",
          confidence: 0.85,
          damages: [
            {
              damageType: "scratch",
              location: "Fender Depan Kanan",
              severity: "MINOR",
              description: "Scratch on front-right fender",
              bodySide: "FRONT_RIGHT",
              isNewDamage: true,
            },
          ],
        });
      },
      analyzeVideo: async () => "{}",
      uploadVideoFile: async () => "gemini://file-uri",
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
      statObject: async () => ({ size: 0, mimeType: "image/jpeg" }),
      getObjectStream: async () => new ReadableStream(),
    };

    const bodyStep = createMockStep({ id: "step-body" });
    const speedoStep = createMockStep({
      id: "step-speedo",
      stepType: "SPEEDOMETER",
    });
    const steps = new Map<string, InspectionStep>();
    steps.set("step-body", bodyStep);
    steps.set("step-speedo", speedoStep);

    mockInspectionRepo = {
      create: async () => ({}) as any,
      createWithSteps: async () => ({}) as any,
      findById: async (_scope: UserScope, id: string) =>
        ({
          id,
          driverId: "driver-1",
          bodyInspectionMode: "PHOTOS_8SIDE",
          additionalBodyPhotoCount: 0,
          projectId: "test-project",
          unitId: null,
          tripType: "PRE_TRIP",
          status: inspectionStatuses.get(id) ?? "PENDING_AI",
          linkedInspectionId: null,
          startedAt: new Date(),
          completedAt: null,
          latitude: null,
          longitude: null,
          signatureKey: null,
          signerName: null,
          signedAt: null,
          driverComment: null,
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
      findByDriverId: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
      update: async () => ({}) as any,
      updateStatus: async (_scope: UserScope, id: string, status) => {
        inspectionStatuses.set(id, status);
        return {} as any;
      },
      createStep: async () => ({}) as any,
      findStepById: async (_scope: UserScope, stepId: string) =>
        steps.get(stepId) ?? null,
      updateStepStatus: async (_scope: UserScope, stepId: string, status) => {
        stepStatuses.set(stepId, status);
        const step = steps.get(stepId)!;
        return { ...step, status } as any;
      },
      delete: async () => {},
      findUnitByInspectionId: async () =>
        ({
          id: "unit-1",
          make: "Wuling",
          model: "Air EV",
          color: "Pink",
          licensePlate: "B 1234 ABC",
          lastKnownKm: null,
        }) as any,
      getProjectIdByInspectionId: async () => "project-1",
      updateUnitKm: async () => {},
      updateUnitVin: async () => {},
      updateSignatureKey: async () => {},
      findOrCreateUnit: async () => ({}) as any,
      linkUnitToInspection: async () => {},
      findTripsByDriverId: async () => [],
    };

    mockMediaRepo = {
      create: async () => ({}) as any,
      findById: async () => null,
      findByStepId: async (_scope: UserScope, stepId: string) =>
        createEightPhotos(stepId),
      deleteById: async () => {},
    };

    mockAIAnalysisRepo = {
      createAnalysis: async (_scope: UserScope, data) => {
        savedAnalyses.push({ stepId: data.stepId, status: data.status });
        return {
          id: `analysis-${savedAnalyses.length}`,
          ...data,
        } as any as AIAnalysis;
      },
      findByStepId: async () => null,
      deleteByStepId: async () => {},
      createDamageMarkers: async (_scope: UserScope, markers) => {
        savedDamageMarkers.push(markers as any);
        return markers as any as DamageMarker[];
      },
      createTelemetryData: async (_scope: UserScope, data) =>
        data as any as TelemetryData,
    };

    mockNotification = { notify: async () => {} };

    mockAlertRepo = {
      create: async (_scope: UserScope, data) => {
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

  test("analyzes all 8 photos and attaches damage to the correct side's media file", async () => {
    // Add a 9th "Foto Tambahan" photo (bodySide: null) — it must be stored
    // but never sent to AI. analyzeImages should still see only the 8 sides.
    mockMediaRepo.findByStepId = async (_scope: UserScope, stepId: string) => [
      ...createEightPhotos(stepId),
      {
        id: "media-EXTRA",
        stepId,
        projectId: "test-project",
        fileName: "photo-extra.jpg",
        mimeType: "image/jpeg",
        mediaType: "IMAGE",
        bodySide: null,
        fileSize: 1024,
        minioKey: "inspections/photo-extra.jpg",
        minioBucket: "carreel-images",
        latitude: null,
        longitude: null,
        capturedAt: new Date(),
        durationSeconds: null,
        createdAt: new Date(),
      } as MediaFile,
    ];

    // Make the other step terminal so completion can be checked.
    stepStatuses.set("step-speedo", "COMPLETED");

    const data: StepAnalysisJobData = {
      inspectionId: "insp-1",
      stepId: "step-body",
      stepType: "BODY_INSPECTION",
      driverId: "driver-1",
    };

    await job.handle(data);

    // analyzeImages received all 8 photos on each call.
    expect(analyzeImagesCalls.length).toBe(2); // verification + damage
    expect(analyzeImagesCalls[0].imagesLength).toBe(8);
    expect(analyzeImagesCalls[1].imagesLength).toBe(8);

    // Step completed, analysis saved as SUCCESS.
    expect(stepStatuses.get("step-body")).toBe("COMPLETED");
    expect(savedAnalyses.some((a) => a.status === "SUCCESS")).toBe(true);

    // Damage marker attached to the FRONT_RIGHT media file.
    const allMarkers = savedDamageMarkers.flat();
    const frontRightMarker = allMarkers.find(
      (m) => m.mediaFileId === "media-FRONT_RIGHT",
    );
    expect(frontRightMarker).toBeDefined();
    expect(frontRightMarker!.damageType).toBe("scratch");
  });

  test("verification mismatch → VEHICLE_MISMATCH alert, step FAILED, no damage pass", async () => {
    mockAI.analyzeImages = async (images) => {
      analyzeImagesCalls.push({ imagesLength: images.length });
      // First (and only) call is verification → Mismatch.
      return JSON.stringify({
        analisisVerifikasi: "Tidak cocok",
        statusVerifikasi: "Mismatch",
        confidence: 0.95,
        screenRecaptureDetected: false,
      });
    };

    stepStatuses.set("step-speedo", "COMPLETED");

    await job.handle({
      inspectionId: "insp-1",
      stepId: "step-body",
      stepType: "BODY_INSPECTION",
      driverId: "driver-1",
    });

    // Only the verification pass ran (no damage pass).
    expect(analyzeImagesCalls.length).toBe(1);
    expect(stepStatuses.get("step-body")).toBe("FAILED");
    expect(
      savedAlerts.find((a) => a.alertType === "VEHICLE_MISMATCH"),
    ).toBeDefined();
    // No damage markers saved.
    expect(savedDamageMarkers.flat().length).toBe(0);
  });
});
