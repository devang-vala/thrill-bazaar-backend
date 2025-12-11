import type { Context } from "hono";
import { prisma } from "../db.js";
import { z } from "zod";

// Validation schema for addon item
const addonItemSchema = z.object({
  addonName: z.string().min(1, "Addon name is required"),
  addonDescription: z.string().optional(),
  price: z.number().min(0, "Price must be positive"),
  isMandatory: z.boolean().default(false),
  maxQuantity: z.number().int().positive().optional(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

// Validation schema for addons
const addonsSchema = z.object({
  listingId: z.string().uuid("Invalid listing ID"),
  addons: z.array(addonItemSchema).optional().default([]),
});

/**
 * Get addons for a listing
 */
export const getListingAddons = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const addonRecord = await prisma.listingAddon.findUnique({
      where: { listingId },
    });

    if (!addonRecord) {
      return c.json({
        success: true,
        data: { addons: [] },
      });
    }

    return c.json({
      success: true,
      data: addonRecord,
    });
  } catch (error) {
    console.error("Get listing addons error:", error);
    return c.json({ error: "Failed to fetch addons" }, 500);
  }
};

/**
 * Create or update listing addons
 */
export const upsertListingAddons = async (c: Context) => {
  try {
    const body = await c.req.json();
    const validatedData = addonsSchema.parse(body);

    // Check if listing exists
    const listing = await prisma.listing.findUnique({
      where: { id: validatedData.listingId },
    });

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    // Upsert addons
    const addonRecord = await prisma.listingAddon.upsert({
      where: { listingId: validatedData.listingId },
      create: {
        listingId: validatedData.listingId,
        addons: validatedData.addons,
      },
      update: {
        addons: validatedData.addons,
      },
    });

    return c.json(
      {
        success: true,
        message: "Addons saved successfully",
        data: addonRecord,
      },
      200
    );
  } catch (error: any) {
    console.error("Upsert listing addons error:", error);
    if (error.name === "ZodError") {
      return c.json({ error: "Validation error", details: error.errors }, 400);
    }
    return c.json({ error: "Failed to save addons" }, 500);
  }
};

/**
 * Delete listing addons
 */
export const deleteListingAddons = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const existingRecord = await prisma.listingAddon.findUnique({
      where: { listingId },
    });

    if (!existingRecord) {
      return c.json({ error: "Addons not found" }, 404);
    }

    await prisma.listingAddon.delete({
      where: { listingId },
    });

    return c.json({
      success: true,
      message: "Addons deleted successfully",
    });
  } catch (error) {
    console.error("Delete listing addons error:", error);
    return c.json({ error: "Failed to delete addons" }, 500);
  }
};
