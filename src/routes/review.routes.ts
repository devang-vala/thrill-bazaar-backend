import { Hono } from "hono";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  createReviewController,
  getReviewController,
  getReviewsController,
  updateReviewController,
  deleteReviewController,
  moderateReviewController,
  toggleHelpfulController,
  getListingReviewStatsController,
  getOperatorReviewStatsController,
} from "../controllers/review.controller.js";

const reviewRoutes = new Hono();

// ===== Public Routes =====

/**
 * @route   GET /api/reviews
 * @desc    Get all reviews with filters and pagination
 * @access  Public (moderated reviews hidden from non-admins)
 * @query   listingId, customerId, operatorId, rating, minRating, maxRating, 
 *          page, limit, sortBy (createdAt|rating|helpfulCount), sortOrder (asc|desc)
 */
reviewRoutes.get("/", getReviewsController);

/**
 * @route   GET /api/reviews/:id
 * @desc    Get a single review by ID
 * @access  Public (moderated reviews hidden from non-admins)
 */
reviewRoutes.get("/:id", getReviewController);

/**
 * @route   GET /api/reviews/stats/listing/:listingId
 * @desc    Get review statistics for a listing (average rating, distribution)
 * @access  Public
 */
reviewRoutes.get("/stats/listing/:listingId", getListingReviewStatsController);

/**
 * @route   GET /api/reviews/stats/operator/:operatorId
 * @desc    Get review statistics for an operator
 * @access  Public
 */
reviewRoutes.get("/stats/operator/:operatorId", getOperatorReviewStatsController);

// ===== Protected Routes (Authentication Required) =====

/**
 * @route   POST /api/reviews
 * @desc    Create a new review
 * @access  Private (Customer only)
 * @body    { bookingId, listingId, operatorId, rating, reviewTitle, reviewText, reviewImages? }
 */
reviewRoutes.post("/", authenticateToken, createReviewController);

/**
 * @route   PUT /api/reviews/:id
 * @desc    Update a review
 * @access  Private (Review owner only)
 * @body    { rating?, reviewTitle?, reviewText?, reviewImages? }
 */
reviewRoutes.put("/:id", authenticateToken, updateReviewController);

/**
 * @route   DELETE /api/reviews/:id
 * @desc    Delete a review
 * @access  Private (Review owner or Admin)
 */
reviewRoutes.delete("/:id", authenticateToken, deleteReviewController);

/**
 * @route   POST /api/reviews/:id/helpful
 * @desc    Toggle helpful vote on a review
 * @access  Private (Any authenticated user)
 */
reviewRoutes.post("/:id/helpful", authenticateToken, toggleHelpfulController);

/**
 * @route   POST /api/reviews/:id/moderate
 * @desc    Moderate a review (hide/show)
 * @access  Private (Admin only)
 * @body    { isModerated: boolean, moderationReason?: string }
 */
reviewRoutes.post("/:id/moderate", authenticateToken, moderateReviewController);

export default reviewRoutes;
