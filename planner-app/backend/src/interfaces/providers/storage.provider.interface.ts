export interface IStorageProvider {
  getPresignedUrl(
    bucket: string,
    key: string,
    expiresIn?: number,
  ): Promise<string>;
  ping(): Promise<boolean>;
}
