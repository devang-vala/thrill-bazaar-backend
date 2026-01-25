import type { Context } from "hono";
import { prisma } from "../db.js";
import { sanitizeString } from "../helpers/validation.helper.js";

/**
 * Get all tags (with optional filters)
 */
export const getTags = async (c: Context) => {
  try {
    const tagType = c.req.query("type");
    const isActive = c.req.query("isActive");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "50");
    const skip = (page - 1) * limit;

    const whereClause: any = {};

    if (tagType) {
      whereClause.tagType = tagType;
    }

    if (isActive !== undefined) {
      whereClause.isActive = isActive === "true";
    }

    const [tags, totalCount] = await Promise.all([
      prisma.tag.findMany({
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
              listingTags: true,
            },
          },
        },
        orderBy: { displayOrder: "asc" },
        skip,
        take: limit,
      }),
      prisma.tag.count({ where: whereClause }),
    ]);

    return c.json({
      success: true,
      data: tags,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error("Get tags error:", error);
    return c.json({ success: false, message: "Failed to fetch tags" }, 500);
  }
};

/**
 * Get a single tag by ID
 */
export const getTagById = async (c: Context) => {
  try {
    const tagId = c.req.param("id");

    const tag = await prisma.tag.findUnique({
      where: { id: tagId },
      include: {
        createdByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        listingTags: {
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
            listingTags: true,
          },
        },
      },
    });

    if (!tag) {
      return c.json({ success: false, message: "Tag not found" }, 404);
    }

    return c.json({ success: true, data: tag });
  } catch (error) {
    console.error("Get tag by ID error:", error);
    return c.json({ success: false, message: "Failed to fetch tag" }, 500);
  }
};

/**
 * Create a new tag (Admin only)
 * Text only - no icon upload
 */
export const createTag = async (c: Context) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    const { tagName, tagType, description, tagColor, displayOrder } = body;

    // Validate required fields
    if (!tagName || !tagType) {
      return c.json(
        { success: false, message: "Tag name and type are required" },
        400
      );
    }

    // Validate tag type
    const validTagTypes = ["promotional", "characteristic", "tier"];
    if (!validTagTypes.includes(tagType)) {
      return c.json(
        { success: false, message: `Invalid tag type. Must be one of: ${validTagTypes.join(", ")}` },
        400
      );
    }

    // Check for duplicate tag name
    const existingTag = await prisma.tag.findUnique({
      where: { tagName: sanitizeString(tagName, 100) },
    });

    if (existingTag) {
      return c.json(
        { success: false, message: "A tag with this name already exists" },
        409
      );
    }

    const tag = await prisma.tag.create({
      data: {
        tagName: sanitizeString(tagName, 100),
        tagType: tagType as any,
        description: description ? sanitizeString(description, 1000) : null,
        tagColor: tagColor ? sanitizeString(tagColor, 20) : null,
        displayOrder: displayOrder || 0,
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
        message: "Tag created successfully",
        data: tag,
      },
      201
    );
  } catch (error) {
    console.error("Create tag error:", error);
    return c.json({ success: false, message: "Failed to create tag" }, 500);
  }
};

/**
 * Update a tag (Admin only)
 * Text only - no icon upload
 */
export const updateTag = async (c: Context) => {
  try {
    const tagId = c.req.param("id");
    const body = await c.req.json();

    const existingTag = await prisma.tag.findUnique({
      where: { id: tagId },
    });

    if (!existingTag) {
      return c.json({ success: false, message: "Tag not found" }, 404);
    }

    const updateData: any = {};

    if (body.tagName !== undefined) {
      const duplicateTag = await prisma.tag.findFirst({
        where: {
          tagName: sanitizeString(body.tagName, 100),
          id: { not: tagId },
        },
      });

      if (duplicateTag) {
        return c.json(
          { success: false, message: "A tag with this name already exists" },
          409
        );
      }
      updateData.tagName = sanitizeString(body.tagName, 100);
    }

    if (body.tagType !== undefined) {
      const validTagTypes = ["promotional", "characteristic", "tier"];
      if (!validTagTypes.includes(body.tagType)) {
        return c.json(
          { success: false, message: `Invalid tag type. Must be one of: ${validTagTypes.join(", ")}` },
          400
        );
      }
      updateData.tagType = body.tagType;
    }

    if (body.description !== undefined) {
      updateData.description = body.description ? sanitizeString(body.description, 1000) : null;
    }

    if (body.tagColor !== undefined) {
      updateData.tagColor = body.tagColor ? sanitizeString(body.tagColor, 20) : null;
    }

    if (body.displayOrder !== undefined) {
      updateData.displayOrder = body.displayOrder;
    }

    if (body.isActive !== undefined) {
      updateData.isActive = body.isActive;
    }

    const updatedTag = await prisma.tag.update({
      where: { id: tagId },
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
      message: "Tag updated successfully",
      data: updatedTag,
    });
  } catch (error) {
    console.error("Update tag error:", error);
    return c.json({ success: false, message: "Failed to update tag" }, 500);
  }
};

