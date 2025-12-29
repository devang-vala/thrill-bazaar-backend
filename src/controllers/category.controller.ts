import type { Context } from "hono";
import { prisma } from "../db.js";
import {
  validateCreateCategory,
  validateUpdateCategory,
  validateUsersListBody,
  sanitizeString,
  generateSlug,
} from "../helpers/validation.helper.js";
import {
  getCategoryById,
  getAllCategories,
  createCategory,
  updateCategoryById,
  deleteCategoryById,
  checkCategorySlugExists,
} from "../helpers/category.helper.js";

export interface CreateCategoryRequest {
  listingTypeId?: string;
  categoryName: string;
  categorySlug?: string;
  categoryIconUrl?: string;
  categoryDescription?: string;
  displayOrder?: number;
  bookingFormat: "F1" | "F2" | "F3" | "F4";
  isEndLocation?: boolean;
  isRental?: boolean;
  hasVariantCatA?: boolean;
  isInclusionsExclusionsAllowed?: boolean;
  isAddonsAllowed?: boolean;
  isBookingOptionAllowed?: boolean;
  isFaqAllowed?: boolean;
  isDayWiseAllowed?: boolean;
  isActive?: boolean;
}

export interface UpdateCategoryRequest {
  listingTypeId?: string;
  categoryName?: string;
  categorySlug?: string;
  categoryIconUrl?: string;
  categoryDescription?: string;
  displayOrder?: number;
  bookingFormat?: "F1" | "F2" | "F3" | "F4";
  isEndLocation?: boolean;
  isRental?: boolean;
  hasVariantCatA?: boolean;
  isInclusionsExclusionsAllowed?: boolean;
  isAddonsAllowed?: boolean;
  isBookingOptionAllowed?: boolean;
  isFaqAllowed?: boolean;
  isDayWiseAllowed?: boolean;
  isActive?: boolean;
}

export const getCategories = async (c: Context) => {
  try {
    const { includeInactive = "false" } = c.req.query();
    const showInactive = includeInactive.toLowerCase() === "true";

    const categories = await getAllCategories(showInactive);

    return c.json({
      success: true,
      data: categories,
      count: categories.length,
    });
  } catch (error) {
    console.error("Get categories error:", error);
    return c.json({ error: "Failed to fetch categories" }, 500);
  }
};

export const getCategoriesByBookingFormat = async (c: Context) => {
  try {
    const format = c.req.param("format");
    const { includeInactive = "false" } = c.req.query();
    const showInactive = includeInactive.toLowerCase() === "true";

    // Validate booking format
    const validFormats = ["F1", "F2", "F3", "F4"];
    if (!format || !validFormats.includes(format.toUpperCase())) {
      return c.json({ 
        error: "Invalid booking format. Must be F1, F2, F3, or F4" 
      }, 400);
    }

    const bookingFormat = format.toUpperCase() as "F1" | "F2" | "F3" | "F4";

    // Debug: Check all categories first
    const allCategories = await prisma.category.findMany({
      select: {
        id: true,
        categoryName: true,
        bookingFormat: true,
        isActive: true,
      },
    });
    console.log("All categories:", allCategories);
    console.log("Looking for booking format:", bookingFormat);

    // Query categories by booking format
    const categories = await prisma.category.findMany({
      where: {
        bookingFormat: bookingFormat,
        ...(showInactive ? {} : { isActive: true }),
      },
      orderBy: {
        displayOrder: "asc",
      },
      include: {
        listingType: {
          select: {
            id: true,
            name: true,
            displayOrder: true,
          },
        },
        subCategories: {
          where: showInactive ? {} : { isActive: true },
          orderBy: {
            displayOrder: "asc",
          },
        },
      },
    });

    return c.json({
      success: true,
      data: categories,
      count: categories.length,
      bookingFormat: bookingFormat,
      debug: {
        totalCategoriesInDb: allCategories.length,
        allBookingFormats: [...new Set(allCategories.map(c => c.bookingFormat))],
      },
    });
  } catch (error) {
    console.error("Get categories by booking format error:", error);
    return c.json({ error: "Failed to fetch categories" }, 500);
  }
};

