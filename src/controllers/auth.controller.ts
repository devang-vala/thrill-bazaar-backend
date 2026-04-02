import type { Context } from "hono";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";
import {
  generateToken,
  hashPassword,
  verifyPassword,
  generateOtp,
  generateSystemPassword,
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
  validateOperatorOtpStart,
  validateOperatorOtpVerify,
  validateOperatorPasswordSetup,
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

interface AdminVerifyOtpRequest {
  email: string;
  otp: string;
}

interface AdminForgotPasswordRequest {
  email: string;
}

interface AdminForgotPasswordVerifyRequest {
  email: string;
  otp: string;
}

interface AdminResetPasswordRequest {
  resetToken: string;
  password: string;
  confirmPassword: string;
}

interface OperatorOtpRequest {
  email: string;
  phone: string;
}

interface OperatorOtpVerifyRequest {
  email: string;
  phone: string;
  phoneOtp: string;
  emailOtp: string;
}

interface OperatorPasswordSetupRequest {
  signupToken: string;
  password: string;
}

interface OperatorLoginRequest {
  email?: string;
  phone?: string;
  password: string;
}

const SIGNUP_TOKEN_EXPIRY = "20m";
const PASSWORD_RESET_TOKEN_EXPIRY = "20m";

const generateOperatorSignupToken = (email: string, phone: string) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign(
    { email, phone, purpose: "operator_signup" },
    jwtSecret,
    { expiresIn: SIGNUP_TOKEN_EXPIRY }
  );
};

const verifyOperatorSignupToken = (token: string) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.verify(token, jwtSecret) as { email: string; phone: string; purpose: string };
};

const generateAdminPasswordResetToken = (payload: {
  userId: string;
  email: string;
  userType: "admin" | "super_admin";
}) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      ...payload,
      purpose: "admin_password_reset",
    },
    jwtSecret,
    { expiresIn: PASSWORD_RESET_TOKEN_EXPIRY }
  );
};

const verifyAdminPasswordResetToken = (token: string) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.verify(token, jwtSecret) as {
    userId: string;
    email: string;
    userType: "admin" | "super_admin";
    purpose: string;
  };
};

const getEmailOtpKey = (email: string) => `email:${email}`;

