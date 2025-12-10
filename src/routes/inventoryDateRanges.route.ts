import { Hono } from "hono";
import {
  getInventoryDateRanges,
//   getInventoryDateRange,
  createInventoryDateRange,
//   updateInventoryDateRange,
//   deleteInventoryDateRange,
} from "../controllers/inventoryDateRanges.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const inventoryDateRangesRouter = new Hono();

// Uncomment for production
// inventoryDateRangesRouter.use(authenticateToken);
// inventoryDateRangesRouter.use(requireAnyAdmin);

// Get all date ranges for a listing
inventoryDateRangesRouter.get("/listing/:listingId", getInventoryDateRanges);

// Get single date range by ID
// inventoryDateRangesRouter.get("/: id", getInventoryDateRange);

// Create date range for a listing
inventoryDateRangesRouter.post("/listing/:listingId", createInventoryDateRange);

// Update date range
// inventoryDateRangesRouter. put("/:id", updateInventoryDateRange);

// Delete date range
// inventoryDateRangesRouter.delete("/:id", deleteInventoryDateRange);

export default inventoryDateRangesRouter;