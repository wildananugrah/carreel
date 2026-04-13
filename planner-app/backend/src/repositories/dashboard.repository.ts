import type { PrismaClient } from "../generated/prisma";
import type { IDashboardRepository } from "../interfaces/repositories/dashboard.repository.interface";
import type {
  DashboardAlertBanner,
  DashboardOverviewKPIs,
  DashboardOverviewQuery,
  DashboardVehicleCard,
} from "../types/dto";
import type { UserScope } from "../types/scope";
import { buildScopeFilter } from "../utils/scope-filter";

export class DashboardRepository implements IDashboardRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Alerts carry projectId but no `inspection` relation in the schema. To
   * restrict alerts by driver ownership we pre-fetch the in-scope inspection
   * IDs and filter by `inspectionId: { in: [...] }`.
   *
   * Returns null for SUPER_ADMIN (no restriction).
   */
  private async allowedInspectionIdsForAlerts(
    scope: UserScope,
  ): Promise<string[] | null> {
    if (scope.systemRole === "SUPER_ADMIN") return null;
    const inspectionFilter = buildScopeFilter(scope, {
      includeDriverFilter: true,
    });
    const inspections = await this.prisma.inspection.findMany({
      where: inspectionFilter as never,
      select: { id: true },
    });
    return inspections.map((i) => i.id);
  }

  async getOverviewKPIs(scope: UserScope): Promise<DashboardOverviewKPIs> {
    const inspectionScope = buildScopeFilter(scope, {
      includeDriverFilter: true,
    });
    // Units have no driverId — filter by project only.
    const unitScope = buildScopeFilter(scope, { includeDriverFilter: false });
    const allowedAlertInspectionIds =
      await this.allowedInspectionIdsForAlerts(scope);

    const buildAlertWhere = (extra: Record<string, unknown>) => {
      if (allowedAlertInspectionIds === null) return extra;
      if (allowedAlertInspectionIds.length === 0) {
        // No accessible inspections → force zero matches.
        return { ...extra, id: "__scope-empty__" };
      }
      return {
        ...extra,
        inspectionId: { in: allowedAlertInspectionIds },
      };
    };

    const [
      activeUnits,
      preCheckComplete,
      postCheckComplete,
      aiAlerts,
      lowFuelCount,
    ] = await Promise.all([
      this.prisma.unit.count({
        where: {
          AND: [unitScope, { status: "ACTIVE" }],
        } as never,
      }),
      this.prisma.inspection.count({
        where: {
          AND: [
            inspectionScope,
            {
              tripType: "PRE_TRIP",
              status: { in: ["AI_COMPLETE", "UNDER_REVIEW", "APPROVED"] },
            },
          ],
        } as never,
      }),
      this.prisma.inspection.count({
        where: {
          AND: [
            inspectionScope,
            {
              tripType: "POST_TRIP",
              status: { in: ["AI_COMPLETE", "UNDER_REVIEW", "APPROVED"] },
            },
          ],
        } as never,
      }),
      this.prisma.alert.count({
        where: buildAlertWhere({
          isRead: false,
          alertType: {
            in: ["NEW_DAMAGE_DETECTED", "HIGH_SEVERITY_DAMAGE", "AI_FAILURE"],
          },
        }) as never,
      }),
      this.prisma.alert.count({
        where: buildAlertWhere({
          isRead: false,
          alertType: "LOW_FUEL",
        }) as never,
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

  async getAlertBanners(scope: UserScope): Promise<DashboardAlertBanner[]> {
    const inspectionScope = buildScopeFilter(scope, {
      includeDriverFilter: true,
    });
    const allowedAlertInspectionIds =
      await this.allowedInspectionIdsForAlerts(scope);
    const banners: DashboardAlertBanner[] = [];

    const lowFuelAlertWhere: Record<string, unknown> = {
      isRead: false,
      alertType: "LOW_FUEL",
    };
    if (allowedAlertInspectionIds !== null) {
      if (allowedAlertInspectionIds.length === 0) {
        lowFuelAlertWhere.id = "__scope-empty__";
      } else {
        lowFuelAlertWhere.inspectionId = { in: allowedAlertInspectionIds };
      }
    }

    const [unsignedInspections, lowFuelAlerts] = await Promise.all([
      this.prisma.inspection.findMany({
        where: {
          AND: [
            inspectionScope,
            {
              signatureKey: null,
              status: { in: ["AI_COMPLETE", "UNDER_REVIEW", "APPROVED"] },
              unitId: { not: null },
            },
          ],
        } as never,
        select: { unit: { select: { licensePlate: true } } },
        distinct: ["unitId"],
      }),
      this.prisma.alert.findMany({
        where: lowFuelAlertWhere as never,
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
        where: {
          AND: [inspectionScope, { id: { in: inspectionIds } }],
        } as never,
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
    scope: UserScope,
    query: DashboardOverviewQuery,
  ): Promise<DashboardVehicleCard[]> {
    const inspectionScope = buildScopeFilter(scope, {
      includeDriverFilter: true,
    });

    // Build inspection-level search filter — include all statuses
    const conditions: Record<string, unknown>[] = [inspectionScope];

    if (query.search) {
      const s = query.search;
      conditions.push({
        OR: [
          { unit: { licensePlate: { contains: s, mode: "insensitive" } } },
          { unit: { make: { contains: s, mode: "insensitive" } } },
          { unit: { model: { contains: s, mode: "insensitive" } } },
          { driver: { fullName: { contains: s, mode: "insensitive" } } },
        ],
      });
    }

    const inspectionWhere = { AND: conditions };

    const inspections = await this.prisma.inspection.findMany({
      where: inspectionWhere as never,
      include: {
        driver: { select: { fullName: true } },
        unit: true,
        steps: {
          where: { stepType: "UNIT_IDENTIFICATION" },
          select: {
            mediaFiles: {
              select: { id: true },
              orderBy: { createdAt: "asc" as const },
              take: 1,
            },
          },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" as const },
    });

    // Build inspectionId -> thumbnailMediaId lookup
    const thumbnailByInspectionId = new Map<string, string>();
    for (const insp of inspections) {
      const mediaId = insp.steps[0]?.mediaFiles[0]?.id;
      if (mediaId) thumbnailByInspectionId.set(insp.id, mediaId);
    }

    const allInspectionIds = inspections.map((i) => i.id);

    // Downstream queries are keyed by the already-scoped inspection IDs, so
    // they inherit the scope restriction naturally.
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
            signedAt: insp.signedAt?.toISOString() ?? null,
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

      const pairAlertCount = pairIds.reduce(
        (sum, id) => sum + (alertCountMap.get(id) ?? 0),
        0,
      );
      const pairDamageAlertCount = pairIds.reduce(
        (sum, id) => sum + (damageAlertCountMap.get(id) ?? 0),
        0,
      );
      const fuelPct = telemetryMap.get(postTrip?.id ?? insp.id) ?? null;

      const unit = insp.unit;
      const unitName = unit
        ? [unit.make, unit.model, unit.type].filter(Boolean).join(" ") ||
          unit.licensePlate
        : (insp.driver?.fullName ?? insp.id);

      cards.push({
        unitId: unit?.id ?? `driver:${insp.driverId}`,
        unitName,
        licensePlate: unit?.licensePlate ?? "--",
        company: unit
          ? ((unit as unknown as { company?: string }).company ?? null)
          : null,
        lastKnownKm: unit?.lastKnownKm ?? null,
        driverName: insp.driver?.fullName ?? null,
        preTrip: mapTrip(insp),
        postTrip: mapTrip(postTrip),
        latestFuelLevelPct: fuelPct,
        hasAlerts: pairAlertCount > 0,
        alertCount: pairAlertCount,
        hasDamageAlerts: pairDamageAlertCount > 0,
        damageAlertCount: pairDamageAlertCount,
        thumbnailMediaId: thumbnailByInspectionId.get(insp.id) ?? null,
      });
    }

    // Second pass: standalone post-trips (no linked pre-trip)
    for (const insp of inspections) {
      if (usedIds.has(insp.id)) continue;
      if (insp.tripType !== "POST_TRIP") continue;
      usedIds.add(insp.id);

      const unit = insp.unit;
      const unitName = unit
        ? [unit.make, unit.model, unit.type].filter(Boolean).join(" ") ||
          unit.licensePlate
        : (insp.driver?.fullName ?? insp.id);

      cards.push({
        unitId: unit?.id ?? `driver:${insp.driverId}`,
        unitName,
        licensePlate: unit?.licensePlate ?? "--",
        company: unit
          ? ((unit as unknown as { company?: string }).company ?? null)
          : null,
        lastKnownKm: unit?.lastKnownKm ?? null,
        driverName: insp.driver?.fullName ?? null,
        preTrip: null,
        postTrip: mapTrip(insp),
        latestFuelLevelPct: telemetryMap.get(insp.id) ?? null,
        hasAlerts: (alertCountMap.get(insp.id) ?? 0) > 0,
        alertCount: alertCountMap.get(insp.id) ?? 0,
        hasDamageAlerts: (damageAlertCountMap.get(insp.id) ?? 0) > 0,
        damageAlertCount: damageAlertCountMap.get(insp.id) ?? 0,
        thumbnailMediaId: thumbnailByInspectionId.get(insp.id) ?? null,
      });
    }

    // Tab filters (trip-group level):
    // alert     — cards with damage alerts
    // ongoing   — pre-trip submitted, post-trip not yet past PENDING_AI
    // completed — both pre and post submitted, post past PENDING_AI
    // all       — everything
    switch (query.tab) {
      case "alert":
        return cards.filter((c) => c.hasDamageAlerts);
      case "ongoing": {
        return cards.filter((c) => {
          if (!c.preTrip || c.preTrip.status === "DRAFT") return false;
          if (!c.postTrip) return true;
          return (
            c.postTrip.status === "DRAFT" ||
            c.postTrip.status === "PENDING_AI"
          );
        });
      }
      case "completed": {
        const done = [
          "AI_COMPLETE",
          "UNDER_REVIEW",
          "APPROVED",
          "REJECTED",
          "FLAGGED",
        ];
        return cards.filter(
          (c) =>
            c.preTrip &&
            c.preTrip.status !== "DRAFT" &&
            c.postTrip &&
            done.includes(c.postTrip.status),
        );
      }
      default:
        return cards;
    }
  }
}
