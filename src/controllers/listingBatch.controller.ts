import type { Context } from "hono";
import { prisma } from "../db.js";

// Get variants for a listing (for batch management)
export const getVariantsForListing = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const variants = await prisma.listingVariant.findMany({
      where: { listingId },
      orderBy: { variantOrder: "asc" },
    });
    return c.json({ success: true, data: variants || [] });
  } catch (error) {
    console.error("Get batch variants error:", error);
    return c.json({ success: false, message: "Failed to fetch variants" }, 500);
  }
};

// Get batches for a listing and variant
export const getBatchesForListingVariant = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const variantId = c.req.param("variantId");
    const where: any = { listingId, formatType: "F1" };
    if (variantId) where.variantId = variantId;
    console.log("[DEBUG] Fetching batches with:", { listingId, variantId, where });
    const batches = await prisma.listingSlot.findMany({
      where,
      orderBy: { batchStartDate: "asc" },
    });
    console.log("[DEBUG] Batches found:", batches);
    return c.json({ success: true, data: batches });
  } catch (error) {
    console.error("Get batches error:", error);
    return c.json({ success: false, message: "Failed to fetch batches" }, 500);
  }
};

// Create a new batch
export const createBatch = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const variantId = c.req.param("variantId");
    const body = await c.req.json();
    const { batchStartDate, batchEndDate, basePrice, totalCapacity } = body;
    if (!batchStartDate || !batchEndDate || !basePrice || !totalCapacity) {
      return c.json({ success: false, message: "Missing required fields" }, 400);
    }
    const batch = await prisma.listingSlot.create({
      data: {
        listingId,
        variantId: variantId ?? null,
        formatType: "F1",
        batchStartDate: new Date(batchStartDate),
        batchEndDate: new Date(batchEndDate),
        basePrice: Number(basePrice),
        totalCapacity: Number(totalCapacity),
        availableCount: Number(totalCapacity),
        isActive: true,
      },
    });
    return c.json({ success: true, data: batch }, 201);
  } catch (error) {
    console.error("Create batch error:", error);
    return c.json({ success: false, message: "Failed to create batch" }, 500);
  }
};

// Update a batch
export const updateBatch = async (c: Context) => {
  try {
    const batchId = c.req.param("batchId");
    const body = await c.req.json();
    // Convert date fields to ISO strings if present
    const data: any = { ...body };
    if (data.batchStartDate) {
      data.batchStartDate = new Date(data.batchStartDate).toISOString();
    }
    if (data.batchEndDate) {
      data.batchEndDate = new Date(data.batchEndDate).toISOString();
    }
    const batch = await prisma.listingSlot.update({
      where: { id: batchId },
      data,
    });
    return c.json({ success: true, data: batch });
  } catch (error) {
    console.error("Update batch error:", error);
    return c.json({ success: false, message: "Failed to update batch" }, 500);
  }
};

// Toggle batch active/inactive
export const toggleBatchActive = async (c: Context) => {
  try {
    const batchId = c.req.param("batchId");
    const body = await c.req.json();
    const batch = await prisma.listingSlot.update({
      where: { id: batchId },
      data: { isActive: body.isActive },
    });
    return c.json({ success: true, data: batch });
  } catch (error) {
    console.error("Toggle batch error:", error);
    return c.json({ success: false, message: "Failed to toggle batch" }, 500);
  }
};

// Delete a batch
export const deleteBatch = async (c: Context) => {
  try {
    const batchId = c.req.param("batchId");
    await prisma.listingSlot.delete({ where: { id: batchId } });
    return c.json({ success: true });
  } catch (error) {
    console.error("Delete batch error:", error);
    return c.json({ success: false, message: "Failed to delete batch" }, 500);
  }
};
