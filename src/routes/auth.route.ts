import { Hono } from "hono";
import {
  registerUser,
  registerAdmin,
  loginUser,
  customerLogin,
  customerVerifyOtp,
  adminLogin,
  verifyAdminLoginOtp,
  requestAdminForgotPasswordOtp,
  verifyAdminForgotPasswordOtp,
  resetAdminPassword,
  superAdminLogin,
  operatorLogin,
  requestOperatorOtp,
  verifyOperatorOtp,
  verifySingleOperatorOtp,
  setOperatorPassword,
  verifyOperatorLoginOtp,
  requestOperatorForgotPasswordOtp,
  verifyOperatorForgotPasswordOtp,
  resetOperatorPassword
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
authRouter.post("/login/admin/verify-otp", verifyAdminLoginOtp);
authRouter.post("/login/admin/forgot-password/request-otp", requestAdminForgotPasswordOtp);
authRouter.post("/login/admin/forgot-password/verify-otp", verifyAdminForgotPasswordOtp);
authRouter.post("/login/admin/forgot-password/reset-password", resetAdminPassword);
authRouter.post("/login/super-admin", superAdminLogin);

// Operator signup (OTP + password)
authRouter.post("/operator/send-otp", requestOperatorOtp);
authRouter.post("/operator/verify-otp", verifyOperatorOtp);
authRouter.post("/operator/verify-single-otp", verifySingleOperatorOtp);
authRouter.post("/operator/set-password", setOperatorPassword);

// testing middleware
authRouter.get("/admin-only", authenticateToken, requireAdmin, (c) => {
  const user = c.get("user");
  return c.json({
    message: "This endpoint is only for admins and super admins",
    user: user,
  });
});

authRouter.post("/login/operator", operatorLogin);
authRouter.post("/login/operator/verify-login-otp", verifyOperatorLoginOtp);
authRouter.post("/login/operator/forgot-password/request-otp", requestOperatorForgotPasswordOtp);
authRouter.post("/login/operator/forgot-password/verify-otp", verifyOperatorForgotPasswordOtp);
authRouter.post("/login/operator/forgot-password/reset-password", resetOperatorPassword);

export default authRouter;
