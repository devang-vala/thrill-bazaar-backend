import { Hono } from "hono";
import {
  getSubCategories,
  getSubCategory,
  createSubCategoryHandler,
  updateSubCategory,
  deleteSubCategory,
  paginateSubCategories,
} from "../controllers/subCategory.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const subCategoryRouter = new Hono();

subCategoryRouter.use(authenticateToken);

// Public routes
subCategoryRouter.get("/", getSubCategories);

// Protected routes (Admin only)
subCategoryRouter.get("/:id", requireAdmin, getSubCategory);
subCategoryRouter.post("/paginate", requireAdmin, paginateSubCategories);
subCategoryRouter.post("/", requireAdmin, createSubCategoryHandler);
subCategoryRouter.put("/:id", requireAdmin, updateSubCategory);

export default subCategoryRouter;
