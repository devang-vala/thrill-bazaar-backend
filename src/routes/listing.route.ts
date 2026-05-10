import { Hono } from "hono";
import {
  getListings,
  getListingFilterFacets,
  getListing,
  getListingById,
  createListing,
  updateListing,
  deleteListing,
  getAdminListings,
  getSimilarListings,
  getListingSlugs,
} from "../controllers/listing.controller.js";
import { getListingAvailabilitySummary } from "../controllers/listingAvailability.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
  requireAdmin,
  optionalAuth,
} from "../middlewares/auth.middleware.js";

const listingRouter = new Hono();

// Public routes (with optional auth to determine role)
listingRouter.get("/", optionalAuth, getListings);
listingRouter.get("/facets", optionalAuth, getListingFilterFacets);
listingRouter.get("/slugs", getListingSlugs);
listingRouter.get("/:listingId/availability-summary", optionalAuth, getListingAvailabilitySummary);
listingRouter.get("/slug/:slug", getListing);

// Get similar listings based on category, operator, then random
listingRouter.get("/:listingId/similar", getSimilarListings);

// Get listing by ID with all related data (for management)
listingRouter.get("/:id/details", authenticateToken, getListingById);

// Public catch-all slug route should stay last among GET detail routes
listingRouter.get("/:slug", getListing);

// Admin-only route to get all listings (excluding drafts)
listingRouter.post("/admin/all", authenticateToken, requireAdmin, getAdminListings);

// Protected routes - require authentication
listingRouter.post("/", authenticateToken, requireAnyAdmin, createListing);
listingRouter.put("/:id", authenticateToken, requireAnyAdmin, updateListing);
listingRouter.delete("/:id", authenticateToken, requireAnyAdmin, deleteListing);

export default listingRouter;
