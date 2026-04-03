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
import {
  GeminiProvider,
  GeminiStubProvider,
} from "./providers/gemini.provider";
import { MinIOProvider } from "./providers/minio.provider";
import { PgBossQueueProvider } from "./providers/pgboss-queue.provider";
import { WebSocketNotificationProvider } from "./providers/websocket-notification.provider";
// Providers
import { WinstonLogger } from "./providers/winston-logger.provider";
import { AIAnalysisRepository } from "./repositories/ai-analysis.repository";
import { AlertRepository } from "./repositories/alert.repository";
import { InspectionRepository } from "./repositories/inspection.repository";
import { MediaFileRepository } from "./repositories/media-file.repository";
import { UploadSessionRepository } from "./repositories/upload-session.repository";
// Repositories
import { UserRepository } from "./repositories/user.repository";
// Routes
import { createAuthRoutes } from "./routes/auth.route";
import { createChunkedUploadRoutes } from "./routes/chunked-upload.route";
import { createHealthRoutes } from "./routes/health.route";
import { createInspectionRoutes } from "./routes/inspection.route";
import { createMediaRoutes } from "./routes/media.route";
import { createUploadRoutes } from "./routes/upload.route";
// Services
import { AuthService } from "./services/auth.service";
import { ChunkedUploadService } from "./services/chunked-upload.service";
import { InspectionService } from "./services/inspection.service";
import { MediaStreamService } from "./services/media-stream.service";
import { UploadService } from "./services/upload.service";
import type { AppEnv } from "./types/dto";

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
const alertRepository = new AlertRepository(prisma);

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

// Routes
app.route("/health", createHealthRoutes(prisma, storageProvider));
app.route("/api/auth", createAuthRoutes(authService, authMiddleware));
app.route(
  "/api/inspections",
  createInspectionRoutes(inspectionService, uploadService, authMiddleware),
);
app.route("/api/upload", createUploadRoutes(uploadService, authMiddleware));
app.route("/api/media", createMediaRoutes(uploadService, mediaStreamService));
app.route(
  "/api/chunked-upload",
  createChunkedUploadRoutes(chunkedUploadService, authMiddleware),
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
