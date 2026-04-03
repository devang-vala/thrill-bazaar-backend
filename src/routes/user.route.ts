import { Hono } from "hono";
import {
  getUserProfile,
  updateUserProfile,
  changePassword,
  getUsers,
  updateAnyUser,
  manageUserStatus,
  getOperatorsForFilter,
  updateUserCategories,
  getUserCategories,
  getAdminAccounts,
  createAdminAccount,
  updateAdminAccountStatus,
  deleteAdminAccount,
  requestOperatorAccountAccessOtp,
  verifyOperatorAccountAccessOtp,
  updateOperatorAccountAccess,
} from "../controllers/user.controller.js";
import {
  authenticateToken,
  requireAdmin,
  requireSuperAdmin,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const userRouter = new Hono();

// Test endpoint to verify user router is working
userRouter.get("/", (c) => c.text("User router is working"));

// Public endpoint for getting operators/sellers for filters
userRouter.get("/operators", getOperatorsForFilter);

// All user routes require authentication
userRouter.use(authenticateToken);

// Get user profile
userRouter.get("/profile", getUserProfile);

// Get user's selected categories
userRouter.get("/categories", getUserCategories);

// Update user's selected categories
userRouter.put("/categories", updateUserCategories);

// Get users list (admin only)
userRouter.post("/paginate", requireAdmin, getUsers);

// Update any user (superadmin only)
userRouter.put("/update/:userId", requireSuperAdmin, updateAnyUser);

// Update user profile
userRouter.put("/profile", updateUserProfile);

// Change password (for admin/operator users)
userRouter.put("/change-password", requireAnyAdmin, changePassword);

// Manage user account status (superadmin only) - activate/deactivate
userRouter.put("/status/:userId", requireSuperAdmin, manageUserStatus);

// Superadmin admin management
userRouter.post("/admins/list", requireSuperAdmin, getAdminAccounts);
userRouter.post("/admins/create", requireSuperAdmin, createAdminAccount);
userRouter.put("/admins/:userId/status", requireSuperAdmin, updateAdminAccountStatus);
userRouter.delete("/admins/:userId", requireSuperAdmin, deleteAdminAccount);

// Superadmin seller account access management
userRouter.post(
  "/operators/:userId/account-access/request-otp",
  requireSuperAdmin,
  requestOperatorAccountAccessOtp
);
userRouter.post(
  "/operators/:userId/account-access/verify-otp",
  requireSuperAdmin,
  verifyOperatorAccountAccessOtp
);
userRouter.put(
  "/operators/:userId/account-access",
  requireSuperAdmin,
  updateOperatorAccountAccess
);

export default userRouter;
