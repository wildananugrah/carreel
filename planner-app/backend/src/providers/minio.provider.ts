import { Readable } from "node:stream";
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

  async statObject(
    bucket: string,
    key: string,
  ): Promise<{ size: number; mimeType: string }> {
    const stat = await this.client.statObject(bucket, key);
    return {
      size: stat.size,
      mimeType: stat.metaData["content-type"] ?? "application/octet-stream",
    };
  }

  async getObjectStream(
    bucket: string,
    key: string,
    offset: number,
    length: number,
  ): Promise<ReadableStream> {
    const nodeStream = await this.client.getPartialObject(
      bucket,
      key,
      offset,
      length,
    );
    return Readable.toWeb(nodeStream) as unknown as ReadableStream;
  }
}
