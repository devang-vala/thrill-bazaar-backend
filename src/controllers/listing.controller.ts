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
    const sortBy = c.req.query("sortBy"); // sorting option
    
    // Get location filter parameters
    const startPrimaryDivisions = c.req.query("startPrimaryDivisions"); // comma-separated IDs
    const startSecondaryDivisions = c.req.query("startSecondaryDivisions"); // comma-separated IDs
    const endPrimaryDivisions = c.req.query("endPrimaryDivisions"); // comma-separated IDs
    const endSecondaryDivisions = c.req.query("endSecondaryDivisions"); // comma-separated IDs
    
    // Get category and seller filter parameters
    const categories = c.req.query("categories"); // comma-separated category IDs
    const sellers = c.req.query("sellers"); // comma-separated operator/seller IDs
    
    // Get metadata filter parameters (JSON string)
    const metadataFilters = c.req.query("metadata"); // JSON string of metadata filters

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Build where clause
    const whereClause: any = {};
    
    // Get user context if authenticated
    const user = c.get("user");
    
    if (status) {
      whereClause.status = status;
    } else {
      // Only show active listings for unauthenticated users or customer role
      // Show all listings for operators, admins, and other non-customer roles
      if (!user || user.role === "customer") {
        whereClause.status = "active";
      }
      // For other roles (operator, admin, super_admin), don't filter by status
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
      const categoryIds = categories.split(",").filter(Boolean);
      if (categoryIds.length > 0) {
        whereClause.categoryId = { in: categoryIds };
      }
    }
    
    // Add seller/operator filter
    if (sellers) {
      const sellerIds = sellers.split(",").filter(Boolean);
      if (sellerIds.length > 0) {
        whereClause.operatorId = { in: sellerIds };
      }
    }
    
    // Add metadata filters
    if (metadataFilters) {
      try {
        const parsedMetadata = JSON.parse(metadataFilters);
        if (Object.keys(parsedMetadata).length > 0) {
          // Filter by metadata JSON field
          // Using path() to query JSON fields in PostgreSQL
          const metadataConditions: any[] = [];
          
          for (const [key, value] of Object.entries(parsedMetadata)) {
            if (value !== null && value !== undefined && value !== '') {
              metadataConditions.push({
                metadata: {
                  path: [key],
                  equals: value
                }
              });
            }
          }
          
          if (metadataConditions.length > 0) {
            whereClause.AND = metadataConditions;
          }
        }
      } catch (err) {
        console.error("Error parsing metadata filters:", err);
      }
    }

    // Build orderBy clause based on sortBy parameter
    let orderByClause: any = { createdAt: "desc" }; // default
    
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
        default:
          orderByClause = { createdAt: "desc" };
      }
    }

    // Get total count for pagination
    const totalCount = await prisma.listing.count({
      where: whereClause,
    });

    // Fetch listings with pagination
    const listings = await prisma.listing.findMany({
      where: whereClause,
      include: {
        category: {
          include: {
            listingType: true,
          },
        },
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
      orderBy: orderByClause,
      skip,
      take: limit,
    });

    // Check if user is admin or seller/operator
    const isAdminOrSeller = user && (
      user.userType === "admin" || 
      user.userType === "super_admin" || 
      user.userType === "operator" ||
      user.role === "seller"
    );
    
    // For customers/public users, remove admin-specific fields
    // Sellers and admins can see all fields including rejection reason
    const responseData = isAdminOrSeller 
      ? listings 
      : listings.map(listing => {
          const { rejectionReason, approvedByAdminId, approvedAt, ...publicListing } = listing;
          return publicListing;
        });

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

/**
 * Admin endpoint: Get all listings (excluding drafts) with pagination
 * POST request to allow filtering criteria in body
 */
export const getAdminListings = async (c: Context) => {
  try {
    // Get pagination from body
    const body = await c.req.json();
    const page = body.page || 1;
    const limit = body.limit || 12;
    const searchTerm = body.searchTerm || "";
    const statusFilter = body.statusFilter || "";

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Build where clause - exclude drafts
    const whereClause: any = {
      status: {
        not: "draft",
      },
    };

    // Add optional status filter
    if (statusFilter && statusFilter !== "all") {
      whereClause.status = statusFilter;
    }

    // Add search filter
    if (searchTerm) {
      whereClause.OR = [
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

    // Get total count for pagination
    const totalCount = await prisma.listing.count({
      where: whereClause,
    });

    // Fetch listings with pagination
    const listings = await prisma.listing.findMany({
      where: whereClause,
      include: {
        category: {
          select: {
            categoryName: true,
          },
        },
        subCategory: {
          select: {
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

    const listing = await prisma.listing.findUnique({
      where: { listingSlug: listingSlug },
      include: {
        category: {
          include: {
            listingType: true,
          },
        },
        subCategory: true,
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        startCountry: true,
        startPrimaryDivision: true,
        startSecondaryDivision: true,
        endCountry: true,
        endPrimaryDivision: true,
        endSecondaryDivision: true,
        variants: true,
        content: true,
        inclusionsExclusions: true,
        addons: true,
        media: true,
        faqs: true,
      },
    });

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

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

    // Check if user is admin
    const isAdmin = user && (user.userType === "admin" || user.userType === "super_admin");
    
    if (!isAdmin) {
      // Remove admin-specific fields for non-admin users (public/customers)
      // Note: Sellers see rejection reason through their own listings query
      const { approvedByAdminId, approvedAt, ...publicListing } = listing;
      
      return c.json({
        success: true,
        data: {
          ...publicListing,
          media: transformedMedia,
        },
      });
    }

    // Admin gets all data
    return c.json({
      success: true,
      data: {
        ...listing,
        media: transformedMedia,
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

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        category: {
          include: {
            listingType: true,
          },
        },
        subCategory: true,
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        startCountry: true,
        startPrimaryDivision: true,
        startSecondaryDivision: true,
        endCountry: true,
        endPrimaryDivision: true,
        endSecondaryDivision: true,
        variants: {
          orderBy: { variantOrder: "asc" },
        },
        inclusionsExclusions: true, // One-to-one relation, no orderBy
        addons: true, // One-to-one relation with Json storage, no orderBy
        content: {
          orderBy: { contentOrder: "asc" },
        },
        media: true, // One-to-many but data is Json, no orderBy on Json field
        faqs: true, // One-to-one relation, no orderBy
      },
    });

    if (!listing) {
      return c.json({ success: false, message: "Listing not found" }, 404);
    }

    // If user is not admin, remove admin-specific fields
    const isAdmin = user && (user.userType === "admin" || user.userType === "super_admin");
    
    if (!isAdmin) {
      // Remove admin-specific sensitive fields for non-admin users
      // Note: Sellers accessing their own listings will see rejectionReason via the listings endpoint
      const { approvedByAdminId, approvedAt, ...publicListing } = listing;
      
      return c.json({
        success: true,
        data: publicListing,
      });
    }

    // Admin gets all data including rejection reason
    return c.json({
      success: true,
      data: listing,
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
    return c.json({ 
      success: false,
      error: "Failed to create listing",
      message: error instanceof Error ? error.message : "Unknown error"
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
      
      // If status is being changed to rejected, handle rejection reason
      if (body.status === "rejected" && body.rejectionReason !== undefined) {
        updateData.rejectionReason = sanitizeString(body.rejectionReason, 1000);
      }
      
      // Clear rejection reason only when admin approves (status = active)
      // Keep rejection reason when seller resubmits (status = pending_approval)
      if (body.status === "active") {
        updateData.rejectionReason = null;
      }
    }
    if (body.rejectionReason !== undefined && body.status === "rejected") {
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

    // Handle metadata - extract fields that exist in table schema
    if (body.metadata !== undefined) {
      const metadata = typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata;
      const cleanedMetadata: any = {};
      
      // List of fields that exist in the listings table
      const tableFields = [
        'startCountryId', 'startPrimaryDivisionId', 'startSecondaryDivisionId',
        'endCountryId', 'endPrimaryDivisionId', 'endSecondaryDivisionId',
        'startLocationName', 'startLocationCoordinates', 'startGoogleMapsUrl',
        'endLocationName', 'endLocationCoordinates', 'endGoogleMapsUrl',
        'taxRate', 'advanceBookingPercentage', 'basePriceDisplay', 'currency'
      ];
      
      // Extract table fields from metadata and add them to updateData
      Object.keys(metadata).forEach(key => {
        if (tableFields.includes(key) && metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '') {
          // Store in table column
          updateData[key] = metadata[key];
        } else {
          // Keep in metadata
          cleanedMetadata[key] = metadata[key];
        }
      });
      
      // Update metadata with only non-table fields
      updateData.metadata = cleanedMetadata;
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
