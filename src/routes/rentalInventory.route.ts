import { Hono } from "hono";
import {
  getRentalAvailability,
  upsertRentalDateRange,
  blockRentalDate,
  unblockRentalDate,
  getRentalDateRangesRaw,
  upsertPerDayPriceOverride,
  removePerDayOverride,
} from "../controllers/rentalInventory.controller.js";

const rentalInventoryRouter = new Hono();

// Fetch calendar availability (per-day, excludes blocked)
rentalInventoryRouter.get("/availability/:listingId/:variantId?", getRentalAvailability);

// Fetch raw date ranges (for display)
rentalInventoryRouter.get("/date-ranges/:listingId/:variantId?", getRentalDateRangesRaw);

// Create/update a date range
rentalInventoryRouter.post("/date-range", upsertRentalDateRange);

// Block a date
rentalInventoryRouter.post("/block-date", blockRentalDate);

// Unblock a date
rentalInventoryRouter.delete("/block-date", unblockRentalDate);

// Upsert per-day price override
rentalInventoryRouter.post("/per-day-price-override", upsertPerDayPriceOverride);

// Remove per-day price override
rentalInventoryRouter.delete("/per-day-price-override", removePerDayOverride);

export default rentalInventoryRouter;
