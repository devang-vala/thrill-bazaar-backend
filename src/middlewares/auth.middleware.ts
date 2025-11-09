import type { Context, Next } from "hono";
import jwt from "jsonwebtoken";

interface JWTPayload {
  userId: string;
  userType: string;
  role: string;
  iat: number;
  exp: number;
}

interface UserInfo {
  userId: string;
  userType: string;
  role: string;
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
          current: user.role,
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
export const optionalAuth = async (c: Context, next: Next) => {
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
