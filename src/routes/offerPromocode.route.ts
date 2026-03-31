import { Hono } from "hono";
import {
  createOffer,
  getOffers,
  getOfferById,
  updateOffer,
  deleteOffer,
  validatePromoCode,
  getOffersForListing,
} from "../controllers/offerPromocode.controller.js";
import { authenticateToken, requireAdmin } from "../middlewares/auth.middleware.js";

const offerPromocodeRouter = new Hono();

// Public / Checkout routes
offerPromocodeRouter.post("/validate", validatePromoCode);
offerPromocodeRouter.get("/listing/:listingId", getOffersForListing);

// Admin routes
offerPromocodeRouter.post("/", authenticateToken, requireAdmin, createOffer);
offerPromocodeRouter.get("/", authenticateToken, requireAdmin, getOffers);
offerPromocodeRouter.get("/:id", authenticateToken, requireAdmin, getOfferById);
offerPromocodeRouter.put("/:id", authenticateToken, requireAdmin, updateOffer);
offerPromocodeRouter.delete("/:id", authenticateToken, requireAdmin, deleteOffer);

export default offerPromocodeRouter;
