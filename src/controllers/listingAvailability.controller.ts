import type { Context } from "hono";
import { prisma } from "../db.js";
import {
  getActiveDateReservationHoldCounts,
  getActiveSlotReservationHoldCounts,
} from "../helpers/bookingReservation.helper.js";

type OperationStatus = "active" | "inactive";

type VariantSummary = {
  variantId: string | null;
  fromPrice: number | null;
  hasAvailability: boolean;
  operationStatus: OperationStatus;
};

const ACTIVE_BOOKING_STATUSES = ["CONFIRMED", "COMPLETED"] as const;

const toVariantKey = (variantId: string | null | undefined) => variantId || "__default__";

const toUtcStartOfDay = (value?: Date) => {
  const date = value ? new Date(value) : new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const toDateKey = (value: Date) => value.toISOString().split("T")[0];

const enumerateDateKeys = (start: Date, end: Date) => {
  const current = new Date(start);
  const keys: string[] = [];

  while (current <= end) {
    keys.push(toDateKey(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return keys;
};

const buildEmptySummary = (variantId: string | null): VariantSummary => ({
  variantId,
  fromPrice: null,
  hasAvailability: false,
  operationStatus: "inactive",
});

const updateVariantMinPrice = (
  minPriceMap: Map<string, number>,
  variantId: string | null,
  price: number | null | undefined,
) => {
  const normalizedPrice = Number(price ?? 0);
  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
    return;
  }

  const variantKey = toVariantKey(variantId);
  const existingPrice = minPriceMap.get(variantKey);
  if (existingPrice === undefined || normalizedPrice < existingPrice) {
    minPriceMap.set(variantKey, normalizedPrice);
  }
};

const buildBookedDateCounts = (
  bookings: Array<{
    dateRangeId: string | null;
    pricingDetails?: unknown;
    bookingStartDate: Date;
    bookingEndDate: Date;
  }>,
) => {
  const bookedDateCounts = new Map<string, number>();

  for (const booking of bookings) {
    if (!booking.dateRangeId) continue;

    const pricingDetails =
      booking.pricingDetails && typeof booking.pricingDetails === "object"
        ? (booking.pricingDetails as { selectedDates?: string[] })
        : null;

    const selectedDates =
      pricingDetails?.selectedDates && Array.isArray(pricingDetails.selectedDates)
        ? pricingDetails.selectedDates.filter(Boolean)
        : enumerateDateKeys(
          toUtcStartOfDay(booking.bookingStartDate),
          toUtcStartOfDay(booking.bookingEndDate),
        );

    for (const selectedDate of selectedDates) {
      const key = `${booking.dateRangeId}:${selectedDate}`;
      bookedDateCounts.set(key, (bookedDateCounts.get(key) || 0) + 1);
    }
  }

  return bookedDateCounts;
};

/**
 * Computes the per-variant minimum bookable price for every supplied activity listing
 * in a single pair of queries, keyed by listing id.
 */
async function calculateActivitySummaries(
  listingIds: string[],
  bookingFormat: "F1" | "F3",
  variantIdsByListingId: Map<string, string[]>,
  todayStartUtc: Date,
) {
  const minPriceMapByListingId = new Map<string, Map<string, number>>();
  if (listingIds.length === 0) return minPriceMapByListingId;

  const activitySlots = await prisma.listingSlot.findMany({
    where: {
      listingId: { in: listingIds },
      formatType: bookingFormat,
      isActive: true,
      ...(bookingFormat === "F1"
        ? {
          OR: [
            { batchEndDate: { gte: todayStartUtc } },
            { batchStartDate: { gte: todayStartUtc } },
          ],
        }
        : {
          slotDate: { gte: todayStartUtc },
        }),
    },
    select: {
      id: true,
      listingId: true,
      variantId: true,
      basePrice: true,
      availableCount: true,
      batchStartDate: true,
      batchEndDate: true,
      slotDate: true,
    },
  });

  const holdCounts = await getActiveSlotReservationHoldCounts(activitySlots.map((slot) => slot.id));

  for (const slot of activitySlots) {
    // The single-listing query restricted slots to the listing's own variants (or
    // variant-less inventory); keep that behaviour when batching.
    const listingVariantIds = variantIdsByListingId.get(slot.listingId) || [];
    if (
      listingVariantIds.length > 0 &&
      slot.variantId !== null &&
      !listingVariantIds.includes(slot.variantId)
    ) {
      continue;
    }

    const effectiveAvailableCount = Math.max(
      0,
      Number(slot.availableCount || 0) - Number(holdCounts.get(slot.id) || 0),
    );

    if (effectiveAvailableCount <= 0) continue;

    if (bookingFormat === "F1") {
      const relevantDate = slot.batchEndDate || slot.batchStartDate;
      if (!relevantDate || relevantDate < todayStartUtc) continue;
    } else if (!slot.slotDate || slot.slotDate < todayStartUtc) {
      continue;
    }

    let minPriceMap = minPriceMapByListingId.get(slot.listingId);
    if (!minPriceMap) {
      minPriceMap = new Map<string, number>();
      minPriceMapByListingId.set(slot.listingId, minPriceMap);
    }

    updateVariantMinPrice(minPriceMap, slot.variantId, slot.basePrice);
  }

  return minPriceMapByListingId;
}

/**
 * Batched counterpart of the per-listing rental summary. Every read is done once for
 * the whole set of listings and the results are grouped by listing id afterwards.
 */
async function calculateRentalSummaries(
  listingIds: string[],
  bookingFormat: "F2" | "F3" | "F4",
  variantIdsByListingId: Map<string, string[]>,
  todayStartUtc: Date,
) {
  const minPriceMapByListingId = new Map<string, Map<string, number>>();
  if (listingIds.length === 0) return minPriceMapByListingId;

  const isSlotBased = bookingFormat === "F3" || bookingFormat === "F4";

  const isVariantAllowed = (listingId: string, variantId: string | null) => {
    if (variantId === null) return true;
    const listingVariantIds = variantIdsByListingId.get(listingId) || [];
    return listingVariantIds.length === 0 || listingVariantIds.includes(variantId);
  };

  const [ranges, overrides, blockedDates] = await Promise.all([
    prisma.inventoryDateRange.findMany({
      where: {
        listingId: { in: listingIds },
        isActive: true,
        availableToDate: { gte: todayStartUtc },
        ...(isSlotBased
          ? { slotDefinitionId: { not: null } }
          : { slotDefinitionId: null }),
      },
      select: {
        id: true,
        listingId: true,
        variantId: true,
        slotDefinitionId: true,
        availableFromDate: true,
        availableToDate: true,
        basePricePerDay: true,
        totalCapacity: true,
      },
    }),
    prisma.listingSlotChange.findMany({
      where: {
        listingId: { in: listingIds },
        date: { gte: todayStartUtc },
      },
      select: {
        id: true,
        listingId: true,
        inventoryDateRangeId: true,
        variantId: true,
        date: true,
        price: true,
        totalCapacity: true,
        availableCount: true,
        inventoryDateRange: {
          select: {
            id: true,
            variantId: true,
            slotDefinitionId: true,
          },
        },
      },
    }),
    prisma.inventoryBlockedDate.findMany({
      where: {
        listingId: { in: listingIds },
        blockedDate: { gte: todayStartUtc },
      },
      select: {
        listingId: true,
        variantId: true,
        blockedDate: true,
      },
    }),
  ]);

  const filteredOverrides = overrides.filter(
    (override) =>
      isVariantAllowed(override.listingId, override.variantId) &&
      (isSlotBased
        ? Boolean(override.inventoryDateRange?.slotDefinitionId)
        : !override.inventoryDateRange?.slotDefinitionId),
  );
  const applicableRanges = ranges.filter((range) =>
    isVariantAllowed(range.listingId, range.variantId),
  );

  const rangeIds = applicableRanges.map((range) => range.id);
  const [activeBookings, holdCounts] = await Promise.all([
    rangeIds.length === 0
      ? Promise.resolve([])
      : prisma.booking.findMany({
        where: {
          dateRangeId: { in: rangeIds },
          bookingStatus: { in: [...ACTIVE_BOOKING_STATUSES] },
        },
        select: {
          dateRangeId: true,
          pricingDetails: true,
          bookingStartDate: true,
          bookingEndDate: true,
        },
      }),
    getActiveDateReservationHoldCounts(rangeIds),
  ]);

  const bookedDateCounts = buildBookedDateCounts(activeBookings);
  // Blocked dates are tracked per listing + variant, since ids are only unique per listing.
  const blockedDateMap = new Map<string, Set<string>>();
  const overriddenRangeDates = new Set<string>();

  const getMinPriceMap = (listingId: string) => {
    let minPriceMap = minPriceMapByListingId.get(listingId);
    if (!minPriceMap) {
      minPriceMap = new Map<string, number>();
      minPriceMapByListingId.set(listingId, minPriceMap);
    }
    return minPriceMap;
  };

  for (const blockedDate of blockedDates) {
    if (!isVariantAllowed(blockedDate.listingId, blockedDate.variantId)) continue;
    const blockedKey = `${blockedDate.listingId}::${toVariantKey(blockedDate.variantId)}`;
    const existing = blockedDateMap.get(blockedKey) ?? new Set<string>();
    existing.add(toDateKey(blockedDate.blockedDate));
    blockedDateMap.set(blockedKey, existing);
  }

  for (const override of filteredOverrides) {
    if (override.inventoryDateRangeId) {
      overriddenRangeDates.add(`${override.inventoryDateRangeId}:${toDateKey(override.date)}`);
    }
  }

  for (const range of applicableRanges) {
    const blockedVariantDates =
      blockedDateMap.get(`${range.listingId}::${toVariantKey(range.variantId)}`) ??
      new Set<string>();
    const effectiveStart =
      range.availableFromDate > todayStartUtc ? range.availableFromDate : todayStartUtc;

    for (const dateKey of enumerateDateKeys(effectiveStart, range.availableToDate)) {
      if (blockedVariantDates.has(dateKey)) continue;
      if (overriddenRangeDates.has(`${range.id}:${dateKey}`)) continue;

      const bookedCount = bookedDateCounts.get(`${range.id}:${dateKey}`) || 0;
      const heldCount = holdCounts.get(`${range.id}:${dateKey}`) || 0;
      const totalCapacity = Number(range.totalCapacity ?? 1);
      const remainingCount = totalCapacity - bookedCount - heldCount;

      if (remainingCount <= 0) continue;
      updateVariantMinPrice(getMinPriceMap(range.listingId), range.variantId, range.basePricePerDay);
    }
  }

  for (const override of filteredOverrides) {
    const derivedVariantId = override.variantId ?? override.inventoryDateRange?.variantId ?? null;
    const dateKey = toDateKey(override.date);
    const blockedKey = `${override.listingId}::${toVariantKey(derivedVariantId)}`;

    if ((blockedDateMap.get(blockedKey) ?? new Set<string>()).has(dateKey)) {
      continue;
    }

    const bookedCount = override.inventoryDateRangeId
      ? bookedDateCounts.get(`${override.inventoryDateRangeId}:${dateKey}`) || 0
      : 0;
    const heldCount = override.inventoryDateRangeId
      ? holdCounts.get(`${override.inventoryDateRangeId}:${dateKey}`) || 0
      : 0;
    const totalCapacity = Number(override.totalCapacity ?? override.availableCount ?? 1);
    const availableCount = Number(override.availableCount ?? totalCapacity);
    const remainingCount = availableCount - bookedCount - heldCount;

    if (remainingCount <= 0) continue;
    updateVariantMinPrice(getMinPriceMap(override.listingId), derivedVariantId, override.price);
  }

  return minPriceMapByListingId;
}

const buildListingSummary = (
  listingId: string,
  bookingFormat: string,
  variantIds: string[],
  minPriceMap: Map<string, number>,
) => {
  const variants: VariantSummary[] =
    variantIds.length > 0
      ? variantIds.map((variantId) => {
        // Check variant-specific price first, then null-variantId inventory (applies to all variants)
        const inventoryPrice =
          minPriceMap.get(toVariantKey(variantId)) ??
          minPriceMap.get("__default__") ??
          null;
        return {
          variantId,
          fromPrice: inventoryPrice,
          hasAvailability: inventoryPrice !== null,
          operationStatus: (inventoryPrice !== null ? "active" : "inactive") as OperationStatus,
        };
      })
      : [buildEmptySummary(null)];

  const overallMinPrice = variants.reduce<number | null>((lowest, variant) => {
    if (variant.fromPrice === null) return lowest;
    if (lowest === null || variant.fromPrice < lowest) return variant.fromPrice;
    return lowest;
  }, null);

  const hasAnyInventory = variants.some((v) => v.hasAvailability);

  return {
    listingId,
    bookingFormat,
    fromPrice: overallMinPrice,
    hasAvailability: hasAnyInventory,
    operationStatus: (hasAnyInventory ? "active" : "inactive") as OperationStatus,
    variants,
  };
};

/**
 * Computes availability summaries for a set of listings using batched queries — the
 * grid needs one summary per visible card, and doing that as N separate requests was
 * the dominant source of network waterfall on the collection pages.
 */
async function computeAvailabilitySummaries(listingIds: string[]) {
  if (listingIds.length === 0) return [];

  const listings = await prisma.listing.findMany({
    where: { id: { in: listingIds } },
    select: {
      id: true,
      bookingFormat: true,
      variants: {
        select: {
          id: true,
        },
        orderBy: { variantOrder: "asc" },
      },
    },
  });

  if (listings.length === 0) return [];

  const todayStartUtc = toUtcStartOfDay();
  const variantIdsByListingId = new Map<string, string[]>(
    listings.map((listing) => [listing.id, listing.variants.map((variant) => variant.id)]),
  );

  const idsByFormat = new Map<string, string[]>();
  for (const listing of listings) {
    if (!listing.bookingFormat) continue;
    const existing = idsByFormat.get(listing.bookingFormat) ?? [];
    existing.push(listing.id);
    idsByFormat.set(listing.bookingFormat, existing);
  }

  const [f1Prices, f2Prices, f3Prices, f4Prices] = await Promise.all([
    calculateActivitySummaries(
      idsByFormat.get("F1") ?? [],
      "F1",
      variantIdsByListingId,
      todayStartUtc,
    ),
    calculateRentalSummaries(
      idsByFormat.get("F2") ?? [],
      "F2",
      variantIdsByListingId,
      todayStartUtc,
    ),
    calculateRentalSummaries(
      idsByFormat.get("F3") ?? [],
      "F3",
      variantIdsByListingId,
      todayStartUtc,
    ),
    calculateRentalSummaries(
      idsByFormat.get("F4") ?? [],
      "F4",
      variantIdsByListingId,
      todayStartUtc,
    ),
  ]);

  const pricesByFormat: Record<string, Map<string, Map<string, number>>> = {
    F1: f1Prices,
    F2: f2Prices,
    F3: f3Prices,
    F4: f4Prices,
  };

  return listings.map((listing) =>
    buildListingSummary(
      listing.id,
      listing.bookingFormat ?? "",
      variantIdsByListingId.get(listing.id) ?? [],
      (listing.bookingFormat ? pricesByFormat[listing.bookingFormat]?.get(listing.id) : null) ??
        new Map<string, number>(),
    ),
  );
}

export const getListingAvailabilitySummary = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    if (!listingId) {
      return c.json({ success: false, message: "listingId is required" }, 400);
    }

    const [summary] = await computeAvailabilitySummaries([listingId]);

    if (!summary) {
      return c.json({ success: false, message: "Listing not found" }, 404);
    }

    return c.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error("Get listing availability summary error:", error);
    return c.json({ success: false, message: "Failed to compute listing availability summary" }, 500);
  }
};

const MAX_BATCH_AVAILABILITY_LISTINGS = 60;

/**
 * GET /listings/availability-summaries?listingIds=a,b,c
 * Returns a summary per requested listing so a grid can hydrate every card at once.
 */
export const getListingAvailabilitySummaries = async (c: Context) => {
  try {
    const rawListingIds = c.req.query("listingIds") || "";
    const listingIds = Array.from(
      new Set(
        rawListingIds
          .split(",")
          .map((listingId) => listingId.trim())
          .filter(Boolean),
      ),
    );

    if (listingIds.length === 0) {
      return c.json({ success: true, data: [] });
    }

    if (listingIds.length > MAX_BATCH_AVAILABILITY_LISTINGS) {
      return c.json(
        {
          success: false,
          message: `A maximum of ${MAX_BATCH_AVAILABILITY_LISTINGS} listingIds can be requested at once`,
        },
        400,
      );
    }

    const summaries = await computeAvailabilitySummaries(listingIds);

    if (!c.get("user")) {
      c.header("Cache-Control", "public, max-age=60, s-maxage=60");
    } else {
      c.header("Cache-Control", "no-store");
    }

    return c.json({ success: true, data: summaries });
  } catch (error) {
    console.error("Get listing availability summaries error:", error);
    return c.json(
      { success: false, message: "Failed to compute listing availability summaries" },
      500,
    );
  }
};

