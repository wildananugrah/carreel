export interface INotificationProvider {
  notify(
    userId: string,
    notification: {
      type: string;
      inspectionId: string;
      message: string;
      [key: string]: unknown;
    },
  ): Promise<void>;
}
