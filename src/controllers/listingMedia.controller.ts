import type { Context } from "hono";
import { prisma } from "../db.js";
import { sanitizeString } from "../helpers/validation.helper.js";

/**
 * Replace gallery media for a listing.
 *
 * Used by the listing edit wizard when the seller changes images in step 5.
 * It intentionally only replaces listing-level media (contentId null) so
 * day-wise itinerary media linked to ListingContent rows is left untouched.
 */
export const replaceListingMedia = async (c: Context) => {
  try {
    const body = await c.req.json();
    const listingId = body.listingId;
    const mediaItems = Array.isArray(body.media) ? body.media : [];

    if (!listingId) {
      return c.json({ error: "listingId is required" }, 400);
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true },
    });

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    const mediaData = mediaItems
      .map((item: any, index: number) => {
        const mediaUrl = sanitizeString(String(item?.mediaUrl || ""), 500);
        const mediaType = sanitizeString(String(item?.mediaType || "image"), 50);

        if (!mediaUrl || !mediaType) {
          return null;
        }

        return {
          listingId,
          contentId: null,
          media: {
            mediaUrl,
            mediaType,
            displayOrder: Number.isFinite(Number(item?.displayOrder))
              ? Number(item.displayOrder)
              : index + 1,
            caption: item?.caption ? sanitizeString(String(item.caption), 255) : null,
          },
        };
      })
      .filter(Boolean) as Array<{
        listingId: string;
        contentId: null;
        media: {
          mediaUrl: string;
          mediaType: string;
          displayOrder: number;
          caption: string | null;
        };
      }>;

    const replacedMedia = await prisma.$transaction(async (tx) => {
      await tx.listingMedia.deleteMany({
        where: {
          listingId,
          contentId: null,
        },
      });

      if (mediaData.length > 0) {
        await tx.listingMedia.createMany({
          data: mediaData,
        });
      }

      return tx.listingMedia.findMany({
        where: {
          listingId,
          contentId: null,
        },
        orderBy: { createdAt: "asc" },
      });
    });

    return c.json({
      success: true,
      message: "Listing media replaced successfully",
      data: replacedMedia,
      count: replacedMedia.length,
    });
  } catch (error) {
    console.error("Replace listing media error:", error);
    return c.json({ error: "Failed to replace media" }, 500);
  }
};

/**
 * Get media for a listing
 */
export const getListingMedia = async (c: Context) => {
  try {
    const body = await c.req.json();
    const listingId = body.listingId;

    if (!listingId) {
      return c.json({ error: "listingId is required" }, 400);
    }

    const media = await prisma.listingMedia.findMany({
      where: { listingId },
      orderBy: { createdAt: "asc" },
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
    const body = await c.req.json();
    const listingId = body.listingId;

    if (!listingId) {
      return c.json({ error: "listingId is required" }, 400);
    }

    // Build media object
    const mediaObject = {
      mediaUrl: sanitizeString(body.mediaUrl, 500),
      mediaType: body.mediaType,
      displayOrder: body.displayOrder || 0,
      caption: body.caption ? sanitizeString(body.caption, 255) : null,
    };

    const mediaData = {
      listingId,
      contentId: body.contentId || null,
      media: mediaObject,
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

    // Get existing media to merge with updates
    const existingMedia = await prisma.listingMedia.findUnique({
      where: { id: mediaId },
    });

    if (!existingMedia) {
      return c.json({ error: "Media not found" }, 404);
    }

    // Merge existing media object with updates
    const currentMedia = existingMedia.media as any;
    const updatedMediaObject = {
      mediaUrl: body.mediaUrl !== undefined 
        ? sanitizeString(body.mediaUrl, 500) 
        : currentMedia.mediaUrl,
      mediaType: body.mediaType !== undefined 
        ? body.mediaType 
        : currentMedia.mediaType,
      displayOrder: body.displayOrder !== undefined 
        ? body.displayOrder 
        : currentMedia.displayOrder,
      caption: body.caption !== undefined 
        ? (body.caption ? sanitizeString(body.caption, 255) : null)
        : currentMedia.caption,
    };

    const updatedMedia = await prisma.listingMedia.update({
      where: { id: mediaId },
      data: { media: updatedMediaObject },
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
