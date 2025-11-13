import type { Context } from "hono";
import { prisma } from "../db.js";
import { sanitizeString } from "../helpers/validation.helper.js";

/**
 * Get variants for a listing
 */
export const getListingVariants = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const variants = await prisma.listingVariant.findMany({
      where: { listingId },
      orderBy: { variantOrder: "asc" },
    });

    return c.json({
      success: true,
      data: variants,
      count: variants.length,
    });
  } catch (error) {
    console.error("Get listing variants error:", error);
    return c.json({ error: "Failed to fetch variants" }, 500);
  }
};

/**
 * Create listing variant
 */
export const createListingVariant = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const body = await c.req.json();

    const variantData = {
      listingId,
      variantName: sanitizeString(body.variantName, 255),
      variantOrder: body.variantOrder || 0,
    };

    const variant = await prisma.listingVariant.create({
      data: variantData,
    });

    return c.json(
      {
        success: true,
        message: "Variant created successfully",
        data: variant,
      },
      201
    );
  } catch (error) {
    console.error("Create listing variant error:", error);
    return c.json({ error: "Failed to create variant" }, 500);
  }
};

/**
 * Update listing variant
 */
export const updateListingVariant = async (c: Context) => {
  try {
    const variantId = c.req.param("id");
    const body = await c.req.json();

    const updateData: any = {};

    if (body.variantName !== undefined) {
      updateData.variantName = sanitizeString(body.variantName, 255);
    }
    if (body.variantOrder !== undefined) {
      updateData.variantOrder = body.variantOrder;
    }

    const updatedVariant = await prisma.listingVariant.update({
      where: { id: variantId },
      data: updateData,
    });

    return c.json({
      success: true,
      message: "Variant updated successfully",
      data: updatedVariant,
    });
  } catch (error) {
    console.error("Update listing variant error:", error);
    return c.json({ error: "Failed to update variant" }, 500);
  }
};
