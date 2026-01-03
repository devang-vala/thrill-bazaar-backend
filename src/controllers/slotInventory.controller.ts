import type { Context } from "hono";
import { prisma } from "../db.js";

// F3: Delete a single-day slot batch (by id)
export const deleteSingleDaySlotBatch = async (c: Context) => {
  try {
    const { id } = await c.req.json();
    if (!id) {
      return c.json({ error: "Missing slot batch id" }, 400);
    }
    await prisma.listingSlot.delete({ where: { id } });
    return c.json({ success: true });
  } catch (error) {
    console.error("Delete F3 slot batch error:", error);
    return c.json({ error: "Failed to delete slot batch" }, 500);
  }
};

// Block a slot by setting isActive to false
export const blockSlot = async (c: Context) => {
  try {
    const { slotId } = await c.req.json();
    if (!slotId) {
      return c.json({ error: "Missing slotId" }, 400);
    }

    const updated = await prisma.listingSlot.update({
      where: { id: slotId },
      data: { isActive: false },
    });

    return c.json({ success: true, data: updated });
  } catch (error) {
    console.error("Block slot error:", error);
    return c.json({ error: "Failed to block slot" }, 500);
  }
};

// Unblock a slot by setting isActive to true
export const unblockSlot = async (c: Context) => {
  try {
    const { slotId } = await c.req.json();
    if (!slotId) {
      return c.json({ error: "Missing slotId" }, 400);
    }

    const updated = await prisma.listingSlot.update({
      where: { id: slotId },
      data: { isActive: true },
    });

    return c.json({ success: true, data: updated });
  } catch (error) {
    console.error("Unblock slot error:", error);
    return c.json({ error: "Failed to unblock slot" }, 500);
  }
};
// Get slot batches for a listing/variant in a specific month
export const getSlotBatches = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const month = c.req.param("month"); // Expected format: YYYY-MM
    const variantId = c.req.param("variantId"); // Optional

    if (!listingId || !month) {
      return c.json({ error: "Missing listingId or month" }, 400);
    }

    // Parse month and create date range
    const [year, monthNum] = month.split("-").map(Number);
    // Create start of month in UTC to avoid timezone issues
    const startDate = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0));
    // Create end of month in UTC (first day of next month minus 1ms)
    const endDate = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0));
    endDate.setMilliseconds(-1);

    // Query for both F1/F2 (using batchStartDate) and F3 (using slotDate)
    const where: any = {
      listingId,
      OR: [
        {
          batchStartDate: {
            gte: startDate,
            lt: endDate,
          },
        },
        {
          slotDate: {
            gte: startDate,
            lt: endDate,
          },
        },
      ],
    };

    if (variantId) {
      where.variantId = variantId;
    }

    console.log("Fetching slot batches with params:", {
      listingId,
      variantId,
      month,
      startDate,
      endDate,
      where
    });

    const slots = await prisma.listingSlot.findMany({
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
      orderBy: [
        { batchStartDate: "asc" },
        { slotDefinition: { startTime: "asc" } },
      ],
    });

    console.log(`Found ${slots.length} slot batches`);

    return c.json({ success: true, data: slots });
  } catch (error) {
    console.error("Get slot batches error:", error);
    return c.json({ error: "Failed to fetch slot batches" }, 500);
  }
};
// F3: Edit a single-day slot batch (by id)
export const updateSingleDaySlotBatch = async (c: Context) => {
  try {
    const { id, date, basePrice, totalCapacity, isActive, slotDefinitionId } = await c.req.json();
    if (!id) {
      return c.json({ error: "Missing slot batch id" }, 400);
    }
    const updateData: any = {};
    if (date) {
      const batchDate = new Date(date);
      updateData.batchStartDate = batchDate;
      updateData.batchEndDate = batchDate;
    }
    if (basePrice !== undefined) updateData.basePrice = Number(basePrice);
    if (totalCapacity !== undefined) {
      updateData.totalCapacity = Number(totalCapacity);
      updateData.availableCount = Number(totalCapacity); // Optionally reset availableCount
    }
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (slotDefinitionId !== undefined) updateData.slotDefinitionId = slotDefinitionId;

    const updated = await prisma.listingSlot.update({
      where: { id },
      data: updateData,
    });
    return c.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update F3 slot batch error:", error);
    return c.json({ error: "Failed to update slot batch" }, 500);
  }
};

