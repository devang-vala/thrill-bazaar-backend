import type { Context } from "hono";
import { prisma, withPrismaRetry } from "../db.js";
import { sanitizeString, generateSlug } from "../helpers/validation.helper.js";
import meilisearchService from "../services/meilisearch.service.js";

const normalizeMetadataBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === "true") {
      return true;
    }
    if (normalizedValue === "false") {
      return false;
    }
  }

  return null;
};

const buildMetadataFilterCondition = (
  fieldKey: string,
  rawValue: unknown,
  fieldType?: string | null,
) => {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }

  switch (fieldType) {
    case "text":
    case "textarea": {
      if (typeof rawValue !== "string" || !rawValue.trim()) {
        return null;
      }

      return {
        metadata: {
          path: [fieldKey],
          string_contains: rawValue.trim(),
        },
      };
    }

    case "number": {
      const numericValue =
        typeof rawValue === "number" ? rawValue : Number(String(rawValue).trim());

      if (!Number.isFinite(numericValue)) {
        return null;
      }

      return {
        metadata: {
          path: [fieldKey],
          equals: numericValue,
        },
      };
    }

    case "boolean": {
      const booleanValue = normalizeMetadataBoolean(rawValue);
      if (booleanValue === null) {
        return null;
      }

      return {
        metadata: {
          path: [fieldKey],
          equals: booleanValue,
        },
      };
    }

    case "multiselect":
    case "json_array": {
      const values = (Array.isArray(rawValue) ? rawValue : [rawValue])
        .map((value) => String(value).trim())
        .filter(Boolean);

      if (values.length === 0) {
        return null;
      }

      return {
        OR: values.map((value) => ({
          metadata: {
            path: [fieldKey],
            array_contains: [value],
          },
        })),
      };
    }

    case "select":
    case "date":
    case "time":
    case "datetime":
    default: {
      if (Array.isArray(rawValue)) {
        const values = rawValue
          .map((value) => String(value).trim())
          .filter(Boolean);

        if (values.length === 0) {
          return null;
        }

        return {
          OR: values.map((value) => ({
            metadata: {
              path: [fieldKey],
              equals: value,
            },
          })),
        };
      }

      if (typeof rawValue === "string") {
        const trimmedValue = rawValue.trim();
        if (!trimmedValue) {
          return null;
        }

        return {
          metadata: {
            path: [fieldKey],
            equals: trimmedValue,
          },
        };
      }

      return {
        metadata: {
          path: [fieldKey],
          equals: rawValue,
        },
      };
    }
  }
};

type ListingFacetDimension =
  | "category"
  | "subcategory"
  | "location"
  | "seller"
  | "metadata";

