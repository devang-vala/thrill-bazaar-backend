import { Hono } from "hono";

import {
  bulkCreateOrUpdateF2DateRanges,
  getF2DatesForListing,
  getF2DatesForMonth,
  getF2DateRangeByDate,
  getF2DateRangeById,
  blockF2DateRange,
  unblockF2DateRange,
  deleteF2DateRange,
  updateF2DateRange,
} from "../controllers/f2DateRangeInventory.controller.js";

const f2DateRangeRouter = new Hono();

// Get inventory date range by ID (for booking page)
f2DateRangeRouter.get("/range/:id", getF2DateRangeById);

// Get all dates for a listing (for seller calendar)
f2DateRangeRouter.get("/dates/:listingId/:variantId", getF2DatesForListing);
f2DateRangeRouter.get("/dates/:listingId", getF2DatesForListing);

// F2 Customer Booking Routes
f2DateRangeRouter.get("/dates-for-month/:listingId/:variantId/:month", getF2DatesForMonth);
f2DateRangeRouter.get("/dates-for-month/:listingId/:month", getF2DatesForMonth);
f2DateRangeRouter.get("/date-range-by-date/:listingId/:variantId/:date", getF2DateRangeByDate);
f2DateRangeRouter.get("/date-range-by-date/:listingId/:date", getF2DateRangeByDate);

// Bulk create or update F2 date ranges
f2DateRangeRouter.post("/bulk-date-ranges", bulkCreateOrUpdateF2DateRanges);

// Update single F2 date range
f2DateRangeRouter.put("/date-range", updateF2DateRange);

// Delete single F2 date range
f2DateRangeRouter.delete("/date-range", deleteF2DateRange);

// Block/Unblock F2 date ranges
f2DateRangeRouter.post("/block-date-range", blockF2DateRange);
f2DateRangeRouter.post("/unblock-date-range", unblockF2DateRange);

export default f2DateRangeRouter;
