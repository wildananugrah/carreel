import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";

export class S3Provider implements IStorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor(config: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    endpoint?: string;
    forcePathStyle?: boolean;
  }) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle !== undefined
        ? { forcePathStyle: config.forcePathStyle }
        : {}),
    });
  }

  private s3Key(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }

  async getPresignedUrl(
    bucket: string,
    key: string,
    expiresIn = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.s3Key(bucket, key),
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  async download(bucket: string, key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.s3Key(bucket, key),
      }),
    );
    if (!response.Body) return Buffer.alloc(0);
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async statObject(
    bucket: string,
    key: string,
  ): Promise<{ size: number; mimeType: string }> {
    const response = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.s3Key(bucket, key),
      }),
    );
    return {
      size: response.ContentLength ?? 0,
      mimeType: response.ContentType ?? "application/octet-stream",
    };
  }

  async getObjectStream(
    bucket: string,
    key: string,
    offset: number,
    length: number,
  ): Promise<ReadableStream> {
    const range = `bytes=${offset}-${offset + length - 1}`;
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.s3Key(bucket, key),
        Range: range,
      }),
    );
    if (!response.Body) throw new Error("S3 returned empty body");
    return response.Body.transformToWebStream();
  }
}
