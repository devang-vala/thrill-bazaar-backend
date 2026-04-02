import type { Context } from "hono";
import { prisma } from "../db.js";

const isMissingOffersTableError = (error: unknown) => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2021"
  );
};

// Utility to parse relations for updates
const parseRelationUpdate = (allFlag: boolean, identifiers: string[]) => {
  if (allFlag) {
    return { set: [] }; // Clear specific relations if "all" is true
  }
  return { set: identifiers.map((id) => ({ id })) };
};

/**
 * Create a new Offer or Promocode
 */
export const createOffer = async (c: Context) => {
  try {
    const body = await c.req.json();
    const {
      type,
      code,
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscountLimit,
      description,
      details,
      startDate,
      endDate,
      isActive = true,
      applyToAllSellers = false,
      applyToAllCategories = false,
      applyToAllListings = false,
      targetSellers = [],
      targetCategories = [],
      targetListings = [],
    } = body;

    if (!type || !code || !discountType || discountValue === undefined || !description || !details) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    const exists = await prisma.offerPromocode.findUnique({ where: { code } });
    if (exists) {
      return c.json({ error: "Code already exists" }, 400);
    }

    const newOffer = await prisma.offerPromocode.create({
      data: {
        type,
        code: code.toUpperCase(),
        discountType,
        discountValue,
        minOrderAmount: minOrderAmount || null,
        maxDiscountLimit: discountType === "percentage" ? (maxDiscountLimit || null) : null,
        description,
        details,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isActive,
        applyToAllSellers,
        applyToAllCategories,
        applyToAllListings,
        targetSellers: applyToAllSellers ? undefined : { connect: targetSellers.map((id: string) => ({ id })) },
        targetCategories: applyToAllCategories ? undefined : { connect: targetCategories.map((id: string) => ({ id })) },
        targetListings: applyToAllListings ? undefined : { connect: targetListings.map((id: string) => ({ id })) },
      },
      include: {
        targetSellers: { select: { id: true, firstName: true, lastName: true } },
        targetCategories: { select: { id: true, categoryName: true } },
        targetListings: { select: { id: true, listingName: true } },
      },
    });

    return c.json({
      message: `${type === "offer" ? "Offer" : "Promocode"} created successfully`,
      data: newOffer,
    });
  } catch (error) {
    console.error("Create Offer error:", error);
    return c.json({ error: "Failed to create offer/promocode" }, 500);
  }
};

/**
 * Get all Offers and Promocodes
 */