export const getCategoriesByListingType = async (c: Context) => {
  try {
    const listingTypeId = c.req.param("listingTypeId");
    const { includeInactive = "false" } = c.req.query();
    const showInactive = includeInactive.toLowerCase() === "true";

    if (!listingTypeId) {
      return c.json({ 
        error: "Listing type ID is required" 
      }, 400);
    }

    // Query categories by listing type
    const categories = await prisma.category.findMany({
      where: {
        listingTypeId: listingTypeId,
        ...(showInactive ? {} : { isActive: true }),
      },
      orderBy: {
        displayOrder: "asc",
      },
      include: {
        listingType: {
          select: {
            id: true,
            name: true,
            displayOrder: true,
          },
        },
        subCategories: {
          where: showInactive ? {} : { isActive: true },
          orderBy: {
            displayOrder: "asc",
          },
        },
      },
    });

    return c.json({
      success: true,
      data: categories,
      count: categories.length,
    });
  } catch (error) {
    console.error("Get categories by listing type error:", error);
    return c.json({ error: "Failed to fetch categories" }, 500);
  }
};

export const getCategory = async (c: Context) => {
  try {
    const categoryId = c.req.param("id");

    if (!categoryId) {
      return c.json({ error: "Category ID is required" }, 400);
    }

    const category = await getCategoryById(categoryId);

    if (!category) {
      return c.json({ error: "Category not found" }, 404);
    }

    return c.json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error("Get category error:", error);
    return c.json({ error: "Failed to fetch category" }, 500);
  }
};

/**
 * Paginate categories (Admin only)
 */
