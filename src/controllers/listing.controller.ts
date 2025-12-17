import type { Context } from "hono";
import { prisma } from "../db.js";
import { sanitizeString, generateSlug } from "../helpers/validation.helper.js";
import meilisearchService from "../services/meilisearch.service.js";

/**
 * Get all listings with optional pagination
 */
export const getListings = async (c: Context) => {
  try {
    // Get query parameters for pagination
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "12");
    const status = c.req.query("status"); // optional filter by status

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Build where clause
    const whereClause: any = {};
    if (status) {
      whereClause.status = status;
    } else {
      // By default, only show active listings for customers
      whereClause.status = "active";
    }

    // Get total count for pagination
    const totalCount = await prisma.listing.count({
      where: whereClause,
    });

    // Fetch listings with pagination
    const listings = await prisma.listing.findMany({
      where: whereClause,
      include: {
        category: true,
        subCategory: true,
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        variants: {
          take: 1, // Only get first variant for listing card
          orderBy: { createdAt: "asc" },
        },
        media: {
          take: 5, // Limit media to first 5 images
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    });

    return c.json({
      success: true,
      data: listings,
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

/**
 * Get listing by ID
 */
export const getListing = async (c: Context) => {
  try {
    const listingId = c.req.param("id");

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        category: true,
        subCategory: true,
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        variants: true,
        content: true,
        inclusionsExclusions: true,
        addons: true,
        media: true,
      },
    });

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    return c.json({
      success: true,
      data: listing,
    });
  } catch (error) {
    console.error("Get listing error:", error);
    return c.json({ error: "Failed to fetch listing" }, 500);
  }
};

/**
 * Create a new listing
 */
export const createListing = async (c: Context) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    const listingData: any = {
      operatorId: user?.userId || null,
      categoryId: body.categoryId || null,
      subCatId: body.subCatId || null,
      listingName: body.listingName ? sanitizeString(body.listingName, 255) : "Untitled Listing",
      listingSlug: body.listingSlug
        ? sanitizeString(body.listingSlug, 255).toLowerCase()
        : generateSlug(body.listingName || "untitled-listing") + "-" + Date.now(),
      tbaId: body.tbaId ? sanitizeString(body.tbaId, 100) : undefined,
      frontImageUrl: body.frontImageUrl
        ? sanitizeString(body.frontImageUrl, 500)
        : undefined,
      bookingFormat: body.bookingFormat || "F1",
      hasMultipleOptions: body.hasMultipleOptions || false,
      startLocationName: body.startLocationName
        ? sanitizeString(body.startLocationName, 255)
        : undefined,
      endLocationName: body.endLocationName
        ? sanitizeString(body.endLocationName, 255)
        : undefined,
      taxRate: body.taxRate || 0,
      advanceBookingPercentage: body.advanceBookingPercentage || 25,
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
    return c.json({ error: "Failed to create listing" }, 500);
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
    if (body.metadata !== undefined) {
      updateData.metadata = body.metadata;
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
    if (body.endCountryId !== undefined) {
      updateData.endCountryId = body.endCountryId;
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

    // Update index in Meilisearch asynchronously
    meilisearchService.indexListing(updatedListing.id).catch(err => console.error("Background indexing update failed:", err));

    return c.json({
      success: true,
      message: "Listing updated successfully",
      data: updatedListing,
    });
  } catch (error) {
    console.error("Update listing error:", error);
    return c.json({ error: "Failed to update listing" }, 500);
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

    await prisma.listing.delete({
      where: { id: listingId },
    });

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
