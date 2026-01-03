import { Hono } from "hono";

import { createSingleDaySlotBatch, updateSingleDaySlotBatch, getSlotBatches, deleteSingleDaySlotBatch, getSlotById, getSlotsByIds, getDatesBySlotDefinition, bulkCreateOrUpdateSlots, getF3DatesForMonth, getF3SlotsByDate, blockSlot, unblockSlot } from "../controllers/slotInventory.controller.js";

const slotInventoryRouter = new Hono();



// Get slot batches for a listing/variant in a specific month
// Note: More specific route (with variantId) must come first
slotInventoryRouter.get("/batches/:listingId/:variantId/:month", getSlotBatches);
slotInventoryRouter.get("/batches/:listingId/:month", getSlotBatches);

// Get F3 slots for a listing/variant in a specific month
slotInventoryRouter.get("/f3-slots/:listingId/:variantId/:month", getSlotBatches);

// Get single slot by ID
slotInventoryRouter.get("/slot/:slotId", getSlotById);

// Get multiple slots by IDs (for F4)
slotInventoryRouter.get("/slots", getSlotsByIds);

// Get all dates with a specific slot definition
slotInventoryRouter.get("/dates-by-slot/:listingId/:variantId/:slotDefinitionId", getDatesBySlotDefinition);
slotInventoryRouter.get("/dates-by-slot/:listingId/:slotDefinitionId", getDatesBySlotDefinition);

// F3 Customer Booking Routes
slotInventoryRouter.get("/f3-dates/:listingId/:variantId/:month", getF3DatesForMonth);
slotInventoryRouter.get("/f3-slots-by-date/:listingId/:variantId/:date", getF3SlotsByDate);

// Bulk create or update slots
slotInventoryRouter.post("/bulk-slots", bulkCreateOrUpdateSlots);

// F3: Create a single-day slot batch (slotDefinitionId, date, price, capacity)
slotInventoryRouter.post("/single-day-batch", createSingleDaySlotBatch);

// F3: Edit a single-day slot batch (by id)
slotInventoryRouter.put("/single-day-batch", updateSingleDaySlotBatch);

// F3: Delete a single-day slot batch (by id)
slotInventoryRouter.delete("/single-day-batch", deleteSingleDaySlotBatch);

// Block/Unblock slots
slotInventoryRouter.post("/block-slot", blockSlot);
slotInventoryRouter.post("/unblock-slot", unblockSlot);

// The following routes are removed as they are unused and legacy APIs

// Only one default export allowed

export default slotInventoryRouter;
