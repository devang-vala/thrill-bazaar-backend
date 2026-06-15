import { prisma, withPrismaRetry } from "../db.js";

type PriceCandidate = {
  price: number;
  date: Date;
};

export type MinPriceResult = {
  fromPrice: number | null;
  validUntil: Date | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfUtcDay = (date = new Date()): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const toDateKey = (date: Date): string => startOfUtcDay(date).toISOString().slice(0, 10);

const addUtcDays = (date: Date, days: number): Date =>
  new Date(startOfUtcDay(date).getTime() + days * MS_PER_DAY);

const maxDate = (a: Date, b: Date): Date => (a > b ? a : b);

const maybeUpdateMin = (
  current: PriceCandidate | null,
  candidate: PriceCandidate,
): PriceCandidate => {
  if (!current) return candidate;
  if (candidate.price < current.price) return candidate;
  if (candidate.price === current.price && candidate.date < current.date) return candidate;
  return current;
};

export const computeMinPrice = async (listingId: string): Promise<MinPriceResult> => {
  const today = startOfUtcDay();

  const [ranges, overrides, slots, blockedDates] = await withPrismaRetry(
    () =>
      Promise.all([
        prisma.inventoryDateRange.findMany({
          where: {
            listingId,
            isActive: true,
            availableToDate: { gte: today },
            listing: { status: "active" },
          },
          select: {
            id: true,
            availableFromDate: true,
            availableToDate: true,
            basePricePerDay: true,
          },
        }),
        prisma.listingSlotChange.findMany({
          where: {
            listingId,
            triggerType: "seller_update",
            date: { gte: today },
            listing: { status: "active" },
          },
          select: {
            date: true,
            inventoryDateRangeId: true,
            price: true,
          },
        }),
        prisma.listingSlot.findMany({
          where: {
            listingId,
            isActive: true,
            listing: { status: "active" },
            OR: [
              { slotDate: { gte: today } },
              { batchEndDate: { gte: today } },
              { batchStartDate: { gte: today } },
            ],
          },
          select: {
            slotDate: true,
            batchStartDate: true,
            batchEndDate: true,
            basePrice: true,
          },
        }),
        prisma.inventoryBlockedDate.findMany({
          where: {
            listingId,
            blockedDate: { gte: today },
          },
          select: {
            blockedDate: true,
          },
        }),
      ]),
    "compute listing minimum price",
  );


  const blockedDateKeys = new Set<string>(
    blockedDates.map((block) => toDateKey(block.blockedDate)),
  );

  const rangeOverrideByDate = new Map<string, number>();
  const listingOverrideByDate = new Map<string, number>();

  for (const override of overrides) {
    const dateKey = toDateKey(override.date);
    if (override.inventoryDateRangeId) {
      rangeOverrideByDate.set(`${override.inventoryDateRangeId}:${dateKey}`, override.price);
    } else {
      listingOverrideByDate.set(dateKey, override.price);
    }
  }

  let min: PriceCandidate | null = null;

  for (const range of ranges) {
    const start = maxDate(startOfUtcDay(range.availableFromDate), today);
    const end = startOfUtcDay(range.availableToDate);

    for (let current = start; current <= end; current = addUtcDays(current, 1)) {
      const dateKey = toDateKey(current);
      if (blockedDateKeys.has(dateKey)) continue;

      const price =
        rangeOverrideByDate.get(`${range.id}:${dateKey}`) ??
        listingOverrideByDate.get(dateKey) ??
        range.basePricePerDay;

      min = maybeUpdateMin(min, { price, date: current });
    }
  }

  for (const override of overrides) {
    const dateKey = toDateKey(override.date);
    if (!blockedDateKeys.has(dateKey)) {
      min = maybeUpdateMin(min, {
        price: override.price,
        date: startOfUtcDay(override.date),
      });
    }
  }

  for (const slot of slots) {
    const start = startOfUtcDay(slot.slotDate ?? slot.batchStartDate ?? today);
    const end = startOfUtcDay(slot.slotDate ?? slot.batchEndDate ?? slot.batchStartDate ?? today);
    const effectiveStart = maxDate(start, today);

    for (let current = effectiveStart; current <= end; current = addUtcDays(current, 1)) {
      const dateKey = toDateKey(current);
      if (!blockedDateKeys.has(dateKey)) {
        min = maybeUpdateMin(min, { price: slot.basePrice, date: current });
      }
    }
  }

  return {
    fromPrice: min?.price ?? null,
    validUntil: min?.date ?? null,
  };
};

export const upsertListingPriceCache = async (listingId: string): Promise<MinPriceResult> => {
  const result = await computeMinPrice(listingId);

  await withPrismaRetry(
    () =>
      prisma.$executeRaw`
        INSERT INTO "listings_price_cache" ("listing_id", "from_price", "valid_until", "computed_at")
        VALUES (${listingId}, ${result.fromPrice}, ${result.validUntil}, NOW())
        ON CONFLICT ("listing_id")
        DO UPDATE SET
          "from_price" = EXCLUDED."from_price",
          "valid_until" = EXCLUDED."valid_until",
          "computed_at" = EXCLUDED."computed_at"
      `,
    "upsert listing price cache",
  );

  return result;
};
