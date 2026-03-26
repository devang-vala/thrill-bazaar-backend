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
  gender?: string;
  dateOfBirth?: string;
  alternatePhone?: string;
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
  gender?: string;
  dateOfBirth?: string;
  alternatePhone?: string;
  userType?: string;
  isActive?: boolean;
  isVerified?: boolean;
  password?: string;
}

interface ManageUserStatusRequest {
  isActive: boolean;
}

interface AdminListRequest {
  page?: number;
  limit?: number;
  search?: string;
}

interface CreateAdminRequest {
  name: string;
  email: string;
  password?: string;
  isVerified?: boolean;
  isActive?: boolean;
}

interface UpdateAdminStatusRequest {
  isActive?: boolean;
  isVerified?: boolean;
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

    // Handle gender update
    if (body.gender !== undefined) {
      // Validate gender value
      const validGenders = ['Male', 'Female', 'Other', 'Prefer not to say'];
      if (body.gender && !validGenders.includes(body.gender)) {
        return c.json({ error: "Invalid gender value" }, 400);
      }
      updateData.gender = body.gender || null;
    }

    // Handle date of birth update
    if (body.dateOfBirth !== undefined) {
      if (body.dateOfBirth) {
        const dob = new Date(body.dateOfBirth);
        if (isNaN(dob.getTime())) {
          return c.json({ error: "Invalid date of birth" }, 400);
        }
        // Check if date is in the future
        if (dob > new Date()) {
          return c.json({ error: "Date of birth cannot be in the future" }, 400);
        }
        updateData.dateOfBirth = dob;
      } else {
        updateData.dateOfBirth = null;
      }
    }

