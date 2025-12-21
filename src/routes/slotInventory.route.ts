
import { Hono } from "hono";

import { createSingleDaySlotBatch, updateSingleDaySlotBatch } from "../controllers/slotInventory.controller.js";

const slotInventoryRouter = new Hono();


// F3: Create a single-day slot batch (slotDefinitionId, date, price, capacity)
slotInventoryRouter.post("/single-day-batch", createSingleDaySlotBatch);

// F3: Edit a single-day slot batch (by id)
slotInventoryRouter.put("/single-day-batch", updateSingleDaySlotBatch);


// The following routes are removed as they are unused and legacy APIs

// Only one default export allowed

export default slotInventoryRouter;
