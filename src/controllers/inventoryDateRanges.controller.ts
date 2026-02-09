import type { Context } from "hono";
import { prisma } from "../db.js";

export const createInventoryDateRange = async (c: Context) => {
  try {
    const body = await c.req.json();
    
    const rangeData = {
      listingId: body.listingId,
      variantId: body.variantId || null,
      slotDefinitionId: body.slotDefinitionId || null,
      availableFromDate: new Date(body.availableFromDate),
      availableToDate:  new Date(body.availableToDate),
      basePricePerDay: parseFloat(body.basePricePerDay),
      totalCapacity: body.totalCapacity || 1,
      availableCount: body.availableCount || body.totalCapacity || 1,
      primaryContactPhone: body.primaryContactPhone,
      secondaryContactPhone: body.secondaryContactPhone || null,
      isActive: true,
    };

    const range = await prisma.inventoryDateRange.create({
      data: rangeData,
    });

    return c.json({
      success: true,
      data: range,
    }, 201);
  } catch (error) {
    console.error("Create inventory date range error:", error);
    return c.json({ error: "Failed to create date range" }, 500);
  }
};

export const getInventoryDateRanges = async (c: Context) => {
  const listingId = c.req.param("listingId");
  
  const ranges = await prisma.inventoryDateRange.findMany({
    where: { listingId, isActive: true },
    orderBy: { availableFromDate: "asc" },
  });

  return c.json({
    success: true,
    data: ranges,
  });
};