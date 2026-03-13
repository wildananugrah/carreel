import type { MediaFile } from "../../generated/prisma";
import type { UploadMediaDTO } from "../../types/dto";

export interface IMediaFileRepository {
  create(
    stepId: string,
    data: UploadMediaDTO & { minioKey: string; minioBucket: string },
  ): Promise<MediaFile>;
  findById(id: string): Promise<MediaFile | null>;
  findByStepId(stepId: string): Promise<MediaFile[]>;
}
