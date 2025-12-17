import type { Context } from "hono";
import { prisma } from "../db.js";
import {
  sanitizeString,
} from "../helpers/validation.helper.js";

export interface CreateVariantFieldDefinitionRequest {
  categoryId: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: "text" | "textarea" | "number" | "select" | "multiselect" | "boolean" | "date" | "time" | "datetime" | "json_array";
  isRequired?: boolean;
  validationRules?: any;
  helpText?: string;
  displayOrder?: number;
  fieldGroup?: string;
  createdByAdminId?: string;
}

export interface UpdateVariantFieldDefinitionRequest {
  categoryId?: string;
  fieldKey?: string;
  fieldLabel?: string;
  fieldType?: "text" | "textarea" | "number" | "select" | "multiselect" | "boolean" | "date" | "time" | "datetime" | "json_array";
  isRequired?: boolean;
  validationRules?: any;
  helpText?: string;
  displayOrder?: number;
  fieldGroup?: string;
}

/**
 * Get all variant field definitions, optionally filtered by categoryId
 */
export const getVariantFieldDefinitions = async (c: Context) => {
  try {
    const { categoryId } = c.req.query();

    const whereClause: any = {};
    if (categoryId) {
      whereClause.categoryId = categoryId;
    }

    const variantFieldDefinitions = await prisma.listingVariantMetadataFieldDefinition.findMany({
      where: whereClause,
      include: {
        category: {
          select: {
            id: true,
            categoryName: true,
            categorySlug: true,
          },
        },
        createdByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        options: {
          orderBy: { displayOrder: "asc" },
        },
      },
      orderBy: { displayOrder: "asc" },
    });

    return c.json({
      success: true,
      data: variantFieldDefinitions,
      count: variantFieldDefinitions.length,
    });
  } catch (error) {
    console.error("Get variant field definitions error:", error);
    return c.json({ error: "Failed to fetch variant field definitions" }, 500);
  }
};

/**
 * Create a new variant field definition
 */