/**
 * Delete a tag (Admin only)
 */
export const deleteTag = async (c: Context) => {
  try {
    const tagId = c.req.param("id");

    const existingTag = await prisma.tag.findUnique({
      where: { id: tagId },
      include: {
        _count: {
          select: { listingTags: true },
        },
      },
    });

    if (!existingTag) {
      return c.json({ success: false, message: "Tag not found" }, 404);
    }

    if (existingTag._count.listingTags > 0) {
      return c.json(
        {
          success: false,
          message: `Cannot delete tag. It is assigned to ${existingTag._count.listingTags} listing(s). Remove the tag from all listings first or deactivate it.`,
        },
        400
      );
    }

    await prisma.tag.delete({
      where: { id: tagId },
    });

    return c.json({
      success: true,
      message: "Tag deleted successfully",
    });
  } catch (error) {
    console.error("Delete tag error:", error);
    return c.json({ success: false, message: "Failed to delete tag" }, 500);
  }
};

/**
 * Assign a tag to a listing (Admin only)
 */
export const assignTagToListing = async (c: Context) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    const { listingId, tagId } = body;

    if (!listingId || !tagId) {
      return c.json(
        { success: false, message: "Listing ID and Tag ID are required" },
        400
      );
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      return c.json({ success: false, message: "Listing not found" }, 404);
    }

    const tag = await prisma.tag.findUnique({
      where: { id: tagId },
    });

    if (!tag) {
      return c.json({ success: false, message: "Tag not found" }, 404);
    }

    if (!tag.isActive) {
      return c.json(
        { success: false, message: "Cannot assign an inactive tag" },
        400
      );
    }

    const existingAssignment = await prisma.listingTag.findUnique({
      where: {
        listingId_tagId: {
          listingId,
          tagId,
        },
      },
    });

    if (existingAssignment) {
      if (!existingAssignment.isActive) {
        const reactivated = await prisma.listingTag.update({
          where: { id: existingAssignment.id },
          data: {
            isActive: true,
            assignedByAdminId: user?.userId || null,
            assignedAt: new Date(),
          },
          include: {
            tag: true,
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
          message: "Tag reassigned to listing successfully",
          data: reactivated,
        });
      }

      return c.json(
        { success: false, message: "Tag is already assigned to this listing" },
        409
      );
    }

    const listingTag = await prisma.listingTag.create({
      data: {
        listingId,
        tagId,
        assignedByAdminId: user?.userId || null,
        isActive: true,
      },
      include: {
        tag: true,
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
        message: "Tag assigned to listing successfully",
        data: listingTag,
      },
      201
    );
  } catch (error) {
    console.error("Assign tag to listing error:", error);
    return c.json({ success: false, message: "Failed to assign tag" }, 500);
  }
};

/**
 * Remove a tag from a listing (Admin only)
 */
export const removeTagFromListing = async (c: Context) => {
  try {
    const body = await c.req.json();

    const { listingId, tagId } = body;

    if (!listingId || !tagId) {
      return c.json(
        { success: false, message: "Listing ID and Tag ID are required" },
        400
      );
    }

    const existingAssignment = await prisma.listingTag.findUnique({
      where: {
        listingId_tagId: {
          listingId,
          tagId,
        },
      },
    });

    if (!existingAssignment) {
      return c.json(
        { success: false, message: "Tag is not assigned to this listing" },
        404
      );
    }

    await prisma.listingTag.update({
      where: { id: existingAssignment.id },
      data: { isActive: false },
    });

    return c.json({
      success: true,
      message: "Tag removed from listing successfully",
    });
  } catch (error) {
    console.error("Remove tag from listing error:", error);
    return c.json({ success: false, message: "Failed to remove tag" }, 500);
  }
};

