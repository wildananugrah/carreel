import "./tracing";

import { PrismaPg } from "@prisma/adapter-pg";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { PrismaClient } from "./generated/prisma";
// Middlewares
import { createAuthMiddleware } from "./middlewares/auth.middleware";
import { createErrorHandlerMiddleware } from "./middlewares/error-handler.middleware";
import { HttpError } from "./utils/http-error";
import { createRequestLoggerMiddleware } from "./middlewares/request-logger.middleware";
import { createScopeMiddleware } from "./middlewares/scope.middleware";
import { MinIOProvider } from "./providers/minio.provider";
import { WebSocketNotificationProvider } from "./providers/websocket-notification.provider";
// Providers
import { WinstonLogger } from "./providers/winston-logger.provider";
import { AdminUserRepository } from "./repositories/admin-user.repository";
import { AlertRepository } from "./repositories/alert.repository";
import { AuditLogRepository } from "./repositories/audit-log.repository";
import { DashboardRepository } from "./repositories/dashboard.repository";
import { DriverAssignmentRepository } from "./repositories/driver-assignment.repository";
import { InspectionRepository } from "./repositories/inspection.repository";
import { ProjectRepository } from "./repositories/project.repository";
import { ProjectMemberRepository } from "./repositories/project-member.repository";
import { ReviewRepository } from "./repositories/review.repository";
import { ScopeRepository } from "./repositories/scope.repository";
// Repositories
import { UserRepository } from "./repositories/user.repository";
import { WorkspaceRepository } from "./repositories/workspace.repository";
// Routes
import { createDriverAssignmentRoutes } from "./routes/admin/assignment.route";
import { createProjectMemberRoutes } from "./routes/admin/member.route";
import {
  createProjectRoutes,
  createWorkspaceProjectRoutes,
} from "./routes/admin/project.route";
import { createAdminUserRoutes } from "./routes/admin/user.route";
import { createWorkspaceRoutes } from "./routes/admin/workspace.route";
import { createAlertRoutes } from "./routes/alert.route";
import { createAuthRoutes } from "./routes/auth.route";
import { createDashboardRoutes } from "./routes/dashboard.route";
import { createDriverRoutes } from "./routes/driver.route";
import { createHealthRoutes } from "./routes/health.route";
import { createInspectionRoutes } from "./routes/inspection.route";
import { createMediaRoutes } from "./routes/media.route";
import { createUploadRoutes } from "./routes/upload.route";
// Services
import { AdminUserService } from "./services/admin-user.service";
import { AlertService } from "./services/alert.service";
import { AuthService } from "./services/auth.service";
import { DashboardService } from "./services/dashboard.service";
import { DriverAssignmentService } from "./services/driver-assignment.service";
import { InspectionService } from "./services/inspection.service";
import { MediaStreamService } from "./services/media-stream.service";
import { ProjectService } from "./services/project.service";
import { ProjectMemberService } from "./services/project-member.service";
import { WorkspaceService } from "./services/workspace.service";
import type { AppEnv } from "./types/dto";

// ========================
// Wire Dependencies
// ========================

const databaseUrl = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

// Providers
const logger = new WinstonLogger(
  process.env.SERVICE_NAME ?? "planner-backend",
  process.env.LOKI_URL,
);

const storageProvider = new MinIOProvider({
  endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PORT) || 9000,
  accessKey: process.env.MINIO_ACCESS_KEY ?? "carreel",
  secretKey: process.env.MINIO_SECRET_KEY ?? "carreel_secret",
  useSSL: process.env.MINIO_USE_SSL === "true",
});

const notificationProvider = new WebSocketNotificationProvider(
  process.env.WEBSOCKET_URL ?? "http://localhost:3003",
  logger,
);

