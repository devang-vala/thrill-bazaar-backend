import type { Context } from "hono";
import { prisma } from "../db.js";

// Create a slot definition for a listing's variant (single day slot based)
export const createSlotDefinition = async (c: Context) => {
  const { listingId, variantId, startTime, endTime } = await c.req.json();
  if (!listingId || !startTime || !endTime) {
    return c.json({ error: "listingId, startTime, and endTime are required" }, 400);
  }
  const slotDef = await prisma.slotDefinition.create({
    data: {
      listingId,
      variantId: variantId || null,
      startTime,
      endTime,
      isActive: true,
    },
  });
  return c.json({ success: true, data: slotDef });
};

// Fetch slot definitions for a listing/variant
export const getSlotDefinitions = async (c: Context) => {
  const listingId = c.req.param("listingId");
  const variantId = c.req.param("variantId") || undefined;
  const where: any = { listingId };
  if (variantId) where.variantId = variantId;
  const slotDefs = await prisma.slotDefinition.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });
  return c.json({ success: true, data: slotDefs });
};

// Edit a slot definition by id
export const updateSlotDefinition = async (c: Context) => {
  const { id, startTime, endTime, isActive, variantId } = await c.req.json();
  if (!id) {
    return c.json({ error: "id is required" }, 400);
  }
  const updateData: any = {};
  if (startTime !== undefined) updateData.startTime = startTime;
  if (endTime !== undefined) updateData.endTime = endTime;
  if (isActive !== undefined) updateData.isActive = Boolean(isActive);
  if (variantId !== undefined) updateData.variantId = variantId;
  try {
    const updated = await prisma.slotDefinition.update({
      where: { id },
      data: updateData,
    });
    return c.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update slot definition error:", error);
    return c.json({ error: "Failed to update slot definition" }, 500);
  }
};

// Delete a slot definition by id
export const deleteSlotDefinition = async (c: Context) => {
  const { id } = await c.req.json();
  if (!id) {
    return c.json({ error: "id is required" }, 400);
  }
  await prisma.slotDefinition.delete({ where: { id } });
  return c.json({ success: true });
};
