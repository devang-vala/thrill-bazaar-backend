/* -------------------------------------------------------------------------- */
/*                EDIT OR DELETE A SINGLE ADD-ON BY ID (JSONB)               */
/* -------------------------------------------------------------------------- */
// Edit a single add-on by id
export const editSingleAddon = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const addonId = c.req.param("addonId");
    const body = await c.req.json();
    if (!listingId || !addonId) {
      return c.json({ success: false, message: "listingId and addonId are required" }, 400);
    }
    // Fetch current add-ons
    const record = await prisma.listingAddon.findUnique({ where: { listingId } });
    if (!record) {
      return c.json({ success: false, message: "No add-ons found for this listing" }, 404);
    }
    const addons = Array.isArray(record.addons) ? record.addons : [];
    let found = false;
    const updatedAddons = addons.map((addon: any) => {
      if (addon.id === addonId) {
        found = true;
        return { ...addon, ...body, id: addonId };
      }
      return addon;
    });
    if (!found) {
      return c.json({ success: false, message: "Add-on not found" }, 404);
    }
    const saved = await prisma.listingAddon.update({
      where: { listingId },
      data: { addons: updatedAddons },
    });
    return c.json({ success: true, message: "Add-on updated", data: saved });
  } catch (error) {
    console.error("Edit single add-on error:", error);
    return c.json({ success: false, message: "Failed to update add-on" }, 500);
  }
};

// Delete a single add-on by id
export const deleteSingleAddon = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const addonId = c.req.param("addonId");
    if (!listingId || !addonId) {
      return c.json({ success: false, message: "listingId and addonId are required" }, 400);
    }
    // Fetch current add-ons
    const record = await prisma.listingAddon.findUnique({ where: { listingId } });
    if (!record) {
      return c.json({ success: false, message: "No add-ons found for this listing" }, 404);
    }
    const addons = Array.isArray(record.addons) ? record.addons : [];
    const filteredAddons = addons.filter((addon: any) => addon.id !== addonId);
    if (filteredAddons.length === addons.length) {
      return c.json({ success: false, message: "Add-on not found" }, 404);
    }
    const saved = await prisma.listingAddon.update({
      where: { listingId },
      data: { addons: filteredAddons },
    });
    return c.json({ success: true, message: "Add-on deleted", data: saved });
  } catch (error) {
    console.error("Delete single add-on error:", error);
    return c.json({ success: false, message: "Failed to delete add-on" }, 500);
  }
};
import type { Context } from "hono";
import { prisma } from "../db.js";
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*                              ZOD VALIDATION                                */
/* -------------------------------------------------------------------------- */

const addonItemSchema = z.object({
  id: z.string().uuid().optional(),
  addonName: z.string().min(1),
  addonDescription: z.string().optional(),
  price: z.number().min(0),
  isMandatory: z.boolean().optional().default(false),
  maxQuantity: z.number().int().positive().optional(),
  displayOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

const addonsSchema = z.object({
  addons: z.array(addonItemSchema).default([]),
});

/* -------------------------------------------------------------------------- */
/*                         GET ADDONS FOR A LISTING                           */
/* -------------------------------------------------------------------------- */
export const getListingAddons = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const record = await prisma.listingAddon.findUnique({
      where: { listingId },
    });

    if (!record) {
      return c.json({
        success: true,
        data: { addons: [] },
      });
    }

    return c.json({
      success: true,
      data: record,
    });
  } catch (error) {
    console.error("Get addons error:", error);
    return c.json({ success: false, message: "Failed to fetch addons" }, 500);
  }
};

/* -------------------------------------------------------------------------- */
/*                       CREATE OR UPDATE LISTING ADDONS                      */
/* -------------------------------------------------------------------------- */

// Helper to generate UUID (Node 18+)
function generateUUID() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : require('crypto').randomUUID();
}

export const upsertListingAddons = async (c: Context) => {
  try {
    const body = await c.req.json();

    const listingId = body.listingId || c.req.param("listingId");
    if (!listingId) {
      return c.json({ success: false, message: "listingId is required" }, 400);
    }

    const parsed = addonsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
        success: false,
        message: "Validation error",
        errors: parsed.error.issues,
      }, 400);
    }

    // Assign UUID to any add-on missing id
    const newAddons = parsed.data.addons.map(addon => ({
      ...addon,
      id: addon.id && addon.id.length > 0 ? addon.id : generateUUID(),
    }));

    // Replace existing addons with new ones (not merge)
    const saved = await prisma.listingAddon.upsert({
      where: { listingId },
      create: {
        listingId,
        addons: newAddons,
      },
      update: {
        addons: newAddons,
      },
    });

    // Update listing status to pending_approval when addons are saved
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: "pending_approval" }
    });

    return c.json({
      success: true,
      message: "Addons updated successfully and listing set to pending approval",
      data: saved,
    });
  } catch (error) {
    console.error("Upsert addons error:", error);
    return c.json({ success: false, message: "Failed to save addons" }, 500);
  }
};


/* -------------------------------------------------------------------------- */
/*                            DELETE LISTING ADDONS                            */
/* -------------------------------------------------------------------------- */
export const deleteListingAddons = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const exists = await prisma.listingAddon.findUnique({
      where: { listingId },
    });

    if (!exists) {
      return c.json({ success: false, message: "No addons found" }, 404);
    }

    await prisma.listingAddon.delete({
      where: { listingId },
    });

    return c.json({
      success: true,
      message: "Addons deleted successfully",
    });
  } catch (error) {
    console.error("Delete addons error:", error);
    return c.json({ success: false, message: "Failed to delete addons" }, 500);
  }
};