// Repositories
const userRepository = new UserRepository(prisma);
const inspectionRepository = new InspectionRepository(prisma);
const reviewRepository = new ReviewRepository(prisma);
const alertRepository = new AlertRepository(prisma);
const auditLogRepository = new AuditLogRepository(prisma);
const scopeRepository = new ScopeRepository(prisma);
const workspaceRepository = new WorkspaceRepository(prisma);
const projectRepository = new ProjectRepository(prisma);
const projectMemberRepository = new ProjectMemberRepository(prisma);
const driverAssignmentRepository = new DriverAssignmentRepository(prisma);
const adminUserRepository = new AdminUserRepository(prisma);

// Services
const authService = new AuthService(
  userRepository,
  logger,
  process.env.JWT_SECRET ?? "dev-jwt-secret",
  process.env.JWT_EXPIRES_IN ?? "7d",
);

const inspectionService = new InspectionService(
  inspectionRepository,
  reviewRepository,
  auditLogRepository,
  notificationProvider,
  logger,
);

const alertService = new AlertService(alertRepository);

const dashboardRepository = new DashboardRepository(prisma);
const dashboardService = new DashboardService(prisma, dashboardRepository);

const mediaStreamService = new MediaStreamService(prisma, storageProvider);

const workspaceService = new WorkspaceService(workspaceRepository);
const projectService = new ProjectService(projectRepository);
const projectMemberService = new ProjectMemberService(projectMemberRepository);
const driverAssignmentService = new DriverAssignmentService(
  driverAssignmentRepository,
);
const adminUserService = new AdminUserService(adminUserRepository);

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
app.use("/api/*", createScopeMiddleware(scopeRepository));

// Hono's official error boundary — catches any error thrown from routes/middlewares.
// HttpError instances become JSON responses with their status + message.
// Everything else becomes a 500 "Internal server error".
app.onError((err, c) => {
  // HttpError → use its status and message
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

  // Unknown error → 500 with a generic message, log the stack for debugging
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
  createInspectionRoutes(inspectionService, authMiddleware, storageProvider),
);
app.route("/api/alerts", createAlertRoutes(alertService, authMiddleware));
app.route(
  "/api/dashboard",
  createDashboardRoutes(dashboardService, authMiddleware),
);
app.route("/api/drivers", createDriverRoutes(userRepository, authMiddleware));
app.route("/api/upload", createUploadRoutes(storageProvider, authMiddleware));
app.route("/api/media", createMediaRoutes(mediaStreamService));
app.route(
  "/api/admin/workspaces",
  createWorkspaceRoutes(workspaceService, authMiddleware),
);
app.route(
  "/api/admin/workspaces/:workspaceId/projects",
  createWorkspaceProjectRoutes(projectService, authMiddleware),
);
app.route(
  "/api/admin/projects",
  createProjectRoutes(projectService, authMiddleware),
);
app.route(
  "/api/admin/projects/:projectId/members",
  createProjectMemberRoutes(projectMemberService, authMiddleware),
);
app.route(
  "/api/admin/projects/:projectId/assignments",
  createDriverAssignmentRoutes(driverAssignmentService, authMiddleware),
);
app.route(
  "/api/admin/users",
  createAdminUserRoutes(adminUserService, authMiddleware),
);

// ========================
// Start Server
// ========================

const port = Number(process.env.PORT) || 3002;

// ========================
// Startup Checks
// ========================

async function checkConnectivity() {
  logger.info("Running startup connectivity checks...");

  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("Database: connected");
  } catch (err) {
    logger.error("Database: unavailable", { error: String(err) });
    logger.error(
      "Ensure PostgreSQL is running: docker compose -f planner-app/database/docker-compose.yml up -d",
    );
    process.exit(1);
  }

  const minioOk = await storageProvider.ping();
  if (minioOk) {
    logger.info("MinIO: connected");
  } else {
    logger.warn(
      "MinIO: unavailable — file access will fail. Start it with: docker compose -f minio/docker-compose.yml up -d",
    );
  }
}

checkConnectivity().then(() => {
  logger.info(`Planner backend started on port ${port}`);
});

Bun.serve({
  port,
  fetch: app.fetch,
});
