import { prisma } from "../db.js";

// ===== Types and Interfaces =====
export interface CreateReviewInput {
  bookingId: string;
  listingId: string;
  customerId: string;
  operatorId: string;
  rating: number;
  reviewTitle?: string;
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
  isFlagged?: boolean;
  moderatedByAdminId: string;
  moderationReason?: string;
}

export interface ReviewFilters {
  bookingId?: string;
  listingId?: string;
  customerId?: string;
  operatorId?: string;
  searchTerm?: string;
  rating?: number;
  isFlagged?: boolean;
  isModerated?: boolean;
  minRating?: number;
  maxRating?: number;
}

export interface ReviewViewerContext {
  userId?: string;
  userType?: string;
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

const DEFAULT_REVIEW_TITLE = "REVIEW";

// ===== Helper Functions =====

/**
 * Check if user can review a booking
 * - Booking must be completed or confirmed
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

  // Check if booking is completed or confirmed
  if (booking.bookingStatus !== "COMPLETED" && booking.bookingStatus !== "CONFIRMED") {
    return { canReview: false, reason: "Can only review confirmed or completed bookings" };
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

    // Create review (default: not flagged)
    const review = await prisma.review.create({
      data: {
        bookingId: input.bookingId,
        listingId: input.listingId,
        customerId: input.customerId,
        operatorId: input.operatorId,
        rating: input.rating,
        reviewTitle: DEFAULT_REVIEW_TITLE,
        reviewText: input.reviewText,
        reviewImages: input.reviewImages || [],
        // rely on Prisma default isFlagged = false
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
 * Get number of currently flagged reviews (for admin dashboard)
 */
export const getFlaggedReviewsCount = async (whereOverrides: any = {}) => {
  try {
    const where = { isFlagged: true, ...whereOverrides };
    const count = await prisma.review.count({ where });
    return count;
  } catch (error) {
    console.error("Error fetching flagged reviews count:", error);
    return 0;
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
  pagination: PaginationOptions = {},
  viewer: ReviewViewerContext = {}
) => {
  try {
    const {
      bookingId,
      listingId,
      customerId,
      operatorId,
      searchTerm,
      rating,
      isFlagged,
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

    if (bookingId) where.bookingId = bookingId;
    if (listingId) where.listingId = listingId;
    if (customerId) where.customerId = customerId;
    if (operatorId) where.operatorId = operatorId;
    if (searchTerm?.trim()) {
      const normalizedSearchTerm = searchTerm.trim();

      where.OR = [
        { reviewText: { contains: normalizedSearchTerm, mode: "insensitive" } },
        {
          customer: {
            OR: [
              { firstName: { contains: normalizedSearchTerm, mode: "insensitive" } },
              { lastName: { contains: normalizedSearchTerm, mode: "insensitive" } },
            ],
          },
        },
        {
          listing: {
            listingName: { contains: normalizedSearchTerm, mode: "insensitive" },
          },
        },
      ];
    }
    if (rating !== undefined) where.rating = rating;
    if (isFlagged !== undefined) where.isFlagged = isFlagged;
    if (isModerated !== undefined) where.isModerated = isModerated;

    // Rating range filter
    if (minRating !== undefined || maxRating !== undefined) {
      where.rating = {};
      if (minRating !== undefined) where.rating.gte = minRating;
      if (maxRating !== undefined) where.rating.lte = maxRating;
    }

    const isAdmin = viewer.userType === "admin" || viewer.userType === "super_admin";
    const isOperator = viewer.userType === "operator";

    if (!isAdmin && !isOperator) {
      // Admin-moderated reviews are hidden from customer/public views.
      where.isModerated = false;

      // Seller-hidden/flagged reviews should be hidden from public views.
      // Only show reviews that are NOT flagged.
      where.isFlagged = false;
    }

    if (isOperator && viewer.userId) {
      // Operators can only query reviews belonging to their own listings.
      where.operatorId = viewer.userId;
    }

    const [total, reviews] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          bookingId: true,
          listingId: true,
          customerId: true,
          operatorId: true,
          rating: true,
          reviewTitle: true,
          reviewText: true,
          replyReview: true,
          reviewImages: true,
          isFlagged: true,
          flaggedReason: true,
          isModerated: true,
          helpfulCount: true,
          createdAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              gender: true,
              profileImg: true,
            },
          },
          listing: {
            select: {
              id: true,
              listingName: true,
              frontImageUrl: true,
              startLocationName: true,
              endLocationName: true,
              category: {
                select: {
                  categoryName: true,
                },
              },
            },
          },
          operator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              operatorProfile: {
                select: {
                  companyName: true,
                },
              },
            },
          },
        },
      }),
    ]);

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

    if (input.reviewText !== undefined && !validateReviewText(input.reviewText)) {
      return { success: false, error: "Review text must be at least 10 characters long" };
    }

    // Update review
    const updatedReview = await prisma.review.update({
      where: { id: reviewId },
      data: {
        ...(input.rating !== undefined && { rating: input.rating }),
        reviewTitle: DEFAULT_REVIEW_TITLE,
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
): Promise<{ success: boolean; review?: any; flagsCount?: number; error?: string }> => {
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
        // Admin moderation owns both flags; they must move together.
        isFlagged: input.isModerated,
        moderatedByAdminId: input.isModerated ? input.moderatedByAdminId : null,
        moderationReason: input.isModerated ? (input.moderationReason || null) : null,
      },
      include: {
        customer: true,
        listing: true,
        operator: {
          include: {
            operatorProfile: true,
          },
        },
        booking: true,
        moderatedByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    const flagsCount = await getFlaggedReviewsCount();

    return { success: true, review: updatedReview, flagsCount };
  } catch (error: any) {
    console.error("Error moderating review:", error);
    return { success: false, error: error.message || "Failed to moderate review" };
  }
};

/**
 * Update review flag status (Seller/Operator only)
 */
export const updateReviewFlagStatus = async (
  reviewId: string,
  operatorId: string,
  isFlagged: boolean,
  flaggedReason?: string
): Promise<{ success: boolean; review?: any; flagsCount?: number; error?: string }> => {
  try {
    // Check if review exists and belongs to the operator
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      return { success: false, error: "Review not found" };
    }

    // Verify that the review belongs to this operator
    if (review.operatorId !== operatorId) {
      return { success: false, error: "You can only update flag status for your own listings" };
    }

    const updatedReview = await prisma.review.update({
      where: { id: reviewId },
      data: {
        isFlagged,
        flaggedReason: isFlagged ? (flaggedReason?.trim() || null) : null,
      },
    });

    const flagsCount = await getFlaggedReviewsCount();

    return { success: true, review: updatedReview, flagsCount };
  } catch (error: any) {
    console.error("Error updating review flag status:", error);
    return { success: false, error: error.message || "Failed to update flag status" };
  }
};

