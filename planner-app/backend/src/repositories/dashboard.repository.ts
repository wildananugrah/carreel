import type { PrismaClient } from "../generated/prisma";
import type { IDashboardRepository } from "../interfaces/repositories/dashboard.repository.interface";
import type {
  DashboardAlertBanner,
  DashboardOverviewKPIs,
  DashboardOverviewQuery,
  DashboardVehicleCard,
} from "../types/dto";

export class DashboardRepository implements IDashboardRepository {
  constructor(private prisma: PrismaClient) {}

  async getOverviewKPIs(): Promise<DashboardOverviewKPIs> {
    const [
      activeUnits,
      preCheckComplete,
      postCheckComplete,
      aiAlerts,
      lowFuelCount,
    ] = await Promise.all([
      this.prisma.unit.count({ where: { status: "ACTIVE" } }),
      this.prisma.inspection.count({
        where: {
          tripType: "PRE_TRIP",
          status: { in: ["AI_COMPLETE", "UNDER_REVIEW", "APPROVED"] },
        },
      }),
      this.prisma.inspection.count({
        where: {
          tripType: "POST_TRIP",
          status: { in: ["AI_COMPLETE", "UNDER_REVIEW", "APPROVED"] },
        },
      }),
      this.prisma.alert.count({
        where: {
          isRead: false,
          alertType: {
            in: ["NEW_DAMAGE_DETECTED", "HIGH_SEVERITY_DAMAGE", "AI_FAILURE"],
          },
        },
      }),
      this.prisma.alert.count({
        where: { isRead: false, alertType: "LOW_FUEL" },
      }),
    ]);

    return {
      activeUnits,
      preCheckComplete,
      postCheckComplete,
      aiAlerts,
      lowFuelCount,
    };
  }

  async getAlertBanners(): Promise<DashboardAlertBanner[]> {
    const banners: DashboardAlertBanner[] = [];

    const [unsignedInspections, lowFuelAlerts] = await Promise.all([
      this.prisma.inspection.findMany({
        where: {
          signatureKey: null,
          status: { in: ["AI_COMPLETE", "UNDER_REVIEW", "APPROVED"] },
          unitId: { not: null },
        },
        select: { unit: { select: { licensePlate: true } } },
        distinct: ["unitId"],
      }),
      this.prisma.alert.findMany({
        where: { isRead: false, alertType: "LOW_FUEL" },
        select: { inspectionId: true },
      }),
    ]);

    if (unsignedInspections.length > 0) {
      const plates = unsignedInspections
        .map((i) => i.unit?.licensePlate)
        .filter(Boolean) as string[];
      banners.push({
        type: "signature_pending",
        message: `${plates.length} unit menunggu TTD PIC`,
        plates,
      });
    }

    if (lowFuelAlerts.length > 0) {
      const inspectionIds = lowFuelAlerts.map((a) => a.inspectionId);
      const inspections = await this.prisma.inspection.findMany({
        where: { id: { in: inspectionIds } },
        select: { unit: { select: { licensePlate: true } } },
        distinct: ["unitId"],
      });
      const plates = inspections
        .map((i) => i.unit?.licensePlate)
        .filter(Boolean) as string[];
      if (plates.length > 0) {
        banners.push({
          type: "low_fuel",
          message: `${plates.length} unit BBM rendah`,
          plates,
        });
      }
    }

    return banners;
  }

