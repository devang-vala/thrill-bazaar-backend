import { prisma } from "../db.js";
import type { BookingFormat } from "../../prisma/src/generated/prisma/enums.js";

export interface CategoryData {
  listingTypeId?: string | null;
  categoryName: string;
  categorySlug: string;
  categoryIconUrl?: string;
  categoryDescription?: string;
  displayOrder: number;
  bookingFormat: BookingFormat;
  isEndLocation: boolean;
  isRental: boolean;
  hasVariantCatA: boolean;
  isInclusionsExclusionsAllowed: boolean;
  isAddonsAllowed: boolean;
  isBookingOptionAllowed: boolean;
  isFaqAllowed: boolean;
  isDayWiseAllowed: boolean;
  isActive: boolean;
}

export interface CategoryUpdateData {
  listingTypeId?: string | null;
  categoryName?: string;
  categorySlug?: string;
  categoryIconUrl?: string | null;
  categoryDescription?: string | null;
  displayOrder?: number;
  bookingFormat?: BookingFormat;
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

/**
 * Get all categories with optional filtering
 */
export const getAllCategories = async (includeInactive: boolean = false) => {
  const whereClause = includeInactive ? {} : { isActive: true };

  return await prisma.category.findMany({
    where: whereClause,
    include: {
      listingType: {
        select: {
          id: true,
          name: true,
          displayOrder: true,
        },
      },
      subCategories: {
        where: includeInactive ? {} : { isActive: true },
        orderBy: { displayOrder: "asc" },
      },
    },
    orderBy: { displayOrder: "asc" },
  });
};

/**
 * Get category by ID
 */
export const getCategoryById = async (id: string) => {
  return await prisma.category.findUnique({
    where: { id },
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
        orderBy: { displayOrder: "asc" },
      },
    },
  });
};

/**
 * Get category by slug
 */
export const getCategoryBySlug = async (slug: string) => {
  return await prisma.category.findUnique({
    where: { categorySlug: slug },
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
        orderBy: { displayOrder: "asc" },
      },
    },
  });
};

/**
 * Create a new category
 */
export const createCategory = async (data: CategoryData) => {
  return await prisma.category.create({
    data,
    include: {
      subCategories: true,
    },
  });
};

/**
 * Update category by ID
 */
export const updateCategoryById = async (
  id: string,
  data: CategoryUpdateData
) => {
  return await prisma.category.update({
    where: { id },
    data,
    include: {
      subCategories: {
        where: { isActive: true },
        orderBy: { displayOrder: "asc" },
      },
    },
  });
};

/**
 * Delete category by ID
 */
export const deleteCategoryById = async (id: string) => {
  return await prisma.category.delete({
    where: { id },
  });
};

/**
 * Check if category slug exists
 */
export const checkCategorySlugExists = async (
  slug: string,
  excludeId?: string
) => {
  const whereClause: any = { categorySlug: slug };
  if (excludeId) {
    whereClause.id = { not: excludeId };
  }

  return await prisma.category.findFirst({
    where: whereClause,
    select: { id: true },
  });
};

/**
 * Get categories count
 */
export const getCategoriesCount = async (includeInactive: boolean = false) => {
  const whereClause = includeInactive ? {} : { isActive: true };

  return await prisma.category.count({
    where: whereClause,
  });
};

/**
 * Get active categories for dropdown/select options
 */
export const getCategoryOptions = async () => {
  return await prisma.category.findMany({
    where: { isActive: true },
    select: {
      id: true,
      categoryName: true,
      categorySlug: true,
    },
    orderBy: { displayOrder: "asc" },
  });
};
