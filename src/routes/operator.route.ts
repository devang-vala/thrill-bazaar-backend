import { Hono } from "hono";
import {
  registerOperatorComplete,
  getOperatorProfile,
  getAllOperators,
  verifyOperator,
  assignBadgeToOperator,
  removeBadgeFromOperator,
  getOperatorBadges,
} from "../controllers/operator.controller.js";
import {
  authenticateToken,
  requireAdmin,
  requireVerifiedOperator,
} from "../middlewares/auth.middleware.js";

const operatorRouter = new Hono();

// Test endpoint
operatorRouter.get("/", (c) => c.text("Operator router is working"));

// Public registration route (complete multi-step form)
operatorRouter.post("/register", registerOperatorComplete);

// Authenticated routes
operatorRouter.use(authenticateToken);

// Admin routes 
operatorRouter.post("/list", requireAdmin, getAllOperators);
operatorRouter.put("/verify/:operatorId", requireAdmin, verifyOperator);

// Operator badge management (admin only)
operatorRouter.post("/badges/assign", requireAdmin, assignBadgeToOperator);
operatorRouter.post("/badges/remove", requireAdmin, removeBadgeFromOperator);
operatorRouter.get("/badges/:operatorId", requireAdmin, getOperatorBadges);

// Admin-accessible operator profile (for verification workflow)
operatorRouter.get("/admin/profile/:operatorId", requireAdmin, getOperatorProfile);

// Operator-facing profile route (requires verified operator)
operatorRouter.get(
  "/profile/:operatorId?",
  requireVerifiedOperator,
  getOperatorProfile
);

export default operatorRouter;