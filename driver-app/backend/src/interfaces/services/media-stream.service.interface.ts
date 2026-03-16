export interface StreamInfo {
  stream: ReadableStream;
  mimeType: string;
  size: number;
  start: number;
  end: number;
  total: number;
}

export interface IMediaStreamService {
  getVideoStream(mediaId: string, rangeHeader?: string): Promise<StreamInfo>;
}
