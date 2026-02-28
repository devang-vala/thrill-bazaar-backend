import { Hono } from "hono";
import {
  getListings,
  getListing,
  getListingById,
  createListing,
  updateListing,
  deleteListing,
  getAdminListings,
} from "../controllers/listing.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
  requireAdmin,
  optionalAuth,
} from "../middlewares/auth.middleware.js";

const listingRouter = new Hono();

// Public routes (with optional auth to determine role)
listingRouter.get("/", optionalAuth, getListings);
listingRouter.get("/slug/:slug", getListing);
listingRouter.get("/:slug", getListing);

// Get listing by ID with all related data (for management)
listingRouter.get("/:id/details", authenticateToken, getListingById);

// Admin-only route to get all listings (excluding drafts)
listingRouter.post("/admin/all", authenticateToken, requireAdmin, getAdminListings);

// Protected routes - require authentication
listingRouter.post("/", authenticateToken, requireAnyAdmin, createListing);
listingRouter.put("/:id", authenticateToken, requireAnyAdmin, updateListing);
listingRouter.delete("/:id", authenticateToken, requireAnyAdmin, deleteListing);

export default listingRouter;
