import type { Context } from "hono";
import { prisma } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  formatUserResponse,
} from "../helpers/auth.helper.js";
import {
  validateProfileUpdate,
  validatePasswordChange,
  validateUsersListBody,
  validateUpdateAnyUser,
  validateManageUserStatus,
  sanitizeEmail,
  sanitizePhone,
  sanitizeString,
} from "../helpers/validation.helper.js";
import {
  getUserById,
  updateUserById,
  checkEmailExists,
  checkPhoneExists,
  searchUsers,
  getUserCount,
} from "../helpers/user.helper.js";

// Interfaces for request bodies
interface UpdateProfileRequest {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
}

interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface GetUsersQuery {
  page?: number;
  limit?: number;
  userType?: string;
  isActive?: boolean;
  isVerified?: boolean;
  search?: string;
}

interface UpdateAnyUserRequest {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  userType?: string;
  isActive?: boolean;
  isVerified?: boolean;
  password?: string;
}

interface ManageUserStatusRequest {
  isActive: boolean;
}

export const getUserProfile = async (c: Context) => {
  try {
    const user = c.get("user");

    if (!user || !user.userId) {
      return c.json({ error: "User not found" }, 404);
    }

    // Get full user details from database
    const userDetails = await getUserById(user.userId);

    if (!userDetails) {
      return c.json({ error: "User not found" }, 404);
    }

    // Format response (exclude sensitive data)
    const userResponse = formatUserResponse(userDetails);

    return c.json({
      message: "Profile retrieved successfully",
      user: userResponse,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const getUsers = async (c: Context) => {
  try {
    const currentUser = c.get("user");

    // Handle empty request body
    let body: GetUsersQuery = {};
    try {
      const requestBody = await c.req.text();
      if (requestBody.trim()) {
        body = JSON.parse(requestBody) as GetUsersQuery;
      }
    } catch (jsonError) {
      return c.json(
        {
          error: "Invalid JSON format in request body",
          details:
            "Please send a valid JSON object or an empty body for default pagination",
        },
        400
      );
    }

    // Validate request body
    const validation = validateUsersListBody(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Parse pagination parameters
    const page = body.page || 1;
    const limit = Math.min(body.limit || 10, 100); // Max 100 per page
    const offset = (page - 1) * limit;

    // Build search criteria
    const criteria: any = {};

    if (body.userType) {
      criteria.userType = body.userType;
    }

    if (body.isActive !== undefined) {
      criteria.isActive = body.isActive;
    }

    if (body.isVerified !== undefined) {
      criteria.isVerified = body.isVerified;
    }

    if (body.search) {
      // Search in both email and phone
      criteria.email = body.search;
      criteria.phone = body.search;
    }

    // Always exclude super_admin users from pagination results
    criteria.excludeSuperAdmin = true;

    // Get users and total count
    const [users, totalCount] = await Promise.all([
      searchUsers(criteria, limit, offset),
      getUserCount(criteria),
    ]);

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return c.json({
      message: "Users retrieved successfully",
      data: {
        users: users.map(formatUserResponse),
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNextPage,
          hasPrevPage,
        },
        filters: {
          userType: body.userType || null,
          isActive: body.isActive !== undefined ? body.isActive : null,
          isVerified: body.isVerified !== undefined ? body.isVerified : null,
          search: body.search || null,
        },
      },
    });
  } catch (error) {
    console.error("Get users error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const updateUserProfile = async (c: Context) => {
  try {
    const user = c.get("user");
    const body = (await c.req.json()) as UpdateProfileRequest;

    if (!user || !user.userId) {
      return c.json({ error: "User not found" }, 404);
    }

    // Get current user details
    const currentUser = await getUserById(user.userId);
    if (!currentUser) {
      return c.json({ error: "User not found" }, 404);
    }

    // Validate profile update request
    const validation = validateProfileUpdate(body, currentUser.userType);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Prepare update data
    const updateData: any = {};

    // Handle email update (for admin users)
    if (body.email && currentUser.userType !== "customer") {
      const sanitizedEmail = sanitizeEmail(body.email);

      // Check if email already exists (excluding current user)
      const emailExists = await checkEmailExists(sanitizedEmail, user.userId);
      if (emailExists) {
        return c.json({ error: "Email already exists" }, 409);
      }

      updateData.email = sanitizedEmail;
    }

    // Handle phone update (for customer users)
    if (body.phone && currentUser.userType === "customer") {
      const sanitizedPhone = sanitizePhone(body.phone);

      // Check if phone already exists (excluding current user)
      const phoneExists = await checkPhoneExists(sanitizedPhone, user.userId);
      if (phoneExists) {
        return c.json({ error: "Phone number already exists" }, 409);
      }

      updateData.phone = sanitizedPhone;
      // If customer changes phone, they need to verify it again
      updateData.isVerified = false;
    }

    // Handle name updates
    if (body.firstName !== undefined) {
      updateData.firstName = sanitizeString(body.firstName, 50) || null;
    }

    if (body.lastName !== undefined) {
      updateData.lastName = sanitizeString(body.lastName, 50) || null;
    }

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    // Update user in database
    const updatedUser = await updateUserById(user.userId, updateData);

    if (!updatedUser) {
      return c.json({ error: "Failed to update profile" }, 500);
    }

    // Format response
    const userResponse = formatUserResponse(updatedUser);

    return c.json({
      message: "Profile updated successfully",
      user: userResponse,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const changePassword = async (c: Context) => {
  try {
    const user = c.get("user");
    const body = (await c.req.json()) as ChangePasswordRequest;

    if (!user || !user.userId) {
      return c.json({ error: "User not found" }, 404);
    }

    // Get current user details
    const currentUser = await getUserById(user.userId);
    if (!currentUser) {
      return c.json({ error: "User not found" }, 404);
    }

    // Check if user type can change password
    if (currentUser.userType === "customer") {
      return c.json(
        {
          error:
            "Customers cannot change password. Use OTP authentication instead.",
        },
        403
      );
    }

    // Validate password change request
    const validation = validatePasswordChange(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Verify current password
    if (!currentUser.password) {
      return c.json({ error: "No password set for this account" }, 400);
    }

    const isCurrentPasswordValid = await verifyPassword(
      body.currentPassword,
      currentUser.password
    );

    if (!isCurrentPasswordValid) {
      return c.json({ error: "Current password is incorrect" }, 401);
    }

    // Hash new password
    const hashedNewPassword = await hashPassword(body.newPassword);

    // Update password in database
    const updatedUser = await updateUserById(user.userId, {
      password: hashedNewPassword,
    });

    if (!updatedUser) {
      return c.json({ error: "Failed to change password" }, 500);
    }

    return c.json({
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Manage user account status (superadmin only) - activate/deactivate
 */
export const manageUserStatus = async (c: Context) => {
  try {
    const currentUser = c.get("user");
    const userId = c.req.param("userId");
    const body = (await c.req.json()) as ManageUserStatusRequest;

    // Check if current user is superadmin
    if (currentUser?.userType !== "super_admin") {
      return c.json({ error: "Only superadmin can manage user status" }, 403);
    }

    if (!userId) {
      return c.json({ error: "User ID is required" }, 400);
    }

    // Validate request body
    const validation = validateManageUserStatus(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Get target user details
    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return c.json({ error: "User not found" }, 404);
    }

    // Prevent superadmin from deactivating themselves
    if (userId === currentUser.userId && !body.isActive) {
      return c.json({ error: "Cannot deactivate your own account" }, 400);
    }

    // Check if status is already the same
    if (targetUser.isActive === body.isActive) {
      const action = body.isActive ? "activated" : "deactivated";
      return c.json({ error: `Account is already ${action}` }, 400);
    }

    // Update user status
    const updatedUser = await updateUserById(userId, {
      isActive: body.isActive,
    });

    if (!updatedUser) {
      return c.json({ error: "Failed to update user status" }, 500);
    }

    const action = body.isActive ? "activated" : "deactivated";
    const userResponse = formatUserResponse(updatedUser);

    return c.json({
      message: `User account ${action} successfully`,
      user: userResponse,
    });
  } catch (error) {
    console.error("Manage user status error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const updateAnyUser = async (c: Context) => {
  try {
    const currentUser = c.get("user");
    const userId = c.req.param("userId");
    const body = (await c.req.json()) as UpdateAnyUserRequest;

    // Check if current user is superadmin
    if (currentUser?.userType !== "super_admin") {
      return c.json({ error: "Only superadmin can update any user" }, 403);
    }

    if (!userId) {
      return c.json({ error: "User ID is required" }, 400);
    }

    // Get target user details
    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return c.json({ error: "User not found" }, 404);
    }

    // Validate update request
    const validation = validateUpdateAnyUser(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Prepare update data
    const updateData: any = {};

    // Handle email update
    if (body.email) {
      const sanitizedEmail = sanitizeEmail(body.email);

      // Check if email already exists (excluding current user)
      const emailExists = await checkEmailExists(sanitizedEmail, userId);
      if (emailExists) {
        return c.json({ error: "Email already exists" }, 409);
      }

      updateData.email = sanitizedEmail;
    }

    // Handle phone update
    if (body.phone) {
      const sanitizedPhone = sanitizePhone(body.phone);

      // Check if phone already exists (excluding current user)
      const phoneExists = await checkPhoneExists(sanitizedPhone, userId);
      if (phoneExists) {
        return c.json({ error: "Phone number already exists" }, 409);
      }

      updateData.phone = sanitizedPhone;
    }

    // Handle name updates
    if (body.firstName !== undefined) {
      updateData.firstName = sanitizeString(body.firstName, 50) || null;
    }

    if (body.lastName !== undefined) {
      updateData.lastName = sanitizeString(body.lastName, 50) || null;
    }

    // Handle user type update
    if (body.userType && body.userType !== targetUser.userType) {
      updateData.userType = body.userType;
    }

    // Handle status updates
    if (body.isActive !== undefined) {
      updateData.isActive = body.isActive;
    }

    if (body.isVerified !== undefined) {
      updateData.isVerified = body.isVerified;
    }

    // Handle password update
    if (body.password) {
      const hashedPassword = await hashPassword(body.password);
      updateData.password = hashedPassword;
    }

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    // Update user in database
    const updatedUser = await updateUserById(userId, updateData);

    if (!updatedUser) {
      return c.json({ error: "Failed to update user" }, 500);
    }

    // Format response
    const userResponse = formatUserResponse(updatedUser);

    return c.json({
      message: "User updated successfully",
      user: userResponse,
    });
  } catch (error) {
    console.error("Update any user error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};
