import { prisma } from "../db.js";

/**
 * Check if a category is a rental category
 */
export const isRentalCategory = async (categoryId:  string): Promise<boolean> => {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { isRental: true },
  });
  return category?.isRental || false;
};

/**
 * Check if a category has Cat-A variants (equipment rentals)
 */
export const hasCatAVariants = async (categoryId: string): Promise<boolean> => {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select:  { hasVariantCatA:  true },
  });
  return category?.hasVariantCatA || false;
};

/**
 * Get rental type info for a category
 */
export const getRentalTypeInfo = async (categoryId: string) => {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: {
      id:  true,
      categoryName: true,
      bookingFormat: true,
      isRental: true,
      hasVariantCatA: true,
    },
  });

  if (!category) return null;

  return {
    categoryId: category.id,
    categoryName: category.categoryName,
    isRental:  category.isRental,
    bookingFormat: category.bookingFormat,
    hasVariantCatA: category.hasVariantCatA,
    // F2 = per day rentals, F4 = slot-based rentals
    rentalType: category.bookingFormat === "F2" ? "per_day" :  category.bookingFormat === "F4" ? "slot_based" : null,
  };
};

/**
 * Validate variant metadata against field definitions
 */
export const validateVariantMetadata = async (
  categoryId: string,
  metadata: Record<string, any>
): Promise<{ isValid: boolean; errors: string[] }> => {
  const errors: string[] = [];

  // Get required field definitions for this category
  const fieldDefinitions = await prisma.listingVariantMetadataFieldDefinition.findMany({
    where: {
      categoryId,
      isRequired: true,
    },
    select:  {
      fieldKey: true,
      fieldLabel: true,
    },
  });

  // Check required fields
  for (const field of fieldDefinitions) {
    if (!metadata[field.fieldKey] || metadata[field.fieldKey] === "") {
      errors.push(`${field.fieldLabel} is required`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Get default variant metadata structure for a category
 * Returns null values for all fields since defaultValue doesn't exist in schema
 */
export const getDefaultVariantMetadata = async (categoryId: string): Promise<Record<string, any>> => {
  const fieldDefinitions = await prisma.listingVariantMetadataFieldDefinition.findMany({
    where: {
      categoryId,
    },
    select: {
      fieldKey: true,
      fieldType: true,
    },
    orderBy: { displayOrder: "asc" },
  });

  const defaultMetadata: Record<string, any> = {};

  for (const field of fieldDefinitions) {
    // Initialize with appropriate null/empty values based on field type
    switch (field.fieldType) {
      case "number":
        defaultMetadata[field.fieldKey] = null;
        break;
      case "boolean":
        defaultMetadata[field.fieldKey] = false;
        break;
      case "multiselect":
      case "json_array":
        defaultMetadata[field.fieldKey] = [];
        break;
      default:
        defaultMetadata[field.fieldKey] = null;
    }
  }

  return defaultMetadata;
};

/**
 * Get variant field definitions with options for a category
 */
export const getVariantFieldDefinitionsWithOptions = async (categoryId: string) => {
  return await prisma.listingVariantMetadataFieldDefinition.findMany({
    where: {
      categoryId,
    },
    include: {
      options: {
        orderBy: { displayOrder: "asc" },
      },
    },
    orderBy: { displayOrder: "asc" },
  });
};

/**
 * Get variant options for a specific field
 */
export const getVariantFieldOptions = async (variantFieldDefinitionId: string) => {
  return await prisma.listingVariantMetadataFieldOptions.findMany({
    where: {
      variantFieldDefinitionId,
    },
    orderBy: { displayOrder: "asc" },
  });
};

/**
 * Check if variant metadata is valid for Cat-A rental
 */
export const isValidCatAMetadata = async (
  categoryId: string,
  metadata: Record<string, any>
): Promise<boolean> => {
  const hasCatA = await hasCatAVariants(categoryId);
  if (!hasCatA) return true; // Not a Cat-A category, so no validation needed

  const validation = await validateVariantMetadata(categoryId, metadata);
  return validation.isValid;
};

/**
 * Get grouped variant fields by fieldGroup
 */
export const getGroupedVariantFields = async (categoryId: string) => {
  const fields = await prisma.listingVariantMetadataFieldDefinition.findMany({
    where: {
      categoryId,
    },
    include: {
      options: {
        orderBy: { displayOrder: "asc" },
      },
    },
    orderBy: { displayOrder: "asc" },
  });

  // Group by fieldGroup
  const grouped: Record<string, typeof fields> = {};
  
  for (const field of fields) {
    const group = field.fieldGroup || "General";
    if (!grouped[group]) {
      grouped[group] = [];
    }
    grouped[group].push(field);
  }

  return grouped;
};