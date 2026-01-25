import { prisma } from "../db.js";

// ===== Types and Interfaces =====
export interface CreateReviewInput {
  bookingId: string;
  listingId: string;
  customerId: string;
  operatorId: string;
  rating: number;
  reviewTitle: string;
  reviewText: string;
  reviewImages?: string[];
}

export interface UpdateReviewInput {
  rating?: number;
  reviewTitle?: string;
  reviewText?: string;
  reviewImages?: string[];
}

export interface ModerateReviewInput {
  isModerated: boolean;
  moderatedByAdminId: string;
  moderationReason?: string;
}

export interface ReviewFilters {
  listingId?: string;
  customerId?: string;
  operatorId?: string;
  rating?: number;
  isModerated?: boolean;
  minRating?: number;
  maxRating?: number;
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'rating' | 'helpfulCount';
  sortOrder?: 'asc' | 'desc';
}

// ===== Validation Functions =====
export const validateRating = (rating: number): boolean => {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
};

export const validateReviewTitle = (title: string): boolean => {
  return title.length > 0 && title.length <= 200;
};

export const validateReviewText = (text: string): boolean => {
  return text.length >= 10; // Minimum 10 characters for meaningful review
};

// ===== Helper Functions =====

/**
 * Check if user can review a booking
 * - Booking must be completed
 * - User must be the customer of the booking
 * - Only one review allowed per booking
 */
export const canUserReviewBooking = async (
  bookingId: string,
  userId: string
): Promise<{ canReview: boolean; reason?: string }> => {
  // Check if booking exists
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { review: true },
  });

  if (!booking) {
    return { canReview: false, reason: "Booking not found" };
  }

  // Check if user is the customer
  if (booking.customerId !== userId) {
    return { canReview: false, reason: "Only the booking customer can leave a review" };
  }

  // Check if booking is completed
  if (booking.bookingStatus !== "COMPLETED") {
    return { canReview: false, reason: "Can only review completed bookings" };
  }

  // Check if review already exists
  if (booking.review) {
    return { canReview: false, reason: "Review already exists for this booking" };
  }

  return { canReview: true };
};

/**
 * Create a new review
 * Includes validation and security checks
 */
export const createReview = async (
  input: CreateReviewInput
): Promise<{ success: boolean; review?: any; error?: string }> => {
  try {
    // Validate rating
    if (!validateRating(input.rating)) {
      return { success: false, error: "Rating must be an integer between 1 and 5" };
    }

    // Validate title
    if (!validateReviewTitle(input.reviewTitle)) {
      return { success: false, error: "Review title must be between 1 and 200 characters" };
    }

    // Validate text
    if (!validateReviewText(input.reviewText)) {
      return { success: false, error: "Review text must be at least 10 characters long" };
    }

    // Check if user can review this booking
    const canReview = await canUserReviewBooking(input.bookingId, input.customerId);
    if (!canReview.canReview) {
      return { success: false, error: canReview.reason };
    }

    // Validate booking belongs to the listing
    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      include: {
        listingSlot: { select: { listingId: true } },
        dateRange: { select: { listingId: true } },
      },
    });

    const bookingListingId = booking?.listingSlot?.listingId || booking?.dateRange?.listingId;
    if (bookingListingId !== input.listingId) {
      return { success: false, error: "Booking does not belong to this listing" };
    }

    // Create review
    const review = await prisma.review.create({
      data: {
        bookingId: input.bookingId,
        listingId: input.listingId,
        customerId: input.customerId,
        operatorId: input.operatorId,
        rating: input.rating,
        reviewTitle: input.reviewTitle,
        reviewText: input.reviewText,
        reviewImages: input.reviewImages || [],
        isVerifiedBooking: true,
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImg: true,
          },
        },
        booking: {
          select: {
            bookingReference: true,
            bookingStartDate: true,
            bookingEndDate: true,
          },
        },
      },
    });

    return { success: true, review };
  } catch (error: any) {
    console.error("Error creating review:", error);
    return { success: false, error: error.message || "Failed to create review" };
  }
};

