import type { Context } from "hono";
import {
  createReview,
  getReviewById,
  getReviews,
  updateReview,
  deleteReview,
  moderateReview,
  toggleHelpfulVote,
  getListingReviewStats,
  getOperatorReviewStats,
} from "../helpers/review.helper.js";

/**
 * Create a new review
 * @route POST /api/reviews
 * @access Private (Customer only)
 */
export const createReviewController = async (c: Context) => {
  try {
    const user = c.get("user");

    if (!user) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    // Only customers can create reviews
    if (user.userType !== "customer") {
      return c.json(
        { success: false, error: "Only customers can create reviews" },
        403
      );
    }

    const body = await c.req.json();
    const {
      bookingId,
      listingId,
      operatorId,
      rating,
      reviewTitle,
      reviewText,
      reviewImages,
    } = body;

    // Validate required fields
    if (!bookingId || !listingId || !operatorId || !rating || !reviewTitle || !reviewText) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: bookingId, listingId, operatorId, rating, reviewTitle, reviewText",
        },
        400
      );
    }

    // Validate rating is integer
    if (!Number.isInteger(rating)) {
      return c.json(
        { success: false, error: "Rating must be an integer" },
        400
      );
    }

    const result = await createReview({
      bookingId,
      listingId,
      customerId: user.userId,
      operatorId,
      rating,
      reviewTitle,
      reviewText,
      reviewImages: reviewImages || [],
    });

    if (!result.success) {
      return c.json(
        { success: false, error: result.error },
        400
      );
    }

    return c.json(
      {
        success: true,
        message: "Review created successfully",
        data: result.review,
      },
      201
    );
  } catch (error: any) {
    console.error("Error in createReviewController:", error);
    return c.json(
      { success: false, error: "Internal server error" },
      500
    );
  }
};

/**
 * Get a single review by ID
 * @route GET /api/reviews/:id
 * @access Public
 */
export const getReviewController = async (c: Context) => {
  try {
    const reviewId = c.req.param("id");

    if (!reviewId) {
      return c.json(
        { success: false, error: "Review ID is required" },
        400
      );
    }

    const review = await getReviewById(reviewId);

    if (!review) {
      return c.json(
        { success: false, error: "Review not found" },
        404
      );
    }

    // Hide moderated reviews from public (unless admin)
    const user = c.get("user");
    const isAdmin = user?.userType === "admin" || user?.userType === "super_admin";

    if (review.isModerated && !isAdmin) {
      return c.json(
        { success: false, error: "This review has been moderated" },
        403
      );
    }

    return c.json({
      success: true,
      data: review,
    });
  } catch (error: any) {
    console.error("Error in getReviewController:", error);
    return c.json(
      { success: false, error: "Internal server error" },
      500
    );
  }
};

/**
 * Get reviews with filters and pagination
 * @route GET /api/reviews
 * @access Public
 */
export const getReviewsController = async (c: Context) => {
  try {
    const query = c.req.query();

    // Parse filters
    const filters: any = {
      listingId: query.listingId,
      customerId: query.customerId,
      operatorId: query.operatorId,
      rating: query.rating ? parseInt(query.rating) : undefined,
      minRating: query.minRating ? parseInt(query.minRating) : undefined,
      maxRating: query.maxRating ? parseInt(query.maxRating) : undefined,
    };

    // Admin can see moderated reviews, others cannot
    const user = c.get("user");
    const isAdmin = user?.userType === "admin" || user?.userType === "super_admin";
    
    if (!isAdmin) {
      filters.isModerated = false;
    } else if (query.isModerated !== undefined) {
      filters.isModerated = query.isModerated === "true";
    }

    // Parse pagination
    const pagination = {
      page: query.page ? parseInt(query.page) : 1,
      limit: query.limit ? parseInt(query.limit) : 10,
      sortBy: (query.sortBy as any) || "createdAt",
      sortOrder: (query.sortOrder as any) || "desc",
    };

    // Validate pagination
    if (pagination.limit > 100) {
      pagination.limit = 100; // Max limit
    }

    const result = await getReviews(filters, pagination);

    return c.json({
      success: true,
      data: result.reviews,
      pagination: result.pagination,
    });
  } catch (error: any) {
    console.error("Error in getReviewsController:", error);
    return c.json(
      { success: false, error: "Internal server error" },
      500
    );
  }
};

/**
 * Update a review
 * @route PUT /api/reviews/:id
 * @access Private (Review owner only)
 */
export const updateReviewController = async (c: Context) => {
  try {
    const user = c.get("user");

    if (!user) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    const reviewId = c.req.param("id");
    if (!reviewId) {
      return c.json(
        { success: false, error: "Review ID is required" },
        400
      );
    }

    const body = await c.req.json();
    const { rating, reviewTitle, reviewText, reviewImages } = body;

    // At least one field must be provided
    if (rating === undefined && !reviewTitle && !reviewText && !reviewImages) {
      return c.json(
        { success: false, error: "At least one field to update is required" },
        400
      );
    }

    // Validate rating if provided
    if (rating !== undefined && !Number.isInteger(rating)) {
      return c.json(
        { success: false, error: "Rating must be an integer" },
        400
      );
    }

    const result = await updateReview(reviewId, user.userId, {
      rating,
      reviewTitle,
      reviewText,
      reviewImages,
    });

    if (!result.success) {
      const statusCode = result.error === "Review not found" ? 404 : 
                        result.error?.includes("only update your own") ? 403 : 400;
      return c.json(
        { success: false, error: result.error },
        statusCode
      );
    }

    return c.json({
      success: true,
      message: "Review updated successfully",
      data: result.review,
    });
  } catch (error: any) {
    console.error("Error in updateReviewController:", error);
    return c.json(
      { success: false, error: "Internal server error" },
      500
    );
  }
};

