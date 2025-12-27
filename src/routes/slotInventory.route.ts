
import { Hono } from "hono";

import { createSingleDaySlotBatch, updateSingleDaySlotBatch, getSlotBatches, deleteSingleDaySlotBatch } from "../controllers/slotInventory.controller.js";

const slotInventoryRouter = new Hono();



// Get slot batches for a listing/variant in a specific month
slotInventoryRouter.get("/batches/:listingId/:month", getSlotBatches);
slotInventoryRouter.get("/batches/:listingId/:variantId/:month", getSlotBatches);

// F3: Create a single-day slot batch (slotDefinitionId, date, price, capacity)
slotInventoryRouter.post("/single-day-batch", createSingleDaySlotBatch);

// F3: Edit a single-day slot batch (by id)
slotInventoryRouter.put("/single-day-batch", updateSingleDaySlotBatch);

// F3: Delete a single-day slot batch (by id)
slotInventoryRouter.delete("/single-day-batch", deleteSingleDaySlotBatch);


// The following routes are removed as they are unused and legacy APIs

// Only one default export allowed

export default slotInventoryRouter;
