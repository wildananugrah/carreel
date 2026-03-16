import { Client as MinioClient } from "minio";
import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";

export class MinIOProvider implements IStorageProvider {
  private client: MinioClient;

  constructor(config: {
    endPoint: string;
    port: number;
    accessKey: string;
    secretKey: string;
    useSSL: boolean;
  }) {
    this.client = new MinioClient(config);
  }

  async getPresignedUrl(
    bucket: string,
    key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    return this.client.presignedGetObject(bucket, key, expiresIn);
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.listBuckets();
      return true;
    } catch {
      return false;
    }
  }
}
