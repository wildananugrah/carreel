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

    // Group inspections into trip pairs (pre-trip + linked post-trip).
    // Each pair becomes one card. Standalone inspections (no pair) get their own card.
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

    // Build a lookup: preTripId -> postTrip
    const postTripByPreId = new Map<string, (typeof inspections)[0]>();
    const usedIds = new Set<string>();

    for (const insp of inspections) {
      if (insp.tripType === "POST_TRIP" && insp.linkedInspectionId) {
        postTripByPreId.set(insp.linkedInspectionId, insp);
      }
    }

    const cards: DashboardVehicleCard[] = [];

    // First pass: create cards from pre-trips (paired or standalone)
    for (const insp of inspections) {
      if (insp.tripType !== "PRE_TRIP") continue;
      usedIds.add(insp.id);

      const postTrip = postTripByPreId.get(insp.id) ?? null;
      if (postTrip) usedIds.add(postTrip.id);

      const pairIds = [insp.id];
      if (postTrip) pairIds.push(postTrip.id);

      const pairAlertCount = pairIds.reduce((sum, id) => sum + (alertCountMap.get(id) ?? 0), 0);
      const pairDamageAlertCount = pairIds.reduce(
        (sum, id) => sum + (damageAlertCountMap.get(id) ?? 0),
        0,
      );
      const fuelPct = telemetryMap.get(postTrip?.id ?? insp.id) ?? null;

      const unit = insp.unit;
      const unitName = unit
        ? [unit.make, unit.model, unit.type].filter(Boolean).join(" ") || unit.licensePlate
        : (insp.driver?.fullName ?? insp.id);

      cards.push({
        unitId: unit?.id ?? `driver:${insp.driverId}`,
        unitName,
        licensePlate: unit?.licensePlate ?? "--",
        company: unit ? ((unit as unknown as { company?: string }).company ?? null) : null,
        lastKnownKm: unit?.lastKnownKm ?? null,
        driverName: insp.driver?.fullName ?? null,
        preTrip: mapTrip(insp),
        postTrip: mapTrip(postTrip),
        latestFuelLevelPct: fuelPct,
        hasAlerts: pairAlertCount > 0,
        alertCount: pairAlertCount,
        hasDamageAlerts: pairDamageAlertCount > 0,
        damageAlertCount: pairDamageAlertCount,
      });
    }

    // Second pass: standalone post-trips (no linked pre-trip)
    for (const insp of inspections) {
      if (usedIds.has(insp.id)) continue;
      if (insp.tripType !== "POST_TRIP") continue;
      usedIds.add(insp.id);

      const unit = insp.unit;
      const unitName = unit
        ? [unit.make, unit.model, unit.type].filter(Boolean).join(" ") || unit.licensePlate
        : (insp.driver?.fullName ?? insp.id);

      cards.push({
        unitId: unit?.id ?? `driver:${insp.driverId}`,
        unitName,
        licensePlate: unit?.licensePlate ?? "--",
        company: unit ? ((unit as unknown as { company?: string }).company ?? null) : null,
        lastKnownKm: unit?.lastKnownKm ?? null,
        driverName: insp.driver?.fullName ?? null,
        preTrip: null,
        postTrip: mapTrip(insp),
        latestFuelLevelPct: telemetryMap.get(insp.id) ?? null,
        hasAlerts: (alertCountMap.get(insp.id) ?? 0) > 0,
        alertCount: alertCountMap.get(insp.id) ?? 0,
        hasDamageAlerts: (damageAlertCountMap.get(insp.id) ?? 0) > 0,
        damageAlertCount: damageAlertCountMap.get(insp.id) ?? 0,
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
