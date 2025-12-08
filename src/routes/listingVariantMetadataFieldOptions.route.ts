import { Hono } from "hono";
import {
  getVariantFieldOptions,
  createVariantFieldOption,
  updateVariantFieldOption,
  deleteVariantFieldOption,
} from "../controllers/listingVariantMetadataFieldOptions.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const variantFieldOptionsRouter = new Hono();

// Apply authentication middleware to all routes
// variantFieldOptionsRouter.use(authenticateToken);
// variantFieldOptionsRouter.use(requireAdmin);

// Protected routes (Admin only)
variantFieldOptionsRouter.get("/", getVariantFieldOptions);
variantFieldOptionsRouter.post("/", createVariantFieldOption);
variantFieldOptionsRouter.put("/:id", updateVariantFieldOption);
variantFieldOptionsRouter.delete("/:id", deleteVariantFieldOption);

export default variantFieldOptionsRouter;