    // Handle alternate phone update
    if (body.alternatePhone !== undefined) {
      if (body.alternatePhone) {
        const sanitizedAlternatePhone = sanitizePhone(body.alternatePhone);
        // Check if alternate phone is same as primary phone
        if (sanitizedAlternatePhone === currentUser.phone) {
          return c.json({ error: "Alternate phone cannot be same as primary phone" }, 400);
        }
        updateData.alternatePhone = sanitizedAlternatePhone;
      } else {
        updateData.alternatePhone = null;
      }
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

/**
 * Superadmin: list admin accounts
 */
export const getAdminAccounts = async (c: Context) => {
  try {
    const currentUser = c.get("user");
    if (currentUser?.userType !== "super_admin") {
      return c.json({ error: "Only superadmin can access admin accounts" }, 403);
    }

    let body: AdminListRequest = {};
    try {
      const requestBody = await c.req.text();
      if (requestBody.trim()) {
        body = JSON.parse(requestBody) as AdminListRequest;
      }
    } catch (_error) {
      return c.json({ error: "Invalid JSON format in request body" }, 400);
    }

    const page = body.page && body.page > 0 ? body.page : 1;
    const limit = body.limit && body.limit > 0 ? Math.min(body.limit, 100) : 10;
    const skip = (page - 1) * limit;

    const whereClause: any = {
      userType: "admin",
    };

    if (body.search?.trim()) {
      const query = body.search.trim();
      whereClause.OR = [
        { email: { contains: query, mode: "insensitive" } },
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
      ];
    }

    const [admins, totalCount] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          userType: true,
          isVerified: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.user.count({ where: whereClause }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    return c.json({
      message: "Admin accounts fetched successfully",
      data: {
        admins,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Get admin accounts error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Superadmin: create an admin account
 */
export const createAdminAccount = async (c: Context) => {
  try {
    const currentUser = c.get("user");
    if (currentUser?.userType !== "super_admin") {
      return c.json({ error: "Only superadmin can create admin accounts" }, 403);
    }

    const body = (await c.req.json()) as CreateAdminRequest;

    if (!body.name?.trim()) {
      return c.json({ error: "Name is required" }, 400);
    }

    if (!body.email?.trim()) {
      return c.json({ error: "Email is required" }, 400);
    }

    if (body.password && body.password.length < 6) {
      return c.json({ error: "Password must be at least 6 characters" }, 400);
    }

    const email = sanitizeEmail(body.email);

    const existing = await prisma.user.findFirst({ where: { email } });
    if (existing) {
      return c.json({ error: "User with this email already exists" }, 409);
    }

    const nameParts = body.name.trim().split(/\s+/);
    const firstName = sanitizeString(nameParts[0] || "", 50) || null;
    const lastName = sanitizeString(nameParts.slice(1).join(" "), 50) || null;
    const generatedPassword = body.password || `TB@${Math.random().toString(36).slice(-8)}!`;
    const hashedPassword = await hashPassword(generatedPassword);

    const admin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        userType: "admin",
        isVerified: body.isVerified ?? true,
        isActive: body.isActive ?? true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        userType: true,
        isVerified: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
      },
    });

    return c.json(
      {
        message: "Admin account created successfully",
        data: admin,
        temporaryPassword: body.password ? null : generatedPassword,
      },
      201
    );
  } catch (error) {
    console.error("Create admin account error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Superadmin: update admin account status/verification
 */
export const updateAdminAccountStatus = async (c: Context) => {
  try {
    const currentUser = c.get("user");
    if (currentUser?.userType !== "super_admin") {
      return c.json({ error: "Only superadmin can update admin accounts" }, 403);
    }

    const userId = c.req.param("userId");
    if (!userId) {
      return c.json({ error: "User ID is required" }, 400);
    }

    const body = (await c.req.json()) as UpdateAdminStatusRequest;

    if (body.isActive === undefined && body.isVerified === undefined) {
      return c.json({ error: "At least one of isActive or isVerified is required" }, 400);
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, userType: true },
    });

    if (!target) {
      return c.json({ error: "Admin account not found" }, 404);
    }

    if (target.userType !== "admin") {
      return c.json({ error: "Only admin accounts can be updated here" }, 400);
    }

    const updateData: { isActive?: boolean; isVerified?: boolean } = {};
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.isVerified !== undefined) updateData.isVerified = body.isVerified;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        userType: true,
        isVerified: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
      },
    });

    return c.json({
      message: "Admin account updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Update admin account status error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Superadmin: delete admin account
 */
export const deleteAdminAccount = async (c: Context) => {
  try {
    const currentUser = c.get("user");
    if (currentUser?.userType !== "super_admin") {
      return c.json({ error: "Only superadmin can delete admin accounts" }, 403);
    }

    const userId = c.req.param("userId");
    if (!userId) {
      return c.json({ error: "User ID is required" }, 400);
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, userType: true },
    });

    if (!target) {
      return c.json({ error: "Admin account not found" }, 404);
    }

    if (target.userType !== "admin") {
      return c.json({ error: "Only admin accounts can be deleted here" }, 400);
    }

    await prisma.user.delete({ where: { id: userId } });

    return c.json({ message: "Admin account deleted successfully" });
  } catch (error) {
    console.error("Delete admin account error:", error);
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

    // Handle gender update
    if (body.gender !== undefined) {
      const validGenders = ['Male', 'Female', 'Other', 'Prefer not to say'];
      if (body.gender && !validGenders.includes(body.gender)) {
        return c.json({ error: "Invalid gender value" }, 400);
      }
      updateData.gender = body.gender || null;
    }

    // Handle date of birth update
    if (body.dateOfBirth !== undefined) {
      if (body.dateOfBirth) {
        const dob = new Date(body.dateOfBirth);
        if (isNaN(dob.getTime())) {
          return c.json({ error: "Invalid date of birth" }, 400);
        }
        if (dob > new Date()) {
          return c.json({ error: "Date of birth cannot be in the future" }, 400);
        }
        updateData.dateOfBirth = dob;
      } else {
        updateData.dateOfBirth = null;
      }
    }

    // Handle alternate phone update
    if (body.alternatePhone !== undefined) {
      if (body.alternatePhone) {
        const sanitizedAlternatePhone = sanitizePhone(body.alternatePhone);
        updateData.alternatePhone = sanitizedAlternatePhone;
      } else {
        updateData.alternatePhone = null;
      }
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

/**
 * Get all operators/sellers for filter dropdown
 */
export const getOperatorsForFilter = async (c: Context) => {
  try {
    const operators = await prisma.user.findMany({
      where: {
        userType: "operator",
        isActive: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
      orderBy: {
        firstName: "asc",
      },
    });

    return c.json({
      success: true,
      data: operators,
    });
  } catch (error) {
    console.error("Get operators for filter error:", error);
    return c.json({ error: "Failed to fetch operators" }, 500);
  }
};

/**
 * Update user's selected categories
 */
export const updateUserCategories = async (c: Context) => {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    
    if (!user || !user.userId) {
      return c.json({ error: "User not found" }, 404);
    }

    // Validate categoryIds is an array
    if (!body.categoryIds || !Array.isArray(body.categoryIds)) {
      return c.json({ error: "categoryIds must be an array" }, 400);
    }

    // Validate all category IDs exist
    const categories = await prisma.category.findMany({
      where: {
        id: {
          in: body.categoryIds,
        },
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (categories.length !== body.categoryIds.length) {
      return c.json({ error: "One or more invalid category IDs" }, 400);
    }

    // Update user's selected categories
    const updatedUser = await prisma.user.update({
      where: { id: user.userId },
      data: {
        selectedCategoryIds: body.categoryIds,
      },
      select: {
        id: true,
        selectedCategoryIds: true,
      },
    });

    return c.json({
      message: "Categories updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update user categories error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Get user's selected categories with full details
 */
export const getUserCategories = async (c: Context) => {
  try {
    const user = c.get("user");
    
    if (!user || !user.userId) {
      return c.json({ error: "User not found" }, 404);
    }

    const userWithCategories = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        id: true,
        selectedCategoryIds: true,
      },
    });

    if (!userWithCategories) {
      return c.json({ error: "User not found" }, 404);
    }

    // If no categories selected, return empty array
    if (!userWithCategories.selectedCategoryIds || userWithCategories.selectedCategoryIds.length === 0) {
      return c.json({
        message: "No categories selected",
        data: {
          categoryIds: [],
          categories: [],
        },
      });
    }

    // Fetch full category details
    const categories = await prisma.category.findMany({
      where: {
        id: {
          in: userWithCategories.selectedCategoryIds,
        },
        isActive: true,
      },
      select: {
        id: true,
        categoryName: true,
        categorySlug: true,
        categoryIconUrl: true,
        bookingFormat: true,
        hasVariantCatA: true,
        isInclusionsExclusionsAllowed: true,
        isAddonsAllowed: true,
        isBookingOptionAllowed: true,
        isFaqAllowed: true,
        isDayWiseAllowed: true,
        listingType: {
          select: {
            id: true,
            name: true,
            displayOrder: true,
          },
        },
      },
      orderBy: {
        displayOrder: 'asc',
      },
    });

    return c.json({
      message: "User categories retrieved successfully",
      data: {
        categoryIds: userWithCategories.selectedCategoryIds,
        categories: categories,
      },
    });
  } catch (error) {
    console.error("Get user categories error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