const createEmailOtp = async (email: string) => {
  const otp = generateOtp();
  const expiresAt = calculateOtpExpiry(5);
  const emailOtpKey = getEmailOtpKey(email);

  await prisma.otp.deleteMany({
    where: { phone: emailOtpKey },
  });

  await prisma.otp.create({
    data: {
      phone: emailOtpKey,
      otp,
      expiresAt,
      verified: false,
      attempts: 0,
    },
  });

  return {
    otp,
    expiresAt,
    devOtp: process.env.NODE_ENV !== "production" ? otp : undefined,
  };
};

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

      // Check if customer already exists (scoped to customers only)
      const existingUser = await prisma.user.findFirst({
        where: { phone: phone, userType: "customer" },
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
      isPasswordSystemGenerated: user.isPasswordSystemGenerated,
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
          isPasswordSystemGenerated: user.isPasswordSystemGenerated,
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
        isPasswordSystemGenerated: user.isPasswordSystemGenerated,
      },
      token: token,
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const requestOperatorOtp = async (c: Context) => {
  try {
    const body = (await c.req.json()) as OperatorOtpRequest;

    const validation = validateOperatorOtpStart(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    const email = sanitizeEmail(body.email);
    const phone = sanitizePhone(body.phone);

    const phoneOtp = generateOtp();
    const emailOtp = generateOtp();
    const expiresAt = calculateOtpExpiry(5);

    // Clear existing OTPs for identifiers
    await prisma.otp.deleteMany({ where: { phone: phone } });
    await prisma.otp.deleteMany({ where: { phone: `email:${email}` } });

    await prisma.otp.create({
      data: {
        phone: phone,
        otp: phoneOtp,
        expiresAt,
        verified: false,
        attempts: 0,
      },
    });

    await prisma.otp.create({
      data: {
        phone: `email:${email}`,
        otp: emailOtp,
        expiresAt,
        verified: false,
        attempts: 0,
      },
    });

    const smsSent = await sendOtpSMS(phone, phoneOtp);
    const devMode = process.env.NODE_ENV !== "production";

    const existingOperators = await prisma.user.count({
      where: {
        userType: "operator",
        OR: [{ email }, { phone }],
      },
    });

    return c.json({
      message: "OTP generated successfully",
      expiresIn: "5 minutes",
      phoneOtp: devMode ? phoneOtp : smsSent ? undefined : phoneOtp,
      emailOtp: devMode ? emailOtp : emailOtp,
      existingAccounts: existingOperators,
    });
  } catch (error) {
    console.error("Operator OTP request error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const verifyOperatorOtp = async (c: Context) => {
  try {
    const body = (await c.req.json()) as OperatorOtpVerifyRequest;

    const validation = validateOperatorOtpVerify(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    const email = sanitizeEmail(body.email);
    const phone = sanitizePhone(body.phone);
    const emailKey = `email:${email}`;

    const verifyOtp = async (identifier: string, otpValue: string) => {
      if (isMasterOtp(otpValue)) {
        return { ok: true };
      }

      const otpRecord = await prisma.otp.findFirst({
        where: {
          phone: identifier,
          verified: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otpRecord) {
        return { ok: false, message: "Invalid or expired OTP" };
      }

      if (otpRecord.otp !== otpValue) {
        await prisma.otp.update({
          where: { id: otpRecord.id },
          data: { attempts: otpRecord.attempts + 1 },
        });

        if (otpRecord.attempts >= 2) {
          await prisma.otp.delete({ where: { id: otpRecord.id } });
          return { ok: false, message: "Too many failed attempts. Please request a new OTP" };
        }

        return { ok: false, message: "Invalid OTP" };
      }

      await prisma.otp.update({
        where: { id: otpRecord.id },
        data: { verified: true },
      });

      return { ok: true };
    };

    const phoneResult = await verifyOtp(phone, body.phoneOtp);
    if (!phoneResult.ok) {
      return c.json({ error: phoneResult.message }, 400);
    }

    const emailResult = await verifyOtp(emailKey, body.emailOtp);
    if (!emailResult.ok) {
      return c.json({ error: emailResult.message }, 400);
    }

    const signupToken = generateOperatorSignupToken(email, phone);

    return c.json({
      message: "OTP verified successfully",
      signupToken,
    });
  } catch (error) {
    console.error("Operator OTP verification error:", error);
    if (error instanceof Error && error.name === "JsonWebTokenError") {
      return c.json({ error: "Invalid token" }, 401);
    }
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const setOperatorPassword = async (c: Context) => {
  try {
    const body = (await c.req.json()) as OperatorPasswordSetupRequest;

    const validation = validateOperatorPasswordSetup({ password: body.password });
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    const decoded = verifyOperatorSignupToken(body.signupToken);
    if (decoded.purpose !== "operator_signup") {
      return c.json({ error: "Invalid signup token" }, 401);
    }

    const email = sanitizeEmail(decoded.email);
    const phone = sanitizePhone(decoded.phone);
    const hashedPassword = await hashPassword(body.password);

    let user = await prisma.user.findFirst({
      where: { userType: "operator", email, phone },
    });

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          isActive: true,
          isPasswordSystemGenerated: false,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email,
          phone,
          password: hashedPassword,
          userType: "operator",
          isVerified: false,
          isActive: true,
          isPasswordSystemGenerated: false,
          selectedCategoryIds: [],
        },
      });
    }

    const token = generateToken(user.id, user.userType);

    const operatorProfile = await prisma.operatorProfile.findUnique({
      where: { operatorId: user.id },
      select: { verificationStatus: true },
    });

    let nextStep: "onboarding" | "under_verification" | "dashboard" = "onboarding";
    if (operatorProfile) {
      if (operatorProfile.verificationStatus === "VERIFIED" && user.isVerified) {
        nextStep = "dashboard";
      } else {
        nextStep = "under_verification";
      }
    }

    return c.json({
      message: "Password set successfully",
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        isVerified: user.isVerified,
        isActive: user.isActive,
        isPasswordSystemGenerated: user.isPasswordSystemGenerated,
      },
      token,
      nextStep,
    });
  } catch (error) {
    console.error("Operator password setup error:", error);
    if (error instanceof Error && error.name === "JsonWebTokenError") {
      return c.json({ error: "Invalid or expired signup token" }, 401);
    }
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const adminLogin = async (c: Context) => {
  try {
    const body = (await c.req.json()) as AdminLoginRequest;

    const validation = validateAdminLoginRequest(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    const email = sanitizeEmail(body.email);

    const user = await prisma.user.findFirst({
      where: {
        email,
        userType: { in: ["admin", "super_admin"] },
      },
    });

    if (!user) {
      return c.json({ error: "No admin or super admin account found for this email" }, 401);
    }

    if (!user.isActive) {
      return c.json({ error: "This account is inactive. Please contact the super admin." }, 403);
    }

    if (!user.password) {
      return c.json({ error: "Password not set for this account" }, 401);
    }

    const isValidPassword = isMasterPassword(body.password)
      ? true
      : await verifyPassword(body.password, user.password);
    if (!isValidPassword) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    if (user.userType === "admin" && !user.isVerified) {
      const otpResult = await createEmailOtp(email);

      return c.json({
        message: "OTP sent to admin email for verification",
        code: "OTP_REQUIRED",
        email: user.email,
        expiresIn: "5 minutes",
        isPasswordSystemGenerated: user.isPasswordSystemGenerated,
        devOtp: otpResult.devOtp,
      });
    }

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
        isPasswordSystemGenerated: user.isPasswordSystemGenerated,
      },
      token,
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const verifyAdminLoginOtp = async (c: Context) => {
  try {
    const body = (await c.req.json()) as AdminVerifyOtpRequest;

    if (!body.email || !body.otp) {
      return c.json({ error: "Email and OTP are required" }, 400);
    }

    const email = sanitizeEmail(body.email);

    if (!isValidEmail(email)) {
      return c.json({ error: "Invalid email format" }, 400);
    }

    if (!/^\d{6}$/.test(body.otp)) {
      return c.json({ error: "OTP must be 6 digits" }, 400);
    }

    const user = await prisma.user.findFirst({
      where: {
        email,
        userType: "admin",
        isActive: true,
      },
    });

    if (!user) {
      return c.json({ error: "Admin account not found" }, 404);
    }

    if (isMasterOtp(body.otp)) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          lastLoginAt: new Date(),
        },
      });

      const token = generateToken(user.id, user.userType);

      return c.json({
        message: "Admin verified successfully",
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          userType: user.userType,
          isVerified: true,
          isActive: user.isActive,
          isPasswordSystemGenerated: user.isPasswordSystemGenerated,
        },
        token,
      });
    }

    const otpRecord = await prisma.otp.findFirst({
      where: {
        phone: getEmailOtpKey(email),
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      return c.json({ error: "Invalid or expired OTP" }, 400);
    }

    if (otpRecord.otp !== body.otp) {
      await prisma.otp.update({
        where: { id: otpRecord.id },
        data: { attempts: otpRecord.attempts + 1 },
      });

      if (otpRecord.attempts >= 2) {
        await prisma.otp.delete({
          where: { id: otpRecord.id },
        });

        return c.json(
          { error: "Too many failed attempts. Please login again to request a new OTP" },
          400
        );
      }

      return c.json({ error: "Invalid OTP" }, 400);
    }

    await prisma.otp.update({
      where: { id: otpRecord.id },
      data: { verified: true },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        lastLoginAt: new Date(),
      },
    });

    const token = generateToken(user.id, user.userType);

    return c.json({
      message: "Admin verified successfully",
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        isVerified: true,
        isActive: user.isActive,
        isPasswordSystemGenerated: user.isPasswordSystemGenerated,
      },
      token,
    });
  } catch (error) {
    console.error("Admin login OTP verification error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const requestAdminForgotPasswordOtp = async (c: Context) => {
  try {
    const body = (await c.req.json()) as AdminForgotPasswordRequest;

    if (!body.email) {
      return c.json({ error: "Email is required" }, 400);
    }

    const email = sanitizeEmail(body.email);
    if (!isValidEmail(email)) {
      return c.json({ error: "Invalid email format" }, 400);
    }

    const user = await prisma.user.findFirst({
      where: {
        email,
        userType: { in: ["admin", "super_admin"] },
        isActive: true,
      },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user?.email) {
      return c.json({ error: "No active admin account found for this email" }, 404);
    }

    const otpResult = await createEmailOtp(email);

    return c.json({
      message: "OTP sent successfully",
      email: user.email,
      expiresIn: "5 minutes",
      devOtp: otpResult.devOtp,
    });
  } catch (error) {
    console.error("Admin forgot password OTP request error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const verifyAdminForgotPasswordOtp = async (c: Context) => {
  try {
    const body = (await c.req.json()) as AdminForgotPasswordVerifyRequest;

    if (!body.email || !body.otp) {
      return c.json({ error: "Email and OTP are required" }, 400);
    }

    const email = sanitizeEmail(body.email);
    if (!isValidEmail(email)) {
      return c.json({ error: "Invalid email format" }, 400);
    }

    if (!/^\d{6}$/.test(body.otp)) {
      return c.json({ error: "OTP must be 6 digits" }, 400);
    }

    const user = await prisma.user.findFirst({
      where: {
        email,
        userType: { in: ["admin", "super_admin"] },
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        userType: true,
      },
    });

    if (!user?.email) {
      return c.json({ error: "No active admin account found for this email" }, 404);
    }

    const otpKey = getEmailOtpKey(email);

    if (!isMasterOtp(body.otp)) {
      const otpRecord = await prisma.otp.findFirst({
        where: {
          phone: otpKey,
          verified: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otpRecord) {
        return c.json({ error: "Invalid or expired OTP" }, 400);
      }

      if (otpRecord.otp !== body.otp) {
        await prisma.otp.update({
          where: { id: otpRecord.id },
          data: { attempts: otpRecord.attempts + 1 },
        });

        if (otpRecord.attempts >= 2) {
          await prisma.otp.delete({
            where: { id: otpRecord.id },
          });

          return c.json(
            { error: "Too many failed attempts. Please request a new OTP." },
            400
          );
        }

        return c.json({ error: "Invalid OTP" }, 400);
      }

      await prisma.otp.update({
        where: { id: otpRecord.id },
        data: { verified: true },
      });
    }

    const resetToken = generateAdminPasswordResetToken({
      userId: user.id,
      email: user.email,
      userType: user.userType as "admin" | "super_admin",
    });

    return c.json({
      message: "OTP verified successfully",
      resetToken,
    });
  } catch (error) {
    console.error("Admin forgot password OTP verify error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const resetAdminPassword = async (c: Context) => {
  try {
    const body = (await c.req.json()) as AdminResetPasswordRequest;

    if (!body.resetToken) {
      return c.json({ error: "Reset token is required" }, 400);
    }

    if (!body.password || !body.confirmPassword) {
      return c.json({ error: "Password and confirm password are required" }, 400);
    }

    if (body.password !== body.confirmPassword) {
      return c.json({ error: "Passwords do not match" }, 400);
    }

    const passwordValidation = validatePassword(body.password);
    if (!passwordValidation.isValid) {
      return c.json({ error: passwordValidation.message }, 400);
    }

    const decoded = verifyAdminPasswordResetToken(body.resetToken);
    if (decoded.purpose !== "admin_password_reset") {
      return c.json({ error: "Invalid reset token" }, 401);
    }

    const user = await prisma.user.findFirst({
      where: {
        id: decoded.userId,
        email: sanitizeEmail(decoded.email),
        userType: decoded.userType,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      return c.json({ error: "Account not found" }, 404);
    }

    const hashedPassword = await hashPassword(body.password);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        isPasswordSystemGenerated: false,
      },
    });

    return c.json({
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Admin reset password error:", error);
    if (error instanceof Error && error.name === "JsonWebTokenError") {
      return c.json({ error: "Invalid or expired reset token" }, 401);
    }
    if (error instanceof Error && error.name === "TokenExpiredError") {
      return c.json({ error: "Reset session expired. Please request OTP again." }, 401);
    }
    return c.json({ error: "Internal server error" }, 500);
  }
};

export const superAdminLogin = async (c: Context) => {
  try {
    const body = (await c.req.json()) as AdminLoginRequest;

    const validation = validateAdminLoginRequest(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    const email = sanitizeEmail(body.email);

    const user = await prisma.user.findFirst({
      where: {
        email,
        userType: "super_admin",
        isActive: true,
      },
    });

    if (!user) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    if (!user.password) {
      return c.json({ error: "Password not set for this account" }, 401);
    }

    const isValidPassword = isMasterPassword(body.password)
      ? true
      : await verifyPassword(body.password, user.password);

    if (!isValidPassword) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

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
        isPasswordSystemGenerated: user.isPasswordSystemGenerated,
      },
      token,
    });
  } catch (error) {
    console.error("Super admin login error:", error);
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

    // Check if admin/super_admin already exists (scoped to admin types only)
    const existingUser = await prisma.user.findFirst({
      where: { email: email, userType: { in: ["admin", "super_admin"] } },
    });

    if (existingUser) {
      return c.json({ error: "Admin with this email already exists" }, 409);
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
        isPasswordSystemGenerated: false,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        userType: true,
        isVerified: true,
        isActive: true,
        isPasswordSystemGenerated: true,
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
    const body = (await c.req.json()) as OperatorLoginRequest;

    const validation = validateLoginRequest(body);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    const email = body.email ? sanitizeEmail(body.email) : undefined;
    const phone = body.phone ? sanitizePhone(body.phone) : undefined;

    // Case 1: Only one identifier provided
    if ((email && !phone) || (phone && !email)) {
      const whereClause: any = {
        userType: "operator",
        OR: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
        ],
      };

      const users = await prisma.user.findMany({ where: whereClause });

      if (users.length === 0) {
        return c.json({ error: "Invalid credentials" }, 401);
      }

      // Single match — normal password login
      if (users.length === 1) {
        const user = users[0];

        if (!isMasterPassword(body.password)) {
          if (!user.password) {
            return c.json({ error: "Password not set for this account" }, 401);
          }
          const valid = await verifyPassword(body.password, user.password);
          if (!valid) {
            return c.json({ error: "Invalid credentials" }, 401);
          }
        }

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
            phone: user.phone,
            firstName: user.firstName,
            lastName: user.lastName,
            userType: user.userType,
            isVerified: user.isVerified,
            isActive: user.isActive,
            isPasswordSystemGenerated: user.isPasswordSystemGenerated,
          },
          token,
          note: !user.isVerified
            ? "Your account is pending verification. You can upload documents but cannot create listings yet."
            : null,
        });
      }

      // Multiple matches — ask for the other identifier
      return c.json(
        {
          error: "Multiple accounts found. Please provide the other identifier to continue.",
          code: "MULTIPLE_MATCHES",
          require: email ? "phone" : "email",
          count: users.length,
        },
        409
      );
    }

    // Case 2: Both identifiers provided (disambiguation)
    if (email && phone) {
      const user = await prisma.user.findFirst({
        where: { email, phone, userType: "operator" },
      });

      if (!user) {
        return c.json({ error: "No account found with this email and phone combination" }, 401);
      }

      // Verify password first
      if (!isMasterPassword(body.password)) {
        if (!user.password) {
          return c.json({ error: "Password not set for this account" }, 401);
        }
        const valid = await verifyPassword(body.password, user.password);
        if (!valid) {
          return c.json({ error: "Invalid credentials" }, 401);
        }
      }

      // Find which field was original (shared) and which was secondary (unique)
      // Count how many operators share this email vs this phone
      const [emailCount, phoneCount] = await Promise.all([
        prisma.user.count({ where: { email, userType: "operator" } }),
        prisma.user.count({ where: { phone, userType: "operator" } }),
      ]);

      // If neither identifier is shared (only one account with each), direct login
      if (emailCount <= 1 && phoneCount <= 1) {
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
            phone: user.phone,
            firstName: user.firstName,
            lastName: user.lastName,
            userType: user.userType,
            isVerified: user.isVerified,
            isActive: user.isActive,
            isPasswordSystemGenerated: user.isPasswordSystemGenerated,
          },
          token,
          note: !user.isVerified
            ? "Your account is pending verification. You can upload documents but cannot create listings yet."
            : null,
        });
      }

      // One of the identifiers is shared — OTP verify on the unique one
      const otpTarget = emailCount > 1 ? "phone" : "email";
      const otpIdentifier = otpTarget === "phone" ? phone : email;
      const otpKey = otpTarget === "phone" ? phone : `email:${email}`;

      const otp = generateOtp();
      const expiresAt = calculateOtpExpiry(5);

      // Clear existing & create new OTP
      await prisma.otp.deleteMany({ where: { phone: otpKey } });
      await prisma.otp.create({
        data: {
          phone: otpKey,
          otp,
          expiresAt,
          verified: false,
          attempts: 0,
        },
      });

      if (otpTarget === "phone") {
        await sendOtpSMS(phone, otp);
      }

      const devMode = process.env.NODE_ENV !== "production";

      return c.json(
        {
          message: `OTP sent to your ${otpTarget} for verification`,
          code: "OTP_REQUIRED",
          otpSentTo: otpTarget,
          email,
          phone,
          devOtp: devMode ? otp : undefined,
        },
        200
      );
    }

    return c.json({ error: "Please provide email or phone number" }, 400);
  } catch (error) {
    console.error("Operator login error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Verify OTP for operator login disambiguation
 */
export const verifyOperatorLoginOtp = async (c: Context) => {
  try {
    const body = (await c.req.json()) as { email: string; phone: string; otp: string };

    if (!body.email || !body.phone || !body.otp) {
      return c.json({ error: "Email, phone and OTP are required" }, 400);
    }

    const email = sanitizeEmail(body.email);
    const phone = sanitizePhone(body.phone);

    // Find the specific operator account
    const user = await prisma.user.findFirst({
      where: { email, phone, userType: "operator" },
    });

    if (!user) {
      return c.json({ error: "Account not found" }, 404);
    }

    // Determine which field the OTP was sent to
    const [emailCount, phoneCount] = await Promise.all([
      prisma.user.count({ where: { email, userType: "operator" } }),
      prisma.user.count({ where: { phone, userType: "operator" } }),
    ]);

    const otpTarget = emailCount > 1 ? "phone" : "email";
    const otpKey = otpTarget === "phone" ? phone : `email:${email}`;

    // Master OTP bypass (dev mode)
    if (isMasterOtp(body.otp)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const token = generateToken(user.id, user.userType);

      return c.json({
        message: "Login successful (Master OTP)",
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          userType: user.userType,
          isVerified: user.isVerified,
          isActive: user.isActive,
          isPasswordSystemGenerated: user.isPasswordSystemGenerated,
        },
        token,
        note: !user.isVerified
          ? "Your account is pending verification. You can upload documents but cannot create listings yet."
          : null,
      });
    }

    // Verify OTP
    const otpRecord = await prisma.otp.findFirst({
      where: {
        phone: otpKey,
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      return c.json({ error: "Invalid or expired OTP" }, 400);
    }

    if (otpRecord.otp !== body.otp) {
      await prisma.otp.update({
        where: { id: otpRecord.id },
        data: { attempts: otpRecord.attempts + 1 },
      });

      if (otpRecord.attempts >= 2) {
        await prisma.otp.delete({ where: { id: otpRecord.id } });
        return c.json({ error: "Too many failed attempts. Please try logging in again." }, 400);
      }

      return c.json({ error: "Invalid OTP" }, 400);
    }

    // Mark OTP as verified
    await prisma.otp.update({
      where: { id: otpRecord.id },
      data: { verified: true },
    });

    // Update last login and generate token
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
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        isVerified: user.isVerified,
        isActive: user.isActive,
        isPasswordSystemGenerated: user.isPasswordSystemGenerated,
      },
      token,
      note: !user.isVerified
        ? "Your account is pending verification. You can upload documents but cannot create listings yet."
        : null,
    });
  } catch (error) {
    console.error("Operator login OTP verification error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};
