import type { Context } from "hono";
import { prisma } from "../db.js";
import {
  validateUsersListBody,
  sanitizeString,
} from "../helpers/validation.helper.js";

export interface CreateFieldDefinitionRequest {
  categoryId: string;
  isFilter?: boolean;
  fieldKey: string;
  fieldLabel: string;
  fieldType: "text" | "textarea" | "number" | "select" | "multiselect" | "boolean" | "date" | "time" | "datetime" | "json_array";
  isRequired?: boolean;
  validationRules?: any;
  defaultValue?: string;
  helpText?: string;
  placeholderText?: string;
  displayOrder?: number;
  fieldGroup?: string;
  createdByAdminId?: string;
}

export interface UpdateFieldDefinitionRequest {
  categoryId?: string;
  isFilter?: boolean;
  fieldKey?: string;
  fieldLabel?: string;
  fieldType?: "text" | "textarea" | "number" | "select" | "multiselect" | "boolean" | "date" | "time" | "datetime" | "json_array";
  isRequired?: boolean;
  validationRules?: any;
  defaultValue?: string;
  helpText?: string;
  placeholderText?: string;
  displayOrder?: number;
  fieldGroup?: string;
}

/**
 * Get all field definitions for a category
 */
export const getFieldDefinitions = async (c: Context) => {
  try {
    const { categoryId } = c.req.query();

    const whereClause: any = {};
    if (categoryId) {
      whereClause.categoryId = categoryId;
    }

    const fieldDefinitions = await prisma.listingMetadataFieldDefinition.findMany({
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
      data: fieldDefinitions,
      count: fieldDefinitions.length,
    });
  } catch (error) {
    console.error("Get field definitions error:", error);
    return c.json({ error: "Failed to fetch field definitions" }, 500);
  }
};

/**
 * Get a single field definition by ID
 */
export const getFieldDefinition = async (c: Context) => {
  try {
    const fieldDefinitionId = c.req.param("id");

    if (!fieldDefinitionId) {
      return c.json({ error: "Field definition ID is required" }, 400);
    }

    const fieldDefinition = await prisma.listingMetadataFieldDefinition.findUnique({
      where: { id: fieldDefinitionId },
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
    });

    if (!fieldDefinition) {
      return c.json({ error: "Field definition not found" }, 404);
    }

    return c.json({
      success: true,
      data: fieldDefinition,
    });
  } catch (error) {
    console.error("Get field definition error:", error);
    return c.json({ error: "Failed to fetch field definition" }, 500);
  }
};

/**
 * Paginate field definitions
 */
