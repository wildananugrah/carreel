export interface IAIProvider {
  analyzeImage(
    base64: string,
    mimeType: string,
    prompt: string,
  ): Promise<string>;
  analyzeVideo(
    fileUri: string,
    mimeType: string,
    prompt: string,
  ): Promise<string>;
  uploadVideoFile(filePath: string, mimeType: string): Promise<string>;
}
