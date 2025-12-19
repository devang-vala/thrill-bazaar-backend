import { Hono } from "hono";
import {
  registerOperatorComplete,
  getOperatorProfile,
  getAllOperators,
  verifyOperator,
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


operatorRouter.get(
  "/profile/: operatorId?",  
  requireVerifiedOperator,
  getOperatorProfile
);

export default operatorRouter;