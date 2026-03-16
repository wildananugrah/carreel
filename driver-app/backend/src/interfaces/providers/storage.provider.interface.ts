export interface MultipartUploadPart {
  part: number;
  etag: string;
}

export interface IStorageProvider {
  upload(
    bucket: string,
    key: string,
    data: Buffer,
    mimeType: string,
  ): Promise<string>;
  getPresignedUrl(
    bucket: string,
    key: string,
    expiresIn?: number,
  ): Promise<string>;
  download(bucket: string, key: string): Promise<Buffer>;
  delete(bucket: string, key: string): Promise<void>;
  ping(): Promise<boolean>;

  // Multipart upload
  initiateMultipartUpload(
    bucket: string,
    key: string,
    mimeType: string,
  ): Promise<string>;
  uploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    data: Buffer,
  ): Promise<MultipartUploadPart>;
  completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: MultipartUploadPart[],
  ): Promise<void>;
  abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<void>;

  // Streaming
  statObject(
    bucket: string,
    key: string,
  ): Promise<{ size: number; mimeType: string }>;
  getObjectStream(
    bucket: string,
    key: string,
    offset: number,
    length: number,
  ): Promise<ReadableStream>;
}