export const getOffers = async (c: Context) => {
  try {
    const type = c.req.query("type");
    const isActive = c.req.query("isActive");
    
    let whereClause: any = {};
    if (type) whereClause.type = type;
    if (isActive !== undefined) whereClause.isActive = isActive === "true";

    const offers = await prisma.offerPromocode.findMany({
      where: whereClause,
      include: {
        targetSellers: { select: { id: true, firstName: true } },
        targetCategories: { select: { id: true, categoryName: true } },
        targetListings: { select: { id: true, listingName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return c.json({
      success: true,
      data: offers,
    });
  } catch (error) {
    if (isMissingOffersTableError(error)) {
      return c.json({
        success: true,
        data: [],
      });
    }
    console.error("Get Offers error:", error);
    return c.json({ error: "Failed to retrieve offers/promocodes" }, 500);
  }
};

/**
 * Get Offer by ID
 */
export const getOfferById = async (c: Context) => {
  try {
    const { id } = c.req.param();
    const offer = await prisma.offerPromocode.findUnique({
      where: { id },
      include: {
        targetSellers: { select: { id: true, firstName: true, lastName: true } },
        targetCategories: { select: { id: true, categoryName: true } },
        targetListings: { select: { id: true, listingName: true } },
      },
    });

    if (!offer) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json({ success: true, data: offer });
  } catch (error) {
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Update Offer
 */
export const updateOffer = async (c: Context) => {
  try {
    const { id } = c.req.param();
    const body = await c.req.json();
    
    // Check existence
    const existing = await prisma.offerPromocode.findUnique({ where: { id } });
    if (!existing) return c.json({ error: "Not found" }, 404);

    const dataToUpdate: any = {
      ...body,
      code: body.code ? body.code.toUpperCase() : undefined,
      startDate: body.startDate !== undefined ? (body.startDate ? new Date(body.startDate) : null) : undefined,
      endDate: body.endDate !== undefined ? (body.endDate ? new Date(body.endDate) : null) : undefined,
    };

    // Remove relation arrays from base object before update
    delete dataToUpdate.targetSellers;
    delete dataToUpdate.targetCategories;
    delete dataToUpdate.targetListings;

    // Build relation updates
    if (body.targetSellers !== undefined) {
      dataToUpdate.targetSellers = parseRelationUpdate(body.applyToAllSellers, body.targetSellers);
    }
    if (body.targetCategories !== undefined) {
      dataToUpdate.targetCategories = parseRelationUpdate(body.applyToAllCategories, body.targetCategories);
    }
    if (body.targetListings !== undefined) {
      dataToUpdate.targetListings = parseRelationUpdate(body.applyToAllListings, body.targetListings);
    }

    const updatedOffer = await prisma.offerPromocode.update({
      where: { id },
      data: dataToUpdate,
      include: {
        targetSellers: { select: { id: true, firstName: true, lastName: true } },
        targetCategories: { select: { id: true, categoryName: true } },
        targetListings: { select: { id: true, listingName: true } },
      },
    });

    return c.json({ success: true, data: updatedOffer });
  } catch (error) {
    console.error("Update Offer error:", error);
    return c.json({ error: "Failed to update" }, 500);
  }
};

/**
 * Delete Offer
 */
export const deleteOffer = async (c: Context) => {
  try {
    const { id } = c.req.param();
    await prisma.offerPromocode.delete({ where: { id } });
    return c.json({ success: true, message: "Deleted successfully" });
  } catch (error) {
    return c.json({ error: "Failed to delete" }, 500);
  }
};

/**
 * Validate Promocode (Checkout Flow)
 */
export const validatePromoCode = async (c: Context) => {
    try {
      const body = await c.req.json();
      const { code, listingId, subtotalAmount } = body;
  
      if (!code || !listingId || subtotalAmount === undefined) {
        return c.json({ error: "Missing required validation parameters" }, 400);
      }
  
      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        select: { operatorId: true, categoryId: true },
      });
  
      if (!listing) {
        return c.json({ error: "Listing not found" }, 404);
      }
  
      const offer = await prisma.offerPromocode.findUnique({
        where: { code: code.toUpperCase() },
        include: {
            targetSellers: { select: { id: true } },
            targetCategories: { select: { id: true } },
            targetListings: { select: { id: true } },
        }
      });
  
      if (!offer) {
        return c.json({ error: "Invalid promo code" }, 400);
      }
  
      // Active & Date Validation
      if (!offer.isActive) {
        return c.json({ error: "This promo code is no longer active" }, 400);
      }
      const now = new Date();
      if (offer.startDate && now < new Date(offer.startDate)) {
        return c.json({ error: "This promo code is not yet valid" }, 400);
      }
      if (offer.endDate && now > new Date(offer.endDate)) {
        return c.json({ error: "This promo code has expired" }, 400);
      }
  
      // Min Order Amount Validation
      if (offer.minOrderAmount && subtotalAmount < Number(offer.minOrderAmount)) {
        return c.json({ error: `Order subtotal must be at least ${offer.minOrderAmount} to use this code` }, 400);
      }
  
      // Scope Validation: Check if it applies to this operator, category, or listing
      let isApplicable = false;
      
      const appliesToSellers = offer.applyToAllSellers || offer.targetSellers.some((s: { id: string }) => s.id === listing.operatorId);
      const appliesToCategories = offer.applyToAllCategories || offer.targetCategories.some((c: { id: string }) => c.id === listing.categoryId);
      const appliesToListings = offer.applyToAllListings || offer.targetListings.some((l: { id: string }) => l.id === listingId);
  
      if (appliesToSellers || appliesToCategories || appliesToListings) {
          isApplicable = true;
      }
  
      // If there are literally no scopes defined, it's globally applicable? Usually yes, but 
      // let's assume it has to hit at least one positive applicability context.
      if (!isApplicable && 
          !offer.applyToAllSellers && !offer.applyToAllCategories && !offer.applyToAllListings &&
          offer.targetSellers.length === 0 && offer.targetCategories.length === 0 && offer.targetListings.length === 0) {
          isApplicable = true; // Global fallback if nothing is configured
      }
  
      if (!isApplicable) {
        return c.json({ error: "This promo code does not apply to this listing" }, 400);
      }
  
      // Calculate Discount
      let calculatedDiscount = 0;
      if (offer.discountType === "percentage") {
        calculatedDiscount = (subtotalAmount * Number(offer.discountValue)) / 100;
        if (offer.maxDiscountLimit && calculatedDiscount > Number(offer.maxDiscountLimit)) {
          calculatedDiscount = Number(offer.maxDiscountLimit);
        }
      } else {
        calculatedDiscount = Number(offer.discountValue);
      }
  
      // Ensure we don't discount more than the subtotal
      calculatedDiscount = Math.min(calculatedDiscount, subtotalAmount);
  
      return c.json({
        success: true,
        data: {
          code: offer.code,
          discountAmount: Math.round(calculatedDiscount), // Round to nearest integer (assuming paise or similar)
          offerDetails: offer.description,
        }
      });
  
    } catch (error) {
      if (isMissingOffersTableError(error)) {
        return c.json({ error: "Offers are not configured for this database yet" }, 400);
      }
      console.error("Validate Promo error:", error);
      return c.json({ error: "Failed to validate promo code" }, 500);
    }
  };
  
/**
 * Fetch applicable Offers & Promocodes for a Listing
 */
export const getOffersForListing = async (c: Context) => {
  try {
    const { listingId } = c.req.param();

    if (!listingId) {
      return c.json({ error: "Missing listingId" }, 400);
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { operatorId: true, categoryId: true },
    });

    if (!listing) {
      return c.json({ error: "Listing not found" }, 404);
    }

    const now = new Date();
    
    // Fetch all currently active offers taking into account dates.
    // We will do exact relationship mapping in-memory to safely handle global fallbacks 
    // where applicable flags are false and target arrays are 0.
    const allActive = await prisma.offerPromocode.findMany({
        where: {
            isActive: true,
            OR: [
                { startDate: null },
                { startDate: { lte: now } }
            ],
            AND: [
                {
                    OR: [
                        { endDate: null },
                        { endDate: { gte: now } }
                    ]
                }
            ]
        },
        include: {
            targetSellers: { select: { id: true } },
            targetCategories: { select: { id: true } },
            targetListings: { select: { id: true } },
        }
    });

    const applicableOffers = allActive.filter(offer => {
        const appliesToSellers = offer.applyToAllSellers || offer.targetSellers.some((s: { id: string }) => s.id === listing.operatorId);
        const appliesToCategories = offer.applyToAllCategories || offer.targetCategories.some((c: { id: string }) => c.id === listing.categoryId);
        const appliesToListings = offer.applyToAllListings || offer.targetListings.some((l: { id: string }) => l.id === listingId);

        let isApplicable = appliesToSellers || appliesToCategories || appliesToListings;

        // Global fallback if nothing is configured
        if (!isApplicable && 
            !offer.applyToAllSellers && !offer.applyToAllCategories && !offer.applyToAllListings &&
            offer.targetSellers.length === 0 && offer.targetCategories.length === 0 && offer.targetListings.length === 0) {
            isApplicable = true; 
        }
        return isApplicable;
    });

    // Strip out relations to mimic raw offer objects
    const formattedOffers = applicableOffers.map(({ targetSellers, targetCategories, targetListings, ...rest }) => rest);

    return c.json({
      success: true,
      data: formattedOffers
    });

  } catch (error) {
    if (isMissingOffersTableError(error)) {
      return c.json({
        success: true,
        data: [],
      });
    }
    console.error("Get Offers For Listing error:", error);
    return c.json({ error: "Failed to retrieve offers for listing" }, 500);
  }
};

