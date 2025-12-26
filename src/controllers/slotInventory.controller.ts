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
    // Set both start and end date to the selected date (single day)
    const batchDate = new Date(date);
    const slot = await prisma.listingSlot.create({
      data: {
        listingId,
        variantId: variantId || null,
        slotDefinitionId,
        batchStartDate: batchDate,
        batchEndDate: batchDate,
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
