import type { Context } from "hono";
import { prisma } from "../db.js";

// Bulk create or update F2 date ranges (day-wise rental)
export const bulkCreateOrUpdateF2DateRanges = async (c: Context) => {
  try {
    const { listingId, variantId, availableFromDate, availableToDate, basePricePerDay, totalCapacity } = await c.req.json();

    if (!listingId || !availableFromDate || !availableToDate || !basePricePerDay || !totalCapacity) {
      return c.json({ success: false, message: "Missing required fields (listingId, dates, price, and batch size required)" }, 400);
    }

    // Check for overlapping date ranges
    const overlappingRanges = await prisma.inventoryDateRange.findMany({
      where: {
        listingId,
        variantId: variantId || null,
        slotDefinitionId: null, // F2 doesn't use slot definitions
        OR: [
          {
            AND: [
              { availableFromDate: { lte: new Date(availableToDate) } },
              { availableToDate: { gte: new Date(availableFromDate) } },
            ],
          },
        ],
      },
    });

    if (overlappingRanges.length > 0) {
      // Delete overlapping ranges and merge
      await prisma.inventoryDateRange.deleteMany({
        where: {
          id: { in: overlappingRanges.map(r => r.id) },
        },
      });
    }

    // Create new date range
    const dateRange = await prisma.inventoryDateRange.create({
      data: {
        listingId,
        variantId: variantId || null,
        slotDefinitionId: null, // F2 has no slot definition
        availableFromDate: new Date(availableFromDate),
        availableToDate: new Date(availableToDate),
        basePricePerDay,
        totalCapacity: totalCapacity,
        availableCount: totalCapacity,
        isActive: true,
      },
    });

    return c.json({ 
      success: true, 
      message: "F2 date range created successfully",
      data: dateRange 
    });
  } catch (error) {
    console.error("Bulk create/update F2 date ranges error:", error);
    return c.json({ error: "Failed to create F2 date ranges" }, 500);
  }
};