// Get single slot by ID
export const getSlotById = async (c: Context) => {
  try {
    const slotId = c.req.param("slotId");
    
    if (!slotId) {
      return c.json({ error: "Missing slotId" }, 400);
    }

    const slot = await prisma.listingSlot.findUnique({
      where: { id: slotId },
      include: {
        slotDefinition: {
          select: {
            id: true,
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    if (!slot) {
      return c.json({ error: "Slot not found" }, 404);
    }

    return c.json({ success: true, data: slot });
  } catch (error) {
    console.error("Get slot by ID error:", error);
    return c.json({ error: "Failed to fetch slot" }, 500);
  }
};

// Get multiple slots by their IDs (for F4 format)
export const getSlotsByIds = async (c: Context) => {
  try {
    const slotIds = c.req.query("slotIds");
    
    if (!slotIds) {
      return c.json({ error: "Missing slotIds" }, 400);
    }

    const slotIdArray = slotIds.split(",").filter(id => id.trim());
    
    if (slotIdArray.length === 0) {
      return c.json({ error: "No valid slot IDs provided" }, 400);
    }

    const slots = await prisma.listingSlot.findMany({
      where: {
        id: {
          in: slotIdArray,
        },
      },
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

    return c.json({ success: true, data: slots });
  } catch (error) {
    console.error("Get slots by IDs error:", error);
    return c.json({ error: "Failed to fetch slots" }, 500);
  }
};

// Get all dates with a specific slot definition
export const getDatesBySlotDefinition = async (c: Context) => {
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
      formatType: "F3",
    };

    if (variantId) {
      where.variantId = variantId;
    }

    const slots = await prisma.listingSlot.findMany({
      where,
      select: {
        id: true,
        slotDate: true,
        basePrice: true,
        totalCapacity: true,
        availableCount: true,
        isActive: true,
      },
      orderBy: { slotDate: "asc" },
    });

    return c.json({ success: true, data: slots });
  } catch (error) {
    console.error("Get dates by slot definition error:", error);
    return c.json({ error: "Failed to fetch dates" }, 500);
  }
};

// Get all dates that have F3 slots for a specific month (for customer view)
export const getF3DatesForMonth = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const variantId = c.req.param("variantId");
    const month = c.req.param("month"); // Expected format: YYYY-MM

    if (!listingId || !month) {
      return c.json({ error: "Missing listingId or month" }, 400);
    }

    // Parse month and create date range
    const [year, monthNum] = month.split("-").map(Number);
    const startDate = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0));
    endDate.setMilliseconds(-1);

    const where: any = {
      listingId,
      formatType: "F3",
      isActive: true,
      slotDate: {
        gte: startDate,
        lt: endDate,
      },
    };

    if (variantId) {
      where.variantId = variantId;
    }

    const slots = await prisma.listingSlot.findMany({
      where,
      select: {
        slotDate: true,
      },
      distinct: ["slotDate"],
      orderBy: { slotDate: "asc" },
    });

    // Format dates as YYYY-MM-DD
    const dates = slots.map((slot) => {
      const utcDate = new Date(slot.slotDate!);
      const year = utcDate.getUTCFullYear();
      const month = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
      const day = String(utcDate.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    });

    return c.json({ success: true, data: dates });
  } catch (error) {
    console.error("Get F3 dates for month error:", error);
    return c.json({ error: "Failed to fetch dates" }, 500);
  }
};

// Get all available slots for a specific date (for customer view)
export const getF3SlotsByDate = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const variantId = c.req.param("variantId");
    const dateStr = c.req.param("date"); // Expected format: YYYY-MM-DD

    if (!listingId || !dateStr) {
      return c.json({ error: "Missing listingId or date" }, 400);
    }

    // Parse date
    const [year, month, day] = dateStr.split("-").map(Number);
    const targetDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

    const where: any = {
      listingId,
      formatType: "F3",
      isActive: true,
      slotDate: targetDate,
      availableCount: {
        gt: 0,
      },
    };

    if (variantId) {
      where.variantId = variantId;
    }

    const slots = await prisma.listingSlot.findMany({
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

    // Format response
    const formattedSlots = slots.map((slot) => ({
      id: slot.id,
      slotDefinitionId: slot.slotDefinitionId,
      startTime: slot.slotDefinition?.startTime || slot.startTime,
      endTime: slot.slotDefinition?.endTime || slot.endTime,
      basePrice: slot.basePrice,
      totalCapacity: slot.totalCapacity,
      availableCount: slot.availableCount,
      isActive: slot.isActive,
    }));

    return c.json({ success: true, data: formattedSlots });
  } catch (error) {
    console.error("Get F3 slots by date error:", error);
    return c.json({ error: "Failed to fetch slots" }, 500);
  }
};

// Bulk create or update slots for multiple dates
export const bulkCreateOrUpdateSlots = async (c: Context) => {
  try {
    const { listingId, variantId, slotDefinitionId, dates, basePrice, totalCapacity } = await c.req.json();
    
    if (!listingId || !slotDefinitionId || !dates || !Array.isArray(dates) || dates.length === 0) {
      return c.json({ error: "Missing required fields or invalid dates array" }, 400);
    }

    if (!basePrice || !totalCapacity) {
      return c.json({ error: "Missing basePrice or totalCapacity" }, 400);
    }

    // Get slot definition to fetch start and end times
    const slotDefinition = await prisma.slotDefinition.findUnique({
      where: { id: slotDefinitionId },
      select: { startTime: true, endTime: true },
    });

    if (!slotDefinition) {
      return c.json({ error: "Slot definition not found" }, 404);
    }

    const results = await Promise.all(
      dates.map(async (dateStr: string) => {
        const batchDate = new Date(dateStr);
        
        // Check if slot already exists for this date
        const existingSlot = await prisma.listingSlot.findFirst({
          where: {
            listingId,
            variantId: variantId || null,
            slotDefinitionId,
            slotDate: batchDate,
          },
        });

        if (existingSlot) {
          // Update existing slot
          return await prisma.listingSlot.update({
            where: { id: existingSlot.id },
            data: {
              basePrice: Number(basePrice),
              totalCapacity: Number(totalCapacity),
              availableCount: Number(totalCapacity),
              isActive: true,
            },
          });
        } else {
          // Create new slot
          return await prisma.listingSlot.create({
            data: {
              listingId,
              variantId: variantId || null,
              slotDefinitionId,
              slotDate: batchDate,
              startTime: slotDefinition.startTime,
              endTime: slotDefinition.endTime,
              basePrice: Number(basePrice),
              totalCapacity: Number(totalCapacity),
              availableCount: Number(totalCapacity),
              isActive: true,
              formatType: "F3",
            },
          });
        }
      })
    );

    return c.json({ success: true, data: results, count: results.length });
  } catch (error) {
    console.error("Bulk create/update slots error:", error);
    return c.json({ error: "Failed to bulk create/update slots" }, 500);
  }
};

// F3: Create a single-day slot batch (slotDefinitionId, date, price, capacity)
export const createSingleDaySlotBatch = async (c: Context) => {
  try {
    const { listingId, variantId, slotDefinitionId, date, basePrice, totalCapacity } = await c.req.json();
    if (!listingId || !slotDefinitionId || !date || !basePrice || !totalCapacity) {
      return c.json({ error: "Missing required fields" }, 400);
    }
    
    // Get slot definition to fetch start and end times
    const slotDefinition = await prisma.slotDefinition.findUnique({
      where: { id: slotDefinitionId },
      select: { startTime: true, endTime: true }
    });
    
    if (!slotDefinition) {
      return c.json({ error: "Slot definition not found" }, 404);
    }
    
    // Set both start and end date to the selected date (single day)
    const batchDate = new Date(date);
    const slot = await prisma.listingSlot.create({
      data: {
        listingId,
        variantId: variantId || null,
        slotDefinitionId,
        slotDate: batchDate, // For F3, use slotDate instead of batch dates
        startTime: slotDefinition.startTime, // Store the actual times
        endTime: slotDefinition.endTime,
        basePrice: Number(basePrice),
        totalCapacity: Number(totalCapacity),
        availableCount: Number(totalCapacity),
        isActive: true,
        formatType: "F3",
      },
    });
    return c.json({ success: true, data: slot });
  } catch (error) {
    console.error("Create F3 slot batch error:", error);
    return c.json({ error: "Failed to create slot batch" }, 500);
  }
};
