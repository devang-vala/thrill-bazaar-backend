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

// Get variants with batches for a listing (combined endpoint)
export const getVariantsWithBatches = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    
    const variants = await prisma.listingVariant.findMany({
      where: { listingId },
      orderBy: { variantOrder: "asc" },
      include: {
        slots: {
          where: { formatType: "F1" },
          orderBy: { batchStartDate: "asc" },
          include: {
            bookings: {
              where: {
                bookingStatus: {
                  in: ['CONFIRMED', 'COMPLETED']
                }
              },
              select: {
                id: true,
                participantCount: true
              }
            }
          }
        },
      },
    });

    // Transform data to match frontend expectations
    const transformedVariants = variants.map((variant) => ({
      id: variant.id,
      variantName: variant.variantName,
      variantDescription: variant.variantDescription,
      batches: variant.slots.map((slot) => {
        // Calculate actual bookings count from the bookings relation
        const bookingsCount = slot.bookings.length;
        
        return {
          id: slot.id,
          startDate: slot.batchStartDate?.toISOString() || "",
          endDate: slot.batchEndDate?.toISOString() || "",
          batchSize: slot.totalCapacity,
          availableSlots: slot.availableCount,
          bookings: bookingsCount,
          price: slot.basePrice,
          status: slot.isActive ? "ACTIVE" : "PAUSED",
        };
      }),
    }));

    console.log(`[getVariantsWithBatches] Found ${variants.length} variants for listing ${listingId}`);
    return c.json({ success: true, data: transformedVariants });
  } catch (error) {
    console.error("Get variants with batches error:", error);
    return c.json({ success: false, message: "Failed to fetch variants with batches", error: String(error) }, 500);
  }
};

// Get a single batch by ID (for booking page)
export const getBatchById = async (c: Context) => {
  try {
    const batchId = c.req.param("batchId");
    
    if (!batchId) {
      return c.json({ success: false, message: "Batch ID is required" }, 400);
    }
    
    const batch = await prisma.listingSlot.findUnique({
      where: { id: batchId },
      include: {
        slotDefinition: true,
        bookings: {
          where: {
            bookingStatus: {
              in: ['CONFIRMED', 'COMPLETED']
            }
          },
          select: {
            id: true,
            participantCount: true
          }
        }
      }
    });
    
    if (!batch) {
      return c.json({ success: false, message: "Batch not found" }, 404);
    }
    
    // Calculate actual bookings count
    const bookingsCount = batch.bookings.length;
    
    return c.json({ 
      success: true, 
      data: {
        id: batch.id,
        batchStartDate: batch.batchStartDate,
        batchEndDate: batch.batchEndDate,
        basePrice: batch.basePrice,
        totalCapacity: batch.totalCapacity,
        availableCount: batch.availableCount,
        isActive: batch.isActive,
        bookingsCount,
        slotDefinition: batch.slotDefinition
      } 
    });
  } catch (error) {
    console.error("Get batch by ID error:", error);
    return c.json({ success: false, message: "Failed to fetch batch", error: String(error) }, 500);
  }
};

// Get batches for a listing and variant
export const getBatchesForListingVariant = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const variantId = c.req.param("variantId");
    
    // Build where clause - filter for F1 format OR batches with start/end dates
    const where: any = {
      listingId,
      OR: [
        { formatType: "F1" },
        { 
          AND: [
            { batchStartDate: { not: null } },
            { batchEndDate: { not: null } }
          ]
        }
      ]
    };
    
    if (variantId) {
      where.variantId = variantId;
    }
    
    console.log("[DEBUG] Fetching batches with:", { listingId, variantId, where: JSON.stringify(where) });
    
    const batches = await prisma.listingSlot.findMany({
      where,
      orderBy: { batchStartDate: "asc" },
      include: {
        slotDefinition: true, // Include slot definition for time details
      }
    });
    
    console.log(`[DEBUG] Batches found: ${batches.length} batches`);
    console.log("[DEBUG] Batch details:", batches.map(b => ({ 
      id: b.id, 
      variantId: b.variantId, 
      formatType: b.formatType,
      startDate: b.batchStartDate,
      endDate: b.batchEndDate,
      price: b.basePrice,
      capacity: b.totalCapacity,
      available: b.availableCount
    })));
    
    return c.json({ success: true, data: batches });
  } catch (error) {
    console.error("Get batches error:", error);
    return c.json({ success: false, message: "Failed to fetch batches", error: String(error) }, 500);
  }
};