export const paginateFieldDefinitions = async (c: Context) => {
  try {
    let body;
    try {
      body = await c.req.json();
    } catch (error) {
      body = {};
    }

    const validation = validateUsersListBody(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    const page = body.page || 1;
    const limit = Math.min(body.limit || 10, 100);
    const skip = (page - 1) * limit;

    const whereClause: any = {};

    if (body.categoryId) {
      whereClause.categoryId = body.categoryId;
    }

    if (body.fieldType) {
      whereClause.fieldType = body.fieldType;
    }

    if (body.isFilter !== undefined) {
      whereClause.isFilter = body.isFilter;
    }

    if (body.isRequired !== undefined) {
      whereClause.isRequired = body.isRequired;
    }

    if (body.search) {
      whereClause.OR = [
        { fieldKey: { contains: body.search, mode: "insensitive" } },
        { fieldLabel: { contains: body.search, mode: "insensitive" } },
        { helpText: { contains: body.search, mode: "insensitive" } },
        { fieldGroup: { contains: body.search, mode: "insensitive" } },
      ];
    }

    const [fieldDefinitions, totalCount] = await Promise.all([
      prisma.listingMetadataFieldDefinition.findMany({
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
            select: {
              optionId: true,
              optionValue: true,
              optionLabel: true,
              displayOrder: true,
            },
            orderBy: { displayOrder: "asc" },
          },
        },
        orderBy: { displayOrder: "asc" },
        skip,
        take: limit,
      }),
      prisma.listingMetadataFieldDefinition.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return c.json({
      success: true,
      data: fieldDefinitions,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error("Paginate field definitions error:", error);
    return c.json({ error: "Failed to fetch field definitions" }, 500);
  }
};

/**
 * Create a new field definition
 */
export const createFieldDefinition = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CreateFieldDefinitionRequest;

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
    const existingField = await prisma.listingMetadataFieldDefinition.findUnique({
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
      isFilter: body.isFilter || false,
      fieldKey: sanitizeString(body.fieldKey, 100),
      fieldLabel: sanitizeString(body.fieldLabel, 255),
      fieldType: body.fieldType,
      isRequired: body.isRequired || false,
      validationRules: body.validationRules || null,
      defaultValue: body.defaultValue ? sanitizeString(body.defaultValue, 500) : null,
      helpText: body.helpText ? sanitizeString(body.helpText, 1000) : null,
      placeholderText: body.placeholderText ? sanitizeString(body.placeholderText, 255) : null,
      displayOrder: body.displayOrder || 0,
      fieldGroup: body.fieldGroup ? sanitizeString(body.fieldGroup, 100) : null,
      createdByAdminId: body.createdByAdminId || null,
    };

    const newFieldDefinition = await prisma.listingMetadataFieldDefinition.create({
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
        message: "Field definition created successfully",
        data: newFieldDefinition,
      },
      201
    );
  } catch (error) {
    console.error("Create field definition error:", error);
    return c.json({ error: "Failed to create field definition" }, 500);
  }
};

/**
 * Update a field definition
 */
export const updateFieldDefinition = async (c: Context) => {
  try {
    const fieldDefinitionId = c.req.param("id");
    const body = (await c.req.json()) as UpdateFieldDefinitionRequest;

    if (!fieldDefinitionId) {
      return c.json({ error: "Field definition ID is required" }, 400);
    }

    // Check if field definition exists
    const existingFieldDefinition = await prisma.listingMetadataFieldDefinition.findUnique({
      where: { id: fieldDefinitionId },
    });

    if (!existingFieldDefinition) {
      return c.json({ error: "Field definition not found" }, 404);
    }

    // If updating categoryId, check if category exists
    if (body.categoryId && body.categoryId !== existingFieldDefinition.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: body.categoryId },
      });

      if (!category) {
        return c.json({ error: "Category not found" }, 404);
      }
    }

    // If updating fieldKey, check for uniqueness within the category
    if (body.fieldKey && body.fieldKey !== existingFieldDefinition.fieldKey) {
      const categoryId = body.categoryId || existingFieldDefinition.categoryId;
      const existingField = await prisma.listingMetadataFieldDefinition.findUnique({
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
    if (body.isFilter !== undefined) {
      updateData.isFilter = body.isFilter;
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
    if (body.defaultValue !== undefined) {
      updateData.defaultValue = body.defaultValue ? sanitizeString(body.defaultValue, 500) : null;
    }
    if (body.helpText !== undefined) {
      updateData.helpText = body.helpText ? sanitizeString(body.helpText, 1000) : null;
    }
    if (body.placeholderText !== undefined) {
      updateData.placeholderText = body.placeholderText ? sanitizeString(body.placeholderText, 255) : null;
    }
    if (body.displayOrder !== undefined) {
      updateData.displayOrder = body.displayOrder;
    }
    if (body.fieldGroup !== undefined) {
      updateData.fieldGroup = body.fieldGroup ? sanitizeString(body.fieldGroup, 100) : null;
    }

    const updatedFieldDefinition = await prisma.listingMetadataFieldDefinition.update({
      where: { id: fieldDefinitionId },
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
      message: "Field definition updated successfully",
      data: updatedFieldDefinition,
    });
  } catch (error) {
    console.error("Update field definition error:", error);
    return c.json({ error: "Failed to update field definition" }, 500);
  }
};

/**
 * Delete a field definition
 */
export const deleteFieldDefinition = async (c: Context) => {
  try {
    const fieldDefinitionId = c.req.param("id");

    if (!fieldDefinitionId) {
      return c.json({ error: "Field definition ID is required" }, 400);
    }

    // Check if field definition exists
    const existingFieldDefinition = await prisma.listingMetadataFieldDefinition.findUnique({
      where: { id: fieldDefinitionId },
    });

    if (!existingFieldDefinition) {
      return c.json({ error: "Field definition not found" }, 404);
    }

    // Delete the field definition (cascade will handle options)
    await prisma.listingMetadataFieldDefinition.delete({
      where: { id: fieldDefinitionId },
    });

    return c.json({
      success: true,
      message: "Field definition deleted successfully",
    });
  } catch (error) {
    console.error("Delete field definition error:", error);
    return c.json({ error: "Failed to delete field definition" }, 500);
  }
};