/**
 * Get review by ID with full details
 */
export const getReviewById = async (reviewId: string) => {
  try {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImg: true,
          },
        },
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        listing: {
          select: {
            id: true,
            listingName: true,
          },
        },
        booking: {
          select: {
            bookingReference: true,
            bookingStartDate: true,
            bookingEndDate: true,
          },
        },
        moderatedByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return review;
  } catch (error) {
    console.error("Error fetching review:", error);
    return null;
  }
};

/**
 * Get reviews with filters and pagination
 */
export const getReviews = async (
  filters: ReviewFilters = {},
  pagination: PaginationOptions = {}
) => {
  try {
    const {
      listingId,
      customerId,
      operatorId,
      rating,
      isModerated,
      minRating,
      maxRating,
    } = filters;

    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = pagination;

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};

    if (listingId) where.listingId = listingId;
    if (customerId) where.customerId = customerId;
    if (operatorId) where.operatorId = operatorId;
    if (rating !== undefined) where.rating = rating;
    if (isModerated !== undefined) where.isModerated = isModerated;

    // Rating range filter
    if (minRating !== undefined || maxRating !== undefined) {
      where.rating = {};
      if (minRating !== undefined) where.rating.gte = minRating;
      if (maxRating !== undefined) where.rating.lte = maxRating;
    }

    // Get total count
    const total = await prisma.review.count({ where });

    // Get reviews
    const reviews = await prisma.review.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImg: true,
          },
        },
        listing: {
          select: {
            id: true,
            listingName: true,
          },
        },
        booking: {
          select: {
            bookingReference: true,
            bookingStartDate: true,
            bookingEndDate: true,
          },
        },
      },
    });

    return {
      reviews,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error("Error fetching reviews:", error);
    throw error;
  }
};

/**
 * Update a review
 * Only the review author can update (not moderators)
 */
export const updateReview = async (
  reviewId: string,
  userId: string,
  input: UpdateReviewInput
): Promise<{ success: boolean; review?: any; error?: string }> => {
  try {
    // Check if review exists and belongs to user
    const existingReview = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!existingReview) {
      return { success: false, error: "Review not found" };
    }

    if (existingReview.customerId !== userId) {
      return { success: false, error: "You can only update your own reviews" };
    }

    // Validate new values if provided
    if (input.rating !== undefined && !validateRating(input.rating)) {
      return { success: false, error: "Rating must be an integer between 1 and 5" };
    }

    if (input.reviewTitle !== undefined && !validateReviewTitle(input.reviewTitle)) {
      return { success: false, error: "Review title must be between 1 and 200 characters" };
    }

    if (input.reviewText !== undefined && !validateReviewText(input.reviewText)) {
      return { success: false, error: "Review text must be at least 10 characters long" };
    }

    // Update review
    const updatedReview = await prisma.review.update({
      where: { id: reviewId },
      data: {
        ...(input.rating !== undefined && { rating: input.rating }),
        ...(input.reviewTitle !== undefined && { reviewTitle: input.reviewTitle }),
        ...(input.reviewText !== undefined && { reviewText: input.reviewText }),
        ...(input.reviewImages !== undefined && { reviewImages: input.reviewImages }),
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImg: true,
          },
        },
      },
    });

    return { success: true, review: updatedReview };
  } catch (error: any) {
    console.error("Error updating review:", error);
    return { success: false, error: error.message || "Failed to update review" };
  }
};

/**
 * Delete a review
 * Only the review author or admin can delete
 */
export const deleteReview = async (
  reviewId: string,
  userId: string,
  isAdmin: boolean = false
): Promise<{ success: boolean; error?: string }> => {
  try {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      return { success: false, error: "Review not found" };
    }

    // Check permissions
    if (!isAdmin && review.customerId !== userId) {
      return { success: false, error: "You can only delete your own reviews" };
    }

    await prisma.review.delete({
      where: { id: reviewId },
    });

    return { success: true };
  } catch (error: any) {
    console.error("Error deleting review:", error);
    return { success: false, error: error.message || "Failed to delete review" };
  }
};

