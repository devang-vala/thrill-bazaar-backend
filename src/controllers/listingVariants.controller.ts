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
 * Get a single variant by ID with full details
 */
export const getListingVariantById = async (c: Context) => {
  try {
    const variantId = c.req.param("id");

    const variant = await prisma.listingVariant.findUnique({
      where: { id: variantId },
      include: {
        listing: {
          select: {
            id: true,
            listingName: true,
            categoryId: true,
            bookingFormat: true,
          },
        },
      },
    });

    if (!variant) {
      return c.json({ error: "Variant not found" }, 404);
    }

    return c.json({
      success: true,
      data:  variant,
    });
  } catch (error) {
    console.error("Get listing variant by ID error:", error);
    return c.json({ error: "Failed to fetch variant" }, 500);
  }
};

/**
 * Create listing variant (enhanced for Cat-A rentals)
 */
export const createListingVariant = async (c: Context) => {
  try {
    const listingId = c.req. param("listingId");
    const body = await c.req.json();

    // Verify listing exists and check if it's a rental category
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        category: {
          select:  {
            id: true,
            hasVariantCatA: true,
            isRental: true,
            bookingFormat: true,
          },
        },
      },
    });

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    const variantData:  any = {
      listingId,
      variantName: sanitizeString(body.variantName, 255),
      variantOrder: body.variantOrder || 0,
    };

    // For Cat-A rentals, store variant-specific metadata
    if (listing.category?. hasVariantCatA && body.variantMetadata) {
      variantData.variantMetadata = body. variantMetadata;
    }

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
    const variantId = c. req.param("id");
    const body = await c.req. json();

    // Check if variant exists
    const existingVariant = await prisma. listingVariant.findUnique({
      where: { id:  variantId },
    });

    if (!existingVariant) {
      return c.json({ error: "Variant not found" }, 404);
    }

    const updateData: any = {};

    if (body.variantName !== undefined) {
      updateData.variantName = sanitizeString(body.variantName, 255);
    }
    if (body.variantOrder !== undefined) {
      updateData.variantOrder = body.variantOrder;
    }
    if (body.variantMetadata !== undefined) {
      updateData. variantMetadata = body.variantMetadata;
    }

    const updatedVariant = await prisma.listingVariant. update({
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

/**
 * Delete listing variant
 */
export const deleteListingVariant = async (c:  Context) => {
  try {
    const variantId = c.req.param("id");

    // Check if variant exists
    const existingVariant = await prisma. listingVariant.findUnique({
      where: { id:  variantId },
    });

    if (!existingVariant) {
      return c.json({ error: "Variant not found" }, 404);
    }

    await prisma.listingVariant. delete({
      where: { id: variantId },
    });

    return c.json({
      success: true,
      message: "Variant deleted successfully",
    });
  } catch (error) {
    console.error("Delete listing variant error:", error);
    return c.json({ error: "Failed to delete variant" }, 500);
  }
};

/**
 * Bulk create variants for a listing (useful for rentals with multiple equipment options)
 */
export const bulkCreateVariants = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const body = await c.req.json();

    if (!body.variants || ! Array.isArray(body.variants) || body.variants.length === 0) {
      return c.json({ error: "variants array is required" }, 400);
    }

    // Verify listing exists
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        category: {
          select: {
            hasVariantCatA: true,
          },
        },
      },
    });

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    const variantsData = body.variants.map((variant: any, index: number) => ({
      listingId,
      variantName: sanitizeString(variant.variantName, 255),
      variantOrder: variant.variantOrder ??  index,
      variantMetadata: listing.category?.hasVariantCatA ?  variant.variantMetadata : null,
    }));

    const createdVariants = await prisma. listingVariant.createMany({
      data: variantsData,
    });

    // Fetch created variants to return
    const variants = await prisma.listingVariant.findMany({
      where: { listingId },
      orderBy: { variantOrder:  "asc" },
    });

    return c.json(
      {
        success: true,
        message: `${createdVariants.count} variants created successfully`,
        data: variants,
      },
      201
    );
  } catch (error) {
    console.error("Bulk create variants error:", error);
    return c.json({ error: "Failed to create variants" }, 500);
  }
};

/**
 * Get variant metadata field definitions for a category (for Cat-A rentals)
 */
export const getVariantFieldsForCategory = async (c: Context) => {
  try {
    const categoryId = c.req.param("categoryId");

    // Check if category exists and has Cat-A variants
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: {
        id: true,
        categoryName: true,
        hasVariantCatA: true,
        isRental: true,
      },
    });

    if (!category) {
      return c.json({ error: "Category not found" }, 404);
    }

    if (!category.hasVariantCatA) {
      return c.json({
        success: true,
        data: [],
        message: "This category does not have Cat-A variant fields",
      });
    }

    // Get variant field definitions for this category
    const fieldDefinitions = await prisma.listingVariantMetadataFieldDefinition.findMany({
      where: {
        categoryId,
        isActive: true,
      },
      include: {
        options: {
          where: { isActive: true },
          orderBy: { displayOrder: "asc" },
        },
      },
      orderBy: { displayOrder: "asc" },
    });

    return c.json({
      success: true,
      data:  fieldDefinitions,
      count:  fieldDefinitions.length,
      category: {
        id: category.id,
        name: category.categoryName,
        hasVariantCatA: category.hasVariantCatA,
        isRental: category. isRental,
      },
    });
  } catch (error) {
    console.error("Get variant fields for category error:", error);
    return c.json({ error: "Failed to fetch variant fields" }, 500);
  }
};