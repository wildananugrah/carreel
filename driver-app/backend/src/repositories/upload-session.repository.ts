import type {
  PrismaClient,
  UploadSession,
  UploadSessionStatus,
} from "../generated/prisma";
import type {
  CreateUploadSessionData,
  IUploadSessionRepository,
  UploadSessionWithParts,
} from "../interfaces/repositories/upload-session.repository.interface";
import type { UserScope } from "../types/scope";

/**
 * UploadSession has NO projectId column in the schema (see
 * driver-app/database/prisma/schema.prisma). We enforce access control
 * via driverId ownership instead: a driver can only see/mutate their own
 * sessions; SUPER_ADMIN bypasses.
 */
export class UploadSessionRepository implements IUploadSessionRepository {
  constructor(private prisma: PrismaClient) {}

  private isAllowed(scope: UserScope, driverId: string): boolean {
    if (scope.systemRole === "SUPER_ADMIN") return true;
    return scope.userId === driverId;
  }

  async create(
    scope: UserScope,
    data: CreateUploadSessionData,
  ): Promise<UploadSession> {
    if (!this.isAllowed(scope, data.driverId)) {
      throw new Error("Upload session not found");
    }
    return this.prisma.uploadSession.create({ data });
  }

  async findById(
    scope: UserScope,
    id: string,
  ): Promise<UploadSessionWithParts | null> {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id },
      include: { parts: { orderBy: { partNumber: "asc" } } },
    });
    if (!session) return null;
    if (!this.isAllowed(scope, session.driverId)) return null;
    return session;
  }

  async findActiveByDriverId(
    scope: UserScope,
    driverId: string,
  ): Promise<UploadSession[]> {
    if (!this.isAllowed(scope, driverId)) return [];
    return this.prisma.uploadSession.findMany({
      where: { driverId, status: "IN_PROGRESS" },
      orderBy: { createdAt: "desc" },
    });
  }

  async addPart(
    scope: UserScope,
    sessionId: string,
    partNumber: number,
    etag: string,
    size: number,
  ): Promise<void> {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
      select: { driverId: true },
    });
    if (!session) throw new Error("Upload session not found");
    if (!this.isAllowed(scope, session.driverId)) {
      throw new Error("Upload session not found");
    }
    await this.prisma.uploadedPart.create({
      data: { sessionId, partNumber, etag, size },
    });
  }

  async partExists(
    scope: UserScope,
    sessionId: string,
    partNumber: number,
  ): Promise<boolean> {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
      select: { driverId: true },
    });
    if (!session) return false;
    if (!this.isAllowed(scope, session.driverId)) return false;
    const part = await this.prisma.uploadedPart.findUnique({
      where: { sessionId_partNumber: { sessionId, partNumber } },
    });
    return part !== null;
  }

  async updateStatus(
    scope: UserScope,
    id: string,
    status: UploadSessionStatus,
  ): Promise<void> {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id },
      select: { driverId: true },
    });
    if (!session) throw new Error("Upload session not found");
    if (!this.isAllowed(scope, session.driverId)) {
      throw new Error("Upload session not found");
    }
    await this.prisma.uploadSession.update({
      where: { id },
      data: { status },
    });
  }
}
