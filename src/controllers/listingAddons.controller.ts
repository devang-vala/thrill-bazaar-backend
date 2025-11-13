import type { Context } from "hono";
import { prisma } from "../db.js";
import { sanitizeString } from "../helpers/validation.helper.js";

/**
 * Get addons for a listing
 */
export const getListingAddons = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const addons = await prisma.listingAddon.findMany({
      where: { listingId, isActive: true },
      orderBy: [{ isMandatory: "desc" }, { displayOrder: "asc" }],
    });

    return c.json({
      success: true,
      data: addons,
      count: addons.length,
    });
  } catch (error) {
    console.error("Get listing addons error:", error);
    return c.json({ error: "Failed to fetch addons" }, 500);
  }
};

/**
 * Create listing addon
 */
export const createListingAddon = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const body = await c.req.json();

    const addonData = {
      listingId,
      addonName: sanitizeString(body.addonName, 255),
      addonDescription: body.addonDescription
        ? sanitizeString(body.addonDescription, 1000)
        : null,
      price: body.price,
      isMandatory: body.isMandatory || false,
      maxQuantity: body.maxQuantity || null,
      displayOrder: body.displayOrder || 0,
      isActive: body.isActive !== undefined ? body.isActive : true,
    };

    const addon = await prisma.listingAddon.create({
      data: addonData,
    });

    return c.json(
      {
        success: true,
        message: "Addon created successfully",
        data: addon,
      },
      201
    );
  } catch (error) {
    console.error("Create listing addon error:", error);
    return c.json({ error: "Failed to create addon" }, 500);
  }
};

/**
 * Update listing addon
 */
export const updateListingAddon = async (c: Context) => {
  try {
    const addonId = c.req.param("id");
    const body = await c.req.json();

    const updateData: any = {};

    if (body.addonName !== undefined) {
      updateData.addonName = sanitizeString(body.addonName, 255);
    }
    if (body.addonDescription !== undefined) {
      updateData.addonDescription = body.addonDescription
        ? sanitizeString(body.addonDescription, 1000)
        : null;
    }
    if (body.price !== undefined) {
      updateData.price = body.price;
    }
    if (body.isMandatory !== undefined) {
      updateData.isMandatory = body.isMandatory;
    }
    if (body.maxQuantity !== undefined) {
      updateData.maxQuantity = body.maxQuantity;
    }
    if (body.displayOrder !== undefined) {
      updateData.displayOrder = body.displayOrder;
    }
    if (body.isActive !== undefined) {
      updateData.isActive = body.isActive;
    }

    const updatedAddon = await prisma.listingAddon.update({
      where: { id: addonId },
      data: updateData,
    });

    return c.json({
      success: true,
      message: "Addon updated successfully",
      data: updatedAddon,
    });
  } catch (error) {
    console.error("Update listing addon error:", error);
    return c.json({ error: "Failed to update addon" }, 500);
  }
};
