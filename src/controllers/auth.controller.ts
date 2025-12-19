import type { Context } from "hono";
import { prisma } from "../db.js";
import {
  generateToken,
  hashPassword,
  verifyPassword,
  generateOtp,
  sendOtpSMS,
  isMasterOtp,
  isMasterPassword,
  isValidEmail,
  isValidPhone,
  validatePassword,
  isValidUserType,
  isValidAdminType,
  formatUserResponse,
  calculateOtpExpiry,
} from "../helpers/auth.helper.js";
import {
  validateCustomerRegistration,
  validateAdminRegistration,
  validateLoginRequest,
  validateCustomerLoginRequest,
  validateAdminLoginRequest,
  validateOtpRequest,
  sanitizeEmail,
  sanitizePhone,
  sanitizeString,
} from "../helpers/validation.helper.js";

interface RegisterUserRequest {
  email?: string;
  phone?: string;
  password?: string; // Optional for customers
  firstName?: string;
  lastName?: string;
  userType?: "customer" | "operator" | "admin" | "super_admin";
}

interface CustomerRegistrationRequest {
  phone: string;
  firstName?: string;
  lastName?: string;
}

interface AdminRegistrationRequest {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  userType: "operator" | "admin" | "super_admin";
}

interface LoginUserRequest {
  email?: string;
  phone?: string;
  password: string;
}

interface CustomerLoginRequest {
  phone: string;
}

interface CustomerVerifyOtpRequest {
  phone: string;
  otp: string;
}

interface AdminLoginRequest {
  email: string;
  password: string;
}

export const registerUser = async (c: Context) => {
  try {
    const body = (await c.req.json()) as RegisterUserRequest;
    const userType = body.userType || "customer";

    // Customer registration - only needs phone, no password
    if (userType === "customer") {
      // Validate customer registration
      const validation = validateCustomerRegistration(body);
      if (!validation.isValid) {
        return c.json({ error: validation.message }, 400);
      }

      // Sanitize phone number
      const phone = sanitizePhone(body.phone!);

      // Check if customer already exists
      const existingUser = await prisma.user.findFirst({
        where: { phone: phone },
      });

      if (existingUser) {
        return c.json(
          { error: "Customer with this phone number already exists" },
          409
        );
      }

      // Create customer without password
      const newUser = await prisma.user.create({
        data: {
          phone: phone,
          firstName: sanitizeString(body.firstName || "", 50),
          lastName: sanitizeString(body.lastName || "", 50),
          userType: "customer",
          isVerified: false, // Will be verified through OTP
          isActive: true,
        },
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true,
          userType: true,
          isVerified: true,
          isActive: true,
          createdAt: true,
        },
      });

      return c.json(
        {
          message:
            "Customer registered successfully. Please verify your phone number via OTP.",
          user: newUser,
          note: "Use /login/customer to receive OTP for login",
        },
        201
      );
    }
  } catch (error) {
    console.error("Registration error:", error);

    // More detailed error logging
    if (error instanceof Error) {
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }

    return c.json({ error: "Internal server error" }, 500);
  }
};

export const loginUser = async (c: Context) => {
  try {
    const body = (await c.req.json()) as LoginUserRequest;

    // Validate login request
    const validation = validateLoginRequest(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Sanitize input
    const email = body.email ? sanitizeEmail(body.email) : undefined;
    const phone = body.phone ? sanitizePhone(body.phone) : undefined;

    // Find user by email or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          email ? { email: email } : {},
          phone ? { phone: phone } : {},
        ].filter((condition) => Object.keys(condition).length > 0),
      },
    });

    if (!user) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    if (!user.isActive) {
      return c.json({ error: "Account is deactivated" }, 401);
    }

    if (!user.password) {
      return c.json({ error: "Password not set for this account" }, 401);
    }

    // Verify password using helper function
    const isValidPassword = await verifyPassword(body.password, user.password);
    if (!isValidPassword) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Update last login time
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate JWT token
    const token = generateToken(user.id, user.userType);

    // Return user info (without password) and token
    const loginResponse = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      isVerified: user.isVerified,
      isActive: user.isActive,
      createdAt: user.createdAt,
      lastLoginAt: new Date(),
    };

    return c.json(
      {
        message: "Login successful",
        user: loginResponse,
        token: token,
      },
      200
    );
  } catch (error) {
    console.error("Login error:", error);

    // More detailed error logging
    if (error instanceof Error) {
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }

    return c.json({ error: "Internal server error" }, 500);
  }
};

