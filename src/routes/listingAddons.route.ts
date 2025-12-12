import { Hono } from "hono";
import {
  getListingAddons,
  upsertListingAddons,
  deleteListingAddons,
} from "../controllers/listingAddons.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

import { editSingleAddon, deleteSingleAddon } from "../controllers/listingAddons.controller.js";

const listingAddonsRouter = new Hono();

// Edit a single add-on by id
listingAddonsRouter.put("/listing/:listingId/addon/:addonId", editSingleAddon);

// Delete a single add-on by id
listingAddonsRouter.delete("/listing/:listingId/addon/:addonId", deleteSingleAddon);

// listingAddonsRouter.use(authenticateToken);
// listingAddonsRouter.use(requireAnyAdmin);

// Get addons for a listing
listingAddonsRouter.get("/listing/:listingId", getListingAddons);

// Create or update addons
listingAddonsRouter.post("/", upsertListingAddons);
listingAddonsRouter.put("/", upsertListingAddons);

// Delete addons
listingAddonsRouter.delete("/listing/:listingId", deleteListingAddons);

export default listingAddonsRouter;
