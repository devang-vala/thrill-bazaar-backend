import type { Context } from "hono";
import { prisma } from "../db.js";
import { sanitizeString } from "../helpers/validation.helper.js";

/**
 * Get media for a listing
 */
export const getListingMedia = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const media = await prisma.listingMedia.findMany({
      where: { listingId },
      orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }],
    });

    return c.json({
      success: true,
      data: media,
      count: media.length,
    });
  } catch (error) {
    console.error("Get listing media error:", error);
    return c.json({ error: "Failed to fetch media" }, 500);
  }
};

/**
 * Create listing media
 */
export const createListingMedia = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const body = await c.req.json();

    const mediaData = {
      listingId,
      contentId: body.contentId || null,
      mediaType: body.mediaType,
      mediaUrl: sanitizeString(body.mediaUrl, 500),
      thumbnailUrl: body.thumbnailUrl
        ? sanitizeString(body.thumbnailUrl, 500)
        : null,
      isPrimary: body.isPrimary || false,
      displayOrder: body.displayOrder || 0,
      caption: body.caption ? sanitizeString(body.caption, 255) : null,
    };

    const media = await prisma.listingMedia.create({
      data: mediaData,
    });

    return c.json(
      {
        success: true,
        message: "Media created successfully",
        data: media,
      },
      201
    );
  } catch (error) {
    console.error("Create listing media error:", error);
    return c.json({ error: "Failed to create media" }, 500);
  }
};

/**
 * Update listing media
 */
export const updateListingMedia = async (c: Context) => {
  try {
    const mediaId = c.req.param("id");
    const body = await c.req.json();

    const updateData: any = {};

    if (body.mediaUrl !== undefined) {
      updateData.mediaUrl = sanitizeString(body.mediaUrl, 500);
    }
    if (body.thumbnailUrl !== undefined) {
      updateData.thumbnailUrl = body.thumbnailUrl
        ? sanitizeString(body.thumbnailUrl, 500)
        : null;
    }
    if (body.isPrimary !== undefined) {
      updateData.isPrimary = body.isPrimary;
    }
    if (body.displayOrder !== undefined) {
      updateData.displayOrder = body.displayOrder;
    }
    if (body.caption !== undefined) {
      updateData.caption = body.caption
        ? sanitizeString(body.caption, 255)
        : null;
    }

    const updatedMedia = await prisma.listingMedia.update({
      where: { id: mediaId },
      data: updateData,
    });

    return c.json({
      success: true,
      message: "Media updated successfully",
      data: updatedMedia,
    });
  } catch (error) {
    console.error("Update listing media error:", error);
    return c.json({ error: "Failed to update media" }, 500);
  }
};
