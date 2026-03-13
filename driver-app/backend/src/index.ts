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
import { InspectionRepository } from "./repositories/inspection.repository";
import { MediaFileRepository } from "./repositories/media-file.repository";
// Repositories
import { UserRepository } from "./repositories/user.repository";
// Routes
import { createAuthRoutes } from "./routes/auth.route";
import { createHealthRoutes } from "./routes/health.route";
import { createInspectionRoutes } from "./routes/inspection.route";
import { createUploadRoutes } from "./routes/upload.route";
// Services
import { AuthService } from "./services/auth.service";
import { InspectionService } from "./services/inspection.service";
import { UploadService } from "./services/upload.service";
import type { AppEnv } from "./types/dto";

// ========================
// Wire Dependencies
// ========================

const databaseUrl = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString: databaseUrl });
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
const aiAnalysisRepository = new AIAnalysisRepository(prisma);

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

const inspectionService = new InspectionService(
  inspectionRepository,
  logger,
  jobQueue,
);

const uploadService = new UploadService(
  storageProvider,
  mediaFileRepository,
  inspectionRepository,
  logger,
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
app.use("*", cors());
app.use("*", createErrorHandlerMiddleware(logger));
app.use("*", createRequestLoggerMiddleware(logger));

// Routes
app.route("/health", createHealthRoutes());
app.route("/api/auth", createAuthRoutes(authService, authMiddleware));
app.route(
  "/api/inspections",
  createInspectionRoutes(inspectionService, uploadService, authMiddleware),
);
app.route("/api/upload", createUploadRoutes(uploadService, authMiddleware));

// ========================
// Start pgboss & Server
// ========================

const port = Number(process.env.PORT) || 3001;

boss
  .start()
  .then(async () => {
    logger.info("pgboss started");

    await boss.work<StepAnalysisJobData>(
      "step-analysis",
      { batchSize: 1 },
      async ([job]) => {
        await stepAnalysisJob.handle(job.data);
      },
    );

    logger.info("Step analysis worker registered");
  })
  .catch((err: unknown) => {
    logger.error("Failed to start pgboss", { error: String(err) });
  });

logger.info(`Driver backend starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
