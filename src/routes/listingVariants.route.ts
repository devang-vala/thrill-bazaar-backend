import { Hono } from "hono";
import {
  getListingVariants,
  getListingVariantById,
  createListingVariant,
  updateListingVariant,
  deleteListingVariant,
  bulkCreateVariants,
  getVariantFieldsForCategory,
} from "../controllers/listingVariants.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const listingVariantsRouter = new Hono();

// Uncomment for production
// listingVariantsRouter.use(authenticateToken);
// listingVariantsRouter.use(requireAnyAdmin);

// Get variant field definitions for a category (for Cat-A rentals)
listingVariantsRouter.get("/category/:categoryId/fields", getVariantFieldsForCategory);

// Get all variants for a listing
listingVariantsRouter.get("/listing/: listingId", getListingVariants);

// Create single variant for a listing
listingVariantsRouter.post("/listing/:listingId", createListingVariant);

// Bulk create variants for a listing
listingVariantsRouter.post("/listing/:listingId/bulk", bulkCreateVariants);

// Get single variant by ID
listingVariantsRouter.get("/:id", getListingVariantById);

// Update variant
listingVariantsRouter.put("/:id", updateListingVariant);

// Delete variant
listingVariantsRouter.delete("/:id", deleteListingVariant);

export default listingVariantsRouter;
