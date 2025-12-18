import type { Context } from "hono";
import { prisma } from "../db.js";

// 1. Fetch slot definitions for a listing + variant
export const getSlotDefinitions = async (c: Context) => {
  const { listingId, variantId } = c.req.param();
  const where: any = { listingId };
  if (variantId) where.variantId = variantId;
  const slots = await prisma.listingSlot.findMany({
    where,
    orderBy: { batchStartTime: "asc" },
  });
  return c.json({ success: true, data: slots });
};

// 2. Create/update slot definitions
export const upsertSlotDefinition = async (c: Context) => {
  const body = await c.req.json();
  // Accepts array or single object
  const slots = Array.isArray(body) ? body : [body];
  const results = [];
  for (const slot of slots) {
    const { id, ...data } = slot;
    let result;
    if (id) {
      result = await prisma.listingSlot.update({ where: { id }, data });
    } else {
      result = await prisma.listingSlot.create({ data });
    }
    results.push(result);
  }
  return c.json({ success: true, data: results });
};

// 3. Fetch slot availability for a given month
export const getSlotAvailability = async (c: Context) => {
  try {
    const params = c.req.param();
    const listingId = params.listingId;
    const variantId = params.variantId; // Will be undefined if not provided
    const month = params.month;
    
    if (!listingId || !month) {
      return c.json({ error: "listingId and month are required" }, 400);
    }
    
    // month: YYYY-MM
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    
    const where: any = {
      listingId,
      batchStartDate: { gte: start, lt: end },
      isActive: true, // Only return active slots
    };
    
    if (variantId) {
      where.variantId = variantId;
    }
    
    const slots = await prisma.listingSlot.findMany({ 
      where,
      orderBy: { batchStartDate: 'asc' }
    });
    
    return c.json({ success: true, data: slots });
  } catch (error) {
    console.error('Error fetching slot availability:', error);
    return c.json({ error: 'Failed to fetch slot availability' }, 500);
  }
};

// 4. Create/update slot inventory for one or multiple dates
export const upsertSlotInventory = async (c: Context) => {
  try {
    const body = await c.req.json();
    // Accepts array or single object
    const inventories = Array.isArray(body) ? body : [body];
    const results = [];
    for (const inv of inventories) {
      const { id, ...data } = inv;
      
      // Convert date strings to DateTime if needed
      if (data.batchStartDate && typeof data.batchStartDate === 'string') {
        data.batchStartDate = new Date(data.batchStartDate);
      }
      if (data.batchEndDate && typeof data.batchEndDate === 'string') {
        data.batchEndDate = new Date(data.batchEndDate);
      }
      if (data.batchStartTime && typeof data.batchStartTime === 'string') {
        data.batchStartTime = new Date(data.batchStartTime);
      }
      if (data.batchEndTime && typeof data.batchEndTime === 'string') {
        data.batchEndTime = new Date(data.batchEndTime);
      }
      
      let result;
      if (id) {
        result = await prisma.listingSlot.update({ where: { id }, data });
      } else {
        result = await prisma.listingSlot.create({ data });
      }
      results.push(result);
    }
    return c.json({ success: true, data: results });
  } catch (error) {
    console.error('Error upserting slot inventory:', error);
    return c.json({ error: 'Failed to upsert slot inventory' }, 500);
  }
};

// 5. Block/unblock entire date or specific slot on a date
export const blockSlotOrDate = async (c: Context) => {
  try {
    const body = await c.req.json();
    const { date, ...rest } = body;
    
    // Convert date string to DateTime
    const blockedDate = date ? new Date(date) : new Date();
    
    const blockData = {
      ...rest,
      blockedDate,
    };
    
    const block = await prisma.inventoryBlockedDate.create({ data: blockData });
    return c.json({ success: true, data: block });
  } catch (error) {
    console.error('Error blocking slot/date:', error);
    return c.json({ error: 'Failed to block date' }, 500);
  }
};

export const unblockSlotOrDate = async (c: Context) => {
  try {
    const { id } = await c.req.json();
    await prisma.inventoryBlockedDate.delete({ where: { id } });
    return c.json({ success: true });
  } catch (error) {
    console.error('Error unblocking slot/date:', error);
    return c.json({ error: 'Failed to unblock date' }, 500);
  }
};
