import { Hono } from "hono";
import {
  getCategories,
  getCategory,
  createCategoryHandler,
  updateCategory,
  deleteCategory,
  paginateCategories,
  getCategoriesByBookingFormat,
} from "../controllers/category.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const categoryRouter = new Hono();

// categoryRouter.use(authenticateToken);

// Public routes
categoryRouter.get("/", getCategories);
categoryRouter.get("/booking-format/:format", getCategoriesByBookingFormat);

// Protected routes (Admin only)
categoryRouter.post("/paginate", paginateCategories);
categoryRouter.get("/:id", requireAdmin, getCategory);
categoryRouter.post("/", createCategoryHandler);
categoryRouter.put("/:id", updateCategory);

export default categoryRouter;
