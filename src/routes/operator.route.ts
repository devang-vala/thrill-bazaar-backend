import { Hono } from "hono";
import {
  registerOperatorComplete,
  getOperatorProfile,
  updateOperatorProfile,
  getAllOperators,
  verifyOperator,
  upsertOperatorCategoryRate,
  deleteOperatorCategoryRate,
  assignBadgeToOperator,
  removeBadgeFromOperator,
  getOperatorBadges,
  getOperatorDashboardSummary,
  getOperatorSettlements,
  upsertOperatorSettlementConcern,
} from "../controllers/operator.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const operatorRouter = new Hono();

// Test endpoint
operatorRouter.get("/", (c) => c.text("Operator router is working"));

// Public registration route (complete multi-step form)
operatorRouter.post("/register", registerOperatorComplete);

// Authenticated routes
operatorRouter.use(authenticateToken);

// Seller dashboard summary
operatorRouter.get("/dashboard/:operatorId", getOperatorDashboardSummary);
operatorRouter.get("/:operatorId/settlements", getOperatorSettlements);
operatorRouter.post("/:operatorId/settlements/:settlementId/concern", upsertOperatorSettlementConcern);

// Admin routes 
operatorRouter.post("/list", requireAdmin, getAllOperators);
operatorRouter.put("/verify/:operatorId", requireAdmin, verifyOperator);
operatorRouter.put("/category-rates/:operatorId", requireAdmin, upsertOperatorCategoryRate);
operatorRouter.delete("/category-rates/:operatorId/:categoryId", requireAdmin, deleteOperatorCategoryRate);

// Operator badge management (admin only)
operatorRouter.post("/badges/assign", requireAdmin, assignBadgeToOperator);
operatorRouter.post("/badges/remove", requireAdmin, removeBadgeFromOperator);
operatorRouter.get("/badges/:operatorId", requireAdmin, getOperatorBadges);

// Admin-accessible operator profile (for verification workflow)
operatorRouter.get("/admin/profile/:operatorId", requireAdmin, getOperatorProfile);

// Operator-facing profile route (authenticated operator can view own status/profile)
operatorRouter.get("/profile/:operatorId?", getOperatorProfile);

// Operator self-service profile update
operatorRouter.put("/profile", updateOperatorProfile);

export default operatorRouter;