export const createVariantFieldDefinition = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CreateVariantFieldDefinitionRequest;

    // Basic validation
    if (!body.categoryId || !body.fieldKey || !body.fieldLabel || !body.fieldType) {
      return c.json({ 
        error: "categoryId, fieldKey, fieldLabel, and fieldType are required" 
      }, 400);
    }

    // Check if category exists
    const category = await prisma.category.findUnique({
      where: { id: body.categoryId },
    });

    if (!category) {
      return c.json({ error: "Category not found" }, 404);
    }

    // Check if field key already exists for this category
    const existingField = await prisma.listingVariantMetadataFieldDefinition.findUnique({
      where: {
        categoryId_fieldKey: {
          categoryId: body.categoryId,
          fieldKey: body.fieldKey,
        },
      },
    });

    if (existingField) {
      return c.json({ 
        error: "Field key already exists for this category" 
      }, 409);
    }

    // Sanitize inputs
    const sanitizedData = {
      categoryId: body.categoryId,
      fieldKey: sanitizeString(body.fieldKey, 100),
      fieldLabel: sanitizeString(body.fieldLabel, 255),
      fieldType: body.fieldType,
      isRequired: body.isRequired || false,
      validationRules: body.validationRules || null,
      helpText: body.helpText ? sanitizeString(body.helpText, 1000) : null,
      displayOrder: body.displayOrder || 0,
      fieldGroup: body.fieldGroup ? sanitizeString(body.fieldGroup, 100) : null,
      createdByAdminId: body.createdByAdminId || null,
    };

    const newVariantFieldDefinition = await prisma.listingVariantMetadataFieldDefinition.create({
      data: sanitizedData,
      include: {
        category: {
          select: {
            id: true,
            categoryName: true,
            categorySlug: true,
          },
        },
        createdByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return c.json(
      {
        success: true,
        message: "Variant field definition created successfully",
        data: newVariantFieldDefinition,
      },
      201
    );
  } catch (error) {
    console.error("Create variant field definition error:", error);
    return c.json({ error: "Failed to create variant field definition" }, 500);
  }
};

/**
 * Update a variant field definition
 */
export const updateVariantFieldDefinition = async (c: Context) => {
  try {
    const variantFieldDefinitionId = c.req.param("id");
    const body = (await c.req.json()) as UpdateVariantFieldDefinitionRequest;

    if (!variantFieldDefinitionId) {
      return c.json({ error: "Variant field definition ID is required" }, 400);
    }

    // Check if variant field definition exists
    const existingVariantFieldDefinition = await prisma.listingVariantMetadataFieldDefinition.findUnique({
      where: { id: variantFieldDefinitionId },
    });

    if (!existingVariantFieldDefinition) {
      return c.json({ error: "Variant field definition not found" }, 404);
    }

    // If updating categoryId, check if category exists
    if (body.categoryId && body.categoryId !== existingVariantFieldDefinition.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: body.categoryId },
      });

      if (!category) {
        return c.json({ error: "Category not found" }, 404);
      }
    }

    // If updating fieldKey, check for uniqueness within the category
    if (body.fieldKey && body.fieldKey !== existingVariantFieldDefinition.fieldKey) {
      const categoryId = body.categoryId || existingVariantFieldDefinition.categoryId;
      const existingField = await prisma.listingVariantMetadataFieldDefinition.findUnique({
        where: {
          categoryId_fieldKey: {
            categoryId: categoryId,
            fieldKey: body.fieldKey,
          },
        },
      });

      if (existingField) {
        return c.json({ 
          error: "Field key already exists for this category" 
        }, 409);
      }
    }

    // Prepare update data
    const updateData: any = {};

    if (body.categoryId !== undefined) {
      updateData.categoryId = body.categoryId;
    }
    if (body.fieldKey !== undefined) {
      updateData.fieldKey = sanitizeString(body.fieldKey, 100);
    }
    if (body.fieldLabel !== undefined) {
      updateData.fieldLabel = sanitizeString(body.fieldLabel, 255);
    }
    if (body.fieldType !== undefined) {
      updateData.fieldType = body.fieldType;
    }
    if (body.isRequired !== undefined) {
      updateData.isRequired = body.isRequired;
    }
    if (body.validationRules !== undefined) {
      updateData.validationRules = body.validationRules;
    }
    if (body.helpText !== undefined) {
      updateData.helpText = body.helpText ? sanitizeString(body.helpText, 1000) : null;
    }
    if (body.displayOrder !== undefined) {
      updateData.displayOrder = body.displayOrder;
    }
    if (body.fieldGroup !== undefined) {
      updateData.fieldGroup = body.fieldGroup ? sanitizeString(body.fieldGroup, 100) : null;
    }

    const updatedVariantFieldDefinition = await prisma.listingVariantMetadataFieldDefinition.update({
      where: { id: variantFieldDefinitionId },
      data: updateData,
      include: {
        category: {
          select: {
            id: true,
            categoryName: true,
            categorySlug: true,
          },
        },
        createdByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return c.json({
      success: true,
      message: "Variant field definition updated successfully",
      data: updatedVariantFieldDefinition,
    });
  } catch (error) {
    console.error("Update variant field definition error:", error);
    return c.json({ error: "Failed to update variant field definition" }, 500);
  }
};

/**
 * Delete a variant field definition
 */
export const deleteVariantFieldDefinition = async (c: Context) => {
  try {
    const variantFieldDefinitionId = c.req.param("id");

    if (!variantFieldDefinitionId) {
      return c.json({ error: "Variant field definition ID is required" }, 400);
    }

    // Check if variant field definition exists
    const existingVariantFieldDefinition = await prisma.listingVariantMetadataFieldDefinition.findUnique({
      where: { id: variantFieldDefinitionId },
    });

    if (!existingVariantFieldDefinition) {
      return c.json({ error: "Variant field definition not found" }, 404);
    }

    // Delete the variant field definition (cascade will handle options)
    await prisma.listingVariantMetadataFieldDefinition.delete({
      where: { id: variantFieldDefinitionId },
    });

    return c.json({
      success: true,
      message: "Variant field definition deleted successfully",
    });
  } catch (error) {
    console.error("Delete variant field definition error:", error);
    return c.json({ error: "Failed to delete variant field definition" }, 500);
  }
};
