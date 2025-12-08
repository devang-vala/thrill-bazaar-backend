import type { Context } from "hono";
import { prisma } from "../db.js";
import { z } from "zod";

// Validation schema for FAQ item
const faqItemSchema = z.object({
  question: z.string().min(1, "Question is required"),
  answer: z.string().min(1, "Answer is required"),
});

// Validation schema for FAQ creation/update
const faqSchema = z.object({
  listingId: z.string().uuid("Invalid listing ID"),
  faqs: z.array(faqItemSchema).min(1, "At least one FAQ is required"),
});

/**
 * Get FAQs for a listing
 */
export const getListingFaqs = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    if (!listingId) {
      return c.json({ error: "Listing ID is required" }, 400);
    }
    const faqRecord = await prisma.listingFaq.findUnique({
      where: { listingId },
    });
    if (!faqRecord) {
      return c.json({ faqs: [] }, 200);
    }
    return c.json({ faqs: faqRecord.faqs }, 200);
  } catch (error) {
    console.error("Error fetching FAQs:", error);
    return c.json({ error: "Failed to fetch FAQs" }, 500);
  }
};

/**
 * Create FAQs for a listing
 */
export const createListingFaqs = async (c: Context) => {
  try {
    const body = await c.req.json();
    const validatedData = faqSchema.parse(body);

    // Check if listing exists
    const listing = await prisma.listing.findUnique({ where: { id: validatedData.listingId } });
    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    // Check if FAQ already exists for this listing
    const existingFaq = await prisma.listingFaq.findUnique({ where: { listingId: validatedData.listingId } });
    if (existingFaq) {
      return c.json({ error: "FAQ already exists for this listing. Use PUT to update." }, 409);
    }

    // Create FAQ
    const faq = await prisma.listingFaq.create({
      data: { listingId: validatedData.listingId, faqs: validatedData.faqs },
    });

    return c.json(
      { success: true, message: "FAQs created successfully", data: faq },
      201
    );
  } catch (error: any) {
    console.error("Error creating FAQs:", error);
    if (error.name === "ZodError") {
      return c.json({ error: "Validation error", details: error.errors }, 400);
    }
    return c.json({ error: "Failed to create FAQs" }, 500);
  }
};

/**
 * Update FAQs for a listing
 */
export const updateListingFaqs = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    const body = await c.req.json();
    const validatedData = faqSchema.parse(body);

    // Check if FAQ exists
    const existingFaq = await prisma.listingFaq.findUnique({ where: { listingId } });
    if (!existingFaq) {
      return c.json({ error: "FAQ not found for this listing" }, 404);
    }

    // Update FAQ
    const updatedFaq = await prisma.listingFaq.update({
      where: { listingId },
      data: { faqs: validatedData.faqs },
    });

    return c.json({
      success: true,
      message: "FAQs updated successfully",
      data: updatedFaq,
    });
  } catch (error: any) {
    console.error("Error updating FAQs:", error);
    if (error.name === "ZodError") {
      return c.json({ error: "Validation error", details: error.errors }, 400);
    }
    return c.json({ error: "Failed to update FAQs" }, 500);
  }
};

/**
 * Delete FAQs for a listing
 */
export const deleteListingFaqs = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");
    if (!listingId) {
      return c.json({ error: "Listing ID is required" }, 400);
    }
    // Check if FAQ exists
    const existingFaq = await prisma.listingFaq.findUnique({ where: { listingId } });
    if (!existingFaq) {
      return c.json({ error: "FAQ not found" }, 404);
    }
    // Delete FAQ
    await prisma.listingFaq.delete({ where: { listingId } });
    return c.json({ message: "FAQs deleted successfully" }, 200);
  } catch (error) {
    console.error("Error deleting FAQs:", error);
    return c.json({ error: "Failed to delete FAQs" }, 500);
  }
};