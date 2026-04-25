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

let transporter: Transporter | null = null;

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
  const host = process.env.SMTP_HOST?.trim() || "";
  const portValue = process.env.SMTP_PORT?.trim() || "587";
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS?.trim() || "";
  const fromAddress = process.env.MAIL_FROM_ADDRESS?.trim() || "";
  const fromName = process.env.MAIL_FROM_NAME?.trim() || "Thrill Bazaar";
  const replyTo = process.env.MAIL_REPLY_TO?.trim();

  if (
    isPlaceholder(host) ||
    isPlaceholder(user) ||
    isPlaceholder(pass) ||
    isPlaceholder(fromAddress)
  ) {
    return null;
  }

  const port = Number(portValue);
  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }

  const secureEnv = process.env.SMTP_SECURE?.trim();
  const secure =
    secureEnv === undefined || secureEnv === ""
      ? port === 465
      : isTruthyEnv(secureEnv);

  return {
    host,
    port,
    secure,
    user,
    pass,
    fromAddress,
    fromName,
    replyTo: replyTo || undefined,
  };
};

const getTransporter = (config: MailConfig) => {
  if (!transporter) {
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
    const config = getMailConfig();
    if (!config) {
      console.warn("SMTP credentials are not configured. Skipping email OTP send.");
      return false;
    }

    const { subject, action } = getPurposeText(purpose);
    const transport = getTransporter(config);

    await transport.sendMail({
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

    console.log(`OTP email sent successfully to ${to}`);
    return true;
  } catch (error) {
    console.error("Failed to send OTP email:", error);
    return false;
  }
};
