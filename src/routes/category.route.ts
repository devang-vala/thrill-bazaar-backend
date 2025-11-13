import { Hono } from "hono";
import {
  getCategories,
  getCategory,
  createCategoryHandler,
  updateCategory,
  deleteCategory,
  paginateCategories,
} from "../controllers/category.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const categoryRouter = new Hono();

categoryRouter.use(authenticateToken);

// Public routes
categoryRouter.get("/", getCategories);

// Protected routes (Admin only)
categoryRouter.post("/paginate", requireAdmin, paginateCategories);
categoryRouter.get("/:id", requireAdmin, getCategory);
categoryRouter.post("/", requireAdmin, createCategoryHandler);
categoryRouter.put("/:id", requireAdmin, updateCategory);

export default categoryRouter;
