import { Hono } from "hono";
import {
  getTags,
  getTagById,
  createTag,
  updateTag,
  deleteTag,
  assignTagToListing,
  removeTagFromListing,
  getListingTags,
  bulkAssignTags,
  getListingsByTag,
} from "../controllers/tag.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const tagRouter = new Hono();

// Public routes
tagRouter.get("/", getTags);
tagRouter.get("/:id", getTagById);

// Get tags for a specific listing (public)
tagRouter.get("/listing/:listingId", getListingTags);

// Get listings by tag (public)
tagRouter.get("/:tagId/listings", getListingsByTag);

// Admin-only routes
tagRouter.post("/", authenticateToken, requireAdmin, createTag);
tagRouter.put("/:id", authenticateToken, requireAdmin, updateTag);
tagRouter.delete("/:id", authenticateToken, requireAdmin, deleteTag);

// Assign/Remove tags from listings (Admin only)
tagRouter.post("/assign", authenticateToken, requireAdmin, assignTagToListing);
tagRouter.post("/remove", authenticateToken, requireAdmin, removeTagFromListing);
tagRouter.post("/bulk-assign", authenticateToken, requireAdmin, bulkAssignTags);

export default tagRouter;