// Get all F2 dates for a listing (for seller calendar)
export const getF2DatesForListing = async (c: Context) => {
  const { listingId, variantId } = c.req.param();

  try {
    const dateRanges = await prisma.inventoryDateRange.findMany({
      where: {
        listingId,
        variantId: variantId || null,
        slotDefinitionId: null, // F2 only
        isActive: true,
      },
      orderBy: { availableFromDate: "asc" },
    });

    // Expand date ranges into individual dates
    const transformedDates: any[] = [];
    
    dateRanges.forEach((range) => {
      const startDate = new Date(range.availableFromDate);
      const endDate = new Date(range.availableToDate);
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        transformedDates.push({
          date: currentDate.toISOString().split("T")[0],
          dateRangeId: range.id,
          basePricePerDay: range.basePricePerDay,
          totalCapacity: range.totalCapacity,
          availableCount: range.availableCount,
          isActive: range.isActive,
          availableFromDate: range.availableFromDate,
          availableToDate: range.availableToDate,
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    return c.json({ success: true, data: transformedDates });
  } catch (error) {
    console.error("Get F2 dates error:", error);
    return c.json({ error: "Failed to fetch F2 dates" }, 500);
  }
};

// Get F2 date ranges for a specific month (for customer calendar)
export const getF2DatesForMonth = async (c: Context) => {
  const params = c.req.param();
  const listingId = params.listingId;
  const variantId = params.variantId;
  const month = params.month;

  if (!listingId || !month) {
    return c.json(
      { success: false, message: "Missing listingId or month" },
      400
    );
  }

  try {
    const [year, monthNum] = month.split("-");
    const startOfMonth = new Date(`${year}-${monthNum}-01`);
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);

    const dateRanges = await prisma.inventoryDateRange.findMany({
      where: {
        listingId,
        variantId: variantId || null,
        slotDefinitionId: null, // F2 only
        isActive: true,
        OR: [
          {
            AND: [
              { availableFromDate: { lte: endOfMonth } },
              { availableToDate: { gte: startOfMonth } },
            ],
          },
        ],
      },
      orderBy: { availableFromDate: "asc" },
    });

    // Expand ranges into individual dates for the month
    const datesInMonth: any[] = [];
    
    dateRanges.forEach((range) => {
      const rangeStart = new Date(range.availableFromDate);
      const rangeEnd = new Date(range.availableToDate);
      
      // Start from the later of range start or month start
      const iterStart = rangeStart > startOfMonth ? rangeStart : startOfMonth;
      // End at the earlier of range end or month end
      const iterEnd = rangeEnd < endOfMonth ? rangeEnd : endOfMonth;
      
      const currentDate = new Date(iterStart);
      
      while (currentDate <= iterEnd) {
        datesInMonth.push({
          date: currentDate.toISOString().split("T")[0],
          dateRangeId: range.id,
          basePricePerDay: range.basePricePerDay,
          totalCapacity: range.totalCapacity,
          availableCount: range.availableCount,
          isActive: range.isActive,
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    return c.json({ success: true, data: datesInMonth });
  } catch (error) {
    console.error("Get F2 dates for month error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to fetch dates for month",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
};

// Get F2 date range details for a specific date
export const getF2DateRangeByDate = async (c: Context) => {
  const { listingId, variantId, date } = c.req.param();

  try {
    const targetDate = new Date(date);

    const dateRange = await prisma.inventoryDateRange.findFirst({
      where: {
        listingId,
        variantId: variantId || null,
        slotDefinitionId: null, // F2 only
        isActive: true,
        availableFromDate: { lte: targetDate },
        availableToDate: { gte: targetDate },
      },
    });

    if (!dateRange) {
      return c.json({ success: false, message: "No date range found for this date" }, 404);
    }

    return c.json({ success: true, data: dateRange });
  } catch (error) {
    console.error("Get F2 date range by date error:", error);
    return c.json({ error: "Failed to fetch date range" }, 500);
  }
};

// Get inventory date range by ID (for booking page)
export const getF2DateRangeById = async (c: Context) => {
  const { id } = c.req.param();

  try {
    const dateRange = await prisma.inventoryDateRange.findUnique({
      where: { id },
      include: {
        listing: {
          select: {
            listingName: true,
            currency: true,
            taxRate: true,
          },
        },
      },
    });

    if (!dateRange) {
      return c.json(
        { success: false, message: "Date range not found" },
        404
      );
    }

    return c.json({ success: true, data: dateRange });
  } catch (error) {
    console.error("Error fetching F2 date range:", error);
    return c.json(
      {
        success: false,
        message: "Failed to fetch date range",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
};

// Block F2 date range (set availableCount to 0)
export const blockF2DateRange = async (c: Context) => {
  try {
    const { dateRangeId } = await c.req.json();

    const updated = await prisma.inventoryDateRange.update({
      where: { id: dateRangeId },
      data: { availableCount: 0 },
    });

    return c.json({ success: true, data: updated });
  } catch (error) {
    console.error("Block F2 date range error:", error);
    return c.json({ error: "Failed to block date range" }, 500);
  }
};

// Unblock F2 date range (restore availableCount to totalCapacity)
export const unblockF2DateRange = async (c: Context) => {
  try {
    const { dateRangeId } = await c.req.json();

    const dateRange = await prisma.inventoryDateRange.findUnique({
      where: { id: dateRangeId },
    });

    if (!dateRange) {
      return c.json({ error: "Date range not found" }, 404);
    }

    const updated = await prisma.inventoryDateRange.update({
      where: { id: dateRangeId },
      data: { availableCount: dateRange.totalCapacity },
    });

    return c.json({ success: true, data: updated });
  } catch (error) {
    console.error("Unblock F2 date range error:", error);
    return c.json({ error: "Failed to unblock date range" }, 500);
  }
};

// Delete F2 date range
export const deleteF2DateRange = async (c: Context) => {
  try {
    const { dateRangeId } = await c.req.json();

    await prisma.inventoryDateRange.delete({
      where: { id: dateRangeId },
    });

    return c.json({ success: true, message: "Date range deleted" });
  } catch (error) {
    console.error("Delete F2 date range error:", error);
    return c.json({ error: "Failed to delete date range" }, 500);
  }
};

// Update F2 date range
export const updateF2DateRange = async (c: Context) => {
  try {
    const { dateRangeId, basePricePerDay, totalCapacity, availableCount } = await c.req.json();

    const updateData: any = {};
    if (basePricePerDay !== undefined) updateData.basePricePerDay = basePricePerDay;
    if (totalCapacity !== undefined) {
      updateData.totalCapacity = totalCapacity;
      // If availableCount is not provided, update it to match totalCapacity
      if (availableCount === undefined) {
        updateData.availableCount = totalCapacity;
      }
    }
    if (availableCount !== undefined) updateData.availableCount = availableCount;

    const updated = await prisma.inventoryDateRange.update({
      where: { id: dateRangeId },
      data: updateData,
    });

    return c.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update F2 date range error:", error);
    return c.json({ error: "Failed to update date range" }, 500);
  }
};
