import type { Context } from "hono";
import { prisma, withPrismaRetry } from "../db.js";
import { sanitizeString } from "../helpers/validation.helper.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_REGEX.test(value.trim());

const getNewVariantApprovalStatus = () => "pending_approval";

const normalizeComparableVariantPayload = (variant: any, index: number) => {
  const validParticipantNumbers = Array.isArray(variant?.validParticipantNumbers)
    ? variant.validParticipantNumbers
        .map((p: any) => Number(p))
        .filter((num: number) => Number.isInteger(num) && num > 0)
        .sort((a: number, b: number) => a - b)
    : [];

  return {
    variantName: sanitizeString(variant?.variantName || "", 255),
    variantDescription: variant?.variantDescription
      ? sanitizeString(variant.variantDescription, 5000)
      : null,
    validParticipantNumbers,
    variantOrder: variant?.variantOrder ?? index + 1,
    variantMetadata: variant?.variantMetadata || null,
  };
};

const isVariantPayloadChanged = (
  existingVariant: {
    variantName: string;
    variantDescription: string | null;
    validParticipantNumbers: number[];
    variantOrder: number;
    variantMetadata: any;
  },
  nextPayload: {
    variantName: string;
    variantDescription: string | null;
    validParticipantNumbers: number[];
    variantOrder: number;
    variantMetadata: any;
  },
) => {
  const existingParticipants = [...(existingVariant.validParticipantNumbers || [])].sort(
    (a, b) => a - b,
  );

  return (
    existingVariant.variantName !== nextPayload.variantName ||
    (existingVariant.variantDescription || null) !== (nextPayload.variantDescription || null) ||
    JSON.stringify(existingParticipants) !== JSON.stringify(nextPayload.validParticipantNumbers) ||
    existingVariant.variantOrder !== nextPayload.variantOrder ||
    JSON.stringify(existingVariant.variantMetadata || null) !==
      JSON.stringify(nextPayload.variantMetadata || null)
  );
};

/**
 * Get variants for a listing
 */
export const getListingVariants = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const variants = await prisma.listingVariant.findMany({
      where: { listingId },
      orderBy: { variantOrder: "asc" },
    });

    return c.json({
      success: true,
      data: variants,
      count: variants.length,
    });
  } catch (error) {
    console.error("Get listing variants error:", error);
    return c.json({ error: "Failed to fetch variants" }, 500);
  }
};

/**
 * Get a single variant by ID with full details
 */
export const getListingVariantById = async (c: Context) => {
  try {
    const variantId = c.req.param("id");

    const variant = await prisma.listingVariant.findUnique({
      where: { id: variantId },
      include: {
        listing: {
          select: {
            id: true,
            listingName: true,
            categoryId: true,
            bookingFormat: true,
          },
        },
      },
    });

    if (!variant) {
      return c.json({ error: "Variant not found" }, 404);
    }

    return c.json({
      success: true,
      data: variant,
    });
  } catch (error) {
    console.error("Get listing variant by ID error:", error);
    return c.json({ error: "Failed to fetch variant" }, 500);
  }
};

/**
 * Create listing variant (enhanced for Cat-A rentals)
 */