/**
 * Moderate a review (Admin only)
 */
export const moderateReview = async (
  reviewId: string,
  input: ModerateReviewInput
): Promise<{ success: boolean; review?: any; error?: string }> => {
  try {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      return { success: false, error: "Review not found" };
    }

    const updatedReview = await prisma.review.update({
      where: { id: reviewId },
      data: {
        isModerated: input.isModerated,
        moderatedByAdminId: input.moderatedByAdminId,
        moderationReason: input.moderationReason,
      },
      include: {
        moderatedByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return { success: true, review: updatedReview };
  } catch (error: any) {
    console.error("Error moderating review:", error);
    return { success: false, error: error.message || "Failed to moderate review" };
  }
};

/**
 * Toggle helpful vote on a review
 */
export const toggleHelpfulVote = async (
  reviewId: string,
  userId: string
): Promise<{ success: boolean; action?: 'added' | 'removed'; helpfulCount?: number; error?: string }> => {
  try {
    // Check if review exists
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      return { success: false, error: "Review not found" };
    }

    // Check if user already voted
    const existingVote = await prisma.reviewHelpfulVote.findUnique({
      where: {
        reviewId_userId: {
          reviewId,
          userId,
        },
      },
    });

    let action: 'added' | 'removed';
    let helpfulCount: number;

    if (existingVote) {
      // Remove vote
      await prisma.$transaction([
        prisma.reviewHelpfulVote.delete({
          where: { id: existingVote.id },
        }),
        prisma.review.update({
          where: { id: reviewId },
          data: { helpfulCount: { decrement: 1 } },
        }),
      ]);
      action = 'removed';
      helpfulCount = review.helpfulCount - 1;
    } else {
      // Add vote
      await prisma.$transaction([
        prisma.reviewHelpfulVote.create({
          data: {
            reviewId,
            userId,
          },
        }),
        prisma.review.update({
          where: { id: reviewId },
          data: { helpfulCount: { increment: 1 } },
        }),
      ]);
      action = 'added';
      helpfulCount = review.helpfulCount + 1;
    }

    return { success: true, action, helpfulCount };
  } catch (error: any) {
    console.error("Error toggling helpful vote:", error);
    return { success: false, error: error.message || "Failed to toggle helpful vote" };
  }
};

/**
 * Get review statistics for a listing
 */
export const getListingReviewStats = async (listingId: string) => {
  try {
    const stats = await prisma.review.groupBy({
      by: ['rating'],
      where: {
        listingId,
        isModerated: false, // Only count non-moderated reviews
      },
      _count: {
        rating: true,
      },
    });

    const total = stats.reduce((sum: number, stat: any) => sum + stat._count.rating, 0);
    const avgRating = stats.reduce(
      (sum: number, stat: any) => sum + stat.rating * stat._count.rating,
      0
    ) / (total || 1);

    const ratingDistribution = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };

    stats.forEach((stat: any) => {
      ratingDistribution[stat.rating as keyof typeof ratingDistribution] = stat._count.rating;
    });

    return {
      totalReviews: total,
      averageRating: Math.round(avgRating * 10) / 10, // Round to 1 decimal
      ratingDistribution,
    };
  } catch (error) {
    console.error("Error fetching review stats:", error);
    throw error;
  }
};

/**
 * Get operator review statistics
 */
export const getOperatorReviewStats = async (operatorId: string) => {
  try {
    const reviews = await prisma.review.findMany({
      where: {
        operatorId,
        isModerated: false,
      },
      select: {
        rating: true,
      },
    });

    const total = reviews.length;
    const avgRating = total > 0
      ? reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / total
      : 0;

    return {
      totalReviews: total,
      averageRating: Math.round(avgRating * 10) / 10,
    };
  } catch (error) {
    console.error("Error fetching operator review stats:", error);
    throw error;
  }
};
