import { Hono } from "hono";
import {
  uploadImages,
  uploadIcon,
  deleteImage,
} from "../controllers/upload.controller.js";
import {
  authenticateToken,
} from "../middlewares/auth.middleware.js";

const uploadRouter = new Hono();

// Uncomment to require authentication
// uploadRouter.use(authenticateToken);

// Upload single or multiple images
uploadRouter.post("/images", uploadImages);

// Upload SVG icon for metadata field definitions (SVG only)
uploadRouter.post("/icon", uploadIcon);

// Delete image by public_id
uploadRouter.delete("/images", deleteImage);

export default uploadRouter;
