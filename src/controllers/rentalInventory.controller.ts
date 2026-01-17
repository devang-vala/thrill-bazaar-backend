// 5. Upsert per-day price override (just store override, do not touch ranges)
export const upsertPerDayPriceOverride = async (c: Context) => {
  const { listingId, variantId, date, price, availableCount, totalCapacity, inventoryDateRangeId } = await c.req.json();
  const changeDate = new Date(date);
  // Upsert: if exists, update; else, create
  const existing = await prisma.listingSlotChange.findFirst({
    where: {
      listingId,
      variantId: variantId ?? null,
      inventoryDateRangeId: inventoryDateRangeId ?? null,
      date: changeDate,
    },
  });
  
  const updateData: any = {
    price: price,
    triggerType: "seller_update",
  };
  
  // Only update availableCount and totalCapacity if provided
  if (availableCount !== undefined && availableCount !== null) {
    updateData.availableCount = availableCount;
  }
  if (totalCapacity !== undefined && totalCapacity !== null) {
    updateData.totalCapacity = totalCapacity;
  }
  
  if (existing) {
    await prisma.listingSlotChange.update({
      where: { id: existing.id },
      data: updateData,
    });
  } else {
    await prisma.listingSlotChange.create({
      data: {
        inventoryDateRangeId: inventoryDateRangeId ?? null,
        listingId,
        variantId: variantId ?? null,
        date: changeDate,
        price: price,
        availableCount: availableCount !== undefined && availableCount !== null ? availableCount : 0,
        totalCapacity: totalCapacity !== undefined && totalCapacity !== null ? totalCapacity : 0,
        triggerType: "seller_update",
      },
    });
  }
  return c.json({ success: true });
};
// 6. Remove per-day price override
export const removePerDayOverride = async (c: Context) => {
  const { listingId, variantId, date, inventoryDateRangeId } = await c.req.json();
  const changeDate = new Date(date);
  await prisma.listingSlotChange.deleteMany({
    where: {
      listingId,
      variantId: variantId ?? null,
      inventoryDateRangeId: inventoryDateRangeId ?? null,
      date: changeDate,
    },
  });
  return c.json({ success: true });
};
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

// 1. Fetch availability for a listing+variant (blocked > booked > per-day override > date range)
export const getRentalAvailability = async (c: Context) => {
  const listingId = c.req.param("listingId");
  const variantId = c.req.param("variantId") || null;
  // Fetch all date ranges
  const ranges = await prisma.inventoryDateRange.findMany({
    where: { listingId, variantId },
    orderBy: { availableFromDate: "asc" },
  });
  // Fetch all per-day overrides (including booked dates)
  const slotOverrides = await prisma.listingSlotChange.findMany({
    where: {
      listingId,
      variantId: variantId ?? null,
      inventoryDateRangeId: null,
    },
    select: {
      date: true,
      price: true,
      totalCapacity: true,
      availableCount: true,
    },
  });
  // Fetch all blocked dates
  const blocked = await prisma.inventoryBlockedDate.findMany({
    where: { listingId, variantId },
  });
  const blockedSet = new Set(blocked.map(b => format(b.blockedDate, "yyyy-MM-dd")));
  
  // Build a map for booked dates and capacity
  const capacityMap: Record<string, { totalCapacity: number, availableCount: number }> = {};
  for (const o of slotOverrides) {
    capacityMap[format(o.date, "yyyy-MM-dd")] = {
      totalCapacity: o.totalCapacity,
      availableCount: o.availableCount,
    };
  }
  
  // Build date-wise availability
  const calendar: Record<string, { 
    price: number, 
    available: boolean, 
    source: string, 
    totalCapacity?: number,
    availableCount?: number,
    remainingCount?: number
  }> = {};
  // 1. Fill from date ranges
  for (const range of ranges) {
    const dates = getDatesInRange(range.availableFromDate, range.availableToDate);
    for (const date of dates) {
      calendar[date] = { price: range.basePricePerDay, available: true, source: "range" };
    }
  }
  // 2. Override with per-day slot changes (price and capacity)
  for (const o of slotOverrides) {
    const dateStr = format(o.date, "yyyy-MM-dd");
    const capacity = capacityMap[dateStr];
    if (calendar[dateStr]) {
      calendar[dateStr].price = o.price;
      calendar[dateStr].source = "override";
      calendar[dateStr].totalCapacity = capacity.totalCapacity;
      calendar[dateStr].availableCount = capacity.availableCount;
      calendar[dateStr].remainingCount = capacity.availableCount;
    } else {
      calendar[dateStr] = { 
        price: o.price, 
        available: true, 
        source: "override",
        totalCapacity: capacity.totalCapacity,
        availableCount: capacity.availableCount,
        remainingCount: capacity.availableCount,
      };
    }
  }
  // 3. Mark booked dates as unavailable (if fully booked)
  for (const date of Object.keys(capacityMap)) {
    if (calendar[date]) {
      const capacity = capacityMap[date];
      if (capacity.totalCapacity > capacity.availableCount) {
        calendar[date].available = false;
        calendar[date].source = "booked";
      }
      calendar[date].totalCapacity = capacity.totalCapacity;
      calendar[date].availableCount = capacity.availableCount;
      calendar[date].remainingCount = capacity.availableCount;
    }
  }
  // 4. Blocked dates take highest priority
  for (const date of blockedSet) {
    if (calendar[date]) {
      calendar[date].available = false;
      calendar[date].source = "blocked";
    } else {
      calendar[date] = { price: 0, available: false, source: "blocked" };
    }
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
