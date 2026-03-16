import { Readable } from "node:stream";
import { Client as MinioClient } from "minio";
import type {
  IStorageProvider,
  MultipartUploadPart,
} from "../interfaces/providers/storage.provider.interface";

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

  async initiateMultipartUpload(
    bucket: string,
    key: string,
    mimeType: string,
  ): Promise<string> {
    return this.client.initiateNewMultipartUpload(bucket, key, {
      "Content-Type": mimeType,
    });
  }

  async uploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer,
  ): Promise<MultipartUploadPart> {
    const result = await this.client.uploadPart(
      {
        bucketName: bucket,
        objectName: key,
        uploadID: uploadId,
        partNumber,
        headers: {},
      },
      data,
    );
    return { part: result.part, etag: result.etag };
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: MultipartUploadPart[],
  ): Promise<void> {
    await this.client.completeMultipartUpload(bucket, key, uploadId, parts);
  }

  async abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<void> {
    await this.client.abortMultipartUpload(bucket, key, uploadId);
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
