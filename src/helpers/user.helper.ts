import { prisma } from "../db.js";

export const getUserById = async (userId: string) => {
  try {
    return await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        userType: true,
        isVerified: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        password: true, // Include for password verification
      },
    });
  } catch (error) {
    console.error("Error getting user by ID:", error);
    return null;
  }
};

export const updateUserById = async (userId: string, updateData: any) => {
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        phone: true,
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
  } catch (error) {
    console.error("Error updating user:", error);
    return null;
  }
};

export const checkEmailExists = async (
  email: string,
  excludeUserId?: string
): Promise<boolean> => {
  try {
    const whereClause: any = { email };

    if (excludeUserId) {
      whereClause.id = { not: excludeUserId };
    }

    const user = await prisma.user.findFirst({
      where: whereClause,
    });

    return !!user;
  } catch (error) {
    console.error("Error checking email existence:", error);
    return false;
  }
};

export const checkPhoneExists = async (
  phone: string,
  excludeUserId?: string
): Promise<boolean> => {
  try {
    const whereClause: any = { phone };

    if (excludeUserId) {
      whereClause.id = { not: excludeUserId };
    }

    const user = await prisma.user.findFirst({
      where: whereClause,
    });

    return !!user;
  } catch (error) {
    console.error("Error checking phone existence:", error);
    return false;
  }
};

export const getUserStatistics = async (userId: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        createdAt: true,
        lastLoginAt: true,
        isVerified: true,
        isActive: true,
      },
    });

    if (!user) {
      return null;
    }

    // Calculate days since registration
    const daysSinceRegistration = Math.floor(
      (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Calculate days since last login
    const daysSinceLastLogin = user.lastLoginAt
      ? Math.floor(
          (Date.now() - user.lastLoginAt.getTime()) / (1000 * 60 * 60 * 24)
        )
      : null;

    return {
      userId: user.id,
      daysSinceRegistration,
      daysSinceLastLogin,
      isVerified: user.isVerified,
      isActive: user.isActive,
      accountStatus: user.isActive
        ? user.isVerified
          ? "active"
          : "unverified"
        : "deactivated",
    };
  } catch (error) {
    console.error("Error getting user statistics:", error);
    return null;
  }
};

export const searchUsers = async (
  criteria: {
    email?: string;
    phone?: string;
    userType?: string;
    isActive?: boolean;
    isVerified?: boolean;
    excludeSuperAdmin?: boolean;
  },
  limit: number = 10,
  offset: number = 0
) => {
  try {
    const whereClause: any = {};

    // Handle search text (can match email or phone)
    if (criteria.email && criteria.phone && criteria.email === criteria.phone) {
      // If email and phone are the same (search query), create OR condition
      whereClause.OR = [
        { email: { contains: criteria.email, mode: "insensitive" } },
        { phone: { contains: criteria.phone } },
      ];
    } else {
      // Handle individual email/phone filters
      if (criteria.email) {
        whereClause.email = { contains: criteria.email, mode: "insensitive" };
      }

      if (criteria.phone) {
        whereClause.phone = { contains: criteria.phone };
      }
    }

    if (criteria.userType) {
      whereClause.userType = criteria.userType;
    }

    if (criteria.isActive !== undefined) {
      whereClause.isActive = criteria.isActive;
    }

    if (criteria.isVerified !== undefined) {
      whereClause.isVerified = criteria.isVerified;
    }

    // Exclude superadmin users if requested
    if (criteria.excludeSuperAdmin) {
      whereClause.userType = { not: "super_admin" };

      // If userType was already specified, combine with NOT super_admin
      if (criteria.userType) {
        whereClause.AND = [
          { userType: criteria.userType },
          { userType: { not: "super_admin" } },
        ];
        delete whereClause.userType;
      }
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        userType: true,
        isVerified: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    return users;
  } catch (error) {
    console.error("Error searching users:", error);
    return [];
  }
};

export const getUserCount = async (criteria: {
  userType?: string;
  isActive?: boolean;
  isVerified?: boolean;
  excludeSuperAdmin?: boolean;
}): Promise<number> => {
  try {
    const whereClause: any = {};

    if (criteria.userType) {
      whereClause.userType = criteria.userType;
    }

    if (criteria.isActive !== undefined) {
      whereClause.isActive = criteria.isActive;
    }

    if (criteria.isVerified !== undefined) {
      whereClause.isVerified = criteria.isVerified;
    }

    // Exclude superadmin users if requested
    if (criteria.excludeSuperAdmin) {
      whereClause.userType = { not: "super_admin" };

      // If userType was already specified, combine with NOT super_admin
      if (criteria.userType) {
        whereClause.AND = [
          { userType: criteria.userType },
          { userType: { not: "super_admin" } },
        ];
        delete whereClause.userType;
      }
    }

    return await prisma.user.count({
      where: whereClause,
    });
  } catch (error) {
    console.error("Error getting user count:", error);
    return 0;
  }
};

export const isProfileComplete = async (userId: string): Promise<boolean> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
      },
    });

    return !!(user && user.firstName && user.lastName);
  } catch (error) {
    console.error("Error checking profile completion:", error);
    return false;
  }
};

export const getUserLastActivity = async (userId: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        lastLoginAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return null;
    }

    return {
      lastLogin: user.lastLoginAt,
      lastUpdate: user.updatedAt,
      isRecentlyActive: user.lastLoginAt
        ? Date.now() - user.lastLoginAt.getTime() < 7 * 24 * 60 * 60 * 1000 // 7 days
        : false,
    };
  } catch (error) {
    console.error("Error getting user last activity:", error);
    return null;
  }
};