/**
 * Delete a review
 * @route DELETE /api/reviews/:id
 * @access Private (Review owner or Admin)
 */
export const deleteReviewController = async (c: Context) => {
  try {
    const user = c.get("user");

    if (!user) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    const reviewId = c.req.param("id");
    if (!reviewId) {
      return c.json(
        { success: false, error: "Review ID is required" },
        400
      );
    }

    const isAdmin = user.userType === "admin" || user.userType === "super_admin";

    const result = await deleteReview(reviewId, user.userId, isAdmin);

    if (!result.success) {
      const statusCode = result.error === "Review not found" ? 404 : 403;
      return c.json(
        { success: false, error: result.error },
        statusCode
      );
    }

    return c.json({
      success: true,
      message: "Review deleted successfully",
    });
  } catch (error: any) {
    console.error("Error in deleteReviewController:", error);
    return c.json(
      { success: false, error: "Internal server error" },
      500
    );
  }
};

/**
 * Moderate a review (Admin only)
 * @route POST /api/reviews/:id/moderate
 * @access Private (Admin only)
 */
export const moderateReviewController = async (c: Context) => {
  try {
    const user = c.get("user");

    if (!user) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    // Check if user is admin
    if (user.userType !== "admin" && user.userType !== "super_admin") {
      return c.json(
        { success: false, error: "Only admins can moderate reviews" },
        403
      );
    }

    const reviewId = c.req.param("id");
    if (!reviewId) {
      return c.json(
        { success: false, error: "Review ID is required" },
        400
      );
    }

    const body = await c.req.json();
    const { isModerated, moderationReason } = body;

    if (typeof isModerated !== "boolean") {
      return c.json(
        { success: false, error: "isModerated must be a boolean value" },
        400
      );
    }

    if (isModerated && !moderationReason) {
      return c.json(
        { success: false, error: "moderationReason is required when moderating a review" },
        400
      );
    }

    const result = await moderateReview(reviewId, {
      isModerated,
      moderatedByAdminId: user.userId,
      moderationReason: isModerated ? moderationReason : null,
    });

    if (!result.success) {
      return c.json(
        { success: false, error: result.error },
        400
      );
    }

    return c.json({
      success: true,
      message: isModerated ? "Review moderated successfully" : "Review moderation removed",
      data: result.review,
    });
  } catch (error: any) {
    console.error("Error in moderateReviewController:", error);
    return c.json(
      { success: false, error: "Internal server error" },
      500
    );
  }
};

/**
 * Toggle helpful vote on a review
 * @route POST /api/reviews/:id/helpful
 * @access Private
 */
export const toggleHelpfulController = async (c: Context) => {
  try {
    const user = c.get("user");

    if (!user) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    const reviewId = c.req.param("id");
    if (!reviewId) {
      return c.json(
        { success: false, error: "Review ID is required" },
        400
      );
    }

    const result = await toggleHelpfulVote(reviewId, user.userId);

    if (!result.success) {
      return c.json(
        { success: false, error: result.error },
        400
      );
    }

    return c.json({
      success: true,
      message: result.action === "added" 
        ? "Marked review as helpful" 
        : "Removed helpful vote",
      data: {
        action: result.action,
        helpfulCount: result.helpfulCount,
      },
    });
  } catch (error: any) {
    console.error("Error in toggleHelpfulController:", error);
    return c.json(
      { success: false, error: "Internal server error" },
      500
    );
  }
};

/**
 * Get review statistics for a listing
 * @route GET /api/reviews/stats/listing/:listingId
 * @access Public
 */
export const getListingReviewStatsController = async (c: Context) => {
  try {
    const listingId = c.req.param("listingId");

    if (!listingId) {
      return c.json(
        { success: false, error: "Listing ID is required" },
        400
      );
    }

    const stats = await getListingReviewStats(listingId);

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("Error in getListingReviewStatsController:", error);
    return c.json(
      { success: false, error: "Internal server error" },
      500
    );
  }
};

/**
 * Get review statistics for an operator
 * @route GET /api/reviews/stats/operator/:operatorId
 * @access Public
 */
export const getOperatorReviewStatsController = async (c: Context) => {
  try {
    const operatorId = c.req.param("operatorId");

    if (!operatorId) {
      return c.json(
        { success: false, error: "Operator ID is required" },
        400
      );
    }

    const stats = await getOperatorReviewStats(operatorId);

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("Error in getOperatorReviewStatsController:", error);
    return c.json(
      { success: false, error: "Internal server error" },
      500
    );
  }
};