/**
 * Get all tags for a listing
 */
export const getListingTags = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const listingTags = await prisma.listingTag.findMany({
      where: {
        listingId,
        isActive: true,
        tag: {
          isActive: true,
        },
      },
      include: {
        tag: true,
        assignedByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        tag: {
          displayOrder: "asc",
        },
      },
    });

    return c.json({
      success: true,
      data: listingTags,
      count: listingTags.length,
    });
  } catch (error) {
    console.error("Get listing tags error:", error);
    return c.json({ success: false, message: "Failed to fetch listing tags" }, 500);
  }
};

/**
 * Bulk assign tags to a listing (Admin only)
 */
export const bulkAssignTags = async (c: Context) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    const { listingId, tagIds } = body;

    if (!listingId || !tagIds || !Array.isArray(tagIds) || tagIds.length === 0) {
      return c.json(
        { success: false, message: "Listing ID and tag IDs array are required" },
        400
      );
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      return c.json({ success: false, message: "Listing not found" }, 404);
    }

    const tags = await prisma.tag.findMany({
      where: {
        id: { in: tagIds },
        isActive: true,
      },
    });

    if (tags.length !== tagIds.length) {
      return c.json(
        { success: false, message: "One or more tags not found or inactive" },
        400
      );
    }

    const existingAssignments = await prisma.listingTag.findMany({
      where: {
        listingId,
        tagId: { in: tagIds },
      },
    });

    const existingTagIds = existingAssignments.map((a) => a.tagId);
    const newTagIds = tagIds.filter((id: string) => !existingTagIds.includes(id));

    if (newTagIds.length > 0) {
      await prisma.listingTag.createMany({
        data: newTagIds.map((tagId: string) => ({
          listingId,
          tagId,
          assignedByAdminId: user?.userId || null,
          isActive: true,
        })),
      });
    }

    const inactiveAssignments = existingAssignments.filter((a) => !a.isActive);
    if (inactiveAssignments.length > 0) {
      await prisma.listingTag.updateMany({
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

    const updatedTags = await prisma.listingTag.findMany({
      where: {
        listingId,
        isActive: true,
      },
      include: {
        tag: true,
      },
    });

    return c.json({
      success: true,
      message: `${newTagIds.length} new tag(s) assigned, ${inactiveAssignments.length} tag(s) reactivated`,
      data: updatedTags,
    });
  } catch (error) {
    console.error("Bulk assign tags error:", error);
    return c.json({ success: false, message: "Failed to bulk assign tags" }, 500);
  }
};

/**
 * Get listings by tag
 */
export const getListingsByTag = async (c: Context) => {
  try {
    const tagId = c.req.param("tagId");
    const page = parseInt(c.req.query("page") || "1");
    const limit = parseInt(c.req.query("limit") || "12");
    const skip = (page - 1) * limit;

    const tag = await prisma.tag.findUnique({
      where: { id: tagId },
    });

    if (!tag) {
      return c.json({ success: false, message: "Tag not found" }, 404);
    }

    const [listings, totalCount] = await Promise.all([
      prisma.listing.findMany({
        where: {
          status: "active",
          tags: {
            some: {
              tagId,
              isActive: true,
            },
          },
        },
        include: {
          category: {
            select: {
              id: true,
              categoryName: true,
            },
          },
          operator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          tags: {
            where: { isActive: true },
            include: {
              tag: true,
            },
          },
          badges: {
            where: { isActive: true },
            include: {
              badge: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.listing.count({
        where: {
          status: "active",
          tags: {
            some: {
              tagId,
              isActive: true,
            },
          },
        },
      }),
    ]);

    return c.json({
      success: true,
      data: {
        tag,
        listings,
      },
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error("Get listings by tag error:", error);
    return c.json({ success: false, message: "Failed to fetch listings" }, 500);
  }
};