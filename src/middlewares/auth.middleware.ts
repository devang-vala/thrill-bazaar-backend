import type { Context, Next } from "hono";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";

interface JWTPayload {
  userId: string;
  userType: string;
  role: string;
  iat: number;
  exp:  number;
}

interface UserInfo {
  userId: string;
  userType:  string;
  role: string;
  isActive?:  boolean;     // Made optional
  isVerified?: boolean;   // Made optional
}

// Extend Context type to include user
declare module "hono" {
  interface ContextVariableMap {
    user: UserInfo;
  }
}

// Middleware to verify JWT token and extract user information
export const authenticateToken = async (c: Context, next: Next) => {
  try {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Access token required" }, 401);
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      return c.json({ error: "JWT configuration error" }, 500);
    }

    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;

    // Add user information to context for use in route handlers
    c.set("user", {
      userId: decoded.userId,
      userType: decoded.userType,
      role: decoded.role || decoded.userType, // Fallback to userType if role not present
    });

    await next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return c.json({ error: "Token expired" }, 401);
    } else if (error instanceof jwt.JsonWebTokenError) {
      return c.json({ error: "Invalid token" }, 401);
    }

    return c.json({ error: "Authentication failed" }, 401);
  }
};

/**
 * NEW:  Middleware to enrich user context with database information
 * Use this after authenticateToken when you need isActive/isVerified checks
 */
export const enrichUserContext = async (c: Context, next: Next) => {
  try {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    // Fetch user status from database
    const dbUser = await prisma.user.findUnique({
      where:  { id: user.userId },
      select: {
        isActive: true,
        isVerified: true,
      },
    });

    if (!dbUser) {
      return c.json({ error: "User not found" }, 404);
    }

    // Enrich user context with database info
    c.set("user", {
      ... user,
      isActive: dbUser.isActive,
      isVerified: dbUser.isVerified,
    });

    await next();
  } catch (error) {
    console.error("Enrich user context error:", error);
    return c.json({ error: "Failed to load user information" }, 500);
  }
};

/**
 * NEW: Middleware to check if operator is verified
 * Use this to protect routes that require verification
 */
export const requireVerifiedOperator = async (c: Context, next: Next) => {
  try {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (user.userType !== "operator") {
      return c.json({ error: "Only operators can access this resource" }, 403);
    }

    // Fetch verification status from database
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        isActive: true,
        isVerified: true,
      },
    });

    if (!dbUser) {
      return c.json({ error: "User not found" }, 404);
    }

    if (!dbUser.isVerified || !dbUser.isActive) {
      return c.json({
        error: "Account not verified",
        message: "Your account is pending admin verification. You will be notified once approved.",
        status: "pending_verification",
      }, 403);
    }

    // Enrich context with verification status
    c.set("user", {
      ...user,
      isActive: dbUser.isActive,
      isVerified: dbUser.isVerified,
    });

    await next();
  } catch (error) {
    console.error("Verify operator status error:", error);
    return c.json({ error: "Failed to verify operator status" }, 500);
  }
};

// Middleware to check if user has required role(s)
export const requireRole = (allowedRoles: string | string[]) => {
  return async (c: Context, next: Next) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    if (!roles.includes(user.role) && !roles.includes(user.userType)) {
      return c.json(
        {
          error: "Insufficient permissions",
          required: roles,
          currentRole: user.role,
          currentUserType: user.userType,
        },
        403
      );
    }

    await next();
  };
};

// Predefined role middlewares for common use cases
export const requireCustomer = requireRole("customer");
export const requireOperator = requireRole("operator");
export const requireAdmin = requireRole(["admin", "super_admin"]);
export const requireSuperAdmin = requireRole("super_admin");
export const requireAnyAdmin = requireRole([
  "operator",
  "admin",
  "super_admin",
]);

// Middleware to get current user information (optional authentication)
export const optionalAuth = async (c:  Context, next: Next) => {
  try {
    const authHeader = c.req.header("Authorization");

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const jwtSecret = process.env.JWT_SECRET;

      if (jwtSecret) {
        const decoded = jwt.verify(token, jwtSecret) as JWTPayload;
        c.set("user", {
          userId: decoded.userId,
          userType: decoded.userType,
          role: decoded.role || decoded.userType,
        });
      }
    }

    await next();
  } catch (error) {
    // Continue without authentication if token is invalid
    await next();
  }
};