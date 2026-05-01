import "./tracing";

import { PrismaPg } from "@prisma/adapter-pg";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { PgBoss } from "pg-boss";
import { PrismaClient } from "./generated/prisma";
import type { StepAnalysisJobData } from "./jobs/step-analysis.job";
// Jobs
import { StepAnalysisJob } from "./jobs/step-analysis.job";
// Middlewares
import { createAuthMiddleware } from "./middlewares/auth.middleware";
import { createErrorHandlerMiddleware } from "./middlewares/error-handler.middleware";
import { createRequestLoggerMiddleware } from "./middlewares/request-logger.middleware";
import { DamagePhotoVerificationStubProvider } from "./providers/damage-photo-verification.stub.provider";
import {
  GeminiProvider,
  GeminiStubProvider,
} from "./providers/gemini.provider";
import { GeminiDamagePhotoVerificationProvider } from "./providers/gemini-damage-photo-verification.provider";
import { MinIOProvider } from "./providers/minio.provider";
import { PgBossQueueProvider } from "./providers/pgboss-queue.provider";
import { WebSocketNotificationProvider } from "./providers/websocket-notification.provider";
// Providers
import { WinstonLogger } from "./providers/winston-logger.provider";
import { AIAnalysisRepository } from "./repositories/ai-analysis.repository";
import { AlertRepository } from "./repositories/alert.repository";
import { DamageAuditLogRepository } from "./repositories/damage-audit-log.repository";
import { DamageMarkerRepository } from "./repositories/damage-marker.repository";
import { InspectionRepository } from "./repositories/inspection.repository";
import { MediaFileRepository } from "./repositories/media-file.repository";
import { ScopeRepository } from "./repositories/scope.repository";
import { UploadSessionRepository } from "./repositories/upload-session.repository";
// Repositories
import { UserRepository } from "./repositories/user.repository";
import { WorkspaceRepository } from "./repositories/workspace.repository";
// Routes
import { createAuthRoutes } from "./routes/auth.route";
import { createChunkedUploadRoutes } from "./routes/chunked-upload.route";
import { createDamageRoutes } from "./routes/damage.route";
import { createHealthRoutes } from "./routes/health.route";
import { createInspectionRoutes } from "./routes/inspection.route";
import { createMediaRoutes } from "./routes/media.route";
import { createUploadRoutes } from "./routes/upload.route";
import { createWorkspaceRoutes } from "./routes/workspace.route";
// Services
import { AuthService } from "./services/auth.service";
import { ChunkedUploadService } from "./services/chunked-upload.service";
import { DamageEditingService } from "./services/damage-editing.service";
import { InspectionService } from "./services/inspection.service";
import { MediaStreamService } from "./services/media-stream.service";
import { UploadService } from "./services/upload.service";
import { WorkspaceService } from "./services/workspace.service";
import type { AppEnv } from "./types/dto";
import { HttpError } from "./utils/http-error";

// ========================
// Wire Dependencies
// ========================

const databaseUrl = process.env.DATABASE_URL!;
const adapter = new PrismaPg({
  connectionString: databaseUrl,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
const prisma = new PrismaClient({ adapter });

// Providers
const logger = new WinstonLogger(
  process.env.SERVICE_NAME ?? "driver-backend",
  process.env.LOKI_URL,
);

const storageProvider = new MinIOProvider({
  endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PORT) || 9000,
  accessKey: process.env.MINIO_ACCESS_KEY ?? "carreel",
  secretKey: process.env.MINIO_SECRET_KEY ?? "carreel_secret",
  useSSL: process.env.MINIO_USE_SSL === "true",
});

const aiProvider = process.env.GEMINI_API_KEY
  ? new GeminiProvider(
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    )
  : new GeminiStubProvider();

// Driver-added damage photo verification: real Gemini-backed when AI is
// enabled, stub (always-PASS) otherwise so the dev/test flow without a
// Gemini API key still functions end-to-end.
const damagePhotoVerificationProvider = process.env.GEMINI_API_KEY
  ? new GeminiDamagePhotoVerificationProvider(aiProvider, logger)
  : new DamagePhotoVerificationStubProvider();

const notificationProvider = new WebSocketNotificationProvider(
  process.env.WEBSOCKET_URL ?? "http://localhost:3003",
  logger,
);

// Repositories
const userRepository = new UserRepository(prisma);
const inspectionRepository = new InspectionRepository(prisma);
const mediaFileRepository = new MediaFileRepository(prisma);
const uploadSessionRepository = new UploadSessionRepository(prisma);
const aiAnalysisRepository = new AIAnalysisRepository(prisma);
const damageMarkerRepository = new DamageMarkerRepository(prisma);
const damageAuditLogRepository = new DamageAuditLogRepository(prisma);
const alertRepository = new AlertRepository(prisma);
const scopeRepository = new ScopeRepository(prisma);
const workspaceRepository = new WorkspaceRepository(prisma);

// pgboss
const boss = new PgBoss(databaseUrl);

const jobQueue = new PgBossQueueProvider(boss);

// Services
const authService = new AuthService(
  userRepository,
  logger,
  process.env.JWT_SECRET ?? "dev-jwt-secret",
  process.env.JWT_EXPIRES_IN ?? "7d",
);

const aiEnabled = process.env.AI_ENABLED !== "false";
const inspectionService = new InspectionService(
  inspectionRepository,
  logger,
  jobQueue,
  aiEnabled,
);

const uploadService = new UploadService(
  storageProvider,
  mediaFileRepository,
  inspectionRepository,
  logger,
  jobQueue,
  aiAnalysisRepository,
);

const chunkedUploadService = new ChunkedUploadService(
  storageProvider,
  uploadSessionRepository,
  mediaFileRepository,
  inspectionRepository,
  logger,
);

const mediaStreamService = new MediaStreamService(
  storageProvider,
  mediaFileRepository,
);

const damageEditingService = new DamageEditingService(
  inspectionRepository,
  mediaFileRepository,
  damageMarkerRepository,
  damageAuditLogRepository,
  storageProvider,
  damagePhotoVerificationProvider,
  logger,
);

const workspaceService = new WorkspaceService(workspaceRepository);

// Jobs
const stepAnalysisJob = new StepAnalysisJob(
  aiProvider,
  storageProvider,
  inspectionRepository,
  mediaFileRepository,
  aiAnalysisRepository,
  notificationProvider,
  logger,
  alertRepository,
);

// Middlewares
const authMiddleware = createAuthMiddleware(
  process.env.JWT_SECRET ?? "dev-jwt-secret",
  scopeRepository,
);

// ========================
// Build App
// ========================

const app = new Hono<AppEnv>();

// Global middlewares
app.use(
  "*",
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : "*",
  }),
);
app.use("*", createErrorHandlerMiddleware(logger));
app.use("*", createRequestLoggerMiddleware(logger));
// Note: scope is loaded INSIDE authMiddleware (per route) — not as a separate
// global middleware — because Hono runs global middlewares before per-route
// auth, so a global scope middleware would see no userId yet.

