import type { Context } from "hono";
import { prisma } from "../db.js";
import { sanitizeString } from "../helpers/validation.helper.js";

/**
 * Get content for a listing
 */
export const getListingContent = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    const content = await prisma.listingContent.findMany({
      where: { listingId },
      include: {
        media: true,
      },
      orderBy: [{ contentType: "asc" }, { contentOrder: "asc" }],
    });

    return c.json({
      success: true,
      data: content,
      count: content.length,
    });
  } catch (error) {
    console.error("Get listing content error:", error);
    return c.json({ error: "Failed to fetch content" }, 500);
  }
};

/**
 * Create listing content
 */
export const createListingContent = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const body = await c.req.json();

    const contentData = {
      listingId,
      contentType: body.contentType,
      contentOrder: body.contentOrder || 0,
      title: body.title ? sanitizeString(body.title, 255) : null,
      contentText: body.contentText
        ? sanitizeString(body.contentText, 10000)
        : null,
      imageUrls: body.imageUrls || null,
    };

    const content = await prisma.listingContent.create({
      data: contentData,
    });

    return c.json(
      {
        success: true,
        message: "Content created successfully",
        data: content,
      },
      201
    );
  } catch (error) {
    console.error("Create listing content error:", error);
    return c.json({ error: "Failed to create content" }, 500);
  }
};

/**
 * Update listing content
 */
export const updateListingContent = async (c: Context) => {
  try {
    const contentId = c.req.param("id");
    const body = await c.req.json();

    const updateData: any = {};

    if (body.contentType !== undefined) {
      updateData.contentType = body.contentType;
    }
    if (body.contentOrder !== undefined) {
      updateData.contentOrder = body.contentOrder;
    }
    if (body.title !== undefined) {
      updateData.title = body.title ? sanitizeString(body.title, 255) : null;
    }
    if (body.contentText !== undefined) {
      updateData.contentText = body.contentText
        ? sanitizeString(body.contentText, 10000)
        : null;
    }
    if (body.imageUrls !== undefined) {
      updateData.imageUrls = body.imageUrls;
    }

    const updatedContent = await prisma.listingContent.update({
      where: { id: contentId },
      data: updateData,
    });

    return c.json({
      success: true,
      message: "Content updated successfully",
      data: updatedContent,
    });
  } catch (error) {
    console.error("Update listing content error:", error);
    return c.json({ error: "Failed to update content" }, 500);
  }
};

/**
 * Get content by ID
 */
export const getListingContentById = async (c: Context) => {
  try {
    const contentId = c.req.param("id");

    const content = await prisma.listingContent.findUnique({
      where: { id: contentId },
      include: {
        media: true,
        listing: {
          select: {
            id: true,
            listingName: true,
          },
        },
      },
    });

    if (!content) {
      return c.json({ error: "Content not found" }, 404);
    }

    return c.json({
      success: true,
      data: content,
    });
  } catch (error) {
    console.error("Get listing content by ID error:", error);
    return c.json({ error: "Failed to fetch content" }, 500);
  }
};
