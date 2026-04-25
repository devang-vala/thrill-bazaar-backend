import nodemailer, { type Transporter } from "nodemailer";

export type EmailOtpPurpose =
  | "admin_login"
  | "admin_forgot_password"
  | "operator_signup"
  | "operator_login"
  | "operator_forgot_password";

interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromAddress: string;
  fromName: string;
  replyTo?: string;
}

interface SendOtpEmailParams {
  to: string;
  otp: string;
  purpose: EmailOtpPurpose;
  expiresInMinutes?: number;
}

interface SendAccountCreatedEmailParams {
  to: string;
  userType: "admin" | "super_admin" | "operator";
  password: string;
  firstName?: string;
}

let transporter: Transporter | null = null;

const maskEmail = (email: string) => {
  const [name = "", domain = ""] = email.split("@");
  if (!domain) {
    return email;
  }

  const visibleName = name.length <= 2 ? name[0] || "*" : `${name.slice(0, 2)}***`;
  return `${visibleName}@${domain}`;
};

const isPlaceholder = (value?: string) => {
  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("your_") || normalized.includes("example.com");
};

const isTruthyEnv = (value?: string) => {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

const getMailConfig = (): MailConfig | null => {
  console.log("[Mail] 📋 Step 1: Reading SMTP configuration from environment...");
  
  const host = process.env.SMTP_HOST?.trim() || "";
  const portValue = process.env.SMTP_PORT?.trim() || "587";
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS?.trim() || "";
  const fromAddress = process.env.MAIL_FROM_ADDRESS?.trim() || "";
  const fromName = process.env.MAIL_FROM_NAME?.trim() || "Thrill Bazaar";
  const replyTo = process.env.MAIL_REPLY_TO?.trim();

  console.log("[Mail] 📋 Step 2: Checking for missing or placeholder fields...", {
    hostPresent: Boolean(host),
    userPresent: Boolean(user),
    passPresent: Boolean(pass),
    fromAddressPresent: Boolean(fromAddress),
  });

  const missingOrPlaceholderFields = [
    ["SMTP_HOST", host],
    ["SMTP_USER", user],
    ["SMTP_PASS", pass],
    ["MAIL_FROM_ADDRESS", fromAddress],
  ]
    .filter(([, value]) => isPlaceholder(value))
    .map(([key]) => key);

  if (missingOrPlaceholderFields.length > 0) {
    console.error("[Mail] ❌ SMTP configuration INCOMPLETE - Email sending DISABLED", {
      missingOrPlaceholderFields,
      smtpHostSet: Boolean(host),
      smtpUserSet: Boolean(user),
      smtpPassSet: Boolean(pass),
      mailFromAddressSet: Boolean(fromAddress),
    });
    return null;
  }

  console.log("[Mail] ✅ All required fields present. Validating port...");
  const port = Number(portValue);
  if (!Number.isFinite(port) || port <= 0) {
    console.error("[Mail] ❌ Invalid SMTP_PORT - Email sending DISABLED", {
      smtpPort: portValue,
      parsedPort: port,
    });
    return null;
  }

  const secureEnv = process.env.SMTP_SECURE?.trim();
  const secure =
    secureEnv === undefined || secureEnv === ""
      ? port === 465
      : isTruthyEnv(secureEnv);

  const config = {
    host,
    port,
    secure,
    user,
    pass,
    fromAddress,
    fromName,
    replyTo: replyTo || undefined,
  };

  console.log("[Mail] ✅ SMTP configuration VALID and ready to use", {
    host: config.host,
    port: config.port,
    secure: config.secure,
    fromName: config.fromName,
    hasFromAddress: Boolean(config.fromAddress),
    hasReplyTo: Boolean(config.replyTo),
  });

  return config;
};

const getTransporter = (config: MailConfig) => {
  if (!transporter) {
    console.info("[Mail] Creating SMTP transporter.", {
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: maskEmail(config.user),
      fromAddress: maskEmail(config.fromAddress),
      replyTo: config.replyTo ? maskEmail(config.replyTo) : undefined,
    });

    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
  }

  return transporter;
};

const getPurposeText = (purpose: EmailOtpPurpose) => {
  switch (purpose) {
    case "admin_login":
      return {
        subject: "Thrill Bazaar admin login OTP",
        action: "complete your admin login",
      };
    case "admin_forgot_password":
      return {
        subject: "Thrill Bazaar admin password reset OTP",
        action: "reset your admin password",
      };
    case "operator_signup":
      return {
        subject: "Thrill Bazaar operator signup OTP",
        action: "verify your operator signup",
      };
    case "operator_login":
      return {
        subject: "Thrill Bazaar operator login OTP",
        action: "complete your operator login",
      };
    case "operator_forgot_password":
      return {
        subject: "Thrill Bazaar operator password reset OTP",
        action: "reset your operator password",
      };
  }
};

export const isMailConfigured = () => getMailConfig() !== null;

export const sendOtpEmail = async ({
  to,
  otp,
  purpose,
  expiresInMinutes = 5,
}: SendOtpEmailParams): Promise<boolean> => {
  try {
    console.info("[Mail] Preparing OTP email.", {
      to: maskEmail(to),
      purpose,
      expiresInMinutes,
    });

    const config = getMailConfig();
    if (!config) {
      console.warn("[Mail] Skipping OTP email because SMTP is not configured.", {
        to: maskEmail(to),
        purpose,
      });
      return false;
    }

    const { subject, action } = getPurposeText(purpose);
    const transport = getTransporter(config);

    console.info("[Mail] Sending OTP email through SMTP.", {
      to: maskEmail(to),
      purpose,
      subject,
      host: config.host,
      port: config.port,
      secure: config.secure,
    });

    const info = await transport.sendMail({
      from: {
        name: config.fromName,
        address: config.fromAddress,
      },
      to,
      replyTo: config.replyTo,
      subject,
      text: [
        `Your Thrill Bazaar OTP is ${otp}.`,
        `Use this code to ${action}.`,
        `This OTP will expire in ${expiresInMinutes} minutes.`,
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
      html: `
        <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
          <p>Your Thrill Bazaar OTP is:</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 16px 0;">${otp}</p>
          <p>Use this code to ${action}.</p>
          <p>This OTP will expire in ${expiresInMinutes} minutes.</p>
          <p>If you did not request this, you can ignore this email.</p>
        </div>
      `,
    });

    console.log("[Mail] OTP email accepted by SMTP provider.", {
      to: maskEmail(to),
      purpose,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    });
    return true;
  } catch (error) {
    console.error("[Mail] Failed to send OTP email.", {
      to: maskEmail(to),
      purpose,
      errorName: error instanceof Error ? error.name : undefined,
      errorMessage: error instanceof Error ? error.message : error,
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return false;
  }
};

export const sendAccountCreatedEmail = async ({
  to,
  userType,
  password,
  firstName,
}: SendAccountCreatedEmailParams): Promise<boolean> => {
  try {
    console.info("[Mail] Preparing account-created email.", {
      to: maskEmail(to),
      userType,
      hasPassword: Boolean(password),
      hasFirstName: Boolean(firstName?.trim()),
    });

    const config = getMailConfig();
    if (!config) {
      console.warn("[Mail] Skipping account-created email because SMTP is not configured.", {
        to: maskEmail(to),
        userType,
      });
      return false;
    }

    const transport = getTransporter(config);
    const displayName = firstName?.trim() || "there";
    const roleLabel =
      userType === "super_admin"
        ? "Super Admin"
        : userType === "admin"
          ? "Admin"
          : "Operator";

    console.info("[Mail] Sending account-created email through SMTP.", {
      to: maskEmail(to),
      userType,
      roleLabel,
      host: config.host,
      port: config.port,
      secure: config.secure,
      fromAddress: maskEmail(config.fromAddress),
    });

    const info = await transport.sendMail({
      from: {
        name: config.fromName,
        address: config.fromAddress,
      },
      to,
      replyTo: config.replyTo,
      subject: `Your Thrill Bazaar ${roleLabel} account is ready`,
      text: [
        `Hello ${displayName},`,
        "",
        `Your Thrill Bazaar ${roleLabel} account has been created.`,
        `Login email: ${to}`,
        `Current password: ${password}`,
        "",
        "Please log in and change your password after your first sign-in.",
      ].join("\n"),
      html: `
        <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
          <p>Hello ${displayName},</p>
          <p>Your Thrill Bazaar <strong>${roleLabel}</strong> account has been created.</p>
          <p><strong>Login email:</strong> ${to}</p>
          <p><strong>Current password:</strong> ${password}</p>
          <p>Please log in and change your password after your first sign-in.</p>
        </div>
      `,
    });

    console.log("[Mail] Account-created email accepted by SMTP provider.", {
      to: maskEmail(to),
      userType,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    });
    return true;
  } catch (error) {
    console.error("[Mail] Failed to send account-created email.", {
      to: maskEmail(to),
      userType,
      errorName: error instanceof Error ? error.name : undefined,
      errorMessage: error instanceof Error ? error.message : error,
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return false;
  }
};