export const customerLogin = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CustomerLoginRequest;

    // Validate customer login request
    const validation = validateCustomerLoginRequest(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Sanitize phone number
    const phone = sanitizePhone(body.phone);

    // Check if user exists and is a customer
    const user = await prisma.user.findFirst({
      where: {
        phone: phone,
        userType: "customer",
        isActive: true,
      },
    });

    if (!user) {
      return c.json(
        { error: "Customer not found with this phone number" },
        404
      );
    }

    // Generate OTP
    const otp = generateOtp();
    const expiresAt = calculateOtpExpiry(5); // 5 minutes from now

    // Delete any existing OTPs for this phone
    await prisma.otp.deleteMany({
      where: { phone: phone },
    });

    // Create new OTP record
    await prisma.otp.create({
      data: {
        phone: phone,
        otp: otp,
        expiresAt: expiresAt,
        verified: false,
        attempts: 0,
      },
    });

    // Send OTP via Twilio SMS
    const smsSent = await sendOtpSMS(phone, otp);

    if (smsSent) {
      return c.json({
        message: "OTP sent successfully to your phone",
        expiresIn: "5 minutes",
      });
    } else {
      // Fallback for development or when Twilio is not configured
      return c.json({
        message: "OTP generated (SMS service unavailable)",
        otp: otp, // Only for development - remove in production
        expiresIn: "5 minutes",
      });
    }
  } catch (error) {
    console.error("Customer login error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const customerVerifyOtp = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CustomerVerifyOtpRequest;

    // Validate OTP request
    const validation = validateOtpRequest(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Sanitize phone number
    const phone = sanitizePhone(body.phone);

    // Check for master OTP
    if (isMasterOtp(body.otp)) {
      const user = await prisma.user.findFirst({
        where: {
          phone: phone,
          userType: "customer",
          isActive: true,
        },
      });

      if (!user) {
        return c.json({ error: "Customer not found" }, 404);
      }

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const token = generateToken(user.id, user.userType);

      return c.json({
        message: "Login successful (Master OTP)",
        user: {
          id: user.id,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          userType: user.userType,
          isVerified: user.isVerified,
          isActive: user.isActive,
        },
        token: token,
      });
    }

    // Find valid OTP
    const otpRecord = await prisma.otp.findFirst({
      where: {
        phone: phone,
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      return c.json({ error: "Invalid or expired OTP" }, 400);
    }

    // Check if OTP matches
    if (otpRecord.otp !== body.otp) {
      // Increment attempts
      await prisma.otp.update({
        where: { id: otpRecord.id },
        data: { attempts: otpRecord.attempts + 1 },
      });

      if (otpRecord.attempts >= 2) {
        // Delete OTP after 3 failed attempts
        await prisma.otp.delete({
          where: { id: otpRecord.id },
        });
        return c.json(
          { error: "Too many failed attempts. Please request a new OTP" },
          400
        );
      }

      return c.json({ error: "Invalid OTP" }, 400);
    }

    // Mark OTP as verified
    await prisma.otp.update({
      where: { id: otpRecord.id },
      data: { verified: true },
    });

    // Get user details
    const user = await prisma.user.findFirst({
      where: {
        phone: phone,
        userType: "customer",
        isActive: true,
      },
    });

    if (!user) {
      return c.json({ error: "Customer not found" }, 404);
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = generateToken(user.id, user.userType);

    return c.json({
      message: "Login successful",
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        isVerified: user.isVerified,
        isActive: user.isActive,
      },
      token: token,
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const adminLogin = async (c: Context) => {
  try {
    const body = (await c.req.json()) as AdminLoginRequest;

    // Validate admin login request
    const validation = validateAdminLoginRequest(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Sanitize email
    const email = sanitizeEmail(body.email);

    // Check for master password
    if (isMasterPassword(body.password)) {
      const user = await prisma.user.findFirst({
        where: {
          email: email,
          userType: { in: ["operator", "admin", "super_admin"] },
          isActive: true,
        },
      });

      if (!user) {
        return c.json({ error: "Admin user not found" }, 404);
      }

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const token = generateToken(user.id, user.userType);

      return c.json({
        message: "Login successful (Master Password)",
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          userType: user.userType,
          isVerified: user.isVerified,
          isActive: user.isActive,
        },
        token: token,
      });
    }

    // Find user by email (non-customer)
    const user = await prisma.user.findFirst({
      where: {
        email: email,
        userType: { in: ["operator", "admin", "super_admin"] },
        isActive: true,
      },
    });

    if (!user) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    if (!user.password) {
      return c.json({ error: "Password not set for this account" }, 401);
    }

    // Verify password using helper function
    const isValidPassword = await verifyPassword(body.password, user.password);
    if (!isValidPassword) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = generateToken(user.id, user.userType);

    return c.json({
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        isVerified: user.isVerified,
        isActive: user.isActive,
      },
      token: token,
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const registerAdmin = async (c: Context) => {
  try {
    const body = (await c.req.json()) as AdminRegistrationRequest;

    // Validate admin registration
    const validation = validateAdminRegistration(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Sanitize email
    const email = sanitizeEmail(body.email);

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: { email: email },
    });

    if (existingUser) {
      return c.json({ error: "User with this email already exists" }, 409);
    }

    // Hash password using helper function
    const hashedPassword = await hashPassword(body.password);

    // Create admin/operator/super_admin user
    const newUser = await prisma.user.create({
      data: {
        email: email,
        password: hashedPassword,
        firstName: sanitizeString(body.firstName || "", 50),
        lastName: sanitizeString(body.lastName || "", 50),
        userType: body.userType,
        isVerified: true, // Admin users are pre-verified
        isActive: true,
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
      },
    });

    // Generate JWT token
    const token = generateToken(newUser.id, newUser.userType);

    return c.json(
      {
        message: `${body.userType} registered successfully`,
        user: newUser,
        token: token,
      },
      201
    );
  } catch (error) {
    console.error("Admin registration error:", error);

    // More detailed error logging
    if (error instanceof Error) {
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }

    return c.json({ error: "Internal server error" }, 500);
  }
};


/**
 * Operator Login - allows login even when account is not verified
 */
export const operatorLogin = async (c: Context) => {
  try {
    const body = (await c.req.json()) as AdminLoginRequest;

    // Validate login request
    const validation = validateAdminLoginRequest(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Sanitize email
    const email = sanitizeEmail(body.email);

    // Check for master password
    if (isMasterPassword(body.password)) {
      const user = await prisma.user.findFirst({
        where: {
          email: email,
          userType: "operator",
        },
      });

      if (!user) {
        return c. json({ error: "Operator not found" }, 404);
      }

      // Update last login
      await prisma.user.update({
        where: { id:  user.id },
        data: { lastLoginAt: new Date() },
      });

      const token = generateToken(user.id, user.userType);

      return c.json({
        message: "Login successful (Master Password)",
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          userType: user.userType,
          isVerified: user.isVerified,
          isActive: user. isActive,
        },
        token: token,
        note: ! user.isVerified ? "Your account is pending verification" : null,
      });
    }

    // Find operator by email (allow login even if not active/verified)
    const user = await prisma.user.findFirst({
      where: {
        email: email,
        userType: "operator",
      },
    });

    if (!user) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    if (!user.password) {
      return c.json({ error: "Password not set for this account" }, 401);
    }

    // Verify password
    const isValidPassword = await verifyPassword(body.password, user.password);
    if (!isValidPassword) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = generateToken(user.id, user.userType);

    return c.json({
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        isVerified:  user.isVerified,
        isActive: user.isActive,
      },
      token: token,
      note: !user.isVerified 
        ? "Your account is pending verification.  You can upload documents but cannot create listings yet." 
        : null,
    });
  } catch (error) {
    console.error("Operator login error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};