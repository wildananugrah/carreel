import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  IStorageProvider,
  MultipartUploadPart,
} from "../interfaces/providers/storage.provider.interface";

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

  // Legacy MinIO code passes a bucket name ("carreel-images", "carreel-videos").
  // We embed it as a key prefix so objects stay logically grouped in the single S3 bucket.
  private s3Key(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }

  async upload(
    bucket: string,
    key: string,
    data: Buffer,
    mimeType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.s3Key(bucket, key),
        Body: data,
        ContentType: mimeType,
        ContentLength: data.length,
      }),
    );
    return key;
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

  async delete(bucket: string, key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.s3Key(bucket, key),
      }),
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
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
    const response = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.s3Key(bucket, key),
        ContentType: mimeType,
      }),
    );
    if (!response.UploadId) throw new Error("S3 did not return an UploadId");
    return response.UploadId;
  }

  async uploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer,
  ): Promise<MultipartUploadPart> {
    const response = await this.client.send(
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: this.s3Key(bucket, key),
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: data,
        ContentLength: data.length,
      }),
    );
    return { part: partNumber, etag: response.ETag ?? "" };
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: MultipartUploadPart[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.s3Key(bucket, key),
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({ PartNumber: p.part, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.s3Key(bucket, key),
        UploadId: uploadId,
      }),
    );
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
