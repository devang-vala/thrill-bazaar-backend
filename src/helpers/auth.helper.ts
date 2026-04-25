import crypto from "crypto";
import { promisify } from "util";
import jwt from "jsonwebtoken";
import { isMailConfigured } from "../services/mail.service.js";

// Types for authentication helper functions
export interface JWTPayload {
  userId: string;
  userType: string;
  role: string;
  iat: number;
}

export interface MSG91Config {
  authKey: string;
  templateId: string;
  senderId: string;
}

const getMsg91Config = (): MSG91Config | null => {
  const authKey = process.env.MSG91_AUTH_KEY?.trim();
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID?.trim();
  const senderId = process.env.MSG91_SENDER_ID?.trim() || "MSGIND";

  if (!authKey || !templateId || authKey.startsWith("your_") || templateId.startsWith("your_")) {
    return null;
  }

  return { authKey, templateId, senderId };
};

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

export const sendOtpSMS = async (
  phone: string,
  otp: string
): Promise<boolean> => {
  try {
    // If dev mode is explicitly enabled (or we are in non-production and it's not explicitly disabled),
    // we bypass MSG91 to save credits and allow the frontend to print the OTP.
    if (isOtpDevModeEnabled()) {
      console.log(`[OTP Bypass] Dev Mode active. MSG91 skipped for ${phone}. OTP generated: ${otp}`);
      return false; 
    }

    const config = getMsg91Config();
    
    if (!config) {
      console.warn("MSG91 credentials not configured, skipping SMS. Check your .env file details.");
      return false;
    }

    // MSG91 strictly requires the country code without plus sign (e.g., 919999999999)
    let formattedPhone = phone.replace(/\D/g, "");
    if (formattedPhone.length === 10) {
      formattedPhone = `91${formattedPhone}`;
    }

    const payload = {
      template_id: config.templateId,
      sender: config.senderId,
      short_url: "0", // disable short url checking
      mobiles: formattedPhone, // Flow API uses "mobiles" instead of "mobile"
      otp: otp, // Variable to fill in the template
    };

    const response = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        "authkey": config.authKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("MSG91 API error for phone", formattedPhone, "Status:", response.status, "Response:", errorText);
      return false;
    }

    const responseData = await response.json();
    if (responseData.type === "error") {
      console.error("MSG91 returned an error payload:", responseData);
      return false;
    }

    console.log(`MSG91 OTP SMS initiated successfully to ${formattedPhone}`);
    return true;
  } catch (error) {
    console.error("Failed to send MSG91 OTP SMS:", error);
    return false;
  }
};

export const isMasterOtp = (otp: string): boolean => {
  return otp === process.env.MASTER_OTP && !!process.env.MASTER_OTP;
};

export const isMasterPassword = (password: string): boolean => {
  return (
    password === process.env.MASTER_PASSWORD && !!process.env.MASTER_PASSWORD
  );
};

const isTruthyEnv = (value?: string): boolean => {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

export const isOtpDevModeEnabled = (): boolean => {
  // Respect explicit "false" even in development environment
  if (process.env.OTP_DEV_MODE === "false" || process.env.OTP_DEV_MODE === "0") {
    return false;
  }

  return (
    process.env.NODE_ENV !== "production" ||
    isTruthyEnv(process.env.OTP_DEV_MODE) ||
    isTruthyEnv(process.env.EXPOSE_DEV_OTP)
  );
};

export const shouldExposeOtpValue = (
  channel: "phone" | "email",
  delivered?: boolean
): boolean => {
  if (isOtpDevModeEnabled()) {
    return true;
  }

  if (channel === "email") {
    return false;
  }

  // If SMS delivery is unavailable, match the customer flow by exposing the OTP.
  return delivered === false;
};

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isValidPhone = (phone: string): boolean => {
  const raw = (phone || "").toString().trim();
  if (!raw) return false;

  // Normalize to digits only and validate length. This is resilient to
  // +91, spaces, dashes, brackets and similar user input formats.
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
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

export const isMsg91Configured = (): boolean => {
  return getMsg91Config() !== null;
};

export const isEmailOtpConfigured = (): boolean => {
  return isMailConfigured();
};

export const generateSecureRandom = (length: number = 32): string => {
  return crypto.randomBytes(length).toString("hex");
};

export const generateSystemPassword = (): string => {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "!@#$%^&*";
  const allCharacters = `${uppercase}${lowercase}${numbers}${symbols}`;

  const pick = (characters: string) => {
    const index = crypto.randomInt(0, characters.length);
    return characters[index];
  };

  const chars = [
    pick(uppercase),
    pick(lowercase),
    pick(numbers),
    pick(symbols),
  ];

  for (let index = chars.length; index < 12; index += 1) {
    chars.push(pick(allCharacters));
  }

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(0, index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }

  return chars.join("");
};

export const calculateOtpExpiry = (minutes: number = 5): Date => {
  return new Date(Date.now() + minutes * 60 * 1000);
};
