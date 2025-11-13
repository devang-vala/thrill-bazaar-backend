import { Hono } from "hono";
import {
  getListingVariants,
  createListingVariant,
  updateListingVariant,
} from "../controllers/listingVariants.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const listingVariantsRouter = new Hono();

listingVariantsRouter.use(authenticateToken);
listingVariantsRouter.use(requireAnyAdmin);

listingVariantsRouter.get("/listing/:listingId", getListingVariants);
listingVariantsRouter.post("/listing/:listingId", createListingVariant);
listingVariantsRouter.put("/:id", updateListingVariant);

export default listingVariantsRouter;
