import type { Context } from "hono";
import { prisma } from "../db.js";
import { sanitizeString } from "../helpers/validation.helper.js";

export interface CreateListingTypeRequest {
  name: string;
  description?: string;
  displayOrder?: number;
}

export interface UpdateListingTypeRequest {
  name?: string;
  description?: string;
  displayOrder?: number;
}

/**
 * Get all listing types
 */
export const getListingTypes = async (c: Context) => {
  try {
    const listingTypes = await prisma.listingType.findMany({
      orderBy: { displayOrder: "asc" },
      include: {
        categories: {
          where: { isActive: true },
          select: {
            id: true,
            categoryName: true,
            categorySlug: true,
            bookingFormat: true,
            displayOrder: true,
            isActive: true,
            subCategories: {
              where: { isActive: true },
              select: {
                id: true,
                subCatName: true,
                subCatSlug: true,
                displayOrder: true,
                isActive: true,
              },
              orderBy: { displayOrder: "asc" },
            },
          },
          orderBy: { displayOrder: "asc" },
        },
      },
    });

    return c.json({
      success: true,
      data: listingTypes,
      count: listingTypes.length,
    });
  } catch (error) {
    console.error("Get listing types error:", error);
    return c.json({ error: "Failed to fetch listing types" }, 500);
  }
};

/**
 * Get a single listing type by ID
 */
export const getListingType = async (c: Context) => {
  try {
    const listingTypeId = c.req.param("id");

    if (!listingTypeId) {
      return c.json({ error: "Listing type ID is required" }, 400);
    }

    const listingType = await prisma.listingType.findUnique({
      where: { id: listingTypeId },
      include: {
        categories: {
          select: {
            id: true,
            categoryName: true,
            categorySlug: true,
            bookingFormat: true,
            isActive: true,
          },
        },
      },
    });

    if (!listingType) {
      return c.json({ error: "Listing type not found" }, 404);
    }

    return c.json({
      success: true,
      data: listingType,
    });
  } catch (error) {
    console.error("Get listing type error:", error);
    return c.json({ error: "Failed to fetch listing type" }, 500);
  }
};

/**
 * Create a new listing type
 */
export const createListingType = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CreateListingTypeRequest;

    // Validate required fields
    if (!body.name || !body.name.trim()) {
      return c.json({ error: "Name is required" }, 400);
    }

    // Check if listing type with same name already exists
    const existingListingType = await prisma.listingType.findUnique({
      where: { name: body.name.trim() },
    });

    if (existingListingType) {
      return c.json({ 
        error: "Listing type with this name already exists" 
      }, 409);
    }

    // Sanitize inputs
    const sanitizedData = {
      name: sanitizeString(body.name, 100),
      description: body.description ? sanitizeString(body.description, 500) : null,
      displayOrder: body.displayOrder || 0,
    };

    const newListingType = await prisma.listingType.create({
      data: sanitizedData,
    });

    return c.json(
      {
        success: true,
        message: "Listing type created successfully",
        data: newListingType,
      },
      201
    );
  } catch (error) {
    console.error("Create listing type error:", error);
    return c.json({ error: "Failed to create listing type" }, 500);
  }
};

/**
 * Update a listing type
 */
export const updateListingType = async (c: Context) => {
  try {
    const listingTypeId = c.req.param("id");
    const body = (await c.req.json()) as UpdateListingTypeRequest;

    if (!listingTypeId) {
      return c.json({ error: "Listing type ID is required" }, 400);
    }

    // Check if listing type exists
    const existingListingType = await prisma.listingType.findUnique({
      where: { id: listingTypeId },
    });

    if (!existingListingType) {
      return c.json({ error: "Listing type not found" }, 404);
    }

    // If updating name, check for duplicates
    if (body.name && body.name.trim() !== existingListingType.name) {
      const duplicateListingType = await prisma.listingType.findUnique({
        where: { name: body.name.trim() },
      });

      if (duplicateListingType) {
        return c.json({ 
          error: "Listing type with this name already exists" 
        }, 409);
      }
    }

    // Prepare update data
    const updateData: any = {};

    if (body.name !== undefined) {
      updateData.name = sanitizeString(body.name, 100);
    }
    if (body.description !== undefined) {
      updateData.description = body.description ? sanitizeString(body.description, 500) : null;
    }
    if (body.displayOrder !== undefined) {
      updateData.displayOrder = body.displayOrder;
    }

    const updatedListingType = await prisma.listingType.update({
      where: { id: listingTypeId },
      data: updateData,
      include: {
        categories: {
          select: {
            id: true,
            categoryName: true,
            categorySlug: true,
          },
        },
      },
    });

    return c.json({
      success: true,
      message: "Listing type updated successfully",
      data: updatedListingType,
    });
  } catch (error) {
    console.error("Update listing type error:", error);
    return c.json({ error: "Failed to update listing type" }, 500);
  }
};

/**
 * Delete a listing type
 */
export const deleteListingType = async (c: Context) => {
  try {
    const listingTypeId = c.req.param("id");

    if (!listingTypeId) {
      return c.json({ error: "Listing type ID is required" }, 400);
    }

    // Check if listing type exists
    const existingListingType = await prisma.listingType.findUnique({
      where: { id: listingTypeId },
      include: {
        categories: true,
      },
    });

    if (!existingListingType) {
      return c.json({ error: "Listing type not found" }, 404);
    }

    // Check if there are categories using this listing type
    if (existingListingType.categories && existingListingType.categories.length > 0) {
      return c.json({ 
        error: `Cannot delete listing type. It is being used by ${existingListingType.categories.length} category/categories.`,
        categoriesCount: existingListingType.categories.length,
      }, 409);
    }

    await prisma.listingType.delete({
      where: { id: listingTypeId },
    });

    return c.json({
      success: true,
      message: "Listing type deleted successfully",
    });
  } catch (error) {
    console.error("Delete listing type error:", error);
    return c.json({ error: "Failed to delete listing type" }, 500);
  }
};
