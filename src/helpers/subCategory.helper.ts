import { prisma } from "../db.js";

export interface SubCategoryData {
  categoryId: string;
  subCatName: string;
  subCatSlug: string;
  displayOrder: number;
  isActive: boolean;
}

export interface SubCategoryUpdateData {
  categoryId?: string;
  subCatName?: string;
  subCatSlug?: string;
  displayOrder?: number;
  isActive?: boolean;
}

/**
 * Get all sub-categories with optional filtering
 */
export const getAllSubCategories = async (includeInactive: boolean = false) => {
  const whereClause = includeInactive ? {} : { isActive: true };

  return await prisma.subCategory.findMany({
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
    orderBy: [{ category: { displayOrder: "asc" } }, { displayOrder: "asc" }],
  });
};

/**
 * Get sub-categories by category ID
 */
export const getSubCategoriesByCategory = async (
  categoryId: string,
  includeInactive: boolean = false
) => {
  const whereClause: any = { categoryId };
  if (!includeInactive) {
    whereClause.isActive = true;
  }

  return await prisma.subCategory.findMany({
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
    orderBy: { displayOrder: "asc" },
  });
};

/**
 * Get sub-category by ID
 */
export const getSubCategoryById = async (id: string) => {
  return await prisma.subCategory.findUnique({
    where: { id },
    include: {
      category: {
        select: {
          id: true,
          categoryName: true,
          categorySlug: true,
        },
      },
    },
  });
};

/**
 * Get sub-category by slug
 */
export const getSubCategoryBySlug = async (slug: string) => {
  return await prisma.subCategory.findUnique({
    where: { subCatSlug: slug },
    include: {
      category: {
        select: {
          id: true,
          categoryName: true,
          categorySlug: true,
        },
      },
    },
  });
};

/**
 * Create a new sub-category
 */
export const createSubCategory = async (data: SubCategoryData) => {
  return await prisma.subCategory.create({
    data,
    include: {
      category: {
        select: {
          id: true,
          categoryName: true,
          categorySlug: true,
        },
      },
    },
  });
};

/**
 * Update sub-category by ID
 */
export const updateSubCategoryById = async (
  id: string,
  data: SubCategoryUpdateData
) => {
  return await prisma.subCategory.update({
    where: { id },
    data,
    include: {
      category: {
        select: {
          id: true,
          categoryName: true,
          categorySlug: true,
        },
      },
    },
  });
};

/**
 * Delete sub-category by ID
 */
export const deleteSubCategoryById = async (id: string) => {
  return await prisma.subCategory.delete({
    where: { id },
  });
};

/**
 * Check if sub-category slug exists
 */
export const checkSubCategorySlugExists = async (
  slug: string,
  excludeId?: string
) => {
  const whereClause: any = { subCatSlug: slug };
  if (excludeId) {
    whereClause.id = { not: excludeId };
  }

  return await prisma.subCategory.findFirst({
    where: whereClause,
    select: { id: true },
  });
};

/**
 * Get sub-categories count by category
 */
export const getSubCategoriesCount = async (
  categoryId?: string,
  includeInactive: boolean = false
) => {
  const whereClause: any = {};
  if (categoryId) {
    whereClause.categoryId = categoryId;
  }
  if (!includeInactive) {
    whereClause.isActive = true;
  }

  return await prisma.subCategory.count({
    where: whereClause,
  });
};

/**
 * Get active sub-categories for dropdown/select options
 */
export const getSubCategoryOptions = async (categoryId?: string) => {
  const whereClause: any = { isActive: true };
  if (categoryId) {
    whereClause.categoryId = categoryId;
  }

  return await prisma.subCategory.findMany({
    where: whereClause,
    select: {
      id: true,
      subCatName: true,
      subCatSlug: true,
      categoryId: true,
    },
    orderBy: { displayOrder: "asc" },
  });
};
