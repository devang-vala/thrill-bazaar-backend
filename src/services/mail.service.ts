import nodemailer, { type Transporter } from "nodemailer";

export type EmailOtpPurpose =
  | "admin_login"
  | "admin_forgot_password"
  | "operator_signup"
  | "operator_login"
  | "operator_forgot_password"
  | "seller_account_access";

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
  const host =
    process.env.BREVO_SMTP_HOST?.trim() ||
    process.env.SMTP_HOST?.trim() ||
    "smtp-relay.brevo.com";
  const portValue =
    process.env.BREVO_SMTP_PORT?.trim() ||
    process.env.SMTP_PORT?.trim() ||
    "587";
  const user =
    process.env.BREVO_SMTP_USER?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "";
  const pass =
    process.env.BREVO_SMTP_KEY?.trim() ||
    process.env.BREVO_SMTP_PASS?.trim() ||
    process.env.SMTP_PASS?.trim() ||
    "";
  const fromAddress =
    process.env.BREVO_FROM_EMAIL?.trim() ||
    process.env.MAIL_FROM_ADDRESS?.trim() ||
    "";
  const fromName =
    process.env.BREVO_FROM_NAME?.trim() ||
    process.env.MAIL_FROM_NAME?.trim() ||
    "Thrill Bazaar";
  const replyTo =
    process.env.BREVO_REPLY_TO?.trim() ||
    process.env.MAIL_REPLY_TO?.trim();

  const missingOrPlaceholderFields = [
    ["BREVO_SMTP_HOST", host],
    ["BREVO_SMTP_USER", user],
    ["BREVO_SMTP_KEY", pass],
    ["BREVO_FROM_EMAIL", fromAddress],
  ]
    .filter(([, value]) => isPlaceholder(value))
    .map(([key]) => key);

  if (missingOrPlaceholderFields.length > 0) {
    console.warn("[Mail] SMTP configuration incomplete; email sending disabled.", {
      missingOrPlaceholderFields,
      smtpHostSet: Boolean(host),
      smtpUserSet: Boolean(user),
      smtpPassSet: Boolean(pass),
      mailFromAddressSet: Boolean(fromAddress),
    });
    return null;
  }

  const port = Number(portValue);
  if (!Number.isFinite(port) || port <= 0) {
    console.warn("[Mail] Invalid SMTP_PORT; email sending disabled.", {
      smtpPort: portValue,
      parsedPort: port,
    });
    return null;
  }

  const secureEnv =
    process.env.BREVO_SMTP_SECURE?.trim() ||
    process.env.SMTP_SECURE?.trim();
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
    case "seller_account_access":
      return {
        subject: "Thrill Bazaar seller account access verification OTP",
        action: "verify your identity for account access changes requested by the superadmin",
      };
  }
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildAccountCreatedEmailHtml = ({
  displayName,
  roleLabel,
  email,
  password,
  fromName,
}: {
  displayName: string;
  roleLabel: string;
  email: string;
  password: string;
  fromName: string;
}) => {
  const safeDisplayName = escapeHtml(displayName);
  const safeRoleLabel = escapeHtml(roleLabel);
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(password);
  const safeFromName = escapeHtml(fromName);

  return `
    <div style="max-width:620px;margin:0 auto;padding:32px;font-family:Arial,Helvetica,sans-serif;background:#ffffff;color:#222222;border:1px solid #dddddd;line-height:1.6;">

  <div style="text-align:center;font-size:24px;font-weight:bold;margin-bottom:28px;">
    Thrill Bazaar
  </div>

  <div style="font-size:22px;font-weight:bold;margin-bottom:18px;">
    ${safeRoleLabel} Account Created
  </div>

  <div style="font-size:15px;margin-bottom:18px;">
    Hello ${safeDisplayName},
  </div>

  <div style="font-size:15px;margin-bottom:24px;">
    ${safeFromName} has created a <strong>${safeRoleLabel}</strong> account for you. Your login credentials are provided below. Please sign in and update your password immediately after your first login.
  </div>

  <div style="border:1px solid #dddddd;padding:24px;margin-bottom:24px;background:#fafafa;">

    <div style="font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#555555;margin-bottom:18px;">
      Login Details
    </div>

    <div style="margin-bottom:18px;">
      <div style="font-size:13px;color:#666666;margin-bottom:6px;">Email Address</div>
      <div style="font-size:16px;font-weight:bold;word-break:break-word;">
        ${safeEmail}
      </div>
    </div>

    <div style="margin-bottom:18px;">
      <div style="font-size:13px;color:#666666;margin-bottom:6px;">Temporary Password</div>
      <div style="display:inline-block;padding:14px 18px;font-size:18px;font-weight:bold;letter-spacing:3px;border:1px solid #cccccc;background:#f2f2f2;color:#000000;word-break:break-word;">
        ${safePassword}
      </div>
    </div>

    <div style="font-size:13px;color:#666666;">
      This temporary password should be changed after your first login.
    </div>

  </div>

  <div style="border:1px solid #dddddd;padding:18px;margin-bottom:24px;background:#fafafa;">
    <div style="font-size:15px;font-weight:bold;margin-bottom:10px;">
      Next Steps
    </div>
    <div style="font-size:14px;line-height:1.8;">
      1. Sign in using the credentials above.<br>
      2. Review or update your account details.<br>
      3. Change your password in account settings.
    </div>
  </div>

  <div style="font-size:14px;margin-bottom:24px;">
    If you did not expect this email, please contact the Thrill Bazaar team immediately.
  </div>

  <div style="border-top:1px solid #dddddd;padding-top:18px;font-size:12px;color:#666666;">
    Sent by ${safeFromName}. Please keep this message confidential as it contains account access information.
  </div>

</div>
  `;
};

