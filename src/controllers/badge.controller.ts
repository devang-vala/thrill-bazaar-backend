import type { Context } from "hono";
import { prisma } from "../db.js";
import { configureCloudinary } from "../config/cloudinary.config.js";
import { Readable } from "stream";
import { sanitizeString } from "../helpers/validation.helper.js";

const cloudinary = configureCloudinary();

/**
 * Helper function to upload file to Cloudinary
 */
const uploadToCloudinary = async (file: File, folder: string = "badges"): Promise<{
  url: string;
  publicId: string;
  format: string;
  width: number;
  height: number;
}> => {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `thrill-bazaar/${folder}`,
        resource_type: "image",
        transformation: [{ width: 200, height: 200, crop: "limit" }], // Limit badge icon size
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            url: result?.secure_url || "",
            publicId: result?.public_id || "",
            format: result?.format || "",
            width: result?.width || 0,
            height: result?.height || 0,
          });
        }
      }
    );

    const readableStream = new Readable();
    readableStream.push(buffer);
    readableStream.push(null);
    readableStream.pipe(uploadStream);
  });
};

/**
 * Delete image from Cloudinary
 */
const deleteFromCloudinary = async (publicId: string): Promise<boolean> => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result.result === "ok";
  } catch (error) {
    console.error("Cloudinary delete error:", error);
    return false;
  }
};

/**
 * Get all badges (with optional filters)
 */
