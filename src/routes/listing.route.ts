import { Hono } from "hono";
import {
  getListings,
  getListing,
  createListing,
  updateListing,
  deleteListing,
} from "../controllers/listing.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const listingRouter = new Hono();

// listingRouter.use(authenticateToken);
// listingRouter.use(requireAnyAdmin);

listingRouter.get("/", getListings);
listingRouter.get("/:id", getListing);
listingRouter.post("/", createListing);
listingRouter.put("/:id", updateListing);
listingRouter.delete("/:id", deleteListing);

export default listingRouter;
