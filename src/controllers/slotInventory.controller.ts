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
    const startDate = new Date(year, monthNum - 1, 1); // First day of month
    const endDate = new Date(year, monthNum, 0); // Last day of month

    const where: any = {
      listingId,
      batchStartDate: {
        gte: startDate,
        lte: endDate,
      },
      formatType: "F3",
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
      orderBy: [
        { batchStartDate: "asc" },
        { slotDefinition: { startTime: "asc" } },
      ],
    });

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
import type { Context } from "hono";
import { prisma } from "../db.js";

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