// Hono's official error boundary — catches any error thrown from routes/middlewares.
// HttpError instances become JSON responses with their status + message.
// Everything else becomes a 500 "Internal server error".
app.onError((err, c) => {
  if (err instanceof HttpError) {
    logger.warn("HTTP error", {
      error: err.message,
      status: err.status,
      path: c.req.path,
    });
    return c.json(
      { error: err.message },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }

  logger.error("Unhandled exception", {
    error: err.message,
    stack: err.stack,
    path: c.req.path,
  });
  return c.json({ error: "Internal server error" }, 500);
});

// Routes
app.route("/health", createHealthRoutes(prisma, storageProvider));
app.route("/api/auth", createAuthRoutes(authService, authMiddleware));
app.route(
  "/api/inspections",
  createInspectionRoutes(inspectionService, uploadService, authMiddleware),
);
// Damage editing endpoints are namespaced under /api/inspections — Hono
// supports stacking multiple routers under the same prefix; routes inside
// this router declare paths starting with `/:inspectionId/damages...`.
app.route(
  "/api/inspections",
  createDamageRoutes(damageEditingService, authMiddleware),
);
app.route("/api/upload", createUploadRoutes(uploadService, authMiddleware));
app.route("/api/media", createMediaRoutes(uploadService, mediaStreamService));
app.route(
  "/api/chunked-upload",
  createChunkedUploadRoutes(chunkedUploadService, authMiddleware),
);
app.route(
  "/api/workspaces",
  createWorkspaceRoutes(workspaceService, authMiddleware),
);

// ========================
// Startup Connectivity Checks
// ========================

const port = Number(process.env.PORT) || 3001;

async function checkConnectivity() {
  logger.info("Running startup connectivity checks...");

  // Database
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("Database: connected");
  } catch (err) {
    logger.error("Database: unavailable", { error: String(err) });
    logger.error(
      "Ensure PostgreSQL is running: docker compose -f driver-app/database/docker-compose.yml up -d",
    );
    process.exit(1);
  }

  // MinIO
  const minioOk = await storageProvider.ping();
  if (minioOk) {
    logger.info("MinIO: connected");
  } else {
    logger.warn(
      "MinIO: unavailable — file uploads will fail. Start it with: docker compose -f minio/docker-compose.yml up -d",
    );
  }
}

async function startWorkers() {
  try {
    await boss.start();
    logger.info("pgboss started");

    await boss.createQueue("step-analysis");

    await boss.work<StepAnalysisJobData>(
      "step-analysis",
      { batchSize: 1 },
      async ([job]) => {
        await stepAnalysisJob.handle(job.data);
      },
    );

    logger.info("Step analysis worker registered");
  } catch (err) {
    logger.error("Failed to start pgboss", { error: String(err) });
  }
}

// Run checks then start
checkConnectivity().then(() => {
  startWorkers();
  logger.info(`Started development server: http://localhost:${port}`);
});

Bun.serve({
  port,
  fetch: app.fetch,
});

// Graceful shutdown — stop pgboss cleanly on process exit
const shutdown = async () => {
  try {
    await boss.stop({ graceful: true, timeout: 5000 });
  } catch {
    // Ignore errors during shutdown
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
