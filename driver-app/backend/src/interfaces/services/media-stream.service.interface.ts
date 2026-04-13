import type { UserScope } from "../../types/scope";

export interface StreamInfo {
  stream: ReadableStream;
  mimeType: string;
  size: number;
  start: number;
  end: number;
  total: number;
}

export interface IMediaStreamService {
  getVideoStream(
    scope: UserScope,
    mediaId: string,
    rangeHeader?: string,
  ): Promise<StreamInfo>;
}
