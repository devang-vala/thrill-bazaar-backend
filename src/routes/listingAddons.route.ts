import { Hono } from "hono";
import {
  getListingAddons,
  createListingAddon,
  updateListingAddon,
} from "../controllers/listingAddons.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const listingAddonsRouter = new Hono();

listingAddonsRouter.use(authenticateToken);
listingAddonsRouter.use(requireAnyAdmin);

listingAddonsRouter.get("/listing/:listingId", getListingAddons);
listingAddonsRouter.post("/listing/:listingId", createListingAddon);
listingAddonsRouter.put("/:id", updateListingAddon);

export default listingAddonsRouter;
