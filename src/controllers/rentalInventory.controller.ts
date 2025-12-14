// API: Get raw date ranges for a listing+variant
export const getRentalDateRangesRaw = async (c: Context) => {
  const listingId = c.req.param("listingId");
  const variantId = c.req.param("variantId") || null;
  const ranges = await prisma.inventoryDateRange.findMany({
    where: { listingId, variantId },
    orderBy: { availableFromDate: "asc" },
  });
  return c.json({ success: true, data: ranges });
};
import type { Context } from "hono";
import { prisma } from "../db.js";
import { addDays, format, isAfter, isBefore, isEqual } from "date-fns";

// Helper: Generate all dates in a range
function getDatesInRange(start: Date, end: Date): string[] {
  const dates = [];
  let current = new Date(start);
  while (current <= end) {
    dates.push(format(current, "yyyy-MM-dd"));
    current = addDays(current, 1);
  }
  return dates;
}

// 1. Fetch availability for a listing+variant (calendar, per-day price, exclude blocked)
export const getRentalAvailability = async (c: Context) => {
  const listingId = c.req.param("listingId");
  const variantId = c.req.param("variantId") || null;
  // Fetch all date ranges for this listing+variant
  const ranges = await prisma.inventoryDateRange.findMany({
    where: { listingId, variantId },
    orderBy: { availableFromDate: "asc" },
  });
  // Fetch all blocked dates for this listing+variant
  const blocked = await prisma.inventoryBlockedDate.findMany({
    where: { listingId, variantId },
  });
  const blockedSet = new Set(blocked.map(b => format(b.blockedDate, "yyyy-MM-dd")));
  // Build date-wise availability
  const calendar: Record<string, { price: number, available: boolean }> = {};
  for (const range of ranges) {
    const dates = getDatesInRange(range.availableFromDate, range.availableToDate);
    for (const date of dates) {
      calendar[date] = { price: range.basePricePerDay, available: true };
    }
  }
  // Remove blocked dates
  for (const date of blockedSet) {
    if (calendar[date]) calendar[date].available = false;
  }
  return c.json({ success: true, data: calendar });
};

// 2. Create/update date range
export const upsertRentalDateRange = async (c: Context) => {
  const { listingId, variantId, availableFromDate, availableToDate, basePricePerDay } = await c.req.json();
  // Overlapping logic: delete overlapping, then insert new
  await prisma.inventoryDateRange.deleteMany({
    where: {
      listingId,
      variantId,
      OR: [
        { availableFromDate: { lte: new Date(availableToDate) }, availableToDate: { gte: new Date(availableFromDate) } },
      ],
    },
  });
  const range = await prisma.inventoryDateRange.create({
    data: {
      listingId,
      variantId,
      availableFromDate: new Date(availableFromDate),
      availableToDate: new Date(availableToDate),
      basePricePerDay: Number(basePricePerDay),
    },
  });
  return c.json({ success: true, data: range });
};

// 3. Block a date
export const blockRentalDate = async (c: Context) => {
  const { listingId, variantId, blockedDate, reason, createdByOperatorId } = await c.req.json();
  if (!createdByOperatorId) {
    return c.json({ success: false, message: "createdByOperatorId is required" }, 400);
  }
  const block = await prisma.inventoryBlockedDate.create({
    data: {
      listingId,
      variantId,
      blockedDate: new Date(blockedDate),
      reason: reason || null,
      createdByOperatorId,
    },
  });
  return c.json({ success: true, data: block });
};

// 4. Unblock a date
export const unblockRentalDate = async (c: Context) => {
  const { listingId, variantId, blockedDate } = await c.req.json();
  await prisma.inventoryBlockedDate.deleteMany({
    where: {
      listingId,
      variantId,
      blockedDate: new Date(blockedDate),
    },
  });
  return c.json({ success: true });
};