export const getBadges = async (c: Context) => {
  try {
    const badgeType = c.req.query("type");
    const isActive = c.req.query("isActive");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "50");
    const skip = (page - 1) * limit;

    const whereClause: any = {};

    if (badgeType) {
      whereClause.badgeType = badgeType;
    }

    if (isActive !== undefined) {
      whereClause.isActive = isActive === "true";
    }

    const [badges, totalCount] = await Promise.all([
      prisma.badge.findMany({
        where: whereClause,
        include: {
          createdByAdmin: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          _count: {
            select: {
              listingBadges: true,
            },
          },
        },
        orderBy: { displayOrder: "asc" },
        skip,
        take: limit,
      }),
      prisma.badge.count({ where: whereClause }),
    ]);

    return c.json({
      success: true,
      data: badges,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error("Get badges error:", error);
    return c.json({ success: false, message: "Failed to fetch badges" }, 500);
  }
};

/**
 * Get a single badge by ID
 */
export const getBadgeById = async (c: Context) => {
  try {
    const badgeId = c.req.param("id");

    const badge = await prisma.badge.findUnique({
      where: { id: badgeId },
      include: {
        createdByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        listingBadges: {
          where: { isActive: true },
          include: {
            listing: {
              select: {
                id: true,
                listingName: true,
                listingSlug: true,
                frontImageUrl: true,
              },
            },
          },
          take: 10,
        },
        _count: {
          select: {
            listingBadges: true,
          },
        },
      },
    });

    if (!badge) {
      return c.json({ success: false, message: "Badge not found" }, 404);
    }

    return c.json({ success: true, data: badge });
  } catch (error) {
    console.error("Get badge by ID error:", error);
    return c.json({ success: false, message: "Failed to fetch badge" }, 500);
  }
};

/**
 * Create a new badge (Admin only)
 * Supports multipart/form-data for icon upload
 */
export const createBadge = async (c: Context) => {
  try {
    const contentType = c.req.header("content-type") || "";
    const user = c.get("user");

    let badgeName: string;
    let badgeType: string;
    let badgeDescription: string | null = null;
    let badgeColor: string | null = null;
    let displayOrder: number = 0;
    let badgeIconUrl: string | null = null;
    let badgeIconPublicId: string | null = null;

    // Handle multipart/form-data (with file upload)
    if (contentType.includes("multipart/form-data")) {
      const body = await c.req.parseBody();

      badgeName = body.badgeName as string;
      badgeType = body.badgeType as string;
      badgeDescription = body.badgeDescription as string || null;
      badgeColor = body.badgeColor as string || null;
      displayOrder = parseInt(body.displayOrder as string) || 0;

      // Handle icon file upload
      const iconFile = body.badgeIcon || body.icon;
      if (iconFile && iconFile instanceof File) {
        const uploadResult = await uploadToCloudinary(iconFile, "badges");
        badgeIconUrl = uploadResult.url;
        badgeIconPublicId = uploadResult.publicId;
      }
    } else {
      // Handle JSON body
      const body = await c.req.json();
      badgeName = body.badgeName;
      badgeType = body.badgeType;
      badgeDescription = body.badgeDescription || null;
      badgeColor = body.badgeColor || null;
      displayOrder = body.displayOrder || 0;
      badgeIconUrl = body.badgeIconUrl || null;
    }

    // Validate required fields
    if (!badgeName || !badgeType) {
      return c.json(
        { success: false, message: "Badge name and type are required" },
        400
      );
    }

    // Validate badge type
    const validBadgeTypes = ["certification", "performance", "special"];
    if (!validBadgeTypes.includes(badgeType)) {
      return c.json(
        { success: false, message: `Invalid badge type. Must be one of: ${validBadgeTypes.join(", ")}` },
        400
      );
    }

    // Check for duplicate badge name
    const existingBadge = await prisma.badge.findUnique({
      where: { badgeName: sanitizeString(badgeName, 100) },
    });

    if (existingBadge) {
      // Delete uploaded icon if badge creation fails
      if (badgeIconPublicId) {
        await deleteFromCloudinary(badgeIconPublicId);
      }
      return c.json(
        { success: false, message: "A badge with this name already exists" },
        409
      );
    }

    const badge = await prisma.badge.create({
      data: {
        badgeName: sanitizeString(badgeName, 100),
        badgeType: badgeType as any,
        badgeIconUrl: badgeIconUrl,
        badgeDescription: badgeDescription ? sanitizeString(badgeDescription, 1000) : null,
        badgeColor: badgeColor ? sanitizeString(badgeColor, 20) : null,
        displayOrder: displayOrder,
        createdByAdminId: user?.userId || null,
        isActive: true,
      },
      include: {
        createdByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return c.json(
      {
        success: true,
        message: "Badge created successfully",
        data: badge,
      },
      201
    );
  } catch (error) {
    console.error("Create badge error:", error);
    return c.json({ success: false, message: "Failed to create badge" }, 500);
  }
};

/**
 * Update a badge (Admin only)
 * Supports multipart/form-data for icon upload
 */
export const updateBadge = async (c: Context) => {
  try {
    const badgeId = c.req.param("id");
    const contentType = c.req.header("content-type") || "";

    // Check if badge exists
    const existingBadge = await prisma.badge.findUnique({
      where: { id: badgeId },
    });

    if (!existingBadge) {
      return c.json({ success: false, message: "Badge not found" }, 404);
    }

    const updateData: any = {};
    let newIconPublicId: string | null = null;

    // Handle multipart/form-data (with file upload)
    if (contentType.includes("multipart/form-data")) {
      const body = await c.req.parseBody();

      if (body.badgeName) {
        updateData.badgeName = sanitizeString(body.badgeName as string, 100);
      }
      if (body.badgeType) {
        const validBadgeTypes = ["certification", "performance", "special"];
        if (!validBadgeTypes.includes(body.badgeType as string)) {
          return c.json(
            { success: false, message: `Invalid badge type. Must be one of: ${validBadgeTypes.join(", ")}` },
            400
          );
        }
        updateData.badgeType = body.badgeType;
      }
      if (body.badgeDescription !== undefined) {
        updateData.badgeDescription = body.badgeDescription ? sanitizeString(body.badgeDescription as string, 1000) : null;
      }
      if (body.badgeColor !== undefined) {
        updateData.badgeColor = body.badgeColor ? sanitizeString(body.badgeColor as string, 20) : null;
      }
      if (body.displayOrder !== undefined) {
        updateData.displayOrder = parseInt(body.displayOrder as string) || 0;
      }
      if (body.isActive !== undefined) {
        updateData.isActive = body.isActive === "true" || body.isActive === "true";
      }

      // Handle icon file upload
      const iconFile = body.badgeIcon || body.icon;
      if (iconFile && iconFile instanceof File) {
        const uploadResult = await uploadToCloudinary(iconFile, "badges");
        updateData.badgeIconUrl = uploadResult.url;
        newIconPublicId = uploadResult.publicId;

        // Delete old icon if it exists (extract public ID from URL)
        if (existingBadge.badgeIconUrl) {
          const oldPublicId = extractPublicIdFromUrl(existingBadge.badgeIconUrl);
          if (oldPublicId) {
            await deleteFromCloudinary(oldPublicId);
          }
        }
      }
    } else {
      // Handle JSON body
      const body = await c.req.json();

      if (body.badgeName !== undefined) {
        // Check for duplicate name
        const duplicateBadge = await prisma.badge.findFirst({
          where: {
            badgeName: sanitizeString(body.badgeName, 100),
            id: { not: badgeId },
          },
        });

        if (duplicateBadge) {
          return c.json(
            { success: false, message: "A badge with this name already exists" },
            409
          );
        }
        updateData.badgeName = sanitizeString(body.badgeName, 100);
      }

      if (body.badgeType !== undefined) {
        const validBadgeTypes = ["certification", "performance", "special"];
        if (!validBadgeTypes.includes(body.badgeType)) {
          return c.json(
            { success: false, message: `Invalid badge type. Must be one of: ${validBadgeTypes.join(", ")}` },
            400
          );
        }
        updateData.badgeType = body.badgeType;
      }

      if (body.badgeIconUrl !== undefined) {
        updateData.badgeIconUrl = body.badgeIconUrl ? sanitizeString(body.badgeIconUrl, 500) : null;
      }

      if (body.badgeDescription !== undefined) {
        updateData.badgeDescription = body.badgeDescription ? sanitizeString(body.badgeDescription, 1000) : null;
      }

      if (body.badgeColor !== undefined) {
        updateData.badgeColor = body.badgeColor ? sanitizeString(body.badgeColor, 20) : null;
      }

      if (body.displayOrder !== undefined) {
        updateData.displayOrder = body.displayOrder;
      }

      if (body.isActive !== undefined) {
        updateData.isActive = body.isActive;
      }
    }

    const updatedBadge = await prisma.badge.update({
      where: { id: badgeId },
      data: updateData,
      include: {
        createdByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return c.json({
      success: true,
      message: "Badge updated successfully",
      data: updatedBadge,
    });
  } catch (error) {
    console.error("Update badge error:", error);
    return c.json({ success: false, message: "Failed to update badge" }, 500);
  }
};

/**
 * Delete a badge (Admin only)
 */
export const deleteBadge = async (c: Context) => {
  try {
    const badgeId = c.req.param("id");

    const existingBadge = await prisma.badge.findUnique({
      where: { id: badgeId },
      include: {
        _count: {
          select: { listingBadges: true },
        },
      },
    });

    if (!existingBadge) {
      return c.json({ success: false, message: "Badge not found" }, 404);
    }

    if (existingBadge._count.listingBadges > 0) {
      return c.json(
        {
          success: false,
          message: `Cannot delete badge. It is assigned to ${existingBadge._count.listingBadges} listing(s). Remove the badge from all listings first or deactivate it.`,
        },
        400
      );
    }

    // Delete icon from Cloudinary if exists
    if (existingBadge.badgeIconUrl) {
      const publicId = extractPublicIdFromUrl(existingBadge.badgeIconUrl);
      if (publicId) {
        await deleteFromCloudinary(publicId);
      }
    }

    await prisma.badge.delete({
      where: { id: badgeId },
    });

    return c.json({
      success: true,
      message: "Badge deleted successfully",
    });
  } catch (error) {
    console.error("Delete badge error:", error);
    return c.json({ success: false, message: "Failed to delete badge" }, 500);
  }
};

/**
 * Upload badge icon separately (Admin only)
 */
export const uploadBadgeIcon = async (c: Context) => {
  try {
    const badgeId = c.req.param("id");

    const existingBadge = await prisma.badge.findUnique({
      where: { id: badgeId },
    });

    if (!existingBadge) {
      return c.json({ success: false, message: "Badge not found" }, 404);
    }

    const body = await c.req.parseBody();
    const iconFile = body.badgeIcon || body.icon || body.file;

    if (!iconFile || !(iconFile instanceof File)) {
      return c.json({ success: false, message: "No icon file provided" }, 400);
    }

    // Upload new icon
    const uploadResult = await uploadToCloudinary(iconFile, "badges");

    // Delete old icon if exists
    if (existingBadge.badgeIconUrl) {
      const oldPublicId = extractPublicIdFromUrl(existingBadge.badgeIconUrl);
      if (oldPublicId) {
        await deleteFromCloudinary(oldPublicId);
      }
    }

    // Update badge with new icon URL
    const updatedBadge = await prisma.badge.update({
      where: { id: badgeId },
      data: { badgeIconUrl: uploadResult.url },
    });

    return c.json({
      success: true,
      message: "Badge icon uploaded successfully",
      data: {
        badgeIconUrl: uploadResult.url,
        badge: updatedBadge,
      },
    });
  } catch (error) {
    console.error("Upload badge icon error:", error);
    return c.json({ success: false, message: "Failed to upload badge icon" }, 500);
  }
};

/**
 * Delete badge icon (Admin only)
 */
export const deleteBadgeIcon = async (c: Context) => {
  try {
    const badgeId = c.req.param("id");

    const existingBadge = await prisma.badge.findUnique({
      where: { id: badgeId },
    });

    if (!existingBadge) {
      return c.json({ success: false, message: "Badge not found" }, 404);
    }

    if (!existingBadge.badgeIconUrl) {
      return c.json({ success: false, message: "Badge has no icon" }, 400);
    }

    // Delete from Cloudinary
    const publicId = extractPublicIdFromUrl(existingBadge.badgeIconUrl);
    if (publicId) {
      await deleteFromCloudinary(publicId);
    }

    // Update badge
    const updatedBadge = await prisma.badge.update({
      where: { id: badgeId },
      data: { badgeIconUrl: null },
    });

    return c.json({
      success: true,
      message: "Badge icon deleted successfully",
      data: updatedBadge,
    });
  } catch (error) {
    console.error("Delete badge icon error:", error);
    return c.json({ success: false, message: "Failed to delete badge icon" }, 500);
  }
};

/**
 * Helper: Extract public ID from Cloudinary URL
 */
const extractPublicIdFromUrl = (url: string): string | null => {
  try {
    // URL format: https://res.cloudinary.com/{cloud_name}/image/upload/v{version}/{folder}/{public_id}.{format}
    const matches = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
    return matches ? matches[1] : null;
  } catch {
    return null;
  }
};

/**
 * Assign a badge to a listing (Admin only)
 */
export const assignBadgeToListing = async (c: Context) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    const { listingId, badgeId } = body;

    if (!listingId || !badgeId) {
      return c.json(
        { success: false, message: "Listing ID and Badge ID are required" },
        400
      );
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      return c.json({ success: false, message: "Listing not found" }, 404);
    }

    const badge = await prisma.badge.findUnique({
      where: { id: badgeId },
    });

    if (!badge) {
      return c.json({ success: false, message: "Badge not found" }, 404);
    }

    if (!badge.isActive) {
      return c.json(
        { success: false, message: "Cannot assign an inactive badge" },
        400
      );
    }

    const existingAssignment = await prisma.listingBadge.findUnique({
      where: {
        listingId_badgeId: {
          listingId,
          badgeId,
        },
      },
    });

    if (existingAssignment) {
      if (!existingAssignment.isActive) {
        const reactivated = await prisma.listingBadge.update({
          where: { id: existingAssignment.id },
          data: {
            isActive: true,
            assignedByAdminId: user?.userId || null,
            assignedAt: new Date(),
          },
          include: {
            badge: true,
            listing: {
              select: {
                id: true,
                listingName: true,
                listingSlug: true,
              },
            },
          },
        });

        return c.json({
          success: true,
          message: "Badge reassigned to listing successfully",
          data: reactivated,
        });
      }

      return c.json(
        { success: false, message: "Badge is already assigned to this listing" },
        409
      );
    }

    const listingBadge = await prisma.listingBadge.create({
      data: {
        listingId,
        badgeId,
        assignedByAdminId: user?.userId || null,
        isActive: true,
      },
      include: {
        badge: true,
        listing: {
          select: {
            id: true,
            listingName: true,
            listingSlug: true,
          },
        },
        assignedByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return c.json(
      {
        success: true,
        message: "Badge assigned to listing successfully",
        data: listingBadge,
      },
      201
    );
  } catch (error) {
    console.error("Assign badge to listing error:", error);
    return c.json({ success: false, message: "Failed to assign badge" }, 500);
  }
};

/**
 * Remove a badge from a listing (Admin only)
 */
export const removeBadgeFromListing = async (c: Context) => {
  try {
    const body = await c.req.json();

    const { listingId, badgeId } = body;

    if (!listingId || !badgeId) {
      return c.json(
        { success: false, message: "Listing ID and Badge ID are required" },
        400
      );
    }

    const existingAssignment = await prisma.listingBadge.findUnique({
      where: {
        listingId_badgeId: {
          listingId,
          badgeId,
        },
      },
    });

    if (!existingAssignment) {
      return c.json(
        { success: false, message: "Badge is not assigned to this listing" },
        404
      );
    }

    await prisma.listingBadge.update({
      where: { id: existingAssignment.id },
      data: { isActive: false },
    });

    return c.json({
      success: true,
      message: "Badge removed from listing successfully",
    });
  } catch (error) {
    console.error("Remove badge from listing error:", error);
    return c.json({ success: false, message: "Failed to remove badge" }, 500);
  }
};

/**
 * Get all badges for a listing
 */
export const getListingBadges = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const listingBadges = await prisma.listingBadge.findMany({
      where: {
        listingId,
        isActive: true,
        badge: {
          isActive: true,
        },
      },
      include: {
        badge: true,
        assignedByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        badge: {
          displayOrder: "asc",
        },
      },
    });

    return c.json({
      success: true,
      data: listingBadges,
      count: listingBadges.length,
    });
  } catch (error) {
    console.error("Get listing badges error:", error);
    return c.json({ success: false, message: "Failed to fetch listing badges" }, 500);
  }
};

/**
 * Bulk assign badges to a listing (Admin only)
 */
export const bulkAssignBadges = async (c: Context) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    const { listingId, badgeIds } = body;

    if (!listingId || !badgeIds || !Array.isArray(badgeIds) || badgeIds.length === 0) {
      return c.json(
        { success: false, message: "Listing ID and badge IDs array are required" },
        400
      );
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      return c.json({ success: false, message: "Listing not found" }, 404);
    }

    const badges = await prisma.badge.findMany({
      where: {
        id: { in: badgeIds },
        isActive: true,
      },
    });

    if (badges.length !== badgeIds.length) {
      return c.json(
        { success: false, message: "One or more badges not found or inactive" },
        400
      );
    }

    const existingAssignments = await prisma.listingBadge.findMany({
      where: {
        listingId,
        badgeId: { in: badgeIds },
      },
    });

    const existingBadgeIds = existingAssignments.map((a) => a.badgeId);
    const newBadgeIds = badgeIds.filter((id: string) => !existingBadgeIds.includes(id));

    if (newBadgeIds.length > 0) {
      await prisma.listingBadge.createMany({
        data: newBadgeIds.map((badgeId: string) => ({
          listingId,
          badgeId,
          assignedByAdminId: user?.userId || null,
          isActive: true,
        })),
      });
    }

    const inactiveAssignments = existingAssignments.filter((a) => !a.isActive);
    if (inactiveAssignments.length > 0) {
      await prisma.listingBadge.updateMany({
        where: {
          id: { in: inactiveAssignments.map((a) => a.id) },
        },
        data: {
          isActive: true,
          assignedByAdminId: user?.userId || null,
          assignedAt: new Date(),
        },
      });
    }

    const updatedBadges = await prisma.listingBadge.findMany({
      where: {
        listingId,
        isActive: true,
      },
      include: {
        badge: true,
      },
    });

    return c.json({
      success: true,
      message: `${newBadgeIds.length} new badge(s) assigned, ${inactiveAssignments.length} badge(s) reactivated`,
      data: updatedBadges,
    });
  } catch (error) {
    console.error("Bulk assign badges error:", error);
    return c.json({ success: false, message: "Failed to bulk assign badges" }, 500);
  }
};