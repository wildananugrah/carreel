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
}
