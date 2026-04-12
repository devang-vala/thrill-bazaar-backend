import { Hono } from "hono";
import {
  createListingFaqs,
  updateListingFaqs,
  getListingFaqs,
  deleteListingFaqs,
} from "../controllers/listingFaq.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const listingFaqRouter = new Hono();

// listingFaqRouter.use(authenticateToken);
// listingFaqRouter.use(requireAnyAdmin);

// Get FAQs for a specific listing
listingFaqRouter.get("/listing/:listingId", getListingFaqs);

// Create FAQs for a listing
listingFaqRouter.post("/listing", createListingFaqs);

// Update FAQs for a listing
listingFaqRouter.put("/listing/:listingId", updateListingFaqs);

// Delete FAQs for a listing
listingFaqRouter.delete("/listing/:listingId", deleteListingFaqs);

export default listingFaqRouter;