export const createListingVariant = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const body = await c.req.json();

    // Verify listing exists and check if it's a rental category
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        category: {
          select: {
            id: true,
            hasVariantCatA: true,
            isRental: true,
            bookingFormat: true,
          },
        },
      },
    });

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    // Validate validParticipantNumbers
    if (!body.validParticipantNumbers || !Array.isArray(body.validParticipantNumbers) || body.validParticipantNumbers.length === 0) {
      return c.json({ error: "validParticipantNumbers array is required" }, 400);
    }

    const validParticipants = body.validParticipantNumbers.map((p: any) => {
      const num = Number(p);
      if (isNaN(num) || num <= 0 || !Number.isInteger(num)) {
        throw new Error("validParticipantNumbers must contain positive integers only");
      }
      return num;
    });

    const variantData: any = {
      listingId,
      variantName: sanitizeString(body.variantName, 255),
      validParticipantNumbers: validParticipants,
      variantOrder: body.variantOrder || 0,
      approvalStatus: getNewVariantApprovalStatus(),
    };

    // Add description if provided
    if (body.variantDescription) {
      variantData.variantDescription = sanitizeString(body.variantDescription, 5000);
    }

    // Store variant-specific metadata if provided (as JSONB)
    if (body.variantMetadata) {
      // Validate participant numbers if present
      if (body.variantMetadata.participantNumbers) {
        const participants = body.variantMetadata.participantNumbers;
        if (typeof participants === 'string') {
          // Validate comma-separated numbers format
          const participantArray = participants.split(',').map((p: string) => p.trim());
          const isValid = participantArray.every((p: string) => !isNaN(Number(p)) && Number(p) > 0);
          if (!isValid) {
            return c.json({ error: "participantNumbers must be comma-separated positive numbers" }, 400);
          }
        } else if (Array.isArray(participants)) {
          // Validate array of numbers
          const isValid = participants.every((p: any) => typeof p === 'number' && p > 0);
          if (!isValid) {
            return c.json({ error: "participantNumbers must be an array of positive numbers" }, 400);
          }
        } else {
          return c.json({ error: "participantNumbers must be a string or array" }, 400);
        }
      }
      variantData.variantMetadata = body.variantMetadata;
    }

    const variant = await prisma.listingVariant.create({
      data: variantData,
    });

    return c.json(
      {
        success: true,
        message: "Variant created successfully",
        data: variant,
      },
      201
    );
  } catch (error) {
    console.error("Create listing variant error:", error);
    return c.json({ error: "Failed to create variant" }, 500);
  }
};

/**
 * Update listing variant
 */
