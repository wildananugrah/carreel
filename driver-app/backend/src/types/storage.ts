/**
 * Storage target configuration.
 *
 * A "storage target" is one named, addressable place objects live: an S3
 * bucket, a MinIO bucket, a second bucket in another region, etc. Every stored
 * object records the id of the target it was written to, so adding capacity is
 * additive — declare a new target, make it active, and old objects keep being
 * read from wherever they already are.
 *
 * Target ids are PERSISTED in the database (MediaFile.storageTarget). Never
 * rename or reuse an id once objects have been written to it.
 */

export interface S3TargetConfig {
  id: string;
  kind: "s3";
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

export interface MinIOTargetConfig {
  id: string;
  kind: "minio";
  endPoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  useSSL: boolean;
}

export type StorageTargetConfig = S3TargetConfig | MinIOTargetConfig;

export interface StorageRegistryConfig {
  /** Every target the app can READ from. */
  targets: StorageTargetConfig[];
  /** Target new uploads are WRITTEN to. Must exist in `targets`. */
  activeTargetId: string;
  /** Where rows with a NULL `storageTarget` live. Must exist in `targets`. */
  defaultTargetId: string;
}