  async getVehicleCards(
    query: DashboardOverviewQuery,
  ): Promise<DashboardVehicleCard[]> {
    // Build inspection-level search filter — include all statuses
    const inspectionWhere: Record<string, unknown> = {};

    if (query.search) {
      const s = query.search;
      inspectionWhere.OR = [
        { unit: { licensePlate: { contains: s, mode: "insensitive" } } },
        { unit: { make: { contains: s, mode: "insensitive" } } },
        { unit: { model: { contains: s, mode: "insensitive" } } },
        { driver: { fullName: { contains: s, mode: "insensitive" } } },
      ];
    }

    const inspections = await this.prisma.inspection.findMany({
      where: inspectionWhere as never,
      include: {
        driver: { select: { fullName: true } },
        unit: true,
      },
      orderBy: { createdAt: "desc" as const },
    });

    const allInspectionIds = inspections.map((i) => i.id);

    const [alertCounts, damageAlertCounts, telemetryData] = await Promise.all([
      allInspectionIds.length > 0
        ? this.prisma.alert.groupBy({
            by: ["inspectionId"],
            where: { inspectionId: { in: allInspectionIds }, isRead: false },
            _count: { id: true },
          })
        : Promise.resolve([]),
      allInspectionIds.length > 0
        ? this.prisma.alert.groupBy({
            by: ["inspectionId"],
            where: {
              inspectionId: { in: allInspectionIds },
              isRead: false,
              alertType: {
                in: ["NEW_DAMAGE_DETECTED", "HIGH_SEVERITY_DAMAGE"],
              },
            },
            _count: { id: true },
          })
        : Promise.resolve([]),
      allInspectionIds.length > 0
        ? this.prisma.telemetryData.findMany({
            where: { inspectionId: { in: allInspectionIds } },
            orderBy: { createdAt: "desc" as const },
          })
        : Promise.resolve([]),
    ]);

    const alertCountMap = new Map(
      alertCounts.map((a) => [a.inspectionId, a._count.id]),
    );
    const damageAlertCountMap = new Map(
      damageAlertCounts.map((a) => [a.inspectionId, a._count.id]),
    );
    const telemetryMap = new Map(
      telemetryData.map((t) => [t.inspectionId, t.fuelLevelPct]),
    );

    // Group inspections by unitId (or by driverId if no unit)
    const grouped = new Map<string, typeof inspections>();
    for (const insp of inspections) {
      const key = insp.unitId ?? `driver:${insp.driverId}`;
      const group = grouped.get(key);
      if (group) {
        group.push(insp);
      } else {
        grouped.set(key, [insp]);
      }
    }

    const mapTrip = (insp: (typeof inspections)[0] | null) =>
      insp
        ? {
            inspectionId: insp.id,
            status: insp.status,
            startedAt: insp.startedAt.toISOString(),
            completedAt: insp.completedAt?.toISOString() ?? null,
            hasSigned: insp.signatureKey != null,
            signerName: insp.signerName,
          }
        : null;

    const cards: DashboardVehicleCard[] = [];

    for (const [key, group] of grouped) {
      const latest = group[0];
      const unit = latest.unit;
      const latestPreTrip =
        group.find((i) => i.tripType === "PRE_TRIP") ?? null;
      const latestPostTrip =
        group.find((i) => i.tripType === "POST_TRIP") ?? null;
      const driverName = latest.driver?.fullName ?? null;

      const groupAlertCount = group.reduce(
        (sum, i) => sum + (alertCountMap.get(i.id) ?? 0),
        0,
      );
      const groupDamageAlertCount = group.reduce(
        (sum, i) => sum + (damageAlertCountMap.get(i.id) ?? 0),
        0,
      );
      const latestFuelLevelPct = telemetryMap.get(latest.id) ?? null;

      const unitName = unit
        ? [unit.make, unit.model, unit.type].filter(Boolean).join(" ") ||
          unit.licensePlate
        : (driverName ?? key);

      cards.push({
        unitId: unit?.id ?? key,
        unitName,
        licensePlate: unit?.licensePlate ?? "--",
        company: unit
          ? ((unit as unknown as { company?: string }).company ?? null)
          : null,
        lastKnownKm: unit?.lastKnownKm ?? null,
        driverName,
        preTrip: mapTrip(latestPreTrip),
        postTrip: mapTrip(latestPostTrip),
        latestFuelLevelPct,
        hasAlerts: groupAlertCount > 0,
        alertCount: groupAlertCount,
        hasDamageAlerts: groupDamageAlertCount > 0,
        damageAlertCount: groupDamageAlertCount,
      });
    }

    // Tab filters (follows driver-app pattern):
    // alert     — cards with damage alerts
    // ongoing   — still being processed (DRAFT, PENDING_AI)
    // completed — AI done or reviewed (AI_COMPLETE, UNDER_REVIEW, APPROVED, REJECTED)
    // all       — everything
    switch (query.tab) {
      case "alert":
        return cards.filter((c) => c.hasDamageAlerts);
      case "ongoing": {
        const inProgress = ["DRAFT", "PENDING_AI"];
        return cards.filter(
          (c) =>
            (c.preTrip && inProgress.includes(c.preTrip.status)) ||
            (c.postTrip && inProgress.includes(c.postTrip.status)),
        );
      }
      case "completed": {
        const done = ["AI_COMPLETE", "UNDER_REVIEW", "APPROVED", "REJECTED"];
        return cards.filter(
          (c) =>
            (c.preTrip && done.includes(c.preTrip.status)) ||
            (c.postTrip && done.includes(c.postTrip.status)),
        );
      }
      default:
        return cards;
    }
  }
}
