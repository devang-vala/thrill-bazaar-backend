import { Hono } from "hono";
import {
  getFieldDefinitions,
  getFieldDefinition,
  createFieldDefinition,
  updateFieldDefinition,
  deleteFieldDefinition,
  paginateFieldDefinitions,
} from "../controllers/listingMetadataFieldDefinitions.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const fieldDefinitionsRouter = new Hono();

// Apply authentication middleware to all routes
// fieldDefinitionsRouter.use(authenticateToken);
// fieldDefinitionsRouter.use(requireAdmin);

// Protected routes (Admin only)
fieldDefinitionsRouter.get("/", getFieldDefinitions);
fieldDefinitionsRouter.post("/paginate", paginateFieldDefinitions);
fieldDefinitionsRouter.get("/:id", getFieldDefinition);
fieldDefinitionsRouter.post("/", createFieldDefinition);
fieldDefinitionsRouter.put("/:id", updateFieldDefinition);
fieldDefinitionsRouter.delete("/:id", deleteFieldDefinition);

export default fieldDefinitionsRouter;