const buildOtpEmailHtml = ({
  otp,
  action,
  expiresInMinutes,
  fromName,
}: {
  otp: string;
  action: string;
  expiresInMinutes: number;
  fromName: string;
}) => {
  const safeOtp = escapeHtml(otp);
  const safeAction = escapeHtml(action);
  const safeFromName = escapeHtml(fromName);

  return `
    <div style="max-width:600px;margin:0 auto;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#222222;background:#ffffff;border:1px solid #dddddd;line-height:1.6;">

  <div style="font-size:24px;font-weight:bold;margin-bottom:24px;text-align:center;">
    Thrill Bazaar
  </div>

  <div style="font-size:18px;font-weight:bold;margin-bottom:16px;">
    Verification Code
  </div>

  <div style="font-size:15px;margin-bottom:18px;">
    Hello,
  </div>

  <div style="font-size:15px;margin-bottom:18px;">
    We received a request to ${safeAction}. Please use the verification code below to continue.
  </div>

  <div style="text-align:center;margin:28px 0;">
    <div style="display:inline-block;padding:16px 28px;font-size:28px;font-weight:bold;letter-spacing:8px;border:1px solid #cccccc;background:#f5f5f5;color:#000000;">
      ${safeOtp}
    </div>
  </div>

  <div style="font-size:14px;margin-bottom:18px;text-align:center;">
    This code will expire in ${expiresInMinutes} minutes.
  </div>

  <div style="font-size:14px;margin-bottom:18px;padding:14px;border:1px solid #dddddd;background:#fafafa;">
    <strong>Security Notice:</strong> Do not share this code with anyone. Thrill Bazaar support will never ask for your verification code.
  </div>

  <div style="font-size:14px;margin-bottom:24px;">
    If you did not request this verification email, please ignore this message.
  </div>

  <div style="font-size:12px;color:#666666;border-top:1px solid #dddddd;padding-top:18px;">
    Sent by ${safeFromName}. This message contains confidential account verification information.
  </div>

</div>
  `;
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
      html: buildOtpEmailHtml({
        otp,
        action,
        expiresInMinutes,
        fromName: config.fromName,
      }),
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
        `Your Thrill Bazaar ${roleLabel} account is ready.`,
        `Login email: ${to}`,
        `Temporary password: ${password}`,
        "",
        "Please sign in and change your password after the first login.",
      ].join("\n"),
      html: buildAccountCreatedEmailHtml({
        displayName,
        roleLabel,
        email: to,
        password,
        fromName: config.fromName,
      }),
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
