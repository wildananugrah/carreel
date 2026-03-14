import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type { INotificationProvider } from "../interfaces/providers/notification.provider.interface";

export class WebSocketNotificationProvider implements INotificationProvider {
  constructor(
    private websocketUrl: string,
    private logger: ILogger,
  ) {}

  async notify(
    userId: string,
    notification: {
      type: string;
      inspectionId: string;
      message: string;
      [key: string]: unknown;
    },
  ): Promise<void> {
    try {
      const response = await fetch(`${this.websocketUrl}/api/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, notification }),
      });

      if (!response.ok) {
        this.logger.warn("WebSocket notification failed", {
          userId,
          status: response.status,
          notificationType: notification.type,
        });
      }
    } catch (error) {
      this.logger.error("WebSocket notification error", {
        userId,
        error: error instanceof Error ? error.message : String(error),
        notificationType: notification.type,
      });
    }
  }
}