export const updateListingVariant = async (c: Context) => {
  try {
    const variantId = c.req.param("id");
    const body = await c.req.json();

    // Check if variant exists
    const existingVariant = await prisma.listingVariant.findUnique({
      where: { id: variantId },
      include: {
        listing: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!existingVariant) {
      return c.json({ error: "Variant not found" }, 404);
    }

    if (
      existingVariant.listing?.status === "active" &&
      existingVariant.approvalStatus === "approved"
    ) {
      return c.json(
        {
          error:
            "Approved booking options cannot be edited after listing approval. Create a new booking option instead.",
        },
        400,
      );
    }

    const updateData: any = {};

    if (body.variantName !== undefined) {
      updateData.variantName = sanitizeString(body.variantName, 255);
    }
    if (body.variantDescription !== undefined) {
      updateData.variantDescription = body.variantDescription ? sanitizeString(body.variantDescription, 5000) : null;
    }
    if (body.validParticipantNumbers !== undefined) {
      if (!Array.isArray(body.validParticipantNumbers) || body.validParticipantNumbers.length === 0) {
        return c.json({ error: "validParticipantNumbers must be a non-empty array" }, 400);
      }
      const validParticipants = body.validParticipantNumbers.map((p: any) => {
        const num = Number(p);
        if (isNaN(num) || num <= 0 || !Number.isInteger(num)) {
          throw new Error("validParticipantNumbers must contain positive integers only");
        }
        return num;
      });
      updateData.validParticipantNumbers = validParticipants;
    }
    if (body.variantOrder !== undefined) {
      updateData.variantOrder = body.variantOrder;
    }
    if (body.variantMetadata !== undefined) {
      // Validate participant numbers if present
      if (body.variantMetadata && body.variantMetadata.participantNumbers) {
        const participants = body.variantMetadata.participantNumbers;
        if (typeof participants === 'string') {
          const participantArray = participants.split(',').map((p: string) => p.trim());
          const isValid = participantArray.every((p: string) => !isNaN(Number(p)) && Number(p) > 0);
          if (!isValid) {
            return c.json({ error: "participantNumbers must be comma-separated positive numbers" }, 400);
          }
        } else if (Array.isArray(participants)) {
          const isValid = participants.every((p: any) => typeof p === 'number' && p > 0);
          if (!isValid) {
            return c.json({ error: "participantNumbers must be an array of positive numbers" }, 400);
          }
        } else {
          return c.json({ error: "participantNumbers must be a string or array" }, 400);
        }
      }
      updateData.variantMetadata = body.variantMetadata;
    }

    const updatedVariant = await prisma.listingVariant.update({
      where: { id: variantId },
      data: updateData,
    });

    return c.json({
      success: true,
      message: "Variant updated successfully",
      data: updatedVariant,
    });
  } catch (error) {
    console.error("Update listing variant error:", error);
    return c.json({ error: "Failed to update variant" }, 500);
  }
};

/**
 * Delete listing variant
 */
export const deleteListingVariant = async (c: Context) => {
  try {
    const variantId = c.req.param("id");

    // Check if variant exists
    const existingVariant = await prisma.listingVariant.findUnique({
      where: { id: variantId },
      include: {
        listing: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!existingVariant) {
      return c.json({ error: "Variant not found" }, 404);
    }

    if (
      existingVariant.listing?.status === "active" &&
      existingVariant.approvalStatus === "approved"
    ) {
      return c.json(
        {
          error:
            "Approved booking options cannot be deleted after listing approval. Create a new booking option instead.",
        },
        400,
      );
    }

    await prisma.listingVariant.delete({
      where: { id: variantId },
    });

    return c.json({
      success: true,
      message: "Variant deleted successfully",
    });
  } catch (error) {
    console.error("Delete listing variant error:", error);
    return c.json({ error: "Failed to delete variant" }, 500);
  }
};

/**
 * Bulk create variants for a listing (useful for rentals with multiple equipment options)
 */
export const bulkCreateVariants = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const body = await c.req.json();

    if (!body.variants || !Array.isArray(body.variants)) {
      return c.json({ error: "variants array is required" }, 400);
    }

    // Verify listing exists
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        category: {
          select: {
            hasVariantCatA: true,
          },
        },
      },
    });

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    const existingVariants = await prisma.listingVariant.findMany({
      where: { listingId },
      select: {
        id: true,
        variantName: true,
        variantDescription: true,
        validParticipantNumbers: true,
        variantOrder: true,
        variantMetadata: true,
        approvalStatus: true,
      },
    });

    const existingVariantMap = new Map(existingVariants.map((variant) => [variant.id, variant]));

    const submittedVariantIds = new Set(
      body.variants
        .map((variant: any) =>
          isUuid(variant.id)
            ? variant.id.trim()
            : null,
        )
        .filter(Boolean),
    );

    const variantIdsToDelete = existingVariants
      .map((variant) => variant.id)
      .filter((id) => !submittedVariantIds.has(id));

    if (variantIdsToDelete.length > 0) {
      if (listing.status === "active") {
        const deletingApprovedVariants = variantIdsToDelete.some((id) => {
          const existingVariant = existingVariantMap.get(id);
          return existingVariant?.approvalStatus === "approved";
        });

        if (deletingApprovedVariants) {
          return c.json(
            {
              error:
                "Approved booking options cannot be deleted after listing approval. Create new booking options instead.",
            },
            400,
          );
        }
      }

      const blockingBookings = await prisma.booking.findFirst({
        where: {
          OR: [
            { listingSlot: { variantId: { in: variantIdsToDelete } } },
            { dateRange: { variantId: { in: variantIdsToDelete } } },
          ],
        },
        select: {
          bookingReference: true,
        },
      });

      if (blockingBookings) {
        return c.json(
          {
            error:
              "One or more booking options cannot be deleted because they are already used in bookings.",
          },
          400
        );
      }
    }

    let createdCount = 0;
    let updatedCount = 0;

    const allVariants = await prisma.$transaction(async (tx) => {
      if (variantIdsToDelete.length > 0) {
        await tx.listingVariant.deleteMany({
          where: {
            listingId,
            id: { in: variantIdsToDelete },
          },
        });
      }

      for (const [index, variant] of body.variants.entries()) {
        if (!variant.validParticipantNumbers || !Array.isArray(variant.validParticipantNumbers) || variant.validParticipantNumbers.length === 0) {
          throw new Error(`validParticipantNumbers array is required for variant "${variant.variantName}"`);
        }

        const validParticipants = variant.validParticipantNumbers.map((p: any) => {
          const num = Number(p);
          if (isNaN(num) || num <= 0 || !Number.isInteger(num)) {
            throw new Error(`validParticipantNumbers must contain positive integers only for variant "${variant.variantName}"`);
          }
          return num;
        });

        if (variant.variantMetadata && variant.variantMetadata.participantNumbers) {
          const participants = variant.variantMetadata.participantNumbers;
          if (typeof participants === 'string') {
            const participantArray = participants.split(',').map((p: string) => p.trim());
            const isValid = participantArray.every((p: string) => !isNaN(Number(p)) && Number(p) > 0);
            if (!isValid) {
              throw new Error(`Invalid participantNumbers for variant "${variant.variantName}": must be comma-separated positive numbers`);
            }
          } else if (Array.isArray(participants)) {
            const isValid = participants.every((p: any) => typeof p === 'number' && p > 0);
            if (!isValid) {
              throw new Error(`Invalid participantNumbers for variant "${variant.variantName}": must be an array of positive numbers`);
            }
          } else {
            throw new Error(`Invalid participantNumbers for variant "${variant.variantName}": must be a string or array`);
          }
        }

        const variantData = {
          listingId,
          variantName: sanitizeString(variant.variantName, 255),
          variantDescription: variant.variantDescription ? sanitizeString(variant.variantDescription, 5000) : null,
          validParticipantNumbers: validParticipants,
          variantOrder: variant.variantOrder ?? index + 1,
          variantMetadata: variant.variantMetadata || null,
        };

        if (isUuid(variant.id)) {
          const existingVariant = await tx.listingVariant.findUnique({
            where: { id: variant.id },
          });

          if (existingVariant && existingVariant.listingId === listingId) {
            if (listing.status === "active" && existingVariant.approvalStatus === "approved") {
              const comparableIncomingPayload = normalizeComparableVariantPayload(variant, index);
              const hasChanged = isVariantPayloadChanged(
                {
                  variantName: existingVariant.variantName,
                  variantDescription: existingVariant.variantDescription,
                  validParticipantNumbers: existingVariant.validParticipantNumbers,
                  variantOrder: existingVariant.variantOrder,
                  variantMetadata: existingVariant.variantMetadata,
                },
                comparableIncomingPayload,
              );

              if (hasChanged) {
                throw new Error(
                  `Approved booking option \"${existingVariant.variantName}\" cannot be edited after listing approval. Create a new booking option instead.`,
                );
              }

              continue;
            }

            await tx.listingVariant.update({
              where: { id: variant.id },
              data: variantData,
            });
            updatedCount++;
          } else {
            await tx.listingVariant.create({
              data: {
                ...variantData,
                approvalStatus: getNewVariantApprovalStatus(),
              },
            });
            createdCount++;
          }
        } else {
          await tx.listingVariant.create({
            data: {
              ...variantData,
              approvalStatus: getNewVariantApprovalStatus(),
            },
          });
          createdCount++;
        }
      }

      return tx.listingVariant.findMany({
        where: { listingId },
        orderBy: { variantOrder: "asc" },
      });
    });

    return c.json(
      {
        success: true,
        message: `${createdCount} variants created, ${updatedCount} variants updated, ${variantIdsToDelete.length} variants deleted`,
        data: allVariants,
      },
      201
    );
  } catch (error) {
    console.error("Bulk upsert variants error:", error);
    return c.json({ error: error instanceof Error ? error.message : "Failed to process variants" }, 500);
  }
};

