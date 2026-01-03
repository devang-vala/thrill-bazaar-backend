import { Hono } from "hono";

import {
  bulkCreateOrUpdateF3Slots,
  getF3DatesBySlotDefinition,
  blockF3Slot,
  unblockF3Slot,
  deleteF3Slot,
  updateF3Slot,
  getF3SlotsByDate,
  getF3DatesForMonth,
  getInventoryDateRangeById,
  updateF3SlotDateOverride,
  removeF3SlotDateOverride,
} from "../controllers/f3SlotInventory.controller.js";

const f3SlotInventoryRouter = new Hono();

// Get inventory date range by ID (for booking page)
f3SlotInventoryRouter.get("/range/:id", getInventoryDateRangeById);

// Get all dates with a specific slot definition for F3
f3SlotInventoryRouter.get("/dates-by-slot/:listingId/:variantId/:slotDefinitionId", getF3DatesBySlotDefinition);
f3SlotInventoryRouter.get("/dates-by-slot/:listingId/:slotDefinitionId", getF3DatesBySlotDefinition);

// F3 Customer Booking Routes
f3SlotInventoryRouter.get("/dates-for-month/:listingId/:variantId/:month", getF3DatesForMonth);
f3SlotInventoryRouter.get("/dates-for-month/:listingId/:month", getF3DatesForMonth);
f3SlotInventoryRouter.get("/slots-by-date/:listingId/:variantId/:date", getF3SlotsByDate);
f3SlotInventoryRouter.get("/slots-by-date/:listingId/:date", getF3SlotsByDate);

// Bulk create or update F3 slots
f3SlotInventoryRouter.post("/bulk-slots", bulkCreateOrUpdateF3Slots);

// Update single F3 slot
f3SlotInventoryRouter.put("/slot", updateF3Slot);

// Delete single F3 slot
f3SlotInventoryRouter.delete("/slot", deleteF3Slot);

// Block/Unblock F3 slots
f3SlotInventoryRouter.post("/block-slot", blockF3Slot);
f3SlotInventoryRouter.post("/unblock-slot", unblockF3Slot);

// Update or remove date-specific overrides
f3SlotInventoryRouter.post("/update-date-override", updateF3SlotDateOverride);
f3SlotInventoryRouter.post("/remove-date-override", removeF3SlotDateOverride);

export default f3SlotInventoryRouter;