const parseCsvFilter = (value?: string | null) =>
  (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const resolveCategoryFilterValues = async (rawValues?: string | null) => {
  const categoryFilters = Array.from(new Set(parseCsvFilter(rawValues)));

  if (categoryFilters.length === 0) {
    return [];
  }

  const matchingCategories = await prisma.category.findMany({
    where: {
      OR: [
        { id: { in: categoryFilters } },
        { categorySlug: { in: categoryFilters } },
      ],
    },
    select: {
      id: true,
      categorySlug: true,
    },
  });

  const categoryIdByFilter = new Map<string, string>();
  for (const category of matchingCategories) {
    categoryIdByFilter.set(category.id, category.id);
    categoryIdByFilter.set(category.categorySlug, category.id);
  }

  return categoryFilters
    .map((value) => categoryIdByFilter.get(value))
    .filter((value): value is string => Boolean(value));
};

const resolveAvailableListingIds = async ({
  formats,
  availableOnDate,
  dateRangeStart,
  dateRangeEnd,
}: {
  formats?: string | null;
  availableOnDate?: string | null;
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
}): Promise<string[] | null> => {
  if (!dateRangeStart && !dateRangeEnd && !availableOnDate) {
    return null;
  }

  const formatList = formats
    ? formats.split(",").filter(Boolean)
    : ["F1", "F2", "F3", "F4"];
  const availableListingIds: string[] = [];

  const enumerateUtcDateKeys = (start: Date, end: Date) => {
    const keys: string[] = [];
    const current = new Date(start);

    while (current <= end) {
      keys.push(current.toISOString().split("T")[0]);
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return keys;
  };

  if (dateRangeStart && dateRangeEnd) {
    const filterDateStart = new Date(`${dateRangeStart}T00:00:00.000Z`);
    const filterDateEnd = new Date(`${dateRangeEnd}T23:59:59.999Z`);

    if (Number.isNaN(filterDateStart.getTime()) || Number.isNaN(filterDateEnd.getTime())) {
      throw new Error("Invalid date range format. Use YYYY-MM-DD");
    }

    if (formatList.includes("F1")) {
      const f1Slots = await prisma.listingSlot.findMany({
        where: {
          isActive: true,
          availableCount: { gt: 0 },
          formatType: "F1",
          listing: {
            bookingFormat: "F1",
          },
          batchStartDate: {
            gte: filterDateStart,
            lte: filterDateEnd,
          },
        },
        select: {
          listingId: true,
        },
        distinct: ["listingId"],
      });

      availableListingIds.push(...f1Slots.map((slot) => slot.listingId));
    }

    if (formatList.includes("F3")) {
      const f3Slots = await prisma.listingSlot.findMany({
        where: {
          isActive: true,
          availableCount: { gt: 0 },
          formatType: "F3",
          listing: {
            bookingFormat: "F3",
          },
          slotDate: {
            gte: filterDateStart,
            lte: filterDateEnd,
          },
        },
        select: {
          listingId: true,
        },
        distinct: ["listingId"],
      });

      availableListingIds.push(...f3Slots.map((slot) => slot.listingId));
    }

    if (formatList.includes("F2") || formatList.includes("F4")) {
      const rentalFormats = formatList.filter((format) => format === "F2" || format === "F4");
      const selectedDateKeys = enumerateUtcDateKeys(filterDateStart, filterDateEnd);

      const candidateDateRanges = await prisma.inventoryDateRange.findMany({
        where: {
          isActive: true,
          listing: {
            bookingFormat: { in: rentalFormats },
          },
          OR: [{ availableCount: { gt: 0 } }, { availableCount: null }],
          availableFromDate: { lte: filterDateEnd },
          availableToDate: { gte: filterDateStart },
        },
        select: {
          listingId: true,
          variantId: true,
          slotDefinitionId: true,
          availableFromDate: true,
          availableToDate: true,
          listing: {
            select: {
              bookingFormat: true,
            },
          },
        },
      });

      const blockedDates = await prisma.inventoryBlockedDate.findMany({
        where: {
          listing: {
            bookingFormat: { in: rentalFormats },
          },
          blockedDate: {
            gte: filterDateStart,
            lte: filterDateEnd,
          },
        },
        select: {
          listingId: true,
          variantId: true,
          blockedDate: true,
        },
      });

      const groupedRanges = new Map<string, typeof candidateDateRanges>();
      for (const range of candidateDateRanges) {
        const slotKey =
          range.listing.bookingFormat === "F4"
            ? range.slotDefinitionId ?? "__no_slot__"
            : "__no_slot__";
        const groupKey = `${range.listingId}::${range.variantId ?? "__no_variant__"}::${slotKey}`;
        const existing = groupedRanges.get(groupKey) ?? [];
        existing.push(range);
        groupedRanges.set(groupKey, existing);
      }

      const blockedDateMap = new Map<string, Set<string>>();
      for (const blockedDate of blockedDates) {
        const groupPrefix = `${blockedDate.listingId}::${blockedDate.variantId ?? "__no_variant__"}::`;
        const blockedKey = blockedDate.blockedDate.toISOString().split("T")[0];

        for (const groupKey of groupedRanges.keys()) {
          if (!groupKey.startsWith(groupPrefix)) continue;

          if (!blockedDateMap.has(groupKey)) {
            blockedDateMap.set(groupKey, new Set<string>());
          }
          blockedDateMap.get(groupKey)!.add(blockedKey);
        }
      }

      for (const [groupKey, ranges] of groupedRanges.entries()) {
        const coveredKeys = new Set<string>();
        const blockedKeys = blockedDateMap.get(groupKey) ?? new Set<string>();

        for (const range of ranges) {
          const overlappingStart =
            range.availableFromDate > filterDateStart ? range.availableFromDate : filterDateStart;
          const overlappingEnd =
            range.availableToDate < filterDateEnd ? range.availableToDate : filterDateEnd;

          if (overlappingStart > overlappingEnd) continue;

          for (const dateKey of enumerateUtcDateKeys(overlappingStart, overlappingEnd)) {
            coveredKeys.add(dateKey);
          }
        }

        const hasFullCoverage = selectedDateKeys.every(
          (dateKey) => coveredKeys.has(dateKey) && !blockedKeys.has(dateKey),
        );

        if (hasFullCoverage) {
          availableListingIds.push(groupKey.split("::")[0]);
        }
      }
    }

    return Array.from(new Set(availableListingIds));
  }

  if (availableOnDate) {
    const filterDate = new Date(`${availableOnDate}T00:00:00.000Z`);
    if (Number.isNaN(filterDate.getTime())) {
      throw new Error("Invalid date format. Use YYYY-MM-DD");
    }

    const nextDay = new Date(filterDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const activityFormats = formatList.filter((format) => format === "F1" || format === "F3");
    const rentalFormats = formatList.filter((format) => format === "F2" || format === "F4");

    if (activityFormats.length > 0) {
      const activitySlots = await prisma.listingSlot.findMany({
        where: {
          isActive: true,
          availableCount: { gt: 0 },
          listing: {
            bookingFormat: { in: activityFormats },
          },
          OR: [
            {
              formatType: "F1",
              batchStartDate: { lte: filterDate },
              batchEndDate: { gte: filterDate },
            },
            {
              formatType: "F3",
              slotDate: {
                gte: filterDate,
                lt: nextDay,
              },
            },
          ],
        },
        select: {
          listingId: true,
        },
        distinct: ["listingId"],
      });

      availableListingIds.push(...activitySlots.map((slot) => slot.listingId));
    }

    if (rentalFormats.length > 0) {
      const rentalDateRanges = await prisma.inventoryDateRange.findMany({
        where: {
          isActive: true,
          listing: {
            bookingFormat: { in: rentalFormats },
          },
          OR: [{ availableCount: { gt: 0 } }, { availableCount: null }],
          availableFromDate: { lte: filterDate },
          availableToDate: { gte: filterDate },
        },
        select: {
          listingId: true,
        },
        distinct: ["listingId"],
      });

      availableListingIds.push(...rentalDateRanges.map((range) => range.listingId));
    }

    return Array.from(new Set(availableListingIds));
  }

  return null;
};

const buildListingsWhereClause = async (
  c: Context,
  excludedDimensions: Set<ListingFacetDimension> = new Set(),
) => {
  const status = c.req.query("status");
  const searchTerm = (c.req.query("search") || c.req.query("q") || "").trim();
  const startPrimaryDivisions = c.req.query("startPrimaryDivisions");
  const startSecondaryDivisions = c.req.query("startSecondaryDivisions");
  const endPrimaryDivisions = c.req.query("endPrimaryDivisions");
  const endSecondaryDivisions = c.req.query("endSecondaryDivisions");
  const categories = c.req.query("categories");
  const subcategories = c.req.query("subcategories");
  const sellers = c.req.query("sellers");
  const formats = c.req.query("formats");
  const metadataFilters = c.req.query("metadata");
  const availableOnDate = c.req.query("availableOnDate");
  const dateRangeStart = c.req.query("dateRangeStart");
  const dateRangeEnd = c.req.query("dateRangeEnd");
  const whereClause: any = {};
  const user = c.get("user");
  const sellerIds = excludedDimensions.has("seller") ? [] : parseCsvFilter(sellers);
  const isViewingOwnListings =
    user && sellerIds.length > 0 && sellerIds.includes(user.userId);

  if (status) {
    whereClause.status = status;
  } else if (!isViewingOwnListings && (!user || user.role === "customer" || user.userType === "customer")) {
    whereClause.status = "active";
  }

  if (!excludedDimensions.has("location")) {
    const startPrimaryIds = parseCsvFilter(startPrimaryDivisions);
    const startSecondaryIds = parseCsvFilter(startSecondaryDivisions);
    const endPrimaryIds = parseCsvFilter(endPrimaryDivisions);
    const endSecondaryIds = parseCsvFilter(endSecondaryDivisions);

    if (startPrimaryIds.length > 0) whereClause.startPrimaryDivisionId = { in: startPrimaryIds };
    if (startSecondaryIds.length > 0) whereClause.startSecondaryDivisionId = { in: startSecondaryIds };
    if (endPrimaryIds.length > 0) whereClause.endPrimaryDivisionId = { in: endPrimaryIds };
    if (endSecondaryIds.length > 0) whereClause.endSecondaryDivisionId = { in: endSecondaryIds };
  }

  if (!excludedDimensions.has("category")) {
    const categoryIds = await resolveCategoryFilterValues(categories);
    if (categories) {
      whereClause.categoryId = { in: categoryIds };
    }
  }

  if (!excludedDimensions.has("subcategory")) {
    const subCategoryIds = parseCsvFilter(subcategories);
    if (subCategoryIds.length > 0) whereClause.subCatId = { in: subCategoryIds };
  }

  if (!excludedDimensions.has("seller") && sellerIds.length > 0) {
    whereClause.operatorId = { in: sellerIds };
  }

  if (formats) {
    const formatList = formats.split(",").filter(Boolean);
    if (formatList.length > 0) whereClause.bookingFormat = { in: formatList };
  }

  if (searchTerm) {
    whereClause.OR = [
      { listingName: { contains: searchTerm, mode: "insensitive" } },
      { listingSlug: { contains: searchTerm, mode: "insensitive" } },
      { startLocationName: { contains: searchTerm, mode: "insensitive" } },
      { startPrimaryDivision: { division_name: { contains: searchTerm, mode: "insensitive" } } },
      { startSecondaryDivision: { division_name: { contains: searchTerm, mode: "insensitive" } } },
      { endPrimaryDivision: { division_name: { contains: searchTerm, mode: "insensitive" } } },
      { endSecondaryDivision: { division_name: { contains: searchTerm, mode: "insensitive" } } },
      { category: { categoryName: { contains: searchTerm, mode: "insensitive" } } },
      { subCategory: { subCatName: { contains: searchTerm, mode: "insensitive" } } },
      {
        operator: {
          OR: [
            { firstName: { contains: searchTerm, mode: "insensitive" } },
            { lastName: { contains: searchTerm, mode: "insensitive" } },
            { email: { contains: searchTerm, mode: "insensitive" } },
            {
              operatorProfile: {
                companyName: {
                  contains: searchTerm,
                  mode: "insensitive",
                },
              },
            },
          ],
        },
      },
    ];
  }

  if (!excludedDimensions.has("metadata") && metadataFilters) {
    try {
      const parsedMetadata = JSON.parse(metadataFilters);
      if (
        parsedMetadata &&
        typeof parsedMetadata === "object" &&
        !Array.isArray(parsedMetadata) &&
        Object.keys(parsedMetadata).length > 0
      ) {
        const metadataEntries = Object.entries(parsedMetadata).filter(
          ([, value]) =>
            value !== null &&
            value !== undefined &&
            value !== "" &&
            (!Array.isArray(value) || value.length > 0),
        );

        if (metadataEntries.length > 0) {
          const fieldDefinitions = await prisma.listingMetadataFieldDefinition.findMany({
            where: {
              fieldKey: { in: metadataEntries.map(([key]) => key) },
              isFilter: true,
            },
            select: {
              fieldKey: true,
              fieldType: true,
            },
          });

          const fieldTypeByKey = new Map(
            fieldDefinitions.map((fieldDefinition) => [
              fieldDefinition.fieldKey,
              fieldDefinition.fieldType,
            ]),
          );

          const metadataConditions = metadataEntries
            .map(([key, value]) =>
              buildMetadataFilterCondition(key, value, fieldTypeByKey.get(key)),
            )
            .filter(Boolean);

          if (metadataConditions.length > 0) {
            const existingAndConditions = Array.isArray(whereClause.AND)
              ? whereClause.AND
              : whereClause.AND
                ? [whereClause.AND]
                : [];

            whereClause.AND = [...existingAndConditions, ...metadataConditions];
          }
        }
      }
    } catch (err) {
      console.error("Error parsing metadata filters:", err);
    }
  }

  const availableListingIds = await resolveAvailableListingIds({
    formats,
    availableOnDate,
    dateRangeStart,
    dateRangeEnd,
  });

  if (availableListingIds) {
    whereClause.id = { in: availableListingIds };
  }

  return whereClause;
};

/**
 * Common include object for badges - reusable across endpoints
 */
const badgesInclude = {
  badges: {
    where: { isActive: true },
    select: {
      id: true,
      isActive: true,
      assignedAt: true,
      badge: {
        select: {
          id: true,
          badgeName: true,
          badgeType: true,
          badgeIconUrl: true,
          badgeColor: true,
          displayOrder: true,
        },
      },
    },
    orderBy: { badge: { displayOrder: "asc" as const } },
  },
};

/**
 * Common include object for tags - reusable across endpoints
 */
const tagsInclude = {
  tags: {
    where: { isActive: true },
    select: {
      id: true,
      isActive: true,
      assignedAt: true,
      tag: {
        select: {
          id: true,
          tagName: true,
          tagType: true,
          tagColor: true,
          displayOrder: true,
        },
      },
    },
    orderBy: { tag: { displayOrder: "asc" as const } },
  },
};

/**
 * Limited badges/tags for listing cards (better performance)
 */
const badgesIncludeLimited = {
  badges: {
    where: { isActive: true },
    select: {
      id: true,
      isActive: true,
      badge: {
        select: {
          id: true,
          badgeName: true,
          badgeIconUrl: true,
          badgeColor: true,
        },
      },
    },
    take: 1, // Only first badge for card display
    orderBy: { badge: { displayOrder: "asc" as const } },
  },
};

const tagsIncludeLimited = {
  tags: {
    where: { isActive: true },
    select: {
      id: true,
      isActive: true,
      tag: {
        select: {
          id: true,
          tagName: true,
          tagColor: true,
        },
      },
    },
    take: 2, // Only first 2 tags for card display
    orderBy: { tag: { displayOrder: "asc" as const } },
  },
};

/**
 * Get all listings with optional pagination
 */
export const getListings = async (c: Context) => {
  try {
    // Get query parameters for pagination
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "12");
    const status = c.req.query("status"); // optional filter by status
    const sortBy = c.req.query("sortBy"); // sorting option
    const searchTerm = (c.req.query("search") || c.req.query("q") || "").trim();

    // Get location filter parameters
    const startPrimaryDivisions = c.req.query("startPrimaryDivisions"); // comma-separated IDs
    const startSecondaryDivisions = c.req.query("startSecondaryDivisions"); // comma-separated IDs
    const endPrimaryDivisions = c.req.query("endPrimaryDivisions"); // comma-separated IDs
    const endSecondaryDivisions = c.req.query("endSecondaryDivisions"); // comma-separated IDs

    // Get category and seller filter parameters
    const categories = c.req.query("categories"); // comma-separated category IDs
    const subcategories = c.req.query("subcategories"); // comma-separated sub-category IDs
    const sellers = c.req.query("sellers"); // comma-separated operator/seller IDs

    // Get format filter parameters
    const formats = c.req.query("formats"); // comma-separated format types (F1, F2, F3, F4)

    // Get metadata filter parameters (JSON string)
    const metadataFilters = c.req.query("metadata"); // JSON string of metadata filters

    // Get date filter parameter (YYYY-MM-DD format)
    const availableOnDate = c.req.query("availableOnDate"); // Filter listings available on this specific date
    const dateRangeStart = c.req.query("dateRangeStart"); // Filter listings available in this date range
    const dateRangeEnd = c.req.query("dateRangeEnd"); // Filter listings available in this date range

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Build where clause
    const whereClause: any = {};

    // Get user context if authenticated
    const user = c.get("user");

    // Add seller/operator filter first (needed for determining status filter)
    const sellerIds = sellers ? sellers.split(",").filter(Boolean) : [];
    const isViewingOwnListings = user && sellerIds.length > 0 && sellerIds.includes(user.userId);

    if (status) {
      whereClause.status = status;
    } else {
      // If operator is viewing their own listings, show all statuses
      // Otherwise, only show active listings for unauthenticated users or customers
      if (!isViewingOwnListings && (!user || user.role === "customer" || user.userType === "customer")) {
        whereClause.status = "active";
      }
      // For operators viewing their own listings, or admins, don't filter by status
    }

    // Add location filters
    if (startPrimaryDivisions) {
      const divisionIds = startPrimaryDivisions.split(",").filter(Boolean);
      if (divisionIds.length > 0) {
        whereClause.startPrimaryDivisionId = { in: divisionIds };
      }
    }

    if (startSecondaryDivisions) {
      const divisionIds = startSecondaryDivisions.split(",").filter(Boolean);
      if (divisionIds.length > 0) {
        whereClause.startSecondaryDivisionId = { in: divisionIds };
      }
    }

    if (endPrimaryDivisions) {
      const divisionIds = endPrimaryDivisions.split(",").filter(Boolean);
      if (divisionIds.length > 0) {
        whereClause.endPrimaryDivisionId = { in: divisionIds };
      }
    }

    if (endSecondaryDivisions) {
      const divisionIds = endSecondaryDivisions.split(",").filter(Boolean);
      if (divisionIds.length > 0) {
        whereClause.endSecondaryDivisionId = { in: divisionIds };
      }
    }

    // Add category filter
    if (categories) {
      const categoryIds = await resolveCategoryFilterValues(categories);
      whereClause.categoryId = { in: categoryIds };
    }

    if (subcategories) {
      const subCategoryIds = subcategories.split(",").filter(Boolean);
      if (subCategoryIds.length > 0) {
        whereClause.subCatId = { in: subCategoryIds };
      }
    }

    // Add seller/operator filter (sellerIds already parsed above)
    if (sellerIds.length > 0) {
      whereClause.operatorId = { in: sellerIds };
    }

    // Add format filter
    if (formats) {
      const formatList = formats.split(",").filter(Boolean);
      if (formatList.length > 0) {
        whereClause.bookingFormat = { in: formatList };
      }
    }

    if (searchTerm) {
      whereClause.OR = [
        { listingName: { contains: searchTerm, mode: "insensitive" } },
        { listingSlug: { contains: searchTerm, mode: "insensitive" } },
        { startLocationName: { contains: searchTerm, mode: "insensitive" } },
        {
          startPrimaryDivision: {
            division_name: { contains: searchTerm, mode: "insensitive" },
          },
        },
        {
          startSecondaryDivision: {
            division_name: { contains: searchTerm, mode: "insensitive" },
          },
        },
        {
          endPrimaryDivision: {
            division_name: { contains: searchTerm, mode: "insensitive" },
          },
        },
        {
          endSecondaryDivision: {
            division_name: { contains: searchTerm, mode: "insensitive" },
          },
        },
        {
          category: {
            categoryName: { contains: searchTerm, mode: "insensitive" },
          },
        },
        {
          subCategory: {
            subCatName: { contains: searchTerm, mode: "insensitive" },
          },
        },
        {
          operator: {
            OR: [
              { firstName: { contains: searchTerm, mode: "insensitive" } },
              { lastName: { contains: searchTerm, mode: "insensitive" } },
              { email: { contains: searchTerm, mode: "insensitive" } },
              {
                operatorProfile: {
                  companyName: {
                    contains: searchTerm,
                    mode: "insensitive",
                  },
                },
              },
            ],
          },
        },
      ];
    }

    // Add metadata filters
    if (metadataFilters) {
      try {
        const parsedMetadata = JSON.parse(metadataFilters);
        if (
          parsedMetadata &&
          typeof parsedMetadata === "object" &&
          !Array.isArray(parsedMetadata) &&
          Object.keys(parsedMetadata).length > 0
        ) {
          const metadataEntries = Object.entries(parsedMetadata).filter(
            ([, value]) =>
              value !== null &&
              value !== undefined &&
              value !== "" &&
              (!Array.isArray(value) || value.length > 0),
          );

          if (metadataEntries.length > 0) {
            const fieldDefinitions = await prisma.listingMetadataFieldDefinition.findMany({
              where: {
                fieldKey: {
                  in: metadataEntries.map(([key]) => key),
                },
                isFilter: true,
              },
              select: {
                fieldKey: true,
                fieldType: true,
              },
            });

            const fieldTypeByKey = new Map(
              fieldDefinitions.map((fieldDefinition) => [
                fieldDefinition.fieldKey,
                fieldDefinition.fieldType,
              ]),
            );

            const metadataConditions = metadataEntries
              .map(([key, value]) =>
                buildMetadataFilterCondition(key, value, fieldTypeByKey.get(key)),
              )
              .filter(Boolean);

            if (metadataConditions.length > 0) {
              const existingAndConditions = Array.isArray(whereClause.AND)
                ? whereClause.AND
                : whereClause.AND
                  ? [whereClause.AND]
                  : [];

              whereClause.AND = [...existingAndConditions, ...metadataConditions];
            }
          }
        }
      } catch (err) {
        console.error("Error parsing metadata filters:", err);
      }
    }

    // Add date range availability filter
    if (dateRangeStart && dateRangeEnd) {
      try {
        const filterDateStart = new Date(`${dateRangeStart}T00:00:00.000Z`);
        const filterDateEnd = new Date(`${dateRangeEnd}T23:59:59.999Z`);
        const formatList = formats ? formats.split(",").filter(Boolean) : ["F1", "F2", "F3", "F4"];
        const availableListingIds: string[] = [];

        const enumerateUtcDateKeys = (start: Date, end: Date) => {
          const keys: string[] = [];
          const current = new Date(start);

          while (current <= end) {
            keys.push(current.toISOString().split("T")[0]);
            current.setUTCDate(current.getUTCDate() + 1);
          }

          return keys;
        };

        if (formatList.includes("F1")) {
          const f1Slots = await prisma.listingSlot.findMany({
            where: {
              isActive: true,
              availableCount: { gt: 0 },
              formatType: "F1",
              listing: {
                bookingFormat: "F1",
              },
              batchStartDate: {
                gte: filterDateStart,
                lte: filterDateEnd,
              },
            },
            select: {
              listingId: true,
            },
            distinct: ["listingId"],
          });

          availableListingIds.push(...f1Slots.map((slot) => slot.listingId));
        }

        if (formatList.includes("F3")) {
          const f3Slots = await prisma.listingSlot.findMany({
            where: {
              isActive: true,
              availableCount: { gt: 0 },
              formatType: "F3",
              listing: {
                bookingFormat: "F3",
              },
              slotDate: {
                gte: filterDateStart,
                lte: filterDateEnd,
              },
            },
            select: {
              listingId: true,
            },
            distinct: ["listingId"],
          });

          availableListingIds.push(...f3Slots.map((slot) => slot.listingId));
        }

        if (formatList.includes("F2") || formatList.includes("F4")) {
          const rentalFormats = formatList.filter((format) => format === "F2" || format === "F4");
          const selectedDateKeys = enumerateUtcDateKeys(filterDateStart, filterDateEnd);

          const candidateDateRanges = await prisma.inventoryDateRange.findMany({
            where: {
              isActive: true,
              listing: {
                bookingFormat: { in: rentalFormats },
              },
              OR: [
                { availableCount: { gt: 0 } },
                { availableCount: null },
              ],
              availableFromDate: { lte: filterDateEnd },
              availableToDate: { gte: filterDateStart },
            },
            select: {
              listingId: true,
              variantId: true,
              slotDefinitionId: true,
              availableFromDate: true,
              availableToDate: true,
              listing: {
                select: {
                  bookingFormat: true,
                },
              },
            },
          });

          const blockedDates = await prisma.inventoryBlockedDate.findMany({
            where: {
              listing: {
                bookingFormat: { in: rentalFormats },
              },
              blockedDate: {
                gte: filterDateStart,
                lte: filterDateEnd,
              },
            },
            select: {
              listingId: true,
              variantId: true,
              blockedDate: true,
            },
          });

          const groupedRanges = new Map<string, typeof candidateDateRanges>();
          for (const range of candidateDateRanges) {
            const slotKey =
              range.listing.bookingFormat === "F4"
                ? range.slotDefinitionId ?? "__no_slot__"
                : "__no_slot__";
            const groupKey = `${range.listingId}::${range.variantId ?? "__no_variant__"}::${slotKey}`;
            const existing = groupedRanges.get(groupKey) ?? [];
            existing.push(range);
            groupedRanges.set(groupKey, existing);
          }

          const blockedDateMap = new Map<string, Set<string>>();
          for (const blockedDate of blockedDates) {
            const groupPrefix = `${blockedDate.listingId}::${blockedDate.variantId ?? "__no_variant__"}::`;
            const blockedKey = blockedDate.blockedDate.toISOString().split("T")[0];

            for (const groupKey of groupedRanges.keys()) {
              if (!groupKey.startsWith(groupPrefix)) continue;

              if (!blockedDateMap.has(groupKey)) {
                blockedDateMap.set(groupKey, new Set<string>());
              }
              blockedDateMap.get(groupKey)!.add(blockedKey);
            }
          }

          for (const [groupKey, ranges] of groupedRanges.entries()) {
            const coveredKeys = new Set<string>();
            const blockedKeys = blockedDateMap.get(groupKey) ?? new Set<string>();

            for (const range of ranges) {
              const overlappingStart = range.availableFromDate > filterDateStart ? range.availableFromDate : filterDateStart;
              const overlappingEnd = range.availableToDate < filterDateEnd ? range.availableToDate : filterDateEnd;

              if (overlappingStart > overlappingEnd) continue;

              for (const dateKey of enumerateUtcDateKeys(overlappingStart, overlappingEnd)) {
                coveredKeys.add(dateKey);
              }
            }

            const hasFullCoverage = selectedDateKeys.every(
              (dateKey) => coveredKeys.has(dateKey) && !blockedKeys.has(dateKey)
            );

            if (hasFullCoverage) {
              availableListingIds.push(groupKey.split("::")[0]);
            }
          }
        }

        const uniqueListingIds = Array.from(new Set(availableListingIds));

        if (uniqueListingIds.length === 0) {
          return c.json({
            success: true,
            data: [],
            pagination: {
              page,
              limit,
              totalCount: 0,
              totalPages: 0,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          });
        }

        whereClause.id = { in: uniqueListingIds };
      } catch (err) {
        console.error("Error parsing date range filter:", err);
        return c.json({ error: "Invalid date range format. Use YYYY-MM-DD" }, 400);
      }
    } else if (availableOnDate) {
      try {
        // Parse the date string to a Date object at start of day
        const filterDate = new Date(availableOnDate + 'T00:00:00.000Z');
        const nextDay = new Date(filterDate);
        nextDay.setDate(nextDay.getDate() + 1);

        // Determine which formats are being queried
        const formatList = formats ? formats.split(",").filter(Boolean) : ['F1', 'F2', 'F3', 'F4'];

        // Separate formats by their data source
        const activityFormats = formatList.filter(f => f === 'F1' || f === 'F3'); // Use ListingSlot
        const rentalFormats = formatList.filter(f => f === 'F2' || f === 'F4');   // Use InventoryDateRange

        const availableListingIds: string[] = [];

        // Query ListingSlot table for F1/F3 (activities)
        if (activityFormats.length > 0) {
          const activitySlots = await prisma.listingSlot.findMany({
            where: {
              isActive: true,
              availableCount: { gt: 0 },
              // Filter by listing's bookingFormat
              listing: {
                bookingFormat: { in: activityFormats }
              },
              OR: [
                // For F1 (batch activities): Check if date falls within batch range
                {
                  formatType: 'F1',
                  batchStartDate: { lte: filterDate },
                  batchEndDate: { gte: filterDate }
                },
                // For F3 (single-day activities): Check if slotDate matches
                {
                  formatType: 'F3',
                  slotDate: {
                    gte: filterDate,
                    lt: nextDay
                  }
                }
              ]
            },
            select: {
              listingId: true
            },
            distinct: ['listingId']
          });

          availableListingIds.push(...activitySlots.map(slot => slot.listingId));
        }

        // Query InventoryDateRange table for F2/F4 (rentals)
        if (rentalFormats.length > 0) {
          const rentalDateRanges = await prisma.inventoryDateRange.findMany({
            where: {
              isActive: true,
              // Filter by listing's bookingFormat to only get rentals
              listing: {
                bookingFormat: { in: rentalFormats }
              },
              OR: [
                // Check if availableCount exists and is greater than 0
                { availableCount: { gt: 0 } },
                // If availableCount is null, consider it available
                { availableCount: null }
              ],
              // Check if the filter date falls within the available date range
              availableFromDate: { lte: filterDate },
              availableToDate: { gte: filterDate }
            },
            select: {
              listingId: true
            },
            distinct: ['listingId']
          });

          availableListingIds.push(...rentalDateRanges.map(range => range.listingId));
        }

        // Remove duplicates
        const uniqueListingIds = Array.from(new Set(availableListingIds));

        // If no listings have availability on this date, return empty result
        if (uniqueListingIds.length === 0) {
          return c.json({
            success: true,
            data: [],
            pagination: {
              page,
              limit,
              totalCount: 0,
              totalPages: 0,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          });
        }

        // Filter listings to only those with availability
        whereClause.id = { in: uniqueListingIds };
      } catch (err) {
        console.error("Error parsing availableOnDate filter:", err);
        return c.json({ error: "Invalid date format. Use YYYY-MM-DD" }, 400);
      }
    }

    // Build orderBy clause based on sortBy parameter
    let orderByClause: any = { createdAt: "desc" }; // default
    let shouldSortByDateClientSide = false; // Flag for client-side date sorting

    if (sortBy) {
      switch (sortBy) {
        case 'price_low':
          orderByClause = { basePriceDisplay: "asc" };
          break;
        case 'price_high':
          orderByClause = { basePriceDisplay: "desc" };
          break;
        case 'newest':
          orderByClause = { createdAt: "desc" };
          break;
        case 'rating':
          // If you have a rating field, use it here
          orderByClause = { createdAt: "desc" }; // fallback for now
          break;
        case 'popular':
          // If you have a views/bookings field, use it here
          orderByClause = { createdAt: "desc" }; // fallback for now
          break;
        case 'date_earliest':
        case 'date_latest':
          // Date sorting will be done client-side after fetching next available dates
          shouldSortByDateClientSide = true;
          orderByClause = { createdAt: "desc" }; // default order for initial fetch
          break;
        default:
          orderByClause = { createdAt: "desc" };
      }
    }

    const [totalCount, listings] = await Promise.all([
      prisma.listing.count({
        where: whereClause,
      }),
      prisma.listing.findMany({
        where: whereClause,
        select: {
          id: true,
          listingName: true,
          listingSlug: true,
          frontImageUrl: true,
          bookingFormat: true,
          status: true,
          rejectionReason: true,
          basePriceDisplay: true,
          currency: true,
          metadata: true,
          startCountryId: true,
          startPrimaryDivisionId: true,
          startSecondaryDivisionId: true,
          startLocationName: true,
          startLocationCoordinates: true,
          endLocationName: true,
          createdAt: true,
          updatedAt: true,
          startCountry: {
            select: {
              country_id: true,
              country_name: true,
            },
          },
          startPrimaryDivision: {
            select: {
              primary_division_id: true,
              division_name: true,
            },
          },
          startSecondaryDivision: {
            select: {
              secondary_division_id: true,
              division_name: true,
            },
          },
          category: {
            select: {
              id: true,
              categoryName: true,
              metadataFieldDefinitions: {
                where: {
                  displayOrder: 10,
                },
                select: {
                  fieldKey: true,
                  fieldLabel: true,
                  displayOrder: true,
                },
                take: 1,
                orderBy: { displayOrder: "asc" },
              },
            },
          },
          subCategory: {
            select: {
              id: true,
              subCatName: true,
            },
          },
          operator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          media: {
            select: {
              media: true,
            },
            take: 1,
            orderBy: { createdAt: "asc" },
          },
          badges: {
            where: { isActive: true },
            select: {
              id: true,
              isActive: true,
              badge: {
                select: {
                  id: true,
                  badgeName: true,
                  badgeIconUrl: true,
                  badgeColor: true,
                },
              },
            },
            take: 1,
            orderBy: { badge: { displayOrder: "asc" } },
          },
          tags: {
            where: { isActive: true },
            select: {
              id: true,
              isActive: true,
              tag: {
                select: {
                  id: true,
                  tagName: true,
                  tagColor: true,
                },
              },
            },
            take: 2,
            orderBy: { tag: { displayOrder: "asc" } },
          },
        },
        orderBy: orderByClause,
        skip,
        take: limit,
      }),
    ]);

    const shouldIncludeNextAvailableDate =
      shouldSortByDateClientSide || Boolean(availableOnDate || (dateRangeStart && dateRangeEnd));

    let nextAvailableDateMap = new Map<string, Date | null>();

    if (shouldIncludeNextAvailableDate) {
      const now = new Date();
      const activityListingIds = listings
        .filter(l => l.bookingFormat === 'F1' || l.bookingFormat === 'F3')
        .map(l => l.id);

      const rentalListingIds = listings
        .filter(l => l.bookingFormat === 'F2' || l.bookingFormat === 'F4')
        .map(l => l.id);

      if (activityListingIds.length > 0) {
        const nextAvailableSlots = await prisma.listingSlot.findMany({
          where: {
            listingId: { in: activityListingIds },
            isActive: true,
            availableCount: { gt: 0 },
            listing: {
              bookingFormat: { in: ['F1', 'F3'] }
            },
            OR: [
              {
                batchStartDate: { gte: now },
                formatType: 'F1'
              },
              {
                slotDate: { gte: now },
                formatType: 'F3'
              }
            ]
          },
          select: {
            listingId: true,
            batchStartDate: true,
            slotDate: true,
            formatType: true,
          },
          orderBy: [
            { batchStartDate: 'asc' },
            { slotDate: 'asc' }
          ]
        });

        for (const slot of nextAvailableSlots) {
          if (!nextAvailableDateMap.has(slot.listingId)) {
            const date = (slot.formatType === 'F1')
              ? slot.batchStartDate
              : slot.slotDate;

            if (date) {
              nextAvailableDateMap.set(slot.listingId, date);
            }
          }
        }
      }

      if (rentalListingIds.length > 0) {
        const nextAvailableDateRanges = await prisma.inventoryDateRange.findMany({
          where: {
            listingId: { in: rentalListingIds },
            isActive: true,
            listing: {
              bookingFormat: { in: ['F2', 'F4'] }
            },
            OR: [
              { availableCount: { gt: 0 } },
              { availableCount: null }
            ],
            availableFromDate: { gte: now }
          },
          select: {
            listingId: true,
            availableFromDate: true,
          },
          orderBy: {
            availableFromDate: 'asc'
          }
        });

        for (const range of nextAvailableDateRanges) {
          if (!nextAvailableDateMap.has(range.listingId)) {
            nextAvailableDateMap.set(range.listingId, range.availableFromDate);
          }
        }
      }
    }

    // Add nextAvailableDate to each listing
    let responseData = listings.map(listing => ({
      ...listing,
      nextAvailableDate: nextAvailableDateMap.get(listing.id) || null
    }));

    // Apply date-based sorting if needed (client-side sorting after fetching dates)
    if (shouldSortByDateClientSide && sortBy) {
      responseData = responseData.sort((a, b) => {
        const dateA = a.nextAvailableDate ? new Date(a.nextAvailableDate).getTime() : Infinity;
        const dateB = b.nextAvailableDate ? new Date(b.nextAvailableDate).getTime() : Infinity;

        if (sortBy === 'date_earliest') {
          // Earliest dates first, listings without dates at the end
          return dateA - dateB;
        } else if (sortBy === 'date_latest') {
          // Latest dates first, but listings without dates at the end
          if (dateA === Infinity && dateB === Infinity) return 0;
          if (dateA === Infinity) return 1;
          if (dateB === Infinity) return -1;
          return dateB - dateA;
        }
        return 0;
      });
    }

    // Keep public caching only for unauthenticated catalog traffic.
    if (user) {
      c.header('Cache-Control', 'no-store');
    } else {
      c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
    }

    return c.json({
      success: true,
      data: responseData,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get listings error:", error);
    return c.json({ error: "Failed to fetch listings" }, 500);
  }
};

export const getListingFilterFacets = async (c: Context) => {
  try {
    const [categoryWhere, subcategoryWhere, locationWhere, sellerWhere] =
      await Promise.all([
        buildListingsWhereClause(c, new Set(["category", "subcategory", "metadata"])),
        buildListingsWhereClause(c, new Set(["subcategory"])),
        buildListingsWhereClause(c, new Set(["location"])),
        buildListingsWhereClause(c, new Set(["seller"])),
      ]);

    const [categoryMatches, subcategoryMatches, locationMatches, sellerMatches] =
      await Promise.all([
        prisma.listing.findMany({
          where: categoryWhere,
          select: {
            categoryId: true,
          },
          distinct: ["categoryId"],
        }),
        prisma.listing.findMany({
          where: subcategoryWhere,
          select: {
            subCatId: true,
          },
          distinct: ["subCatId"],
        }),
        prisma.listing.findMany({
          where: locationWhere,
          select: {
            startPrimaryDivisionId: true,
            startSecondaryDivisionId: true,
          },
          distinct: ["startPrimaryDivisionId", "startSecondaryDivisionId"],
        }),
        prisma.listing.findMany({
          where: sellerWhere,
          select: {
            operatorId: true,
          },
          distinct: ["operatorId"],
        }),
      ]);

    return c.json({
      success: true,
      data: {
        categoryIds: Array.from(
          new Set(
            categoryMatches
              .map((listing) => listing.categoryId)
              .filter((value): value is string => Boolean(value)),
          ),
        ),
        subcategoryIds: Array.from(
          new Set(
            subcategoryMatches
              .map((listing) => listing.subCatId)
              .filter((value): value is string => Boolean(value)),
          ),
        ),
        operatorIds: Array.from(
          new Set(
            sellerMatches
              .map((listing) => listing.operatorId)
              .filter((value): value is string => Boolean(value)),
          ),
        ),
        primaryDivisionIds: Array.from(
          new Set(
            locationMatches
              .map((listing) => listing.startPrimaryDivisionId)
              .filter((value): value is string => Boolean(value)),
          ),
        ),
        secondaryDivisionIds: Array.from(
          new Set(
            locationMatches
              .map((listing) => listing.startSecondaryDivisionId)
              .filter((value): value is string => Boolean(value)),
          ),
        ),
      },
    });
  } catch (error) {
    console.error("Get listing filter facets error:", error);

    const message = error instanceof Error ? error.message : "";
    if (message.includes("Invalid date")) {
      return c.json({ error: message }, 400);
    }

    return c.json({ error: "Failed to fetch listing facets" }, 500);
  }
};

/**
 * Admin endpoint: Get all listings (excluding drafts) with pagination
 * POST request to allow filtering criteria in body
 */
export const getAdminListings = async (c: Context) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const page = Math.max(1, Number(body.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(body.limit) || 12));
    const searchTerm = typeof body.searchTerm === "string" ? body.searchTerm.trim() : "";
    const statusFilter = typeof body.statusFilter === "string" ? body.statusFilter.trim() : "";
    const categoryId = typeof body.categoryId === "string" ? body.categoryId.trim() : "";

    const skip = (page - 1) * limit;

    const baseWhereClause: any = {
      status: {
        not: "draft",
      },
    };

    if (categoryId && categoryId !== "all") {
      baseWhereClause.categoryId = categoryId;
    }

    // Add search filter
    if (searchTerm) {
      baseWhereClause.OR = [
        { listingName: { contains: searchTerm, mode: "insensitive" } },
        { listingSlug: { contains: searchTerm, mode: "insensitive" } },
        {
          category: {
            categoryName: { contains: searchTerm, mode: "insensitive" },
          },
        },
        {
          operator: {
            OR: [
              { firstName: { contains: searchTerm, mode: "insensitive" } },
              { lastName: { contains: searchTerm, mode: "insensitive" } },
              { email: { contains: searchTerm, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    const whereClause: any = {
      ...baseWhereClause,
    };

    // Add optional status filter
    if (statusFilter && statusFilter !== "all") {
      whereClause.status = statusFilter;
    }

    const [totalCount, listings, groupedStatusCounts] = await Promise.all([
      prisma.listing.count({
        where: whereClause,
      }),
      prisma.listing.findMany({
        where: whereClause,
        include: {
          category: {
            select: {
              id: true,
              categoryName: true,
            },
          },
          subCategory: {
            select: {
              id: true,
              subCatName: true,
            },
          },
          operator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          badges: {
            where: { isActive: true },
            select: {
              id: true,
              isActive: true,
              assignedAt: true,
              badge: {
                select: {
                  id: true,
                  badgeName: true,
                  badgeType: true,
                  badgeIconUrl: true,
                  badgeColor: true,
                },
              },
            },
            orderBy: { badge: { displayOrder: "asc" } },
          },
          tags: {
            where: { isActive: true },
            select: {
              id: true,
              isActive: true,
              assignedAt: true,
              tag: {
                select: {
                  id: true,
                  tagName: true,
                  tagType: true,
                  tagColor: true,
                },
              },
            },
            orderBy: { tag: { displayOrder: "asc" } },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.listing.groupBy({
        by: ["status"],
        where: baseWhereClause,
        _count: {
          status: true,
        },
      }),
    ]);

    const statusCounts = groupedStatusCounts.reduce<Record<string, number>>(
      (acc, item) => {
        acc[item.status] = item._count.status;
        return acc;
      },
      {
        pending_approval: 0,
        active: 0,
        archived: 0,
        rejected: 0,
      }
    );

    return c.json({
      success: true,
      data: listings,
      statusCounts,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get admin listings error:", error);
    return c.json({
      success: false,
      error: "Failed to fetch listings"
    }, 500);
  }
};

/**
 * Get listing by slug (public endpoint)
 */
export const getListing = async (c: Context) => {
  try {
    const listingSlug = c.req.param("slug");
    const user = c.get("user");

    const listing = await withPrismaRetry(
      () =>
        prisma.listing.findUnique({
          where: { listingSlug: listingSlug },
          select: {
          id: true,
          listingName: true,
          listingSlug: true,
          frontImageUrl: true,
          bookingFormat: true,
          status: true,
          basePriceDisplay: true,
          currency: true,
          taxRate: true,
          advanceBookingPercentage: true,
          platformCommissionPercentage: true,
          tcsPercentage: true,
          metadata: true,
          startLocationName: true,
          startLocationCoordinates: true,
          startGoogleMapsUrl: true,
          endLocationName: true,
          endLocationCoordinates: true,
          endGoogleMapsUrl: true,
          approvedByAdminId: true,
          approvedAt: true,
          categoryId: true,
          category: {
            select: {
              id: true,
              categoryName: true,
            },
          },
          subCategory: {
            select: {
              id: true,
              subCatName: true,
            },
          },
          operator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              policies: {
                select: {
                  id: true,
                  policyType: true,
                  policyContent: true,
                  updatedAt: true,
                },
                orderBy: { policyType: "asc" },
              },
            },
          },
          startCountry: {
            select: {
              country_id: true,
              country_name: true,
            },
          },
          startPrimaryDivision: {
            select: {
              primary_division_id: true,
              division_name: true,
            },
          },
          startSecondaryDivision: {
            select: {
              secondary_division_id: true,
              division_name: true,
            },
          },
          endCountry: {
            select: {
              country_id: true,
              country_name: true,
            },
          },
          endPrimaryDivision: {
            select: {
              primary_division_id: true,
              division_name: true,
            },
          },
          endSecondaryDivision: {
            select: {
              secondary_division_id: true,
              division_name: true,
            },
          },
          variants: {
            select: {
              id: true,
              variantName: true,
              variantDescription: true,
              validParticipantNumbers: true,
              variantMetadata: true,
              variantOrder: true,
              approvalStatus: true,
            },
            orderBy: { variantOrder: "asc" },
          },
          content: {
            select: {
              id: true,
              contentType: true,
              title: true,
              contentText: true,
              contentOrder: true,
              imageUrls: true,
            },
            orderBy: { contentOrder: "asc" },
          },
          inclusionsExclusions: {
            select: {
              inclusions: true,
              exclusions: true,
            },
          },
          addons: {
            select: {
              addons: true,
            },
          },
          media: {
            select: {
              id: true,
              media: true,
            },
          },
          faqs: {
            select: {
              id: true,
              faqs: true,
            },
          },
          badges: {
            where: { isActive: true },
            select: {
              id: true,
              isActive: true,
              badge: {
                select: {
                  id: true,
                  badgeName: true,
                  badgeType: true,
                  badgeDescription: true,
                  badgeIconUrl: true,
                  badgeColor: true,
                  displayOrder: true,
                },
              },
            },
            orderBy: { badge: { displayOrder: "asc" } },
          },
          tags: {
            where: { isActive: true },
            select: {
              id: true,
              isActive: true,
              tag: {
                select: {
                  id: true,
                  tagName: true,
                  tagType: true,
                  tagColor: true,
                  displayOrder: true,
                },
              },
            },
            orderBy: { tag: { displayOrder: "asc" } },
          },
          },
        }),
      "getListing.findUnique"
    );

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    const fieldDefinitions = listing.categoryId
      ? await prisma.listingMetadataFieldDefinition.findMany({
          where: {
            categoryId: listing.categoryId,
          },
          select: {
            id: true,
            categoryId: true,
            fieldKey: true,
            fieldLabel: true,
            fieldType: true,
            isRequired: true,
            displayOrder: true,
            fieldGroup: true,
            imageUrl: true,
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
        })
      : [];

    // Transform media from JSON format to flat structure
    const transformedMedia = listing.media.map((m: any) => {
      const mediaData = typeof m.media === 'string' ? JSON.parse(m.media) : m.media;
      return {
        id: m.id,
        mediaType: mediaData.mediaType || 'image',
        mediaUrl: mediaData.mediaUrl || '',
        displayOrder: mediaData.displayOrder || 0,
        caption: mediaData.caption || null,
      };
    });

    // Check access: admins or listing owner (operator) can see all variants
    const isAdmin = user && (user.userType === "admin" || user.userType === "super_admin");
    const isOwner =
      user &&
      user.userType === "operator" &&
      listing.operator?.id &&
      user.userId === listing.operator.id;
    const canSeeAllVariants = Boolean(isAdmin || isOwner);

    if (!canSeeAllVariants) {
      // Remove admin-specific fields for non-admin users (public/customers)
      // Note: Sellers see rejection reason through their own listings query
      const { approvedByAdminId, approvedAt, ...publicListing } = listing;
      const variantsForPublic =
        listing.status === "active"
          ? (publicListing.variants || []).filter((variant: any) => variant.approvalStatus === "approved")
          : publicListing.variants;

      return c.json({
        success: true,
        data: {
          ...publicListing,
          variants: variantsForPublic,
          media: transformedMedia,
          fieldDefinitions,
        },
      });
    }

    // Admin/owner gets all data
    return c.json({
      success: true,
      data: {
        ...listing,
        media: transformedMedia,
        fieldDefinitions,
      },
    });
  } catch (error) {
    console.error("Get listing error:", error);
    return c.json({ error: "Failed to fetch listing" }, 500);
  }
};

/**
 * Get listing by ID with all related data (for management pages)
 */
export const getListingById = async (c: Context) => {
  try {
    const listingId = c.req.param("id");
    const user = c.get("user");

    // Fetch listing with only essential data first
    // UPDATED: Include badges and tags
    const listing = await withPrismaRetry(
      () =>
        prisma.listing.findUnique({
          where: { id: listingId },
          include: {
        category: {
          select: {
            id: true,
            categoryName: true,
            hasVariantCatA: true,
            isAddonsAllowed: true,
            isBookingOptionAllowed: true,
            isInclusionsExclusionsAllowed: true,
            isFaqAllowed: true,
            isDayWiseAllowed: true,
            isRental: true,
            isEndLocation: true,
            bookingFormat: true,
            listingType: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        subCategory: {
          select: {
            id: true,
            subCatName: true,
          },
        },
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            alternatePhone: true,
          },
        },
        startCountry: {
          select: {
            country_id: true,
            country_name: true,
          },
        },
        startPrimaryDivision: {
          select: {
            primary_division_id: true,
            division_name: true,
          },
        },
        startSecondaryDivision: {
          select: {
            secondary_division_id: true,
            division_name: true,
          },
        },
        endCountry: {
          select: {
            country_id: true,
            country_name: true,
          },
        },
        endPrimaryDivision: {
          select: {
            primary_division_id: true,
            division_name: true,
          },
        },
        endSecondaryDivision: {
          select: {
            secondary_division_id: true,
            division_name: true,
          },
        },
        variants: {
          orderBy: { variantOrder: "asc" },
        },
        inclusionsExclusions: true,
        addons: true,
        content: {
          orderBy: { contentOrder: "asc" },
        },
        media: {
          select: {
            id: true,
            media: true,
            createdAt: true,
          },
        },
        faqs: true,
        // ADDED: Full badges for management page
        badges: {
          select: {
            id: true,
            isActive: true,
            assignedAt: true,
            assignedByAdminId: true,
            badge: {
              select: {
                id: true,
                badgeName: true,
                badgeType: true,
                badgeDescription: true,
                badgeIconUrl: true,
                badgeColor: true,
                displayOrder: true,
                isActive: true,
              },
            },
          },
          orderBy: { badge: { displayOrder: "asc" } },
        },
        // ADDED: Full tags for management page
        tags: {
          select: {
            id: true,
            isActive: true,
            assignedAt: true,
            assignedByAdminId: true,
            tag: {
              select: {
                id: true,
                tagName: true,
                tagType: true,
                tagColor: true,
                displayOrder: true,
                isActive: true,
              },
            },
          },
          orderBy: { tag: { displayOrder: "asc" } },
        },
          },
        }),
      "getListingById.findUnique"
    );

    if (!listing) {
      return c.json({ success: false, message: "Listing not found" }, 404);
    }

    // Only fetch variant field definitions if category has variant fields
    let variantFieldDefinitions = null;
    const categoryId = listing.categoryId;
    if (categoryId && listing.category?.hasVariantCatA) {
      variantFieldDefinitions = await withPrismaRetry(
        () =>
          prisma.listingVariantMetadataFieldDefinition.findMany({
            where: {
              categoryId,
            },
            select: {
              id: true,
              fieldKey: true,
              fieldLabel: true,
              fieldType: true,
              displayOrder: true,
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
          }),
        "getListingById.variantFieldDefinitions"
      );
    }

    // If user is not admin, remove admin-specific fields
    const isAdmin = user && (user.userType === "admin" || user.userType === "super_admin");
    const isOwner =
      user &&
      user.userType === "operator" &&
      listing.operator?.id &&
      user.userId === listing.operator.id;
    const canSeeAllVariants = Boolean(isAdmin || isOwner);

    // Avoid stale status/rejection reason for authenticated users.
    if (user) {
      c.header('Cache-Control', 'no-store');
    } else {
      c.header('Cache-Control', 'public, max-age=180, s-maxage=180');
    }

    if (!canSeeAllVariants) {
      // Remove admin-specific sensitive fields for non-admin users
      const { approvedByAdminId, approvedAt, ...publicListing } = listing;
      const variantsForPublic =
        listing.status === "active"
          ? (publicListing.variants || []).filter((variant: any) => variant.approvalStatus === "approved")
          : publicListing.variants;

      // Also filter out inactive badges/tags and assignedByAdminId for non-admins
      const filteredBadges = listing.badges
        .filter(b => b.isActive)
        .map(({ assignedByAdminId, ...rest }) => rest);

      const filteredTags = listing.tags
        .filter(t => t.isActive)
        .map(({ assignedByAdminId, ...rest }) => rest);

      return c.json({
        success: true,
        data: {
          ...publicListing,
          variants: variantsForPublic,
          badges: filteredBadges,
          tags: filteredTags,
          variantFieldDefinitions,
        },
      });
    }

    // Admin/owner gets all data including rejection reason
    return c.json({
      success: true,
      data: {
        ...listing,
        variantFieldDefinitions,
      },
    });
  } catch (error) {
    console.error("Get listing by ID error:", error);
    return c.json({ success: false, message: "Failed to fetch listing" }, 500);
  }
};

/**
 * Create a new listing
 */
export const createListing = async (c: Context) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    // Make operatorId mandatory
    if (!user || !user.userId) {
      return c.json({
        success: false,
        error: "Authentication required. Operator ID is mandatory."
      }, 401);
    }

    const listingData: any = {
      operatorId: user.userId, // Always use authenticated user's ID
      categoryId: body.categoryId || null,
      subCatId: body.subCatId || null,
      listingName: body.listingName ? sanitizeString(body.listingName, 255) : "Untitled Listing",
      listingSlug: body.listingSlug
        ? sanitizeString(body.listingSlug, 255).toLowerCase()
        : generateSlug(body.listingName || "untitled-listing") + "-" + Date.now(),
      tbaId: body.tbaId ? sanitizeString(body.tbaId, 100) : undefined,
      frontImageUrl: body.frontImageUrl
        ? sanitizeString(body.frontImageUrl, 500)
        : null,
      bookingFormat: body.bookingFormat || "F1",
      hasMultipleOptions: body.hasMultipleOptions || false,
      status: "pending_approval", // Set status to pending_approval by default
      startLocationName: body.startLocationName
        ? sanitizeString(body.startLocationName, 255)
        : undefined,
      endLocationName: body.endLocationName
        ? sanitizeString(body.endLocationName, 255)
        : undefined,
      taxRate: body.taxRate || 0,
      advanceBookingPercentage: body.advanceBookingPercentage || 25,
      platformCommissionPercentage: body.platformCommissionPercentage || 0,
      tcsPercentage: body.tcsPercentage || 0,
      basePriceDisplay: body.basePriceDisplay || 0,
      currency: body.currency || "INR",
      metadata: body.metadata || undefined,
    };
    // After existing listingData preparation
    if (body.bookingFormat === "F2" || body.bookingFormat === "F4") {
      // Store rental-specific data in metadata
      listingData.metadata = {
        ...listingData.metadata,
        isRental: true,
        baseRentalPrice: body.baseRentalPrice || null,
        minimumRentalDuration: body.minimumRentalDuration || null,
        availableFrom: body.availableFrom || null,
        availableTo: body.availableTo || null,
        // For F4 slot-based
        rentalSlots: body.rentalSlots || null,
      };
    }

    const listing = await prisma.listing.create({
      data: listingData,
      include: {
        category: true,
        subCategory: true,
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // Auto-assign operator-level badges to the new listing
    try {
      const operatorProfile = await prisma.operatorProfile.findUnique({
        where: { operatorId: user.userId },
        select: { verificationDocuments: true },
      });
      const verDocs: any = (operatorProfile?.verificationDocuments as any) || {};
      const operatorBadgeIds: string[] = Array.isArray(verDocs.operatorBadgeIds)
        ? verDocs.operatorBadgeIds
        : [];

      if (operatorBadgeIds.length > 0) {
        // Verify badges exist and are active
        const activeBadges = await prisma.badge.findMany({
          where: { id: { in: operatorBadgeIds }, isActive: true },
          select: { id: true },
        });

        if (activeBadges.length > 0) {
          await prisma.listingBadge.createMany({
            data: activeBadges.map((badge) => ({
              listingId: listing.id,
              badgeId: badge.id,
              assignedByAdminId: null, // Auto-assigned
              isActive: true,
            })),
          });
        }
      }
    } catch (badgeErr) {
      console.error("Auto-assign operator badges error (non-critical):", badgeErr);
    }

    // Index in Meilisearch asynchronously
    meilisearchService.indexListing(listing.id).catch(err => console.error("Background indexing failed:", err));

    return c.json(
      {
        success: true,
        message: "Listing created successfully",
        data: listing,
      },
      201
    );
  } catch (error) {
    console.error("Create listing error:", error);

    // Log detailed error info
    if (error instanceof Error) {
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }

    return c.json({
      success: false,
      error: "Failed to create listing",
      message: error instanceof Error ? error.message : "Unknown error",
      details: process.env.NODE_ENV === 'development' ? String(error) : undefined
    }, 500);
  }
};

/**
 * Update a listing
 */
export const updateListing = async (c: Context) => {
  try {
    const listingId = c.req.param("id");
    const body = await c.req.json();
    const user = c.get("user");

    // Check if listing exists and user owns it (unless admin)
    const existingListing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!existingListing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    // Skip authorization check if no user (testing mode)
    if (
      user &&
      user.userType !== "admin" &&
      user.userType !== "super_admin" &&
      existingListing.operatorId !== user.userId
    ) {
      return c.json({ error: "Not authorized to update this listing" }, 403);
    }

    const updateData: any = {};

    if (body.listingName !== undefined) {
      updateData.listingName = sanitizeString(body.listingName, 255);
    }
    if (body.listingSlug !== undefined) {
      updateData.listingSlug = sanitizeString(
        body.listingSlug,
        255
      ).toLowerCase();
    }
    if (body.tbaId !== undefined) {
      updateData.tbaId = body.tbaId ? sanitizeString(body.tbaId, 100) : null;
    }
    if (body.frontImageUrl !== undefined) {
      updateData.frontImageUrl = body.frontImageUrl
        ? sanitizeString(body.frontImageUrl, 500)
        : null;
    }
    if (body.hasMultipleOptions !== undefined) {
      updateData.hasMultipleOptions = body.hasMultipleOptions;
    }
    if (body.status !== undefined) {
      updateData.status = body.status;

      // Persist rejection reason when admin blocks or requests changes.
      if ((body.status === "rejected" || body.status === "archived") && body.rejectionReason !== undefined) {
        updateData.rejectionReason = body.rejectionReason ? sanitizeString(body.rejectionReason, 1000) : null;
      }

      // Clear rejection reason only when admin approves (status = active)
      // Keep rejection reason when seller resubmits (status = pending_approval)
      if (body.status === "active") {
        updateData.rejectionReason = null;
      }
    }
    if (body.rejectionReason !== undefined && (body.status === "rejected" || body.status === "archived")) {
      updateData.rejectionReason = body.rejectionReason ? sanitizeString(body.rejectionReason, 1000) : null;
    }
    if (body.taxRate !== undefined) {
      updateData.taxRate = body.taxRate;
    }
    if (body.advanceBookingPercentage !== undefined) {
      updateData.advanceBookingPercentage = body.advanceBookingPercentage;
    }
    if (body.basePriceDisplay !== undefined) {
      updateData.basePriceDisplay = body.basePriceDisplay;
    }
    if (body.currency !== undefined) {
      updateData.currency = body.currency;
    }

    // Handle metadata - merge with existing and separate table fields
    if (body.metadata !== undefined) {
      console.log('=== METADATA UPDATE DEBUG ===');
      console.log('Incoming body.metadata:', JSON.stringify(body.metadata, null, 2));

      const incomingMetadata = typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata;
      const existingMetadata = existingListing.metadata as any || {};

      console.log('Existing metadata from DB:', JSON.stringify(existingMetadata, null, 2));
      console.log('Incoming metadata (parsed):', JSON.stringify(incomingMetadata, null, 2));

      const cleanedMetadata: any = {};

      // List of fields that exist in the listings table
      const tableFields = [
        'startCountryId', 'startPrimaryDivisionId', 'startSecondaryDivisionId',
        'endCountryId', 'endPrimaryDivisionId', 'endSecondaryDivisionId',
        'startLocationName', 'startLocationCoordinates', 'startGoogleMapsUrl',
        'endLocationName', 'endLocationCoordinates', 'endGoogleMapsUrl',
        'taxRate', 'advanceBookingPercentage', 'basePriceDisplay', 'currency'
      ];

      // Extract table fields from incoming metadata and add them to updateData
      Object.keys(incomingMetadata).forEach(key => {
        if (tableFields.includes(key) && incomingMetadata[key] !== undefined && incomingMetadata[key] !== null && incomingMetadata[key] !== '') {
          // Store in table column (don't add if already set above)
          if (updateData[key] === undefined) {
            updateData[key] = incomingMetadata[key];
            console.log(`Moved ${key} from metadata to table field`);
          }
        } else {
          // Keep in metadata
          cleanedMetadata[key] = incomingMetadata[key];
          console.log(`Keeping ${key} in metadata`);
        }
      });

      // Merge cleaned incoming metadata with existing metadata
      updateData.metadata = { ...existingMetadata, ...cleanedMetadata };
      console.log('Final merged metadata:', JSON.stringify(updateData.metadata, null, 2));
      console.log('=== END METADATA DEBUG ===');
    }

    // Location fields
    if (body.startLocationName !== undefined) {
      updateData.startLocationName = body.startLocationName
        ? sanitizeString(body.startLocationName, 255)
        : null;
    }
    if (body.endLocationName !== undefined) {
      updateData.endLocationName = body.endLocationName
        ? sanitizeString(body.endLocationName, 255)
        : null;
    }
    if (body.startCountryId !== undefined) {
      updateData.startCountryId = body.startCountryId;
    }
    if (body.startPrimaryDivisionId !== undefined) {
      updateData.startPrimaryDivisionId = body.startPrimaryDivisionId;
    }
    if (body.startSecondaryDivisionId !== undefined) {
      updateData.startSecondaryDivisionId = body.startSecondaryDivisionId;
    }
    if (body.endCountryId !== undefined) {
      updateData.endCountryId = body.endCountryId;
    }
    if (body.endPrimaryDivisionId !== undefined) {
      updateData.endPrimaryDivisionId = body.endPrimaryDivisionId;
    }
    if (body.endSecondaryDivisionId !== undefined) {
      updateData.endSecondaryDivisionId = body.endSecondaryDivisionId;
    }
    if (body.startLocationCoordinates !== undefined) {
      updateData.startLocationCoordinates = body.startLocationCoordinates;
    }
    if (body.endLocationCoordinates !== undefined) {
      updateData.endLocationCoordinates = body.endLocationCoordinates;
    }
    if (body.startGoogleMapsUrl !== undefined) {
      updateData.startGoogleMapsUrl = body.startGoogleMapsUrl;
    }
    if (body.endGoogleMapsUrl !== undefined) {
      updateData.endGoogleMapsUrl = body.endGoogleMapsUrl;
    }

    const updatedListing = await prisma.listing.update({
      where: { id: listingId },
      data: updateData,
      include: {
        category: true,
        subCategory: true,
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (body.status === "active") {
      await prisma.listingVariant.updateMany({
        where: {
          listingId,
          approvalStatus: {
            not: "approved",
          },
        },
        data: {
          approvalStatus: "approved",
        },
      });
    }

    // Update index in Meilisearch asynchronously
    meilisearchService.indexListing(updatedListing.id).catch(err => console.error("Background indexing update failed:", err));

    return c.json({
      success: true,
      message: "Listing updated successfully",
      data: updatedListing,
    });
  } catch (error) {
    console.error("Update listing error:", error);

    // Log detailed error info
    if (error instanceof Error) {
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }

    return c.json({
      success: false,
      error: "Failed to update listing",
      message: error instanceof Error ? error.message : "Unknown error",
      details: process.env.NODE_ENV === 'development' ? String(error) : undefined
    }, 500);
  }
};

/**
 * Delete a listing
 */
export const deleteListing = async (c: Context) => {
  try {
    const listingId = c.req.param("id");
    const user = c.get("user");

    // Check if listing exists and user owns it (unless admin)
    const existingListing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!existingListing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    // Skip authorization check if no user (testing mode)
    if (
      user &&
      user.userType !== "admin" &&
      user.userType !== "super_admin" &&
      existingListing.operatorId !== user.userId
    ) {
      return c.json({ error: "Not authorized to delete this listing" }, 403);
    }

    // Delete related records first to avoid foreign key constraint errors
    // Prisma should handle cascading deletes based on schema, but we'll be explicit
    try {
      // Delete bookings that reference this listing's slots
      const slots = await prisma.listingSlot.findMany({
        where: { listingId },
        select: { id: true }
      });

      if (slots.length > 0) {
        const slotIds = slots.map(s => s.id);
        await prisma.booking.deleteMany({
          where: {
            listingSlotId: { in: slotIds }
          }
        });
      }

      // Now delete the listing (cascades will handle the rest)
      await prisma.listing.delete({
        where: { id: listingId },
      });
    } catch (deleteError) {
      console.error("Error during cascade delete:", deleteError);
      throw deleteError;
    }

    // Remove from Meilisearch asynchronously
    meilisearchService.removeListing(listingId).catch(err => console.error("Background removal failed:", err));

    return c.json({
      success: true,
      message: "Listing deleted successfully",
    });
  } catch (error) {
    console.error("Delete listing error:", error);
    return c.json({ error: "Failed to delete listing" }, 500);
  }
};

const getRelatedBookingFormats = (bookingFormat?: string | null) => {
  if (bookingFormat === "F1" || bookingFormat === "F3") {
    return ["F1", "F3"];
  }

  if (bookingFormat === "F2" || bookingFormat === "F4") {
    return ["F2", "F4"];
  }

  return bookingFormat ? [bookingFormat] : [];
};

/**
 * Get similar listings based on booking family, category, operator, then fallback
 * Priority: Same booking family + category/subcategory > Same booking family + operator > Same booking family fallback
 */
export const getSimilarListings = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const limit = parseInt(c.req.query("limit") || "6");

    // Get the current listing to know its category and operator
    const currentListing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        categoryId: true,
        subCatId: true,
        operatorId: true,
        bookingFormat: true,
      }
    });

    if (!currentListing) {
      return c.json({ success: false, message: "Listing not found" }, 404);
    }

    const similarListings: any[] = [];
    const seenIds = new Set<string>([listingId]); // Exclude current listing

    const includeFields = {
      category: {
        select: {
          id: true,
          categoryName: true,
        },
      },
      subCategory: {
        select: {
          id: true,
          subCatName: true,
        },
      },
      operator: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      ...badgesIncludeLimited,
      ...tagsIncludeLimited,
    };

    const relatedFormats = getRelatedBookingFormats(currentListing.bookingFormat);

    const baseWhere: any = {
      status: "active",
      NOT: { id: listingId },
      ...(relatedFormats.length > 0
        ? {
            bookingFormat: {
              in: relatedFormats,
            },
          }
        : {}),
    };

    // STEP 1: Same booking family + same category (prefer same subcategory)
    if (currentListing.categoryId && similarListings.length < limit) {
      const categoryWhere: any = {
        ...baseWhere,
        categoryId: currentListing.categoryId,
      };
      
      // If subcategory exists, prefer it
      if (currentListing.subCatId) {
        categoryWhere.subCatId = currentListing.subCatId;
      }

      const categoryListings = await prisma.listing.findMany({
        where: categoryWhere,
        include: includeFields,
        take: limit,
        orderBy: { createdAt: "desc" },
      });

      categoryListings.forEach(listing => {
        if (!seenIds.has(listing.id)) {
          similarListings.push(listing);
          seenIds.add(listing.id);
        }
      });
    }

    // STEP 1B: Same booking family + same category, but allow sibling subcategories too
    if (currentListing.categoryId && currentListing.subCatId && similarListings.length < limit) {
      const siblingCategoryListings = await prisma.listing.findMany({
        where: {
          ...baseWhere,
          categoryId: currentListing.categoryId,
          NOT: [
            { id: listingId },
            { subCatId: currentListing.subCatId },
          ],
        },
        include: includeFields,
        take: limit - similarListings.length,
        orderBy: { createdAt: "desc" },
      });

      siblingCategoryListings.forEach(listing => {
        if (!seenIds.has(listing.id)) {
          similarListings.push(listing);
          seenIds.add(listing.id);
        }
      });
    }

    // STEP 2: Same booking family + same operator
    if (currentListing.operatorId && similarListings.length < limit) {
      const operatorListings = await prisma.listing.findMany({
        where: {
          ...baseWhere,
          operatorId: currentListing.operatorId,
        },
        include: includeFields,
        take: limit - similarListings.length,
        orderBy: { createdAt: "desc" },
      });

      operatorListings.forEach(listing => {
        if (!seenIds.has(listing.id)) {
          similarListings.push(listing);
          seenIds.add(listing.id);
        }
      });
    }

    // STEP 3: Same booking family fallback
    if (similarListings.length < limit) {
      const fallbackListings = await prisma.listing.findMany({
        where: baseWhere,
        include: includeFields,
        take: Math.min(20, (limit - similarListings.length) * 3),
        orderBy: { createdAt: "desc" },
      });

      fallbackListings.forEach(listing => {
        if (!seenIds.has(listing.id) && similarListings.length < limit) {
          similarListings.push(listing);
          seenIds.add(listing.id);
        }
      });
    }

    // Transform badges and tags
    const transformedListings = similarListings.map(listing => {
      const transformedBadges = listing.badges?.map((ab: any) => ({
        id: ab.badge.id,
        badgeName: ab.badge.badgeName,
        badgeIconUrl: ab.badge.badgeIconUrl,
        badgeColor: ab.badge.badgeColor,
      })) || [];

      const transformedTags = listing.tags?.map((lt: any) => ({
        id: lt.tag.id,
        tagName: lt.tag.tagName,
        tagColor: lt.tag.tagColor,
      })) || [];

      return {
        ...listing,
        badges: transformedBadges,
        tags: transformedTags,
      };
    });

    return c.json({
      success: true,
      data: transformedListings,
    });
  } catch (error) {
    console.error("Get similar listings error:", error);
    return c.json({ success: false, message: "Failed to fetch similar listings", error: String(error) }, 500);
  }
};
