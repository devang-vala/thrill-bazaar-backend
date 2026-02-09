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
    // When creating new override, get the base values from the date range if not provided
    let finalAvailableCount = availableCount;
    let finalTotalCapacity = totalCapacity;
    let finalInventoryDateRangeId = inventoryDateRangeId;
    
    // Try to find the date range this date belongs to
    const dateRange = await prisma.inventoryDateRange.findFirst({
      where: {
        listingId,
        variantId: variantId ?? null,
        availableFromDate: { lte: changeDate },
        availableToDate: { gte: changeDate },
        isActive: true,
      },
    });
    
    if (dateRange) {
      // If we found a date range, use its ID and values if not provided
      if (!finalInventoryDateRangeId) {
        finalInventoryDateRangeId = dateRange.id;
      }
      if (finalAvailableCount === undefined || finalAvailableCount === null) {
        finalAvailableCount = dateRange.availableCount ?? 1;
      }
      if (finalTotalCapacity === undefined || finalTotalCapacity === null) {
        finalTotalCapacity = dateRange.totalCapacity ?? 1;
      }
    } else {
      // No date range found, use reasonable defaults (not 0)
      if (finalAvailableCount === undefined || finalAvailableCount === null) {
        finalAvailableCount = 1;
      }
      if (finalTotalCapacity === undefined || finalTotalCapacity === null) {
        finalTotalCapacity = 1;
      }
    }
    
    // Ensure we never have null values (schema requires non-null)
    finalAvailableCount = finalAvailableCount ?? 1;
    finalTotalCapacity = finalTotalCapacity ?? 1;
    
    await prisma.listingSlotChange.create({
      data: {
        inventoryDateRangeId: finalInventoryDateRangeId ?? null,
        listingId,
        variantId: variantId ?? null,
        date: changeDate,
        price: price,
        availableCount: finalAvailableCount,
        totalCapacity: finalTotalCapacity,
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
    where: { listingId, variantId, slotDefinitionId: null }, // F2 only
    orderBy: { availableFromDate: "asc" },
  });
  // Fetch all per-day overrides (including price overrides)
  const slotOverrides = await prisma.listingSlotChange.findMany({
    where: {
      listingId,
      variantId: variantId ?? null,
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
  
  // Fetch active bookings for this listing to calculate per-date booking count
  const dateRangeIds = ranges.map(r => r.id);
  const activeBookings = await prisma.booking.findMany({
    where: {
      dateRangeId: { in: dateRangeIds },
      bookingStatus: { in: ["CONFIRMED", "COMPLETED"] },
    },
    select: {
      dateRangeId: true,
      pricingDetails: true,
      bookingStartDate: true,
      bookingEndDate: true,
    },
  });

  // Build a map of booked dates count per date
  const bookedDatesCount: Record<string, number> = {};
  activeBookings.forEach((booking) => {
    // Try to get selectedDates from pricingDetails
    const pricingDetails = booking.pricingDetails as { selectedDates?: string[] } | null;
    let selectedDates: string[] = [];
    
    if (pricingDetails?.selectedDates && Array.isArray(pricingDetails.selectedDates)) {
      selectedDates = pricingDetails.selectedDates;
    } else {
      // Fall back to generating dates from start/end if selectedDates not available
      const startDate = new Date(booking.bookingStartDate);
      const endDate = new Date(booking.bookingEndDate);
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        selectedDates.push(format(currentDate, "yyyy-MM-dd"));
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
    
    // Count bookings per date
    selectedDates.forEach((dateStr) => {
      bookedDatesCount[dateStr] = (bookedDatesCount[dateStr] || 0) + 1;
    });
  });

  // Build a map for price overrides
  const priceOverrideMap: Record<string, { price: number; totalCapacity?: number }> = {};
  for (const o of slotOverrides) {
    priceOverrideMap[format(o.date, "yyyy-MM-dd")] = {
      price: o.price,
      totalCapacity: o.totalCapacity,
    };
  }
  
  // Build date-wise availability
  const calendar: Record<string, { 
    price: number, 
    available: boolean, 
    source: string, 
    totalCapacity?: number,
    availableCount?: number,
    bookedCount?: number,
    remainingCount?: number
  }> = {};
  // 1. Fill from date ranges
  for (const range of ranges) {
    const dates = getDatesInRange(range.availableFromDate, range.availableToDate);
    for (const dateStr of dates) {
      const totalCapacity = range.totalCapacity ?? 1;
      const bookedCount = bookedDatesCount[dateStr] || 0;
      const availableCount = Math.max(0, totalCapacity - bookedCount);
      
      calendar[dateStr] = { 
        price: range.basePricePerDay, 
        available: availableCount > 0, 
        source: "range",
        totalCapacity: totalCapacity,
        availableCount: availableCount,
        bookedCount: bookedCount,
        remainingCount: availableCount,
      };
    }
  }
  // 2. Override with per-day slot changes (price only, availability calculated from bookings)
  for (const dateStr of Object.keys(priceOverrideMap)) {
    const override = priceOverrideMap[dateStr];
    if (calendar[dateStr]) {
      calendar[dateStr].price = override.price;
      calendar[dateStr].source = "override";
      // Update totalCapacity from override if provided
      if (override.totalCapacity !== undefined && override.totalCapacity !== null) {
        const newTotalCapacity = override.totalCapacity;
        const bookedCount = bookedDatesCount[dateStr] || 0;
        const newAvailableCount = Math.max(0, newTotalCapacity - bookedCount);
        calendar[dateStr].totalCapacity = newTotalCapacity;
        calendar[dateStr].availableCount = newAvailableCount;
        calendar[dateStr].remainingCount = newAvailableCount;
        calendar[dateStr].available = newAvailableCount > 0;
      }
    } else {
      const totalCapacity = override.totalCapacity ?? 1;
      const bookedCount = bookedDatesCount[dateStr] || 0;
      const availableCount = Math.max(0, totalCapacity - bookedCount);
      calendar[dateStr] = { 
        price: override.price, 
        available: availableCount > 0, 
        source: "override",
        totalCapacity: totalCapacity,
        availableCount: availableCount,
        bookedCount: bookedCount,
        remainingCount: availableCount,
      };
    }
  }
  // 3. Mark booked dates as unavailable (if fully booked based on actual bookings)
  for (const dateStr of Object.keys(bookedDatesCount)) {
    if (calendar[dateStr]) {
      const bookedCount = bookedDatesCount[dateStr];
      const totalCapacity = calendar[dateStr].totalCapacity ?? 1;
      const availableCount = Math.max(0, totalCapacity - bookedCount);
      
      if (availableCount === 0) {
        calendar[dateStr].available = false;
        calendar[dateStr].source = "booked";
      }
      calendar[dateStr].bookedCount = bookedCount;
      calendar[dateStr].availableCount = availableCount;
      calendar[dateStr].remainingCount = availableCount;
    }
  }
  // 4. Blocked dates take highest priority
  for (const dateStr of blockedSet) {
    if (calendar[dateStr]) {
      calendar[dateStr].available = false;
      calendar[dateStr].source = "blocked";
    } else {
      calendar[dateStr] = { price: 0, available: false, source: "blocked" };
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
      slotDefinitionId: null, // Only delete F2 ranges (rental ranges)
      OR: [
        { availableFromDate: { lte: new Date(availableToDate) }, availableToDate: { gte: new Date(availableFromDate) } },
      ],
    },
  });
  const range = await prisma.inventoryDateRange.create({
    data: {
      listingId,
      variantId,
      slotDefinitionId: null, // F2 = rental, no slot definition
      availableFromDate: new Date(availableFromDate),
      availableToDate: new Date(availableToDate),
      basePricePerDay: Number(basePricePerDay),
      totalCapacity: 1, // Default capacity for rentals
      availableCount: 1, // Initially all available
      isActive: true,
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
