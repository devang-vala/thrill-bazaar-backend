import type { Context } from "hono";
import { prisma } from "../db.js";

// Bulk create or update F3 slots in InventoryDateRange
export const bulkCreateOrUpdateF3Slots = async (c: Context) => {
  try {
    const { listingId, variantId, slotDefinitionId, dates, basePrice, totalCapacity } = await c.req.json();
    
    if (!listingId || !slotDefinitionId || !dates || !Array.isArray(dates) || dates.length === 0) {
      return c.json({ error: "Missing required fields or invalid dates array" }, 400);
    }

    if (!basePrice || !totalCapacity) {
      return c.json({ error: "Missing basePrice or totalCapacity" }, 400);
    }

    // Sort dates to get start and end
    const sortedDates = dates.map(d => new Date(d)).sort((a, b) => a.getTime() - b.getTime());
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];

    // Check if a range already exists that overlaps with this range
    const existingSlot = await prisma.inventoryDateRange.findFirst({
      where: {
        listingId,
        variantId: variantId || null,
        slotDefinitionId,
        OR: [
          {
            AND: [
              { availableFromDate: { lte: startDate } },
              { availableToDate: { gte: startDate } },
            ],
          },
          {
            AND: [
              { availableFromDate: { lte: endDate } },
              { availableToDate: { gte: endDate } },
            ],
          },
          {
            AND: [
              { availableFromDate: { gte: startDate } },
              { availableToDate: { lte: endDate } },
            ],
          },
        ],
      },
    });

    let result;
    if (existingSlot) {
      // Update existing slot
      result = await prisma.inventoryDateRange.update({
        where: { id: existingSlot.id },
        data: {
          availableFromDate: startDate,
          availableToDate: endDate,
          basePricePerDay: Number(basePrice),
          totalCapacity: Number(totalCapacity),
          availableCount: Number(totalCapacity),
          isActive: true,
        },
      });
    } else {
      // Create new slot range
      result = await prisma.inventoryDateRange.create({
        data: {
          listingId,
          variantId: variantId || null,
          slotDefinitionId,
          availableFromDate: startDate,
          availableToDate: endDate,
          basePricePerDay: Number(basePrice),
          totalCapacity: Number(totalCapacity),
          availableCount: Number(totalCapacity),
          isActive: true,
        },
      });
    }

    return c.json({ success: true, data: result, count: 1 });
  } catch (error) {
    console.error("Bulk create/update F3 slots error:", error);
    return c.json({ error: "Failed to bulk create/update F3 slots" }, 500);
  }
};