/**
 * Update operator reply for a review.
 */
export const updateReplyReview = async (
  reviewId: string,
  operatorId: string,
  replyReview: string
): Promise<{ success: boolean; review?: any; error?: string }> => {
  try {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        operatorId: true,
      },
    });

    if (!review) {
      return { success: false, error: "Review not found" };
    }

    if (review.operatorId !== operatorId) {
      return { success: false, error: "You can only reply to reviews for your own listings" };
    }

    const updatedReview = await prisma.review.update({
      where: { id: reviewId },
      data: {
        replyReview,
      },
    });

    return { success: true, review: updatedReview };
  } catch (error: any) {
    console.error("Error updating reply review:", error);
    return { success: false, error: error.message || "Failed to update review reply" };
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
        isFlagged: false, // Exclude seller-hidden/flagged reviews from customer-facing stats
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
    const stats = await prisma.review.aggregate({
      where: {
        operatorId,
      },
      _count: {
        _all: true,
      },
      _avg: {
        rating: true,
      },
    });

    return {
      totalReviews: stats._count._all || 0,
      averageRating: Math.round(Number(stats._avg.rating || 0) * 10) / 10,
    };
  } catch (error) {
    console.error("Error fetching operator review stats:", error);
    throw error;
  }
};

/**
 * Get enriched review details for seller review details page.
 * Includes booking metadata (participants, contact, addons, slot/date info) and
 * validates that requester is either the listing operator or an admin.
 */
