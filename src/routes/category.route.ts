import { Hono } from "hono";
import {
  getCategories,
  getCategory,
  createCategoryHandler,
  updateCategory,
  deleteCategory,
  paginateCategories,
  getCategoriesByBookingFormat,
  getCategoriesByListingType,
} from "../controllers/category.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const categoryRouter = new Hono();

// categoryRouter.use(authenticateToken);

// All routes are now public
categoryRouter.get("/", getCategories);
categoryRouter.get("/booking-format/:format", getCategoriesByBookingFormat);
categoryRouter.get("/listing-type/:listingTypeId", getCategoriesByListingType);
categoryRouter.post("/paginate", paginateCategories);
categoryRouter.get("/:id", getCategory);
categoryRouter.post("/", createCategoryHandler);
categoryRouter.put("/:id", updateCategory);
categoryRouter.delete("/:id", deleteCategory);

export default categoryRouter;