/**
 * Get variant metadata field definitions for a category (for Cat-A rentals)
 */
export const getVariantFieldsForCategory = async (c: Context) => {
  try {
    const categoryId = c.req.param("categoryId");

    // Check if category exists and has Cat-A variants
    const category = await withPrismaRetry(
      () =>
        prisma.category.findUnique({
          where: { id: categoryId },
          select: {
            id: true,
            categoryName: true,
            hasVariantCatA: true,
            isRental: true,
          },
        }),
      "getVariantFieldsForCategory.category.findUnique"
    );

    if (!category) {
      return c.json({ error: "Category not found" }, 404);
    }

    if (!category.hasVariantCatA) {
      return c.json({
        success: true,
        data: [],
        message: "This category does not have Cat-A variant fields",
      });
    }

    // Get variant field definitions for this category
    const fieldDefinitions = await withPrismaRetry(
      () =>
        prisma.listingVariantMetadataFieldDefinition.findMany({
          where: {
            categoryId,
          },
          include: {
            options: {
              orderBy: { displayOrder: "asc" },
            },
          },
          orderBy: { displayOrder: "asc" },
        }),
      "getVariantFieldsForCategory.fieldDefinitions.findMany"
    );

    return c.json({
      success: true,
      data: fieldDefinitions,
      count: fieldDefinitions.length,
      category: {
        id: category.id,
        name: category.categoryName,
        hasVariantCatA: category.hasVariantCatA,
        isRental: category.isRental,
      },
    });
  } catch (error) {
    console.error("Get variant fields for category error:", error);
    return c.json({ error: "Failed to fetch variant fields" }, 500);
  }
};