export const paginateCategories = async (c: Context) => {
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

    if (body.bookingFormat) {
      whereClause.bookingFormat = body.bookingFormat;
    }

    if (body.isRental !== undefined) {
      whereClause.isRental = body.isRental;
    }

    if (body.search) {
      whereClause.OR = [
        { categoryName: { contains: body.search, mode: "insensitive" } },
        { categorySlug: { contains: body.search, mode: "insensitive" } },
        { categoryDescription: { contains: body.search, mode: "insensitive" } },
      ];
    }

    // Get paginated categories
    const [categories, totalCount] = await Promise.all([
      prisma.category.findMany({
        where: whereClause,
        include: {
          listingType: {
            select: {
              id: true,
              name: true,
              description: true,
              displayOrder: true,
            },
          },
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
        skip,
        take: limit,
      }),
      prisma.category.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return c.json({
      success: true,
      data: categories,
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
    console.error("Paginate categories error:", error);
    return c.json({ error: "Failed to fetch categories" }, 500);
  }
};

/**
 * Create a new category
 */
export const createCategoryHandler = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CreateCategoryRequest;

    // Validate request body
    const validation = validateCreateCategory(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Sanitize inputs
    const sanitizedData = {
      listingTypeId: body.listingTypeId || null,
      categoryName: sanitizeString(body.categoryName, 100),
      categorySlug: body.categorySlug
        ? sanitizeString(body.categorySlug, 100).toLowerCase()
        : generateSlug(body.categoryName),
      categoryIconUrl: body.categoryIconUrl
        ? sanitizeString(body.categoryIconUrl, 255)
        : undefined,
      categoryDescription: body.categoryDescription
        ? sanitizeString(body.categoryDescription, 500)
        : undefined,
      displayOrder: body.displayOrder || 0,
      bookingFormat: body.bookingFormat,
      isEndLocation: body.isEndLocation || false,
      isRental: body.isRental || false,
      hasVariantCatA: body.hasVariantCatA || false,
      isInclusionsExclusionsAllowed: body.isInclusionsExclusionsAllowed || false,
      isAddonsAllowed: body.isAddonsAllowed || false,
      isBookingOptionAllowed: body.isBookingOptionAllowed || false,
      isFaqAllowed: body.isFaqAllowed || false,
      isDayWiseAllowed: body.isDayWiseAllowed || false,
      isActive: body.isActive !== undefined ? body.isActive : true,
    };

    // Check if slug already exists
    const existingCategory = await checkCategorySlugExists(
      sanitizedData.categorySlug
    );
    if (existingCategory) {
      return c.json({ error: "Category slug already exists" }, 409);
    }

    // Create category
    const newCategory = await createCategory(sanitizedData);

    return c.json(
      {
        success: true,
        message: "Category created successfully",
        data: newCategory,
      },
      201
    );
  } catch (error) {
    console.error("Create category error:", error);
    return c.json({ error: "Failed to create category" }, 500);
  }
};

export const updateCategory = async (c: Context) => {
  try {
    const categoryId = c.req.param("id");
    const body = (await c.req.json()) as UpdateCategoryRequest;

    if (!categoryId) {
      return c.json({ error: "Category ID is required" }, 400);
    }

    // Validate request body
    const validation = validateUpdateCategory(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Check if category exists
    const existingCategory = await getCategoryById(categoryId);
    if (!existingCategory) {
      return c.json({ error: "Category not found" }, 404);
    }

    // Prepare update data
    const updateData: any = {};

    if (body.listingTypeId !== undefined) {
      updateData.listingTypeId = body.listingTypeId || null;
    }
    if (body.categoryName !== undefined) {
      updateData.categoryName = sanitizeString(body.categoryName, 100);
    }
    if (body.categorySlug !== undefined) {
      updateData.categorySlug = sanitizeString(
        body.categorySlug,
        100
      ).toLowerCase();
      // Check if new slug already exists (excluding current category)
      const slugExists = await checkCategorySlugExists(
        updateData.categorySlug,
        categoryId
      );
      if (slugExists) {
        return c.json({ error: "Category slug already exists" }, 409);
      }
    }
    if (body.categoryIconUrl !== undefined) {
      updateData.categoryIconUrl = body.categoryIconUrl
        ? sanitizeString(body.categoryIconUrl, 255)
        : null;
    }
    if (body.categoryDescription !== undefined) {
      updateData.categoryDescription = body.categoryDescription
        ? sanitizeString(body.categoryDescription, 500)
        : null;
    }
    if (body.displayOrder !== undefined) {
      updateData.displayOrder = body.displayOrder;
    }
    if (body.bookingFormat !== undefined) {
      updateData.bookingFormat = body.bookingFormat;
    }
    if (body.isEndLocation !== undefined) {
      updateData.isEndLocation = body.isEndLocation;
    }
    if (body.isRental !== undefined) {
      updateData.isRental = body.isRental;
    }
    if (body.hasVariantCatA !== undefined) {
      updateData.hasVariantCatA = body.hasVariantCatA;
    }
    if (body.isInclusionsExclusionsAllowed !== undefined) {
      updateData.isInclusionsExclusionsAllowed = body.isInclusionsExclusionsAllowed;
    }
    if (body.isAddonsAllowed !== undefined) {
      updateData.isAddonsAllowed = body.isAddonsAllowed;
    }
    if (body.isBookingOptionAllowed !== undefined) {
      updateData.isBookingOptionAllowed = body.isBookingOptionAllowed;
    }
    if (body.isFaqAllowed !== undefined) {
      updateData.isFaqAllowed = body.isFaqAllowed;
    }
    if (body.isDayWiseAllowed !== undefined) {
      updateData.isDayWiseAllowed = body.isDayWiseAllowed;
    }
    if (body.isActive !== undefined) {
      updateData.isActive = body.isActive;
    }

    // Update category
    const updatedCategory = await updateCategoryById(categoryId, updateData);

    return c.json({
      success: true,
      message: "Category updated successfully",
      data: updatedCategory,
    });
  } catch (error) {
    console.error("Update category error:", error);
    return c.json({ error: "Failed to update category" }, 500);
  }
};

export const deleteCategory = async (c: Context) => {
  try {
    const categoryId = c.req.param("id");

    if (!categoryId) {
      return c.json({ error: "Category ID is required" }, 400);
    }

    // Check if category exists
    const existingCategory = await getCategoryById(categoryId);
    if (!existingCategory) {
      return c.json({ error: "Category not found" }, 404);
    }

    // Delete category (this will cascade delete sub-categories)
    await deleteCategoryById(categoryId);

    return c.json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error("Delete category error:", error);
    return c.json({ error: "Failed to delete category" }, 500);
  }
};
