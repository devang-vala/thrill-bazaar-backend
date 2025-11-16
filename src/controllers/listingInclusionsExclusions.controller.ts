import type { Context } from "hono";
import { prisma } from "../db.js";
import { sanitizeString } from "../helpers/validation.helper.js";

/**
 * Get inclusions/exclusions for a listing
 */
export const getListingInclusionsExclusions = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const { type } = c.req.query();

    const whereClause: any = { listingId };
    if (type && (type === "inclusion" || type === "exclusion")) {
      whereClause.type = type;
    }

    const items = await prisma.listingInclusionExclusion.findMany({
      where: whereClause,
      orderBy: [{ type: "asc" }, { displayOrder: "asc" }],
    });

    return c.json({
      success: true,
      data: items,
      count: items.length,
    });
  } catch (error) {
    console.error("Get listing inclusions/exclusions error:", error);
    return c.json({ error: "Failed to fetch inclusions/exclusions" }, 500);
  }
};

/**
 * Create listing inclusion/exclusion
 */
export const createListingInclusionExclusion = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const body = await c.req.json();

    const itemData = {
      listingId,
      type: body.type,
      description: sanitizeString(body.description, 1000),
      displayOrder: body.displayOrder || 0,
    };

    const item = await prisma.listingInclusionExclusion.create({
      data: itemData,
    });

    return c.json(
      {
        success: true,
        message: "Inclusion/Exclusion created successfully",
        data: item,
      },
      201
    );
  } catch (error) {
    console.error("Create listing inclusion/exclusion error:", error);
    return c.json({ error: "Failed to create inclusion/exclusion" }, 500);
  }
};

/**
 * Update listing inclusion/exclusion
 */
export const updateListingInclusionExclusion = async (c: Context) => {
  try {
    const itemId = c.req.param("id");
    const body = await c.req.json();

    const updateData: any = {};

    if (body.type !== undefined) {
      updateData.type = body.type;
    }
    if (body.description !== undefined) {
      updateData.description = sanitizeString(body.description, 1000);
    }
    if (body.displayOrder !== undefined) {
      updateData.displayOrder = body.displayOrder;
    }

    const updatedItem = await prisma.listingInclusionExclusion.update({
      where: { id: itemId },
      data: updateData,
    });

    return c.json({
      success: true,
      message: "Inclusion/Exclusion updated successfully",
      data: updatedItem,
    });
  } catch (error) {
    console.error("Update listing inclusion/exclusion error:", error);
    return c.json({ error: "Failed to update inclusion/exclusion" }, 500);
  }
};
