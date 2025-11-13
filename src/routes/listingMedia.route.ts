import { Hono } from "hono";
import {
  getListingMedia,
  createListingMedia,
  updateListingMedia,
} from "../controllers/listingMedia.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const listingMediaRouter = new Hono();

listingMediaRouter.use(authenticateToken);
listingMediaRouter.use(requireAnyAdmin);

listingMediaRouter.get("/listing/:listingId", getListingMedia);
listingMediaRouter.post("/listing/:listingId", createListingMedia);
listingMediaRouter.put("/:id", updateListingMedia);

export default listingMediaRouter;