// Get all dates with a specific slot definition for F3
export const getF3DatesBySlotDefinition = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const variantId = c.req.param("variantId");
    const slotDefinitionId = c.req.param("slotDefinitionId");
    
    if (!listingId || !slotDefinitionId) {
      return c.json({ error: "Missing listingId or slotDefinitionId" }, 400);
    }

    const where: any = {
      listingId,
      slotDefinitionId,
    };

    if (variantId) {
      where.variantId = variantId;
    }

    const slots = await prisma.inventoryDateRange.findMany({
      where,
      select: {
        id: true,
        availableFromDate: true,
        availableToDate: true,
        basePricePerDay: true,
        totalCapacity: true,
        availableCount: true,
        isActive: true,
      },
      orderBy: { availableFromDate: "asc" },
    });

    // Get all slot changes (overrides) for these ranges
    const rangeIds = slots.map(s => s.id);
    const slotChanges = await prisma.listingSlotChange.findMany({
      where: {
        inventoryDateRangeId: { in: rangeIds },
        listingId,
      },
      select: {
        inventoryDateRangeId: true,
        date: true,
        price: true,
        totalCapacity: true,
        availableCount: true,
      },
    });

    // Fetch blocked dates for this listing+variant
    const blockedDates = await prisma.inventoryBlockedDate.findMany({
      where: {
        listingId,
        variantId: variantId || null,
      },
      select: {
        blockedDate: true,
      },
    });

    // Create a set of blocked date keys
    const blockedDateSet = new Set<string>();
    blockedDates.forEach(b => {
      blockedDateSet.add(b.blockedDate.toISOString().split('T')[0]);
    });

    // Create a map of overrides by date string
    const overridesMap = new Map<string, any>();
    slotChanges.forEach(change => {
      const dateKey = change.date.toISOString().split('T')[0];
      overridesMap.set(dateKey, {
        price: change.price,
        totalCapacity: change.totalCapacity,
        availableCount: change.availableCount,
        inventoryDateRangeId: change.inventoryDateRangeId,
      });
    });

    // Use a Map to handle potential overlapping ranges - keep the first occurrence
    const datesMap = new Map<string, any>();
    
    slots.forEach((slot) => {
      const startDate = new Date(slot.availableFromDate);
      const endDate = new Date(slot.availableToDate);
      const currentDate = new Date(startDate);
      
      // Generate all dates in range
      while (currentDate <= endDate) {
        const dateKey = currentDate.toISOString().split('T')[0];
        
        // Only add if not already in map (to handle overlapping ranges)
        if (!datesMap.has(dateKey)) {
          const override = overridesMap.get(dateKey);
          const isBlocked = blockedDateSet.has(dateKey);
          
          datesMap.set(dateKey, {
            id: slot.id,
            slotDate: new Date(currentDate),
            basePrice: override ? override.price : slot.basePricePerDay,
            totalCapacity: override ? override.totalCapacity : slot.totalCapacity,
            availableCount: override ? override.availableCount : slot.availableCount,
            isActive: !isBlocked, // Per-date blocking overrides range-level isActive
            hasOverride: !!override,
          });
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    // Convert map to array and sort by date
    const transformedSlots = Array.from(datesMap.values()).sort((a, b) => 
      a.slotDate.getTime() - b.slotDate.getTime()
    );

    return c.json({ success: true, data: transformedSlots });
  } catch (error) {
    console.error("Get F3 dates by slot definition error:", error);
    return c.json({ error: "Failed to fetch dates" }, 500);
  }
};

// Get inventory date range by ID (for booking page)
export const getInventoryDateRangeById = async (c: Context) => {
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
        slotDefinition: {
          select: {
            id: true,
            startTime: true,
            endTime: true,
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
    console.error("Error fetching date range:", error);
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

// Block F3 slot for a specific date using InventoryBlockedDate table
export const blockF3Slot = async (c: Context) => {
  try {
    const { listingId, variantId, blockedDate, slotDefinitionId, createdByOperatorId } = await c.req.json();
    
    if (!listingId || !blockedDate || !createdByOperatorId) {
      return c.json({ error: "Missing required fields: listingId, blockedDate, createdByOperatorId" }, 400);
    }

    const targetDate = new Date(blockedDate);

    // Check if already blocked
    const existing = await prisma.inventoryBlockedDate.findFirst({
      where: {
        listingId,
        variantId: variantId || null,
        blockedDate: targetDate,
      },
    });

    if (existing) {
      return c.json({ success: true, message: "Date already blocked", data: existing });
    }

    // Create blocked date entry
    const block = await prisma.inventoryBlockedDate.create({
      data: {
        listingId,
        variantId: variantId || null,
        blockedDate: targetDate,
        reason: slotDefinitionId ? `Blocked for slot ${slotDefinitionId}` : "Operator blocked",
        createdByOperatorId,
      },
    });

    return c.json({ success: true, data: block });
  } catch (error) {
    console.error("Block F3 slot error:", error);
    return c.json({ error: "Failed to block slot" }, 500);
  }
};

// Unblock F3 slot for a specific date by removing from InventoryBlockedDate table
export const unblockF3Slot = async (c: Context) => {
  try {
    const { listingId, variantId, blockedDate } = await c.req.json();
    
    if (!listingId || !blockedDate) {
      return c.json({ error: "Missing required fields: listingId, blockedDate" }, 400);
    }

    const targetDate = new Date(blockedDate);

    await prisma.inventoryBlockedDate.deleteMany({
      where: {
        listingId,
        variantId: variantId || null,
        blockedDate: targetDate,
      },
    });

    return c.json({ success: true, message: "Date unblocked successfully" });
  } catch (error) {
    console.error("Unblock F3 slot error:", error);
    return c.json({ error: "Failed to unblock slot" }, 500);
  }
};

// Update price or capacity for a specific date (creates override in listing_slot_changes)
export const updateF3SlotDateOverride = async (c: Context) => {
  try {
    const { date, price, totalCapacity, listingId, variantId, slotDefinitionId } = await c.req.json();
    
    if (!date || !listingId || !slotDefinitionId) {
      return c.json({ error: "Missing required fields: date, listingId, or slotDefinitionId" }, 400);
    }

    const targetDate = new Date(date);

    // Find the inventoryDateRange that contains this date
    const inventoryRange = await prisma.inventoryDateRange.findFirst({
      where: {
        listingId,
        variantId: variantId || null,
        slotDefinitionId,
        availableFromDate: { lte: targetDate },
        availableToDate: { gte: targetDate },
        isActive: true,
      },
    });

    if (!inventoryRange) {
      return c.json({ 
        error: "No active inventory date range found for this date. Please create a base range first." 
      }, 404);
    }

    // Check if override already exists for this date
    const existingOverride = await prisma.listingSlotChange.findFirst({
      where: {
        inventoryDateRangeId: inventoryRange.id,
        date: targetDate,
        listingId,
      },
    });

    const updateData: any = {
      triggerType: "seller_update",
    };

    // Only update fields that are provided
    if (price !== undefined) {
      updateData.price = Number(price);
    }
    if (totalCapacity !== undefined) {
      updateData.totalCapacity = Number(totalCapacity);
      updateData.availableCount = Number(totalCapacity);
    }

    if (existingOverride) {
      // Update existing override - only update provided fields
      const updated = await prisma.listingSlotChange.update({
        where: { id: existingOverride.id },
        data: updateData,
      });
      return c.json({ success: true, data: updated, message: "Override updated successfully" });
    } else {
      // Create new override - use provided values or fall back to base range values
      const created = await prisma.listingSlotChange.create({
        data: {
          inventoryDateRangeId: inventoryRange.id,
          listingId,
          variantId: variantId || null,
          date: targetDate,
          price: price !== undefined ? Number(price) : inventoryRange.basePricePerDay,
          totalCapacity: totalCapacity !== undefined ? Number(totalCapacity) : (inventoryRange.totalCapacity || 0),
          availableCount: totalCapacity !== undefined ? Number(totalCapacity) : (inventoryRange.availableCount || 0),
          triggerType: "seller_update",
        },
      });
      return c.json({ success: true, data: created, message: "Override created successfully" });
    }
  } catch (error) {
    console.error("Update F3/F4 slot date override error:", error);
    return c.json({ error: "Failed to update slot date override" }, 500);
  }
};

// Remove override for specific date (revert to base inventory range values)
export const removeF3SlotDateOverride = async (c: Context) => {
  try {
    const { date, listingId, variantId, slotDefinitionId } = await c.req.json();
    
    if (!date || !listingId || !slotDefinitionId) {
      return c.json({ error: "Missing required fields: date, listingId, or slotDefinitionId" }, 400);
    }

    const targetDate = new Date(date);

    // Find the inventoryDateRange that contains this date
    const inventoryRange = await prisma.inventoryDateRange.findFirst({
      where: {
        listingId,
        variantId: variantId || null,
        slotDefinitionId,
        availableFromDate: { lte: targetDate },
        availableToDate: { gte: targetDate },
      },
    });

    if (!inventoryRange) {
      return c.json({ 
        error: "No inventory date range found for this date" 
      }, 404);
    }

    // Delete the override
    const result = await prisma.listingSlotChange.deleteMany({
      where: {
        inventoryDateRangeId: inventoryRange.id,
        date: targetDate,
        listingId,
      },
    });

    if (result.count === 0) {
      return c.json({ success: true, message: "No override found to remove" });
    }

    return c.json({ success: true, message: "Override removed successfully" });
  } catch (error) {
    console.error("Remove F3/F4 slot date override error:", error);
    return c.json({ error: "Failed to remove slot date override" }, 500);
  }
};

// Delete single F3 slot
export const deleteF3Slot = async (c: Context) => {
  try {
    const { id } = await c.req.json();
    if (!id) {
      return c.json({ error: "Missing slot ID" }, 400);
    }
    
    await prisma.inventoryDateRange.delete({
      where: { id },
    });
    
    return c.json({ success: true, message: "F3 slot deleted successfully" });
  } catch (error) {
    console.error("Delete F3 slot error:", error);
    return c.json({ error: "Failed to delete F3 slot" }, 500);
  }
};

// Update single F3 slot
export const updateF3Slot = async (c: Context) => {
  try {
    const { id, date, basePrice, totalCapacity, isActive } = await c.req.json();
    
    if (!id) {
      return c.json({ error: "Missing slot ID" }, 400);
    }

    const updateData: any = {};
    
    if (date) {
      const slotDate = new Date(date);
      updateData.availableFromDate = slotDate;
      updateData.availableToDate = slotDate; // Single day for F3
    }
    
    if (basePrice !== undefined) {
      updateData.basePricePerDay = Number(basePrice);
    }
    
    if (totalCapacity !== undefined) {
      updateData.totalCapacity = Number(totalCapacity);
      updateData.availableCount = Number(totalCapacity); // Reset availableCount
    }
    
    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    const updated = await prisma.inventoryDateRange.update({
      where: { id },
      data: updateData,
    });
    
    return c.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update F3 slot error:", error);
    return c.json({ error: "Failed to update F3 slot" }, 500);
  }
};

// Get all available F3 slots for a specific date (for customer view)
export const getF3SlotsByDate = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const variantId = c.req.param("variantId");
    const dateStr = c.req.param("date");

    if (!listingId || !dateStr) {
      return c.json({ error: "Missing listingId or date" }, 400);
    }

    const targetDate = new Date(dateStr);

    // Check if this date is blocked
    const blockedEntry = await prisma.inventoryBlockedDate.findFirst({
      where: {
        listingId,
        variantId: variantId || undefined,
        blockedDate: targetDate,
      },
    });

    if (blockedEntry) {
      // Date is blocked, return empty slots
      return c.json({ success: true, data: [] });
    }

    const where: any = {
      listingId,
      isActive: true,
      // Check if targetDate falls within the date range
      availableFromDate: {
        lte: targetDate,
      },
      availableToDate: {
        gte: targetDate,
      },
      slotDefinitionId: {
        not: null, // Only F3/F4 slots have slotDefinitionId
      },
    };

    if (variantId) {
      where.variantId = variantId;
    }

    const slots = await prisma.inventoryDateRange.findMany({
      where,
      include: {
        slotDefinition: {
          select: {
            id: true,
            startTime: true,
            endTime: true,
          },
        },
      },
      orderBy: {
        slotDefinition: {
          startTime: "asc",
        },
      },
    });

    // Get slot changes (overrides) for this specific date
    const rangeIds = slots.map(s => s.id);
    const slotChanges = await prisma.listingSlotChange.findMany({
      where: {
        inventoryDateRangeId: { in: rangeIds },
        date: targetDate,
      },
      select: {
        inventoryDateRangeId: true,
        price: true,
        totalCapacity: true,
        availableCount: true,
      },
    });

    // Create a map of overrides by inventoryDateRangeId
    const overridesMap = new Map<string, any>();
    slotChanges.forEach(change => {
      overridesMap.set(change.inventoryDateRangeId!, {
        price: change.price,
        totalCapacity: change.totalCapacity,
        availableCount: change.availableCount,
      });
    });

    // Format response with overrides applied
    const formattedSlots = slots.map((slot) => {
      const override = overridesMap.get(slot.id);
      return {
        id: slot.id,
        slotDefinitionId: slot.slotDefinitionId,
        startTime: slot.slotDefinition?.startTime,
        endTime: slot.slotDefinition?.endTime,
        basePrice: override ? override.price : slot.basePricePerDay,
        totalCapacity: override ? override.totalCapacity : slot.totalCapacity,
        availableCount: override ? override.availableCount : slot.availableCount,
        isActive: slot.isActive,
      };
    });

    return c.json({ success: true, data: formattedSlots });
  } catch (error) {
    console.error("Get F3 slots by date error:", error);
    return c.json({ error: "Failed to fetch slots" }, 500);
  }
};

// Get all dates that have F3 slots for a specific month (for customer view)
export const getF3DatesForMonth = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const variantId = c.req.param("variantId");
    const month = c.req.param("month");

    if (!listingId || !month) {
      return c.json({ error: "Missing listingId or month" }, 400);
    }

    const [year, monthNum] = month.split("-").map(Number);
    const monthStart = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0));
    monthEnd.setMilliseconds(-1);

    const where: any = {
      listingId,
      isActive: true,
      slotDefinitionId: {
        not: null, // Only F3/F4 slots have slotDefinitionId
      },
      // Find all ranges that overlap with this month
      OR: [
        {
          AND: [
            { availableFromDate: { lte: monthEnd } },
            { availableToDate: { gte: monthStart } },
          ],
        },
      ],
    };

    if (variantId) {
      where.variantId = variantId;
    }

    const slots = await prisma.inventoryDateRange.findMany({
      where,
      select: {
        id: true,
        availableFromDate: true,
        availableToDate: true,
      },
      orderBy: { availableFromDate: "asc" },
    });

    // Expand date ranges to individual dates within the requested month
    const datesSet = new Set<string>();
    
    slots.forEach((slot) => {
      const rangeStart = new Date(slot.availableFromDate);
      const rangeEnd = new Date(slot.availableToDate);
      
      // Start from the later of (range start, month start)
      const effectiveStart = rangeStart > monthStart ? rangeStart : monthStart;
      // End at the earlier of (range end, month end)
      const effectiveEnd = rangeEnd < monthEnd ? rangeEnd : monthEnd;
      
      const currentDate = new Date(effectiveStart);
      
      while (currentDate <= effectiveEnd) {
        const year = currentDate.getUTCFullYear();
        const month = String(currentDate.getUTCMonth() + 1).padStart(2, "0");
        const day = String(currentDate.getUTCDate()).padStart(2, "0");
        datesSet.add(`${year}-${month}-${day}`);
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
    });

    // Also include dates that have slot overrides in listingSlotChanges
    const rangeIds = slots.map(s => s.id);
    if (rangeIds.length > 0) {
      const slotChanges = await prisma.listingSlotChange.findMany({
        where: {
          inventoryDateRangeId: { in: rangeIds },
          date: { gte: monthStart, lte: monthEnd },
        },
        select: {
          date: true,
        },
      });

      slotChanges.forEach((change) => {
        const changeDate = new Date(change.date);
        const year = changeDate.getUTCFullYear();
        const month = String(changeDate.getUTCMonth() + 1).padStart(2, "0");
        const day = String(changeDate.getUTCDate()).padStart(2, "0");
        datesSet.add(`${year}-${month}-${day}`);
      });
    }

    // Remove blocked dates from the available dates
    const blockedDates = await prisma.inventoryBlockedDate.findMany({
      where: {
        listingId,
        variantId: variantId || undefined,
        blockedDate: { gte: monthStart, lte: monthEnd },
      },
      select: {
        blockedDate: true,
      },
    });

    blockedDates.forEach((b) => {
      const blockedStr = b.blockedDate.toISOString().split('T')[0];
      datesSet.delete(blockedStr);
    });

    const dates = Array.from(datesSet).sort();

    return c.json({ success: true, data: dates });
  } catch (error) {
    console.error("Get F3 dates for month error:", error);
    return c.json({ error: "Failed to fetch dates" }, 500);
  }
};
