import type { Context } from "hono";
import { prisma } from "../db.js";
import { z } from "zod";

// Validation schema for inclusions/exclusions
const inclusionExclusionSchema = z.object({
  listingId: z.string().uuid("Invalid listing ID"),
  inclusions: z.array(z.string()).optional().default([]),
  exclusions: z.array(z.string()).optional().default([]),
});

/**
 * Get inclusions/exclusions for a listing
 */
export const getListingInclusionsExclusions = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const item = await prisma.listingInclusionExclusion.findUnique({
      where: { listingId },
    });

    if (!item) {
      return c.json({
        success: true,
        data: { inclusions: [], exclusions: [] },
      });
    }

    return c.json({
      success: true,
      data: item,
    });
  } catch (error) {
    console.error("Get listing inclusions/exclusions error:", error);
    return c.json({ error: "Failed to fetch inclusions/exclusions" }, 500);
  }
};

/**
 * Create or update listing inclusions/exclusions
 */
export const upsertListingInclusionsExclusions = async (c: Context) => {
  try {
    const body = await c.req.json();
    const validatedData = inclusionExclusionSchema.parse(body);

    // Check if listing exists
    const listing = await prisma.listing.findUnique({
      where: { id: validatedData.listingId },
    });

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    // Upsert inclusions/exclusions
    const item = await prisma.listingInclusionExclusion.upsert({
      where: { listingId: validatedData.listingId },
      create: {
        listingId: validatedData.listingId,
        inclusions: validatedData.inclusions,
        exclusions: validatedData.exclusions,
      },
      update: {
        inclusions: validatedData.inclusions,
        exclusions: validatedData.exclusions,
      },
    });

    return c.json(
      {
        success: true,
        message: "Inclusions/Exclusions saved successfully",
        data: item,
      },
      200
    );
  } catch (error: any) {
    console.error("Upsert listing inclusions/exclusions error:", error);
    if (error.name === "ZodError") {
      return c.json({ error: "Validation error", details: error.errors }, 400);
    }
    return c.json({ error: "Failed to save inclusions/exclusions" }, 500);
  }
};

/**
 * Delete listing inclusions/exclusions
 */
export const deleteListingInclusionsExclusions = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const existingItem = await prisma.listingInclusionExclusion.findUnique({
      where: { listingId },
    });

    if (!existingItem) {
      return c.json({ error: "Inclusions/Exclusions not found" }, 404);
    }

    await prisma.listingInclusionExclusion.delete({
      where: { listingId },
    });

    return c.json({
      success: true,
      message: "Inclusions/Exclusions deleted successfully",
    });
  } catch (error) {
    console.error("Delete listing inclusions/exclusions error:", error);
    return c.json({ error: "Failed to delete inclusions/exclusions" }, 500);
  }
};
