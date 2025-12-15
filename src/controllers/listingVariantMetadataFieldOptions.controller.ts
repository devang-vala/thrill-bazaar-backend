import type { Context } from "hono";
import { prisma } from "../db.js";
import {
  sanitizeString,
} from "../helpers/validation.helper.js";

export interface CreateVariantFieldOptionRequest {
  variantFieldDefinitionId: string;
  optionValue: string;
  optionLabel: string;
  optionDescription?: string;
  displayOrder?: number;
}

export interface UpdateVariantFieldOptionRequest {
  variantFieldDefinitionId?: string;
  optionValue?: string;
  optionLabel?: string;
  optionDescription?: string;
  displayOrder?: number;
}

/**
 * Get all variant field options, optionally filtered by variantFieldDefinitionId
 */
export const getVariantFieldOptions = async (c: Context) => {
  try {
    const { variantFieldDefinitionId, categoryId } = c.req.query();

    const whereClause: any = {};
    
    if (variantFieldDefinitionId) {
      whereClause.variantFieldDefinitionId = variantFieldDefinitionId;
    }

    // If categoryId is provided, filter by category through field definition
    if (categoryId) {
      whereClause.variantFieldDefinition = {
        categoryId: categoryId,
      };
    }

    const variantFieldOptions = await prisma.listingVariantMetadataFieldOptions.findMany({
      where: whereClause,
      include: {
        variantFieldDefinition: {
          select: {
            id: true,
            fieldKey: true,
            fieldLabel: true,
            fieldType: true,
            category: {
              select: {
                id: true,
                categoryName: true,
                categorySlug: true,
              },
            },
          },
        },
      },
      orderBy: { displayOrder: "asc" },
    });

    return c.json({
      success: true,
      data: variantFieldOptions,
      count: variantFieldOptions.length,
    });
  } catch (error) {
    console.error("Get variant field options error:", error);
    return c.json({ error: "Failed to fetch variant field options" }, 500);
  }
};

/**
 * Create a new variant field option
 */
export const createVariantFieldOption = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CreateVariantFieldOptionRequest;

    // Basic validation
    if (!body.variantFieldDefinitionId || !body.optionValue || !body.optionLabel) {
      return c.json({ 
        error: "variantFieldDefinitionId, optionValue, and optionLabel are required" 
      }, 400);
    }

    // Check if variant field definition exists
    const variantFieldDefinition = await prisma.listingVariantMetadataFieldDefinition.findUnique({
      where: { id: body.variantFieldDefinitionId },
    });

    if (!variantFieldDefinition) {
      return c.json({ error: "Variant field definition not found" }, 404);
    }

    // Check if option value already exists for this variant field definition
    const existingOption = await prisma.listingVariantMetadataFieldOptions.findUnique({
      where: {
        variantFieldDefinitionId_optionValue: {
          variantFieldDefinitionId: body.variantFieldDefinitionId,
          optionValue: body.optionValue,
        },
      },
    });

    if (existingOption) {
      return c.json({ 
        error: "Option value already exists for this variant field definition" 
      }, 409);
    }

    // Sanitize inputs
    const sanitizedData = {
      variantFieldDefinitionId: body.variantFieldDefinitionId,
      optionValue: sanitizeString(body.optionValue, 255),
      optionLabel: sanitizeString(body.optionLabel, 255),
      optionDescription: body.optionDescription ? sanitizeString(body.optionDescription, 1000) : null,
      displayOrder: body.displayOrder || 0,
    };

    const newVariantFieldOption = await prisma.listingVariantMetadataFieldOptions.create({
      data: sanitizedData,
      include: {
        variantFieldDefinition: {
          select: {
            id: true,
            fieldKey: true,
            fieldLabel: true,
            fieldType: true,
            category: {
              select: {
                id: true,
                categoryName: true,
                categorySlug: true,
              },
            },
          },
        },
      },
    });

    return c.json(
      {
        success: true,
        message: "Variant field option created successfully",
        data: newVariantFieldOption,
      },
      201
    );
  } catch (error) {
    console.error("Create variant field option error:", error);
    return c.json({ error: "Failed to create variant field option" }, 500);
  }
};

/**
 * Update a variant field option
 */
