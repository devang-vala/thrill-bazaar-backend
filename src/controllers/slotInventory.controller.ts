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
  const { listingId, variantId, month } = c.req.param();
  // month: YYYY-MM
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const where: any = {
    listingId,
    batchStartDate: { gte: start, lt: end },
  };
  if (variantId) where.variantId = variantId;
  const slots = await prisma.listingSlot.findMany({ where });
  return c.json({ success: true, data: slots });
};

// 4. Create/update slot inventory for one or multiple dates
export const upsertSlotInventory = async (c: Context) => {
  const body = await c.req.json();
  // Accepts array or single object
  const inventories = Array.isArray(body) ? body : [body];
  const results = [];
  for (const inv of inventories) {
    const { id, ...data } = inv;
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

// 5. Block/unblock entire date or specific slot on a date
export const blockSlotOrDate = async (c: Context) => {
  const body = await c.req.json();
  // { listingId, variantId, slotId, date, reason }
  const block = await prisma.inventoryBlockedDate.create({ data: body });
  return c.json({ success: true, data: block });
};

export const unblockSlotOrDate = async (c: Context) => {
  const { id } = await c.req.json();
  await prisma.inventoryBlockedDate.delete({ where: { id } });
  return c.json({ success: true });
};
