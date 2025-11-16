import type { Context } from "hono";
import { prisma } from "../db.js";
import {
  validateCreateSubCategory,
  validateUpdateSubCategory,
  validateUsersListBody,
  sanitizeString,
  generateSlug,
} from "../helpers/validation.helper.js";
import {
  getSubCategoryById,
  getAllSubCategories,
  getSubCategoriesByCategory,
  createSubCategory,
  updateSubCategoryById,
  deleteSubCategoryById,
  checkSubCategorySlugExists,
} from "../helpers/subCategory.helper.js";
import { getCategoryById } from "../helpers/category.helper.js";

export interface CreateSubCategoryRequest {
  categoryId: string;
  subCatName: string;
  subCatSlug?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateSubCategoryRequest {
  categoryId?: string;
  subCatName?: string;
  subCatSlug?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export const getSubCategories = async (c: Context) => {
  try {
    const { includeInactive = "false", categoryId } = c.req.query();
    const showInactive = includeInactive.toLowerCase() === "true";

    let subCategories;
    if (categoryId) {
      subCategories = await getSubCategoriesByCategory(
        categoryId,
        showInactive
      );
    } else {
      subCategories = await getAllSubCategories(showInactive);
    }

    return c.json({
      success: true,
      data: subCategories,
      count: subCategories.length,
    });
  } catch (error) {
    console.error("Get sub-categories error:", error);
    return c.json({ error: "Failed to fetch sub-categories" }, 500);
  }
};

export const getSubCategory = async (c: Context) => {
  try {
    const subCategoryId = c.req.param("id");

    if (!subCategoryId) {
      return c.json({ error: "Sub-category ID is required" }, 400);
    }

    const subCategory = await getSubCategoryById(subCategoryId);

    if (!subCategory) {
      return c.json({ error: "Sub-category not found" }, 404);
    }

    return c.json({
      success: true,
      data: subCategory,
    });
  } catch (error) {
    console.error("Get sub-category error:", error);
    return c.json({ error: "Failed to fetch sub-category" }, 500);
  }
};

/**
 * Paginate sub-categories (Admin only)
 */
export const paginateSubCategories = async (c: Context) => {
  try {
    let body;
    try {
      body = await c.req.json();
    } catch (error) {
      // If no body or invalid JSON, use empty object
      body = {};
    }

    // Validate request body
    const validation = validateUsersListBody(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Extract pagination and filter parameters
    const page = body.page || 1;
    const limit = Math.min(body.limit || 10, 100);
    const skip = (page - 1) * limit;

    // Build filter conditions
    const whereClause: any = {};

    if (body.isActive !== undefined) {
      whereClause.isActive = body.isActive;
    }

    if (body.categoryId) {
      whereClause.categoryId = body.categoryId;
    }

    if (body.search) {
      whereClause.OR = [
        { subCatName: { contains: body.search, mode: "insensitive" } },
        { subCatSlug: { contains: body.search, mode: "insensitive" } },
        {
          category: {
            categoryName: { contains: body.search, mode: "insensitive" },
          },
        },
      ];
    }

    // Get paginated sub-categories
    const [subCategories, totalCount] = await Promise.all([
      prisma.subCategory.findMany({
        where: whereClause,
        include: {
          category: {
            select: {
              id: true,
              categoryName: true,
              categorySlug: true,
            },
          },
        },
        orderBy: [
          { category: { displayOrder: "asc" } },
          { displayOrder: "asc" },
        ],
        skip,
        take: limit,
      }),
      prisma.subCategory.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return c.json({
      success: true,
      data: subCategories,
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
    console.error("Paginate sub-categories error:", error);
    return c.json({ error: "Failed to fetch sub-categories" }, 500);
  }
};

export const createSubCategoryHandler = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CreateSubCategoryRequest;

    // Validate request body
    const validation = validateCreateSubCategory(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Check if parent category exists
    const parentCategory = await getCategoryById(body.categoryId);
    if (!parentCategory) {
      return c.json({ error: "Parent category not found" }, 404);
    }

    // Sanitize inputs
    const sanitizedData = {
      categoryId: body.categoryId,
      subCatName: sanitizeString(body.subCatName, 100),
      subCatSlug: body.subCatSlug
        ? sanitizeString(body.subCatSlug, 100).toLowerCase()
        : generateSlug(body.subCatName),
      displayOrder: body.displayOrder || 0,
      isActive: body.isActive !== undefined ? body.isActive : true,
    };

    // Check if slug already exists
    const existingSubCategory = await checkSubCategorySlugExists(
      sanitizedData.subCatSlug
    );
    if (existingSubCategory) {
      return c.json({ error: "Sub-category slug already exists" }, 409);
    }

    // Create sub-category
    const newSubCategory = await createSubCategory(sanitizedData);

    return c.json(
      {
        success: true,
        message: "Sub-category created successfully",
        data: newSubCategory,
      },
      201
    );
  } catch (error) {
    console.error("Create sub-category error:", error);
    return c.json({ error: "Failed to create sub-category" }, 500);
  }
};

export const updateSubCategory = async (c: Context) => {
  try {
    const subCategoryId = c.req.param("id");
    const body = (await c.req.json()) as UpdateSubCategoryRequest;

    if (!subCategoryId) {
      return c.json({ error: "Sub-category ID is required" }, 400);
    }

    // Validate request body
    const validation = validateUpdateSubCategory(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Check if sub-category exists
    const existingSubCategory = await getSubCategoryById(subCategoryId);
    if (!existingSubCategory) {
      return c.json({ error: "Sub-category not found" }, 404);
    }

    // Prepare update data
    const updateData: any = {};

    if (body.categoryId !== undefined) {
      // Check if new parent category exists
      const parentCategory = await getCategoryById(body.categoryId);
      if (!parentCategory) {
        return c.json({ error: "Parent category not found" }, 404);
      }
      updateData.categoryId = body.categoryId;
    }
    if (body.subCatName !== undefined) {
      updateData.subCatName = sanitizeString(body.subCatName, 100);
    }
    if (body.subCatSlug !== undefined) {
      updateData.subCatSlug = sanitizeString(
        body.subCatSlug,
        100
      ).toLowerCase();
      // Check if new slug already exists (excluding current sub-category)
      const slugExists = await checkSubCategorySlugExists(
        updateData.subCatSlug,
        subCategoryId
      );
      if (slugExists) {
        return c.json({ error: "Sub-category slug already exists" }, 409);
      }
    }
    if (body.displayOrder !== undefined) {
      updateData.displayOrder = body.displayOrder;
    }
    if (body.isActive !== undefined) {
      updateData.isActive = body.isActive;
    }

    // Update sub-category
    const updatedSubCategory = await updateSubCategoryById(
      subCategoryId,
      updateData
    );

    return c.json({
      success: true,
      message: "Sub-category updated successfully",
      data: updatedSubCategory,
    });
  } catch (error) {
    console.error("Update sub-category error:", error);
    return c.json({ error: "Failed to update sub-category" }, 500);
  }
};

export const deleteSubCategory = async (c: Context) => {
  try {
    const subCategoryId = c.req.param("id");

    if (!subCategoryId) {
      return c.json({ error: "Sub-category ID is required" }, 400);
    }

    // Check if sub-category exists
    const existingSubCategory = await getSubCategoryById(subCategoryId);
    if (!existingSubCategory) {
      return c.json({ error: "Sub-category not found" }, 404);
    }

    // Delete sub-category
    await deleteSubCategoryById(subCategoryId);

    return c.json({
      success: true,
      message: "Sub-category deleted successfully",
    });
  } catch (error) {
    console.error("Delete sub-category error:", error);
    return c.json({ error: "Failed to delete sub-category" }, 500);
  }
};