export const updateVariantFieldOption = async (c: Context) => {
  try {
    const variantFieldOptionId = c.req.param("id");
    const body = (await c.req.json()) as UpdateVariantFieldOptionRequest;

    if (!variantFieldOptionId) {
      return c.json({ error: "Variant field option ID is required" }, 400);
    }

    // Check if variant field option exists
    const existingVariantFieldOption = await prisma.listingVariantMetadataFieldOptions.findUnique({
      where: { optionId: variantFieldOptionId },
    });

    if (!existingVariantFieldOption) {
      return c.json({ error: "Variant field option not found" }, 404);
    }

    // If updating variantFieldDefinitionId, check if variant field definition exists
    if (body.variantFieldDefinitionId && body.variantFieldDefinitionId !== existingVariantFieldOption.variantFieldDefinitionId) {
      const variantFieldDefinition = await prisma.listingVariantMetadataFieldDefinition.findUnique({
        where: { id: body.variantFieldDefinitionId },
      });

      if (!variantFieldDefinition) {
        return c.json({ error: "Variant field definition not found" }, 404);
      }
    }

    // If updating optionValue, check for uniqueness within the variant field definition
    if (body.optionValue && body.optionValue !== existingVariantFieldOption.optionValue) {
      const variantFieldDefinitionId = body.variantFieldDefinitionId || existingVariantFieldOption.variantFieldDefinitionId;
      const existingOption = await prisma.listingVariantMetadataFieldOptions.findUnique({
        where: {
          variantFieldDefinitionId_optionValue: {
            variantFieldDefinitionId: variantFieldDefinitionId,
            optionValue: body.optionValue,
          },
        },
      });

      if (existingOption) {
        return c.json({ 
          error: "Option value already exists for this variant field definition" 
        }, 409);
      }
    }

    // Prepare update data
    const updateData: any = {};

    if (body.variantFieldDefinitionId !== undefined) {
      updateData.variantFieldDefinitionId = body.variantFieldDefinitionId;
    }
    if (body.optionValue !== undefined) {
      updateData.optionValue = sanitizeString(body.optionValue, 255);
    }
    if (body.optionLabel !== undefined) {
      updateData.optionLabel = sanitizeString(body.optionLabel, 255);
    }
    if (body.optionDescription !== undefined) {
      updateData.optionDescription = body.optionDescription ? sanitizeString(body.optionDescription, 1000) : null;
    }
    if (body.displayOrder !== undefined) {
      updateData.displayOrder = body.displayOrder;
    }

    const updatedVariantFieldOption = await prisma.listingVariantMetadataFieldOptions.update({
      where: { optionId: variantFieldOptionId },
      data: updateData,
      include: {
        variantFieldDefinition: {
          select: {
            id: true,
            fieldKey: true,
            fieldLabel: true,
            fieldType: true,
            category: {
              select: {
                id: true,
                categoryName: true,
                categorySlug: true,
              },
            },
          },
        },
      },
    });

    return c.json({
      success: true,
      message: "Variant field option updated successfully",
      data: updatedVariantFieldOption,
    });
  } catch (error) {
    console.error("Update variant field option error:", error);
    return c.json({ error: "Failed to update variant field option" }, 500);
  }
};

/**
 * Delete a variant field option
 */
export const deleteVariantFieldOption = async (c: Context) => {
  try {
    const variantFieldOptionId = c.req.param("id");

    if (!variantFieldOptionId) {
      return c.json({ error: "Variant field option ID is required" }, 400);
    }

    // Check if variant field option exists
    const existingVariantFieldOption = await prisma.listingVariantMetadataFieldOptions.findUnique({
      where: { optionId: variantFieldOptionId },
    });

    if (!existingVariantFieldOption) {
      return c.json({ error: "Variant field option not found" }, 404);
    }

    // Delete the variant field option
    await prisma.listingVariantMetadataFieldOptions.delete({
      where: { optionId: variantFieldOptionId },
    });

    return c.json({
      success: true,
      message: "Variant field option deleted successfully",
    });
  } catch (error) {
    console.error("Delete variant field option error:", error);
    return c.json({ error: "Failed to delete variant field option" }, 500);
  }
};
