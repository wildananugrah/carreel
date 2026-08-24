import type { MediaFile } from "../../generated/prisma";
import type { UploadMediaDTO } from "../../types/dto";
import type { UserScope } from "../../types/scope";

export interface IMediaFileRepository {
  create(
    scope: UserScope,
    stepId: string,
    data: UploadMediaDTO & {
      minioKey: string;
      minioBucket: string;
      storageTarget: string | null;
    },
  ): Promise<MediaFile>;
  findById(scope: UserScope, id: string): Promise<MediaFile | null>;
  findByStepId(scope: UserScope, stepId: string): Promise<MediaFile[]>;
  deleteById(scope: UserScope, id: string): Promise<void>;
}