export const getSellerReviewDetails = async (
  reviewId: string,
  requesterUserId: string,
  isAdmin: boolean
): Promise<{ success: boolean; data?: any; error?: string; statusCode?: number }> => {
  try {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        bookingId: true,
        listingId: true,
        customerId: true,
        operatorId: true,
        rating: true,
        reviewTitle: true,
        reviewText: true,
        replyReview: true,
        reviewImages: true,
        isFlagged: true,
        flaggedReason: true,
        isModerated: true,
        helpfulCount: true,
        createdAt: true,
        updatedAt: true,
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profileImg: true,
            gender: true,
          },
        },
        operator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        listing: {
          select: {
            id: true,
            listingName: true,
            frontImageUrl: true,
            startLocationName: true,
          },
        },
        booking: {
          select: {
            bookingReference: true,
            bookingStartDate: true,
            bookingEndDate: true,
            participantCount: true,
            bookingStatus: true,
            participants: true,
            selectedAddons: true,
            createdAt: true,
            listingSlot: {
              select: {
                startTime: true,
                endTime: true,
                listing: {
                  select: {
                    id: true,
                    listingName: true,
                    frontImageUrl: true,
                    startLocationName: true,
                    operatorId: true,
                    addons: true,
                  },
                },
              },
            },
            dateRange: {
              select: {
                listing: {
                  select: {
                    id: true,
                    listingName: true,
                    frontImageUrl: true,
                    startLocationName: true,
                    operatorId: true,
                    addons: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!review) {
      return { success: false, error: "Review not found", statusCode: 404 };
    }

    const bookingOperatorId =
      review.booking?.listingSlot?.listing?.operatorId ||
      review.booking?.dateRange?.listing?.operatorId ||
      review.operatorId;

    if (!isAdmin && bookingOperatorId !== requesterUserId) {
      return { success: false, error: "Unauthorized to view this review", statusCode: 403 };
    }

    const listingAddonsRecord =
      review.booking?.listingSlot?.listing?.addons ||
      review.booking?.dateRange?.listing?.addons;
    const listingAddons = listingAddonsRecord ? (listingAddonsRecord as any).addons : [];

    let enrichedAddons: any[] = [];
    if (review.booking?.selectedAddons && Array.isArray(review.booking.selectedAddons)) {
      enrichedAddons = review.booking.selectedAddons.map((selectedAddon: any) => {
        const addonDetails = Array.isArray(listingAddons)
          ? listingAddons.find((addon: any) => addon.id === selectedAddon.addonId)
          : null;

        if (addonDetails) {
          const quantity = selectedAddon.quantity || 1;
          const price = addonDetails.price || 0;
          return {
            id: addonDetails.id,
            addonId: selectedAddon.addonId,
            name: addonDetails.addonName,
            description: addonDetails.addonDescription || "",
            quantity,
            price,
            totalPrice: price * quantity,
          };
        }

        return {
          addonId: selectedAddon.addonId,
          name: "Unknown Add-on",
          description: "",
          quantity: selectedAddon.quantity || 1,
          price: 0,
          totalPrice: 0,
        };
      });
    }

    const data = {
      ...review,
      booking: review.booking
        ? {
            ...review.booking,
            selectedAddons: enrichedAddons,
            listingSlot: review.booking.listingSlot
              ? {
                  ...review.booking.listingSlot,
                }
              : null,
            dateRange: review.booking.dateRange
              ? {
                  ...review.booking.dateRange,
                }
              : null,
          }
        : null,
    };

    return { success: true, data };
  } catch (error: any) {
    console.error("Error fetching seller review details:", error);
    return {
      success: false,
      error: error?.message || "Failed to fetch seller review details",
      statusCode: 500,
    };
  }
};

/**
 * Get enriched review details for customer review detail dialog.
 * Validates that requester is the review owner or an admin.
 */
export const getCustomerReviewDetails = async (
  reviewId: string,
  requesterUserId: string,
  isAdmin: boolean
): Promise<{ success: boolean; data?: any; error?: string; statusCode?: number }> => {
  try {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        bookingId: true,
        listingId: true,
        customerId: true,
        operatorId: true,
        rating: true,
        reviewTitle: true,
        reviewText: true,
        replyReview: true,
        reviewImages: true,
        isFlagged: true,
        flaggedReason: true,
        isModerated: true,
        helpfulCount: true,
        createdAt: true,
        updatedAt: true,
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
            phone: true,
            operatorProfile: {
              select: {
                companyName: true,
              },
            },
          },
        },
        listing: {
          select: {
            id: true,
            listingName: true,
            frontImageUrl: true,
            startLocationName: true,
          },
        },
        booking: {
          select: {
            bookingReference: true,
            bookingStartDate: true,
            bookingEndDate: true,
            participantCount: true,
            bookingStatus: true,
            payment: {
              select: {
                totalAmount: true,
                amountPaidOnline: true,
                amountToCollectOffline: true,
              },
            },
          },
        },
      },
    });

    if (!review) {
      return { success: false, error: "Review not found", statusCode: 404 };
    }

    if (!isAdmin && review.customerId !== requesterUserId) {
      return { success: false, error: "Unauthorized to view this review", statusCode: 403 };
    }

    return { success: true, data: review };
  } catch (error: any) {
    console.error("Error fetching customer review details:", error);
    return {
      success: false,
      error: error?.message || "Failed to fetch customer review details",
      statusCode: 500,
    };
  }
};
