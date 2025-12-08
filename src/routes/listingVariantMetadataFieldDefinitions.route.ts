import { Hono } from "hono";
import {
  getVariantFieldDefinitions,
  createVariantFieldDefinition,
  updateVariantFieldDefinition,
  deleteVariantFieldDefinition,
} from "../controllers/listingVariantMetadataFieldDefinitions.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const variantFieldDefinitionsRouter = new Hono();

// Apply authentication middleware to all routes
// variantFieldDefinitionsRouter.use(authenticateToken);
// variantFieldDefinitionsRouter.use(requireAdmin);

// Protected routes (Admin only)
variantFieldDefinitionsRouter.get("/", getVariantFieldDefinitions);
variantFieldDefinitionsRouter.post("/", createVariantFieldDefinition);
variantFieldDefinitionsRouter.put("/:id", updateVariantFieldDefinition);
variantFieldDefinitionsRouter.delete("/:id", deleteVariantFieldDefinition);

export default variantFieldDefinitionsRouter;
