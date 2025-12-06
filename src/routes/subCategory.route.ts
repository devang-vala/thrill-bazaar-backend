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

// subCategoryRouter.use(authenticateToken);

// All routes are now public
subCategoryRouter.get("/", getSubCategories);
subCategoryRouter.get("/:id", getSubCategory);
subCategoryRouter.post("/paginate", paginateSubCategories);
subCategoryRouter.post("/", createSubCategoryHandler);
subCategoryRouter.put("/:id", updateSubCategory);

export default subCategoryRouter;
