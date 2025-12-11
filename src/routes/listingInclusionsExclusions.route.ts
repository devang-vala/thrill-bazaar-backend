import { Hono } from "hono";
import {
  getListingInclusionsExclusions,
  upsertListingInclusionsExclusions,
  deleteListingInclusionsExclusions,
} from "../controllers/listingInclusionsExclusions.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const listingInclusionsExclusionsRouter = new Hono();

// listingInclusionsExclusionsRouter.use(authenticateToken);
// listingInclusionsExclusionsRouter.use(requireAnyAdmin);

// Get inclusions/exclusions for a listing
listingInclusionsExclusionsRouter.get(
  "/listing/:listingId",
  getListingInclusionsExclusions
);

// Create or update inclusions/exclusions
listingInclusionsExclusionsRouter.post(
  "/",
  upsertListingInclusionsExclusions
);

listingInclusionsExclusionsRouter.put(
  "/",
  upsertListingInclusionsExclusions
);

// Delete inclusions/exclusions
listingInclusionsExclusionsRouter.delete(
  "/listing/:listingId",
  deleteListingInclusionsExclusions
);

export default listingInclusionsExclusionsRouter;
