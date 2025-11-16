import { Hono } from "hono";
import {
  getListingInclusionsExclusions,
  createListingInclusionExclusion,
  updateListingInclusionExclusion,
} from "../controllers/listingInclusionsExclusions.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const listingInclusionsExclusionsRouter = new Hono();

listingInclusionsExclusionsRouter.use(authenticateToken);
listingInclusionsExclusionsRouter.use(requireAnyAdmin);

listingInclusionsExclusionsRouter.get(
  "/listing/:listingId",
  getListingInclusionsExclusions
);
listingInclusionsExclusionsRouter.post(
  "/listing/:listingId",
  createListingInclusionExclusion
);
listingInclusionsExclusionsRouter.put("/:id", updateListingInclusionExclusion);

export default listingInclusionsExclusionsRouter;