// Create a new batch
export const createBatch = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const variantIdFromParam = c.req.param("variantId");
    const body = await c.req.json();
    const { batchStartDate, batchEndDate, basePrice, totalCapacity, variantId: variantIdFromBody } = body;
    
    // Use variantId from URL param if available, otherwise use from body
    const variantId = variantIdFromParam || variantIdFromBody || null;
    
    if (!batchStartDate || !batchEndDate || !basePrice || !totalCapacity) {
      return c.json({ success: false, message: "Missing required fields" }, 400);
    }
    const batch = await prisma.listingSlot.create({
      data: {
        listingId,
        variantId: variantId,
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

    // If totalCapacity is being updated, recalculate availableCount based on actual bookings
    if (data.totalCapacity !== undefined) {
      // Count confirmed/completed bookings for this batch
      const bookingsCount = await prisma.booking.count({
        where: {
          listingSlotId: batchId,
          bookingStatus: {
            in: ['CONFIRMED', 'COMPLETED']
          }
        }
      });

      // Calculate available count: total capacity - active bookings
      data.availableCount = data.totalCapacity - bookingsCount;

      console.log(`[updateBatch] Batch ${batchId}: totalCapacity=${data.totalCapacity}, bookingsCount=${bookingsCount}, availableCount=${data.availableCount}`);
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

// Get prices for F2 format (day-wise pricing) for a specific month
export const getF2Prices = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const variantId = c.req.param("variantId");
    const month = c.req.query("month"); // Expected format: YYYY-MM

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ success: false, message: "Invalid month format. Use YYYY-MM" }, 400);
    }

    const [year, monthNum] = month.split('-').map(Number);
    // Use UTC to avoid timezone issues
    const startDate = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, monthNum, 0, 23, 59, 59, 999));

    const prices = await prisma.listingSlot.findMany({
      where: {
        listingId,
        variantId: variantId,
        formatType: "F2",
        batchStartDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        batchStartDate: "asc",
      },
    });

    return c.json({ success: true, data: prices });
  } catch (error) {
    console.error("Get F2 prices error:", error);
    return c.json({ success: false, message: "Failed to fetch prices" }, 500);
  }
};

// Create or update F2 price for a specific date
export const setF2Price = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const body = await c.req.json();
    const { variantId, date, price, isActive } = body;

    if (!date || !variantId) {
      return c.json({ success: false, message: "Missing required fields: date, variantId" }, 400);
    }

    // Parse date string (YYYY-MM-DD) to avoid timezone issues
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) {
      return c.json({ success: false, message: "Invalid date format. Use YYYY-MM-DD" }, 400);
    }

    // Create date in UTC to avoid timezone shifts
    const dateObj = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

    // Check if a price already exists for this date
    const existing = await prisma.listingSlot.findFirst({
      where: {
        listingId,
        variantId,
        formatType: "F2",
        batchStartDate: dateObj,
      },
    });

    let result;
    if (existing) {
      // Update existing
      result = await prisma.listingSlot.update({
        where: { id: existing.id },
        data: {
          basePrice: Number(price),
          totalCapacity: 1,
          availableCount: 1,
          isActive: isActive !== undefined ? isActive : true,
        },
      });
    } else {
      // Create new
      result = await prisma.listingSlot.create({
        data: {
          listingId,
          variantId,
          formatType: "F2",
          batchStartDate: dateObj,
          batchEndDate: dateObj,
          basePrice: Number(price),
          totalCapacity: 1,
          availableCount: 1,
          isActive: isActive !== undefined ? isActive : true,
        },
      });
    }

    return c.json({ success: true, data: result }, 201);
  } catch (error) {
    console.error("Set F2 price error:", error);
    return c.json({ success: false, message: "Failed to set price" }, 500);
  }
};
