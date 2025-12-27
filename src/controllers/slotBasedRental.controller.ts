import type { Context } from "hono";
import { prisma } from "../db.js";
import { format } from "date-fns";

// 1. Get slot definitions for a listing (for F4)
export const getSlotDefinitions = async (c: Context) => {
  const listingId = c.req.param("listingId");
  const variantId = c.req.param("variantId") || null;

  try {
    const slots = await prisma.slotDefinition.findMany({
      where: {
        listingId,
        variantId,
        isActive: true,
      },
      orderBy: { startTime: "asc" },
    });

    return c.json({ success: true, data: slots });
  } catch (error) {
    console.error("Error fetching slot definitions:", error);
    return c.json({ success: false, message: "Failed to fetch slot definitions" }, 500);
  }
};

// 2. Get available date ranges for a specific slot (for F4)
export const getSlotDateRanges = async (c: Context) => {
  const listingId = c.req.param("listingId");
  const variantId = c.req.param("variantId") || null;
  const slotDefinitionId = c.req.param("slotDefinitionId");

  try {
    const dateRanges = await prisma.inventoryDateRange.findMany({
      where: {
        listingId,
        variantId,
        slotDefinitionId,
        isActive: true,
      },
      orderBy: { availableFromDate: "asc" },
    });

    return c.json({ success: true, data: dateRanges });
  } catch (error) {
    console.error("Error fetching slot date ranges:", error);
    return c.json({ success: false, message: "Failed to fetch slot date ranges" }, 500);
  }
};

// 3. Create date range for a slot (for F4)
export const createSlotDateRange = async (c: Context) => {
  try {
    const { listingId, variantId, slotDefinitionId, availableFromDate, availableToDate, basePricePerDay } = await c.req.json();

    // Check for overlapping ranges in the same slot
    await prisma.inventoryDateRange.deleteMany({
      where: {
        listingId,
        variantId,
        slotDefinitionId,
        OR: [
          { availableFromDate: { lte: new Date(availableToDate) }, availableToDate: { gte: new Date(availableFromDate) } },
        ],
      },
    });

    const range = await prisma.inventoryDateRange.create({
      data: {
        listingId,
        variantId,
        slotDefinitionId,
        availableFromDate: new Date(availableFromDate),
        availableToDate: new Date(availableToDate),
        basePricePerDay: Number(basePricePerDay),
      },
    });

    return c.json({ success: true, data: range });
  } catch (error) {
    console.error("Error creating slot date range:", error);
    return c.json({ success: false, message: "Failed to create slot date range" }, 500);
  }
};

// 4. Get slot-based rental availability calendar (for F4)
export const getSlotRentalAvailability = async (c: Context) => {
  const listingId = c.req.param("listingId");
  const variantId = c.req.param("variantId") || null;
  const slotDefinitionId = c.req.param("slotDefinitionId");

  try {
    // Fetch date ranges for this slot
    const ranges = await prisma.inventoryDateRange.findMany({
      where: { listingId, variantId, slotDefinitionId },
      orderBy: { availableFromDate: "asc" },
    });

    // Build calendar
    const calendar: Record<string, { price: number, available: boolean, source: string }> = {};
    
    // Fill from date ranges
    for (const range of ranges) {
      let currentDate = new Date(range.availableFromDate);
      const endDate = new Date(range.availableToDate);
      
      while (currentDate <= endDate) {
        const dateStr = format(currentDate, "yyyy-MM-dd");
        calendar[dateStr] = { 
          price: range.basePricePerDay, 
          available: true, 
          source: "range" 
        };
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    return c.json({ success: true, data: calendar });
  } catch (error) {
    console.error("Error fetching slot rental availability:", error);
    return c.json({ success: false, message: "Failed to fetch slot rental availability" }, 500);
  }
};

// 5. Update slot date range
export const updateSlotDateRange = async (c: Context) => {
  try {
    const rangeId = c.req.param("rangeId");
    const { availableFromDate, availableToDate, basePricePerDay } = await c.req.json();

    const updatedRange = await prisma.inventoryDateRange.update({
      where: { id: rangeId },
      data: {
        availableFromDate: new Date(availableFromDate),
        availableToDate: new Date(availableToDate),
        basePricePerDay: Number(basePricePerDay),
      },
    });

    return c.json({ success: true, data: updatedRange });
  } catch (error) {
    console.error("Error updating slot date range:", error);
    return c.json({ success: false, message: "Failed to update slot date range" }, 500);
  }
};

// 6. Delete slot date range
export const deleteSlotDateRange = async (c: Context) => {
  try {
    const rangeId = c.req.param("rangeId");

    await prisma.inventoryDateRange.delete({
      where: { id: rangeId },
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting slot date range:", error);
    return c.json({ success: false, message: "Failed to delete slot date range" }, 500);
  }
};