import { Hono } from "hono";
import {
  getSlotDefinitions,
  getSlotDateRanges,
  createSlotDateRange,
  getSlotRentalAvailability,
  updateSlotDateRange,
  deleteSlotDateRange,
  upsertSlotPriceOverride,
  deleteSlotPriceOverride,
} from "../controllers/slotBasedRental.controller.js";

const slotBasedRentalRouter = new Hono();

// Get slot definitions for a listing (F4)
slotBasedRentalRouter.get("/slots/:listingId/:variantId?", getSlotDefinitions);

// Get date ranges for a specific slot (F4)
slotBasedRentalRouter.get("/slot-ranges/:listingId/:slotDefinitionId/:variantId?", getSlotDateRanges);

// Get availability calendar for a specific slot (F4)
slotBasedRentalRouter.get("/slot-availability/:listingId/:slotDefinitionId/:variantId?", getSlotRentalAvailability);

// Create date range for a slot (F4)
slotBasedRentalRouter.post("/slot-range", createSlotDateRange);

// Update date range
slotBasedRentalRouter.put("/slot-range/:rangeId", updateSlotDateRange);

// Delete date range
slotBasedRentalRouter.delete("/slot-range/:rangeId", deleteSlotDateRange);

// Price override endpoints (similar to rental management)
slotBasedRentalRouter.post("/price-override", upsertSlotPriceOverride);
slotBasedRentalRouter.delete("/price-override", deleteSlotPriceOverride);

export default slotBasedRentalRouter;