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

const listingAddonsRouter = new Hono();

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
