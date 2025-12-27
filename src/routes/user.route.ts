import { Hono } from "hono";
import {
  getUserProfile,
  updateUserProfile,
  changePassword,
  getUsers,
  updateAnyUser,
  manageUserStatus,
  getOperatorsForFilter,
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

export default userRouter;
