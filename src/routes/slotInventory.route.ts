import { Hono } from "hono";
import {
  getSlotDefinitions,
  upsertSlotDefinition,
  getSlotAvailability,
  upsertSlotInventory,
  blockSlotOrDate,
  unblockSlotOrDate
} from "../controllers/slotInventory.controller.js";

const slotInventoryRouter = new Hono();

// Fetch slot definitions for a listing + variant
slotInventoryRouter.get("/definitions/:listingId/:variantId?", getSlotDefinitions);

// Create/update slot definitions
slotInventoryRouter.post("/definitions", upsertSlotDefinition);

// Fetch slot availability for a given month
slotInventoryRouter.get("/availability/:listingId/:variantId?/:month", getSlotAvailability);

// Create/update slot inventory for one or multiple dates
slotInventoryRouter.post("/inventory", upsertSlotInventory);

// Block/unblock entire date or specific slot on a date
slotInventoryRouter.post("/block", blockSlotOrDate);
slotInventoryRouter.post("/unblock", unblockSlotOrDate);

export default slotInventoryRouter;
