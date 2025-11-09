import crypto from "crypto";
import { promisify } from "util";
import jwt from "jsonwebtoken";
import twilio from "twilio";

// Types for authentication helper functions
export interface JWTPayload {
  userId: string;
  userType: string;
  role: string;
  iat: number;
}

export interface SMSConfig {
  accountSid?: string;
  authToken?: string;
  phoneNumber?: string;
}

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export const generateToken = (userId: string, userType: string): string => {
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

export const verifyToken = (token: string): JWTPayload => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.verify(token, jwtSecret) as JWTPayload;
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.randomBytes(16).toString("hex");
  const scrypt = promisify(crypto.scrypt);
  const derivedKey = (await scrypt(password, salt, 32)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
};

export const verifyPassword = async (
  password: string,
  storedHash: string
): Promise<boolean> => {
  try {
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) {
      throw new Error("Invalid hash format");
    }

    const scrypt = promisify(crypto.scrypt);
    const derivedKey = (await scrypt(password, salt, 32)) as Buffer;
    const hashedPassword = derivedKey.toString("hex");

    return hashedPassword === hash;
  } catch (error) {
    console.error("Password verification error:", error);
    return false;
  }
};

export const generateOtp = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const sendSMS = async (
  phone: string,
  message: string
): Promise<boolean> => {
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

    console.log(`SMS sent successfully to ${phone}`);
    return true;
  } catch (error) {
    console.error("Failed to send SMS:", error);
    return false;
  }
};

export const sendOtpSMS = async (
  phone: string,
  otp: string
): Promise<boolean> => {
  const message = `Your Thrill Bazaar OTP is: ${otp}. Valid for 5 minutes. Do not share this code.`;
  return sendSMS(phone, message);
};

export const isMasterOtp = (otp: string): boolean => {
  return otp === process.env.MASTER_OTP && !!process.env.MASTER_OTP;
};

export const isMasterPassword = (password: string): boolean => {
  return (
    password === process.env.MASTER_PASSWORD && !!process.env.MASTER_PASSWORD
  );
};

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isValidPhone = (phone: string): boolean => {
  // Basic phone validation - at least 10 digits
  const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
  return phoneRegex.test(phone);
};

export const validatePassword = (
  password: string
): {
  isValid: boolean;
  message?: string;
} => {
  if (!password) {
    return { isValid: false, message: "Password is required" };
  }

  if (password.length < 6) {
    return {
      isValid: false,
      message: "Password must be at least 6 characters long",
    };
  }

  if (password.length > 128) {
    return {
      isValid: false,
      message: "Password must be less than 128 characters",
    };
  }

  // Optional: Add more complex password rules
  // const hasUpperCase = /[A-Z]/.test(password);
  // const hasLowerCase = /[a-z]/.test(password);
  // const hasNumbers = /\d/.test(password);
  // const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  return { isValid: true };
};

export const isValidUserType = (userType: string): boolean => {
  const validTypes = ["customer", "operator", "admin", "super_admin"];
  return validTypes.includes(userType);
};

export const isValidAdminType = (userType: string): boolean => {
  const validAdminTypes = ["operator", "admin", "super_admin"];
  return validAdminTypes.includes(userType);
};

export const formatUserResponse = (user: any) => {
  const { password, ...userWithoutPassword } = user;
  return userWithoutPassword;
};

export const isTwilioConfigured = (): boolean => {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
};

export const generateSecureRandom = (length: number = 32): string => {
  return crypto.randomBytes(length).toString("hex");
};

export const calculateOtpExpiry = (minutes: number = 5): Date => {
  return new Date(Date.now() + minutes * 60 * 1000);
};
