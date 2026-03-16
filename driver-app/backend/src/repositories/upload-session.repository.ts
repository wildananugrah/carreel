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

export class UploadSessionRepository implements IUploadSessionRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: CreateUploadSessionData): Promise<UploadSession> {
    return this.prisma.uploadSession.create({ data });
  }

  async findById(id: string): Promise<UploadSessionWithParts | null> {
    return this.prisma.uploadSession.findUnique({
      where: { id },
      include: { parts: { orderBy: { partNumber: "asc" } } },
    });
  }

  async findActiveByDriverId(driverId: string): Promise<UploadSession[]> {
    return this.prisma.uploadSession.findMany({
      where: { driverId, status: "IN_PROGRESS" },
      orderBy: { createdAt: "desc" },
    });
  }

  async addPart(
    sessionId: string,
    partNumber: number,
    etag: string,
    size: number,
  ): Promise<void> {
    await this.prisma.uploadedPart.create({
      data: { sessionId, partNumber, etag, size },
    });
  }

  async partExists(sessionId: string, partNumber: number): Promise<boolean> {
    const part = await this.prisma.uploadedPart.findUnique({
      where: { sessionId_partNumber: { sessionId, partNumber } },
    });
    return part !== null;
  }

  async updateStatus(id: string, status: UploadSessionStatus): Promise<void> {
    await this.prisma.uploadSession.update({
      where: { id },
      data: { status },
    });
  }
}
