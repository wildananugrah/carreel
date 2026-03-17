export interface IStorageProvider {
  getPresignedUrl(
    bucket: string,
    key: string,
    expiresIn?: number,
  ): Promise<string>;
  ping(): Promise<boolean>;
  download(bucket: string, key: string): Promise<Buffer>;
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
