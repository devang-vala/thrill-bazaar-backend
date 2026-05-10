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

async function calculateActivitySummary(
  listingId: string,
  bookingFormat: "F1" | "F3",
  variantIds: string[],
  todayStartUtc: Date,
) {
  const activitySlots = await prisma.listingSlot.findMany({
    where: {
      listingId,
      formatType: bookingFormat,
      isActive: true,
      ...(variantIds.length > 0 ? { variantId: { in: variantIds } } : {}),
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
      variantId: true,
      basePrice: true,
      availableCount: true,
      batchStartDate: true,
      batchEndDate: true,
      slotDate: true,
    },
  });

  const holdCounts = await getActiveSlotReservationHoldCounts(activitySlots.map((slot) => slot.id));
  const minPriceMap = new Map<string, number>();

  for (const slot of activitySlots) {
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

    updateVariantMinPrice(minPriceMap, slot.variantId, slot.basePrice);
  }

  return minPriceMap;
}

async function calculateRentalSummary(
  listingId: string,
  bookingFormat: "F2" | "F4",
  variantIds: string[],
  todayStartUtc: Date,
) {
  const isSlotBasedRental = bookingFormat === "F4";

  const ranges = await prisma.inventoryDateRange.findMany({
    where: {
      listingId,
      isActive: true,
      availableToDate: { gte: todayStartUtc },
      ...(variantIds.length > 0 ? { variantId: { in: variantIds } } : {}),
      ...(isSlotBasedRental
        ? { slotDefinitionId: { not: null } }
        : { slotDefinitionId: null }),
    },
    select: {
      id: true,
      variantId: true,
      slotDefinitionId: true,
      availableFromDate: true,
      availableToDate: true,
      basePricePerDay: true,
      totalCapacity: true,
    },
  });

  const overrides = await prisma.listingSlotChange.findMany({
    where: {
      listingId,
      date: { gte: todayStartUtc },
      ...(variantIds.length > 0 ? { variantId: { in: variantIds } } : {}),
    },
    select: {
      id: true,
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
  });

  const filteredOverrides = overrides.filter((override) =>
    isSlotBasedRental
      ? Boolean(override.inventoryDateRange?.slotDefinitionId)
      : !override.inventoryDateRange?.slotDefinitionId,
  );

  const blockedDates = await prisma.inventoryBlockedDate.findMany({
    where: {
      listingId,
      blockedDate: { gte: todayStartUtc },
      ...(variantIds.length > 0 ? { variantId: { in: variantIds } } : {}),
    },
    select: {
      variantId: true,
      blockedDate: true,
    },
  });

  const rangeIds = ranges.map((range) => range.id);
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
  const blockedDateMap = new Map<string, Set<string>>();
  const overriddenRangeDates = new Set<string>();
  const minPriceMap = new Map<string, number>();

  for (const blockedDate of blockedDates) {
    const variantKey = toVariantKey(blockedDate.variantId);
    const existing = blockedDateMap.get(variantKey) ?? new Set<string>();
    existing.add(toDateKey(blockedDate.blockedDate));
    blockedDateMap.set(variantKey, existing);
  }

  for (const override of filteredOverrides) {
    if (override.inventoryDateRangeId) {
      overriddenRangeDates.add(`${override.inventoryDateRangeId}:${toDateKey(override.date)}`);
    }
  }

  for (const range of ranges) {
    const variantKey = toVariantKey(range.variantId);
    const blockedVariantDates = blockedDateMap.get(variantKey) ?? new Set<string>();
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
      updateVariantMinPrice(minPriceMap, range.variantId, range.basePricePerDay);
    }
  }

  for (const override of filteredOverrides) {
    const derivedVariantId = override.variantId ?? override.inventoryDateRange?.variantId ?? null;
    const variantKey = toVariantKey(derivedVariantId);
    const dateKey = toDateKey(override.date);

    if ((blockedDateMap.get(variantKey) ?? new Set<string>()).has(dateKey)) {
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
    updateVariantMinPrice(minPriceMap, derivedVariantId, override.price);
  }

  return minPriceMap;
}

export const getListingAvailabilitySummary = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    if (!listingId) {
      return c.json({ success: false, message: "listingId is required" }, 400);
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
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

    if (!listing) {
      return c.json({ success: false, message: "Listing not found" }, 404);
    }

    const variantIds = listing.variants.map((variant) => variant.id);
    const todayStartUtc = toUtcStartOfDay();

    let minPriceMap = new Map<string, number>();

    if (listing.bookingFormat === "F1" || listing.bookingFormat === "F3") {
      minPriceMap = await calculateActivitySummary(
        listingId,
        listing.bookingFormat,
        variantIds,
        todayStartUtc,
      );
    } else if (listing.bookingFormat === "F2" || listing.bookingFormat === "F4") {
      minPriceMap = await calculateRentalSummary(
        listingId,
        listing.bookingFormat,
        variantIds,
        todayStartUtc,
      );
    }

    const variants =
      variantIds.length > 0
        ? variantIds.map((variantId) => {
            const fromPrice = minPriceMap.get(toVariantKey(variantId)) ?? null;
            return {
              variantId,
              fromPrice,
              hasAvailability: fromPrice !== null,
              operationStatus: (fromPrice !== null ? "active" : "inactive") as OperationStatus,
            };
          })
        : [
            buildEmptySummary(null),
          ];

    const overallMinPrice = variants.reduce<number | null>((lowest, variant) => {
      if (variant.fromPrice === null) return lowest;
      if (lowest === null || variant.fromPrice < lowest) return variant.fromPrice;
      return lowest;
    }, null);

    return c.json({
      success: true,
      data: {
        listingId,
        bookingFormat: listing.bookingFormat,
        fromPrice: overallMinPrice,
        hasAvailability: overallMinPrice !== null,
        operationStatus: (overallMinPrice !== null ? "active" : "inactive") as OperationStatus,
        variants,
      },
    });
  } catch (error) {
    console.error("Get listing availability summary error:", error);
    return c.json({ success: false, message: "Failed to compute listing availability summary" }, 500);
  }
};
