import { Hono } from "hono";
import {
  getListingContent,
  getListingContentById,
  createListingContent,
  updateListingContent,
} from "../controllers/listingContent.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const listingContentRouter = new Hono();

listingContentRouter.use(authenticateToken);
listingContentRouter.use(requireAnyAdmin);

listingContentRouter.get("/listing/:listingId", getListingContent);
listingContentRouter.get("/:id", getListingContentById);
listingContentRouter.post("/listing/:listingId", createListingContent);
listingContentRouter.put("/:id", updateListingContent);

export default listingContentRouter;
