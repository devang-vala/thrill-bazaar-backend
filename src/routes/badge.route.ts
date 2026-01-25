import { Hono } from "hono";
import {
  getBadges,
  getBadgeById,
  createBadge,
  updateBadge,
  deleteBadge,
  assignBadgeToListing,
  removeBadgeFromListing,
  getListingBadges,
  bulkAssignBadges,
  uploadBadgeIcon,
  deleteBadgeIcon,
} from "../controllers/badge.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const badgeRouter = new Hono();

// Public routes
badgeRouter.get("/", getBadges);
badgeRouter.get("/:id", getBadgeById);

// Get badges for a specific listing (public)
badgeRouter.get("/listing/:listingId", getListingBadges);

// Admin-only routes
badgeRouter.post("/", authenticateToken, requireAdmin, createBadge);
badgeRouter.put("/:id", authenticateToken, requireAdmin, updateBadge);
badgeRouter.delete("/:id", authenticateToken, requireAdmin, deleteBadge);

// Icon upload routes (Admin only)
badgeRouter.post("/:id/icon", authenticateToken, requireAdmin, uploadBadgeIcon);
badgeRouter.delete("/:id/icon", authenticateToken, requireAdmin, deleteBadgeIcon);

// Assign/Remove badges from listings (Admin only)
badgeRouter.post("/assign", authenticateToken, requireAdmin, assignBadgeToListing);
badgeRouter.post("/remove", authenticateToken, requireAdmin, removeBadgeFromListing);
badgeRouter.post("/bulk-assign", authenticateToken, requireAdmin, bulkAssignBadges);

export default badgeRouter;