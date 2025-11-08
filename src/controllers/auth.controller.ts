import type { Context } from "hono";
import { prisma } from "../db.js";
import crypto from "crypto";
import { promisify } from "util";
import jwt from "jsonwebtoken";
import twilio from "twilio";

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

// Helper function to generate JWT token
const generateToken = (userId: string, userType: string) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      userId,
      userType,
      role: userType, // Explicitly include role for clarity
      iat: Math.floor(Date.now() / 1000),
    },
    jwtSecret,
    { expiresIn: "7d" } // Token expires in 7 days
  );
};

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Helper function to send SMS via Twilio
const sendSMS = async (phone: string, message: string): Promise<boolean> => {
  try {
    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN ||
      !process.env.TWILIO_PHONE_NUMBER
    ) {
      console.warn("Twilio credentials not configured, skipping SMS");
      return false;
    }

    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });

    return true;
  } catch (error) {
    console.error("Failed to send SMS:", error);
    return false;
  }
};

// Helper function to generate 6-digit OTP
const generateOtp = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Helper function to check if OTP is master OTP
const isMasterOtp = (otp: string): boolean => {
  return otp === process.env.MASTER_OTP;
};

// Helper function to check if password is master password
const isMasterPassword = (password: string): boolean => {
  return password === process.env.MASTER_PASSWORD;
};

export const registerUser = async (c: Context) => {
  try {
    const body = (await c.req.json()) as RegisterUserRequest;
    const userType = body.userType || "customer";

    // Customer registration - only needs phone, no password
    if (userType === "customer") {
      if (!body.phone) {
        return c.json(
          { error: "Phone number is required for customer registration" },
          400
        );
      }

      // Check if customer already exists
      const existingUser = await prisma.user.findFirst({
        where: { phone: body.phone },
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
          phone: body.phone,
          firstName: body.firstName || null,
          lastName: body.lastName || null,
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

    // Admin/Operator registration - needs email and password
    if (!body.email || !body.password) {
      return c.json(
        {
          error:
            "Email and password are required for admin/operator registration",
        },
        400
      );
    }

    if (body.password.length < 6) {
      return c.json(
        { error: "Password must be at least 6 characters long" },
        400
      );
    }

    // Check if admin user already exists
    const existingUser = await prisma.user.findFirst({
      where: { email: body.email },
    });

    if (existingUser) {
      return c.json({ error: "User with this email already exists" }, 409);
    }

    // Hash password using Node.js crypto
    const salt = crypto.randomBytes(16).toString("hex");
    const scrypt = promisify(crypto.scrypt);
    const derivedKey = (await scrypt(body.password, salt, 32)) as Buffer;
    const hashedPassword = `${salt}:${derivedKey.toString("hex")}`;

    // Create admin/operator user
    const newUser = await prisma.user.create({
      data: {
        email: body.email,
        password: hashedPassword,
        firstName: body.firstName || null,
        lastName: body.lastName || null,
        userType: userType,
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
        message: "User registered successfully",
        user: newUser,
        token: token,
      },
      201
    );
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

    // Validation
    if (!body.password) {
      return c.json({ error: "Password is required" }, 400);
    }

    if (!body.email && !body.phone) {
      return c.json({ error: "Either email or phone is required" }, 400);
    }

    // Find user by email or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          body.email ? { email: body.email } : {},
          body.phone ? { phone: body.phone } : {},
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

    // Verify password
    const [salt, storedHash] = user.password.split(":");
    const scrypt = promisify(crypto.scrypt);
    const derivedKey = (await scrypt(body.password, salt, 32)) as Buffer;
    const hashedPassword = derivedKey.toString("hex");

    if (hashedPassword !== storedHash) {
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
// Customer Login - Send OTP to phone
export const customerLogin = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CustomerLoginRequest;

    if (!body.phone) {
      return c.json({ error: "Phone number is required" }, 400);
    }

    // Check if user exists and is a customer
    const user = await prisma.user.findFirst({
      where: {
        phone: body.phone,
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
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

    // Delete any existing OTPs for this phone
    await prisma.otp.deleteMany({
      where: { phone: body.phone },
    });

    // Create new OTP record
    await prisma.otp.create({
      data: {
        phone: body.phone,
        otp: otp,
        expiresAt: expiresAt,
        verified: false,
        attempts: 0,
      },
    });

    // Send OTP via Twilio SMS
    const smsMessage = `Your Thrill Bazaar OTP is: ${otp}. Valid for 5 minutes. Do not share this code.`;
    const smsSent = await sendSMS(body.phone, smsMessage);

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

// Customer Verify OTP
export const customerVerifyOtp = async (c: Context) => {
  try {
    const body = (await c.req.json()) as CustomerVerifyOtpRequest;

    if (!body.phone || !body.otp) {
      return c.json({ error: "Phone number and OTP are required" }, 400);
    }

    // Check for master OTP
    if (isMasterOtp(body.otp)) {
      const user = await prisma.user.findFirst({
        where: {
          phone: body.phone,
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
        phone: body.phone,
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
        phone: body.phone,
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

// Admin/Operator/Super Admin Login - Email + Password
export const adminLogin = async (c: Context) => {
  try {
    const body = (await c.req.json()) as AdminLoginRequest;

    if (!body.email || !body.password) {
      return c.json({ error: "Email and password are required" }, 400);
    }

    // Check for master password
    if (isMasterPassword(body.password)) {
      const user = await prisma.user.findFirst({
        where: {
          email: body.email,
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
        email: body.email,
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

    // Verify password
    const [salt, storedHash] = user.password.split(":");
    const scrypt = promisify(crypto.scrypt);
    const derivedKey = (await scrypt(body.password, salt, 32)) as Buffer;
    const hashedPassword = derivedKey.toString("hex");

    if (hashedPassword !== storedHash) {
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

// Admin/Operator/Super Admin Registration
export const registerAdmin = async (c: Context) => {
  try {
    const body = (await c.req.json()) as AdminRegistrationRequest;

    // Validate required fields
    if (!body.email || !body.password) {
      return c.json(
        {
          error:
            "Email and password are required for admin/operator registration",
        },
        400
      );
    }

    if (
      !body.userType ||
      !["operator", "admin", "super_admin"].includes(body.userType)
    ) {
      return c.json(
        {
          error: "Valid userType is required (operator, admin, or super_admin)",
        },
        400
      );
    }

    if (body.password.length < 6) {
      return c.json(
        {
          error: "Password must be at least 6 characters long",
        },
        400
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: { email: body.email },
    });

    if (existingUser) {
      return c.json({ error: "User with this email already exists" }, 409);
    }

    // Hash password using Node.js crypto
    const salt = crypto.randomBytes(16).toString("hex");
    const scrypt = promisify(crypto.scrypt);
    const derivedKey = (await scrypt(body.password, salt, 32)) as Buffer;
    const hashedPassword = `${salt}:${derivedKey.toString("hex")}`;

    // Create admin/operator/super_admin user
    const newUser = await prisma.user.create({
      data: {
        email: body.email,
        password: hashedPassword,
        firstName: body.firstName || null,
        lastName: body.lastName || null,
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
