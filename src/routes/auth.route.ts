import { Hono } from "hono";
import {
  registerUser,
  registerAdmin,
  loginUser,
  customerLogin,
  customerVerifyOtp,
  adminLogin,
  operatorLogin
} from "../controllers/auth.controller.js";
import {
  authenticateToken,
  requireCustomer,
  requireAdmin,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const authRouter = new Hono();

// Test endpoint to verify auth router is working
authRouter.get("/", (c) => c.text("Auth router is working"));

// User Registration
authRouter.post("/register", registerUser);

// Admin/Operator/Super Admin Registration (separate endpoint)
//to-do: superadmin and admin cannot be register
authRouter.post("/register/admin", registerAdmin);

// Original unified login (for backward compatibility) for anyone email/phone + password
authRouter.post("/login", loginUser);

// Customer Authentication (OTP-based)
authRouter.post("/login/customer", customerLogin);
authRouter.post("/verify-otp", customerVerifyOtp);

// Admin/Operator/Super Admin Authentication (Email + Password)
authRouter.post("/login/admin", adminLogin);

// testing middleware
authRouter.get("/admin-only", authenticateToken, requireAdmin, (c) => {
  const user = c.get("user");
  return c.json({
    message: "This endpoint is only for admins and super admins",
    user: user,
  });
});

authRouter.post("/login/operator", operatorLogin);

export default authRouter;
