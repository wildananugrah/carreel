export interface IStorageProvider {
  getPresignedUrl(
    bucket: string,
    key: string,
    expiresIn?: number,
  ): Promise<string>;
  ping(): Promise<boolean>;
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
