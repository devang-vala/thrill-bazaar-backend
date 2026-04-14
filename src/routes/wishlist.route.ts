import { Hono } from "hono";
import {
  addToWishlist,
  getWishlist,
  removeFromWishlist,
  toggleWishlist,
} from "../controllers/wishlist.controller.js";
import {
  authenticateToken,
  requireCustomer,
} from "../middlewares/auth.middleware.js";

const wishlistRouter = new Hono();

wishlistRouter.use(authenticateToken, requireCustomer);

wishlistRouter.get("/", getWishlist);
wishlistRouter.post("/", addToWishlist);
wishlistRouter.post("/toggle", toggleWishlist);
wishlistRouter.delete("/:listingId", removeFromWishlist);

export default wishlistRouter;
