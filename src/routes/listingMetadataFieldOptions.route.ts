import { Hono } from "hono";
import {
  getFieldOptions,
  getFieldOption,
  createFieldOption,
  updateFieldOption,
  deleteFieldOption,
  paginateFieldOptions,
} from "../controllers/listingMetadataFieldOptions.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const fieldOptionsRouter = new Hono();

// Apply authentication middleware to all routes
// fieldOptionsRouter.use(authenticateToken);
// fieldOptionsRouter.use(requireAdmin);

// Protected routes (Admin only)
fieldOptionsRouter.get("/", getFieldOptions);
fieldOptionsRouter.post("/paginate", paginateFieldOptions);
fieldOptionsRouter.get("/:id", getFieldOption);
fieldOptionsRouter.post("/", createFieldOption);
fieldOptionsRouter.put("/:id", updateFieldOption);
fieldOptionsRouter.delete("/:id", deleteFieldOption);

export default fieldOptionsRouter;