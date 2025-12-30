import { Hono } from "hono";
import {
  getListings,
  getListing,
  createListing,
  updateListing,
  deleteListing,
} from "../controllers/listing.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const listingRouter = new Hono();

// Public routes
listingRouter.get("/", getListings);
listingRouter.get("/:slug", getListing);

// Protected routes - require authentication
listingRouter.post("/", authenticateToken, createListing);
listingRouter.put("/:id", authenticateToken, updateListing);
listingRouter.delete("/:id", authenticateToken, deleteListing);

export default listingRouter;
