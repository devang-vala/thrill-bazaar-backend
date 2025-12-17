import type { Context } from "hono";
import { prisma } from "../db.js";
import {
  validateUsersListBody,
  sanitizeString,
} from "../helpers/validation.helper.js";

export interface CreateFieldOptionRequest {
  fieldDefinitionId: string;
  optionValue: string;
  optionLabel: string;
  optionDescription?: string;
  displayOrder?: number;
}

export interface UpdateFieldOptionRequest {
  fieldDefinitionId?: string;
  optionValue?: string;
  optionLabel?: string;
  optionDescription?: string;
  displayOrder?: number;
}

/**
 * Get all field options for a field definition
 */
export const getFieldOptions = async (c: Context) => {
  try {
    const { fieldDefinitionId } = c.req.query();

    const whereClause: any = {};
    if (fieldDefinitionId) {
      whereClause.fieldDefinitionId = fieldDefinitionId;
    }

    const fieldOptions = await prisma.listingMetadataFieldOptions.findMany({
      where: whereClause,
      include: {
        fieldDefinition: {
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
      data: fieldOptions,
      count: fieldOptions.length,
    });
  } catch (error) {
    console.error("Get field options error:", error);
    return c.json({ error: "Failed to fetch field options" }, 500);
  }
};

/**
 * Get a single field option by ID
 */
export const getFieldOption = async (c: Context) => {
  try {
    const fieldOptionId = c.req.param("id");

    if (!fieldOptionId) {
      return c.json({ error: "Field option ID is required" }, 400);
    }

    const fieldOption = await prisma.listingMetadataFieldOptions.findUnique({
      where: { optionId: fieldOptionId },
      include: {
        fieldDefinition: {
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

    if (!fieldOption) {
      return c.json({ error: "Field option not found" }, 404);
    }

    return c.json({
      success: true,
      data: fieldOption,
    });
  } catch (error) {
    console.error("Get field option error:", error);
    return c.json({ error: "Failed to fetch field option" }, 500);
  }
};

/**
 * Paginate field options
 */
export const paginateFieldOptions = async (c: Context) => {
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

    if (body.fieldDefinitionId) {
      whereClause.fieldDefinitionId = body.fieldDefinitionId;
    }

    if (body.search) {
      whereClause.OR = [
        { optionValue: { contains: body.search, mode: "insensitive" } },
        { optionLabel: { contains: body.search, mode: "insensitive" } },
        { optionDescription: { contains: body.search, mode: "insensitive" } },
      ];
    }

    const [fieldOptions, totalCount] = await Promise.all([
      prisma.listingMetadataFieldOptions.findMany({
        where: whereClause,
        include: {
          fieldDefinition: {
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
        skip,
        take: limit,
      }),
      prisma.listingMetadataFieldOptions.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return c.json({
      success: true,
      data: fieldOptions,
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
    console.error("Paginate field options error:", error);
    return c.json({ error: "Failed to fetch field options" }, 500);
  }
};

/**
 * Create a new field option
 */
export const createFieldOption = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CreateFieldOptionRequest;

    // Basic validation
    if (!body.fieldDefinitionId || !body.optionValue || !body.optionLabel) {
      return c.json({ 
        error: "fieldDefinitionId, optionValue, and optionLabel are required" 
      }, 400);
    }

    // Check if field definition exists
    const fieldDefinition = await prisma.listingMetadataFieldDefinition.findUnique({
      where: { id: body.fieldDefinitionId },
    });

    if (!fieldDefinition) {
      return c.json({ error: "Field definition not found" }, 404);
    }

    // Check if option value already exists for this field definition
    const existingOption = await prisma.listingMetadataFieldOptions.findUnique({
      where: {
        fieldDefinitionId_optionValue: {
          fieldDefinitionId: body.fieldDefinitionId,
          optionValue: body.optionValue,
        },
      },
    });

    if (existingOption) {
      return c.json({ 
        error: "Option value already exists for this field definition" 
      }, 409);
    }

    // Sanitize inputs
    const sanitizedData = {
      fieldDefinitionId: body.fieldDefinitionId,
      optionValue: sanitizeString(body.optionValue, 255),
      optionLabel: sanitizeString(body.optionLabel, 255),
      optionDescription: body.optionDescription ? sanitizeString(body.optionDescription, 1000) : null,
      displayOrder: body.displayOrder || 0,
    };

    const newFieldOption = await prisma.listingMetadataFieldOptions.create({
      data: sanitizedData,
      include: {
        fieldDefinition: {
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
        message: "Field option created successfully",
        data: newFieldOption,
      },
      201
    );
  } catch (error) {
    console.error("Create field option error:", error);
    return c.json({ error: "Failed to create field option" }, 500);
  }
};

/**
 * Update a field option
 */
export const updateFieldOption = async (c: Context) => {
  try {
    const fieldOptionId = c.req.param("id");
    const body = (await c.req.json()) as UpdateFieldOptionRequest;

    if (!fieldOptionId) {
      return c.json({ error: "Field option ID is required" }, 400);
    }

    // Check if field option exists
    const existingFieldOption = await prisma.listingMetadataFieldOptions.findUnique({
      where: { optionId: fieldOptionId },
    });

    if (!existingFieldOption) {
      return c.json({ error: "Field option not found" }, 404);
    }

    // If updating fieldDefinitionId, check if field definition exists
    if (body.fieldDefinitionId && body.fieldDefinitionId !== existingFieldOption.fieldDefinitionId) {
      const fieldDefinition = await prisma.listingMetadataFieldDefinition.findUnique({
        where: { id: body.fieldDefinitionId },
      });

      if (!fieldDefinition) {
        return c.json({ error: "Field definition not found" }, 404);
      }
    }

    // If updating optionValue, check for uniqueness within the field definition
    if (body.optionValue && body.optionValue !== existingFieldOption.optionValue) {
      const fieldDefinitionId = body.fieldDefinitionId || existingFieldOption.fieldDefinitionId;
      const existingOption = await prisma.listingMetadataFieldOptions.findUnique({
        where: {
          fieldDefinitionId_optionValue: {
            fieldDefinitionId: fieldDefinitionId,
            optionValue: body.optionValue,
          },
        },
      });

      if (existingOption) {
        return c.json({ 
          error: "Option value already exists for this field definition" 
        }, 409);
      }
    }

    // Prepare update data
    const updateData: any = {};

    if (body.fieldDefinitionId !== undefined) {
      updateData.fieldDefinitionId = body.fieldDefinitionId;
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

    const updatedFieldOption = await prisma.listingMetadataFieldOptions.update({
      where: { optionId: fieldOptionId },
      data: updateData,
      include: {
        fieldDefinition: {
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
      message: "Field option updated successfully",
      data: updatedFieldOption,
    });
  } catch (error) {
    console.error("Update field option error:", error);
    return c.json({ error: "Failed to update field option" }, 500);
  }
};

/**
 * Delete a field option
 */
export const deleteFieldOption = async (c: Context) => {
  try {
    const fieldOptionId = c.req.param("id");

    if (!fieldOptionId) {
      return c.json({ error: "Field option ID is required" }, 400);
    }

    // Check if field option exists
    const existingFieldOption = await prisma.listingMetadataFieldOptions.findUnique({
      where: { optionId: fieldOptionId },
    });

    if (!existingFieldOption) {
      return c.json({ error: "Field option not found" }, 404);
    }

    // Delete the field option
    await prisma.listingMetadataFieldOptions.delete({
      where: { optionId: fieldOptionId },
    });

    return c.json({
      success: true,
      message: "Field option deleted successfully",
    });
  } catch (error) {
    console.error("Delete field option error:", error);
    return c.json({ error: "Failed to delete field option" }, 500);
  }
};