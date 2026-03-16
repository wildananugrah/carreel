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

  async upload(
    bucket: string,
    key: string,
    data: Buffer,
    mimeType: string,
  ): Promise<string> {
    await this.client.putObject(bucket, key, data, data.length, {
      "Content-Type": mimeType,
    });
    return key;
  }

  async getPresignedUrl(
    bucket: string,
    key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    return this.client.presignedGetObject(bucket, key, expiresIn);
  }

  async download(bucket: string, key: string): Promise<Buffer> {
    const stream = await this.client.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(bucket: string, key: string): Promise<void> {
    await this.client.removeObject(bucket, key);
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
