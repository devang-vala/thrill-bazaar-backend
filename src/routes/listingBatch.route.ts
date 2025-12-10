import { Hono } from "hono";
import {
  getVariantsForListing,
  getBatchesForListingVariant,
  createBatch,
  updateBatch,
  toggleBatchActive,
  deleteBatch,
} from "../controllers/listingBatch.controller.js";

const listingBatchRouter = new Hono();

// Fetch variants for a listing
listingBatchRouter.get("/listing/:listingId/variants", getVariantsForListing);

// Fetch batches for a listing and variant
listingBatchRouter.get("/listing/:listingId/variant/:variantId/batches", getBatchesForListingVariant);
// Fetch batches for a listing (no variant)
listingBatchRouter.get("/listing/:listingId/batches", getBatchesForListingVariant);

// Create a new batch
listingBatchRouter.post("/listing/:listingId/variant/:variantId/batch", createBatch);
listingBatchRouter.post("/listing/:listingId/batch", createBatch);

// Update a batch
listingBatchRouter.put("/batch/:batchId", updateBatch);

// Toggle batch active/inactive
listingBatchRouter.patch("/batch/:batchId/toggle", toggleBatchActive);

// Delete a batch
listingBatchRouter.delete("/batch/:batchId", deleteBatch);

export default listingBatchRouter;
