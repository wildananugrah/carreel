import { beforeEach, describe, expect, test } from "bun:test";
import type { Alert } from "../../src/generated/prisma";
import type { IAlertRepository } from "../../src/interfaces/repositories/alert.repository.interface";
import { AlertService } from "../../src/services/alert.service";

function createMockAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "alert-1",
    inspectionId: "insp-1",
    alertType: "NEW_DAMAGE_DETECTED",
    message: "New damage found on rear bumper",
    isRead: false,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("AlertService", () => {
  let alertService: AlertService;
  let alerts: Map<string, Alert>;

  beforeEach(() => {
    alerts = new Map();
    alerts.set("alert-1", createMockAlert());
    alerts.set(
      "alert-2",
      createMockAlert({
        id: "alert-2",
        alertType: "KM_ANOMALY",
        message: "Odometer reading seems inconsistent",
      }),
    );
    alerts.set(
      "alert-3",
      createMockAlert({
        id: "alert-3",
        alertType: "LOW_FUEL",
        message: "Fuel below 10%",
        isRead: true,
      }),
    );

    const mockAlertRepo: IAlertRepository = {
      findAll: async (query) => {
        let filtered = [...alerts.values()];
        if (query.isRead !== undefined) {
          filtered = filtered.filter((a) => a.isRead === query.isRead);
        }
        if (query.alertType) {
          filtered = filtered.filter((a) => a.alertType === query.alertType);
        }
        return {
          data: filtered,
          total: filtered.length,
          page: query.page ?? 1,
          limit: query.limit ?? 20,
        };
      },
      markAsRead: async (id: string) => {
        const alert = alerts.get(id)!;
        const updated = { ...alert, isRead: true };
        alerts.set(id, updated);
        return updated;
      },
      markAllAsRead: async () => {
        let count = 0;
        for (const [id, alert] of alerts) {
          if (!alert.isRead) {
            alerts.set(id, { ...alert, isRead: true });
            count++;
          }
        }
        return count;
      },
      countUnread: async () => {
        return [...alerts.values()].filter((a) => !a.isRead).length;
      },
    };

    alertService = new AlertService(mockAlertRepo);
  });

  test("list returns all alerts", async () => {
    const result = await alertService.list({});
    expect(result.data).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  test("list filters by isRead", async () => {
    const unread = await alertService.list({ isRead: false });
    expect(unread.data).toHaveLength(2);

    const read = await alertService.list({ isRead: true });
    expect(read.data).toHaveLength(1);
  });

  test("markAsRead marks a single alert", async () => {
    const updated = await alertService.markAsRead("alert-1");
    expect(updated.isRead).toBe(true);
  });

  test("markAllAsRead marks all unread alerts", async () => {
    const count = await alertService.markAllAsRead();
    expect(count).toBe(2);

    const unread = await alertService.countUnread();
    expect(unread).toBe(0);
  });

  test("countUnread returns correct count", async () => {
    const count = await alertService.countUnread();
    expect(count).toBe(2);
  });
});
