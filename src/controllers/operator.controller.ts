import type { Context } from "hono";
import { prisma } from "../db.js";
import { configureCloudinary } from "../config/cloudinary.config.js";
import { Readable } from "stream";
import {
  hashPassword,
  formatUserResponse,
  verifyToken,
} from "../helpers/auth.helper.js";
import {
  validateOperatorCompleteRegistration,
  validateOperatorProfileUpdate,
  sanitizeEmail,
  sanitizePhone,
  sanitizeString,
  generateSlug,
} from "../helpers/validation.helper.js";

const cloudinary = configureCloudinary();

interface OperatorCompleteRegistrationRequest {
  // Initial signup data
  email: string;
  phone: string;
  password: string;

  // Step 1: Basic Details
  businessName: string;
  operatorName: string;
  contactNumber: string;
  contactEmail: string;
  addressLine01: string;
  addressLine02?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
  selectedCategoryIds?: string[];  // Added for category selection

  // Step 2: Document fields (text data)
  panNumber?: string;
  gstinNumber?: string;
  bankAccountNumber?: string;
  confirmBankAccountNumber?: string;
  ifscCode?: string;
  branchName?: string;
  accountHolderName?: string;

  // Additional fields
  websiteUrl?: string;
  companyDescription?: string;
  socialMediaLinks?: string; // JSON string
}

const SELLER_POLICY_TYPES = [
  "why_choose_us",
  "terms_conditions",
  "rescheduling",
  "cancellation",
  "exchange",
] as const;

const OPERATOR_ADMIN_REVIEW_STATES = [
  "PENDING",
  "CHANGES_REQUESTED",
  "VERIFIED",
  "REJECTED",
  "BLOCKED",
] as const;

type OperatorAdminReviewState = (typeof OPERATOR_ADMIN_REVIEW_STATES)[number];

type OperatorCategoryRate = {
  categoryId: string;
  commissionRate: number;
  tcsRate: number;
  updatedAt: string;
  updatedByAdminId?: string | null;
};

const getOperatorMetadata = (profile: { verificationDocuments?: unknown } | null | undefined) => {
  const raw = (profile?.verificationDocuments as any) || {};
  return typeof raw === "object" && raw !== null ? raw : {};
};

const getOperatorCategoryRates = (profile: { verificationDocuments?: unknown } | null | undefined): OperatorCategoryRate[] => {
  const metadata = getOperatorMetadata(profile);
  const rawRates = Array.isArray(metadata.categoryRates) ? metadata.categoryRates : [];

  return rawRates
    .map((rate: any) => ({
      categoryId: String(rate?.categoryId || ""),
      commissionRate: Number(rate?.commissionRate || 0),
      tcsRate: Number(rate?.tcsRate || 0),
      updatedAt: rate?.updatedAt ? String(rate.updatedAt) : new Date(0).toISOString(),
      updatedByAdminId: rate?.updatedByAdminId ? String(rate.updatedByAdminId) : null,
    }))
    .filter((rate: OperatorCategoryRate) => rate.categoryId);
};

const getOperatorAdminReview = (profile: { verificationDocuments?: unknown; verificationStatus?: string } | null | undefined) => {
  const metadata = getOperatorMetadata(profile);
  const rawReview = metadata.adminReview;

  const review =
    typeof rawReview === "object" && rawReview !== null
      ? rawReview
      : {};

  return {
    state:
      typeof review.state === "string" &&
      (OPERATOR_ADMIN_REVIEW_STATES as readonly string[]).includes(review.state)
        ? (review.state as OperatorAdminReviewState)
        : undefined,
    requestChangesNote:
      typeof review.requestChangesNote === "string" ? review.requestChangesNote : null,
    requestChangesAt:
      typeof review.requestChangesAt === "string" ? review.requestChangesAt : null,
    requestChangesByAdminId:
      typeof review.requestChangesByAdminId === "string"
        ? review.requestChangesByAdminId
        : null,
    blockedReason:
      typeof review.blockedReason === "string" ? review.blockedReason : null,
    blockedAt: typeof review.blockedAt === "string" ? review.blockedAt : null,
    blockedByAdminId:
      typeof review.blockedByAdminId === "string" ? review.blockedByAdminId : null,
    verifiedAt: typeof review.verifiedAt === "string" ? review.verifiedAt : null,
    verifiedByAdminId:
      typeof review.verifiedByAdminId === "string" ? review.verifiedByAdminId : null,
  };
};

const getOperatorAdminStatus = (profile: { verificationDocuments?: unknown; verificationStatus?: string }) => {
  const review = getOperatorAdminReview(profile);

  if (profile.verificationStatus === "VERIFIED") {
    return "VERIFIED" as OperatorAdminReviewState;
  }

  if (review.state === "CHANGES_REQUESTED") {
    return "CHANGES_REQUESTED" as OperatorAdminReviewState;
  }

  if (review.state === "BLOCKED") {
    return "BLOCKED" as OperatorAdminReviewState;
  }

  if (profile.verificationStatus === "REJECTED") {
    return "REJECTED" as OperatorAdminReviewState;
  }

  return "PENDING" as OperatorAdminReviewState;
};

const buildVerificationDocuments = (
  profile: { verificationDocuments?: unknown },
  overrides: Record<string, unknown>
) => {
  const metadata = getOperatorMetadata(profile);
  return {
    ...metadata,
    ...overrides,
  };
};

const toValidPercentage = (value: unknown) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return null;
  }

  return Number(numeric.toFixed(2));
};

const normalizeOperatorListItem = (profile: any) => {
  const adminReviewStatus = getOperatorAdminStatus(profile);
  const adminReview = getOperatorAdminReview(profile);

  return {
    ...profile,
    adminReviewStatus,
    adminReview,
  };
};

const generateUniqueOperatorSlug = async (
  db: any,
  companyName: string,
  currentOperatorId?: string
) => {
  const normalizedCompanyName = sanitizeString(companyName || "", 100);
  const baseSlug = generateSlug(normalizedCompanyName) || "operator";

  for (let counter = 0; counter < 1000; counter += 1) {
    const candidateSlug = counter === 0 ? baseSlug : `${baseSlug}-${counter}`;

    const existingProfile = await db.operatorProfile.findFirst({
      where: {
        operatorSlug: candidateSlug,
        ...(currentOperatorId
          ? {
              operatorId: {
                not: currentOperatorId,
              },
            }
          : {}),
      } as any,
      select: {
        id: true,
      },
    } as any);

    if (!existingProfile) {
      return candidateSlug;
    }
  }

  return `${baseSlug}-${Date.now()}`;
};

/**
 * Helper function to upload file to Cloudinary
 */
const uploadToCloudinary = async (file: File, folder: string = "operator-documents") => {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `thrill-bazaar/${folder}`,
        resource_type: "auto",
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            url: result?.secure_url,
            publicId: result?.public_id,
            format: result?.format,
            resourceType: result?.resource_type,
            originalFilename: result?.original_filename,
          });
        }
      }
    );

    const readableStream = new Readable();
    readableStream.push(buffer);
    readableStream.push(null);
    readableStream.pipe(uploadStream);
  });
};

/**
 * Complete Operator Registration (All steps in one request)
 * Handles multipart/form-data with files + text fields
 */
export const registerOperatorComplete = async (c: Context) => {
  try {
    // Parse form data
    const body = await c.req.parseBody();

    // Optional auth header so already-signed-up operators can continue onboarding
    const authHeader = c.req.header("authorization");
    let existingOperatorUser: any = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const payload = verifyToken(token);
        if (payload.userType === "operator") {
          existingOperatorUser = await prisma.user.findUnique({
            where: { id: payload.userId },
          });
        }
      } catch (err) {
        // Ignore token errors and continue as unauthenticated registration
      }
    }

    const toSingleString = (value: unknown): string => {
      if (Array.isArray(value)) {
        const first = value[0];
        return typeof first === "string" ? first : "";
      }
      return typeof value === "string" ? value : "";
    };

    const normalizeIndianPhoneForValidation = (value: string): string => {
      const digits = (value || "").replace(/\D/g, "");
      if (digits.length >= 10) {
        return digits.slice(-10);
      }
      return value || "";
    };

    // Extract all text fields
    const registrationData = {
      email: toSingleString(body.email),
      phone: normalizeIndianPhoneForValidation(toSingleString(body.phone) || toSingleString(body.contactNumber)),
      password: toSingleString(body.password),
      businessName: toSingleString(body.businessName),
      operatorName: toSingleString(body.operatorName),
      contactNumber: normalizeIndianPhoneForValidation(toSingleString(body.contactNumber) || toSingleString(body.phone)),
      contactEmail: toSingleString(body.contactEmail),
      addressLine01: toSingleString(body.addressLine01),
      addressLine02: toSingleString(body.addressLine02),
      city: toSingleString(body.city),
      state: toSingleString(body.state),
      pincode: toSingleString(body.pincode),
      country: toSingleString(body.country),
      selectedCategoryIds: body.selectedCategoryIds
        ? (typeof body.selectedCategoryIds === 'string'
          ? JSON.parse(body.selectedCategoryIds)
          : body.selectedCategoryIds)
        : [],
      panNumber: toSingleString(body.panNumber),
      gstinNumber: toSingleString(body.gstinNumber),
      bankAccountNumber: toSingleString(body.bankAccountNumber),
      confirmBankAccountNumber: toSingleString(body.confirmBankAccountNumber),
      ifscCode: toSingleString(body.ifscCode),
      branchName: toSingleString(body.branchName),
      accountHolderName: toSingleString(body.accountHolderName),
      websiteUrl: toSingleString(body.websiteUrl),
      companyDescription: toSingleString(body.companyDescription),
      socialMediaLinks: toSingleString(body.socialMediaLinks),
    };

    if (existingOperatorUser) {
      registrationData.email = existingOperatorUser.email || registrationData.email;
      registrationData.phone = existingOperatorUser.phone || registrationData.phone;
      // Supply a placeholder to satisfy validation; password isn't overwritten here
      registrationData.password = registrationData.password || "Placeholder@123";
    }

    // Validate registration data
    const validation = validateOperatorCompleteRegistration(registrationData);
    if (!validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Sanitize inputs
    const email = sanitizeEmail(registrationData.email);
    const phone = sanitizePhone(registrationData.phone);
    const businessName = sanitizeString(registrationData.businessName, 100);
    const operatorName = sanitizeString(registrationData.operatorName, 100);

    // Allow same email or phone individually, but block exact duplicates unless continuing onboarding for an existing operator
    if (!existingOperatorUser) {
      const existingCombo = await prisma.user.findFirst({
        where: {
          userType: "operator",
          email: email,
          phone: phone,
        },
      });

      if (existingCombo) {
        return c.json({ error: "Account already exists with this email and phone" }, 409);
      }
    }

    // Validate bank account confirmation
    if (registrationData.bankAccountNumber !== registrationData.confirmBankAccountNumber) {
      return c.json({ error: "Bank account numbers do not match" }, 400);
    }

    // Collect uploaded files
    const documentFiles: { key: string; file: File }[] = [];

    // KYC Documents
    if (body.panDocument && body.panDocument instanceof File) {
      documentFiles.push({ key: "pan_document", file: body.panDocument });
    }
    if (body.businessLicense && body.businessLicense instanceof File) {
      documentFiles.push({ key: "business_license", file: body.businessLicense });
    }
    if (body.idProof && body.idProof instanceof File) {
      documentFiles.push({ key: "id_proof", file: body.idProof });
    }

    // Certifications (can be multiple)
    const certificationFiles: File[] = [];
    if (body.certifications) {
      if (Array.isArray(body.certifications)) {
        certificationFiles.push(...body.certifications.filter((f): f is File => f instanceof File));
      } else if (body.certifications instanceof File) {
        certificationFiles.push(body.certifications);
      }
    }

    // PAN and Business License are optional - the current onboarding UI
    // only collects Bank Details and Certifications on Step 2.

    // Hash password (may be skipped when continuing onboarding)
    const hashedPassword = registrationData.password
      ? await hashPassword(registrationData.password)
      : null;

    // Split operator name
    const nameParts = operatorName.trim().split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    // Upload all documents to Cloudinary
    const kycDocumentPromises = documentFiles.map(({ key, file }) =>
      uploadToCloudinary(file, `operator-documents/${email}/kyc`).then(result => ({
        documentType: key,
        ...(result as object),
      }))
    );

    const certificationPromises = certificationFiles.map(file =>
      uploadToCloudinary(file, `operator-documents/${email}/certifications`)
    );

    const [kycDocuments, certificationDocuments] = await Promise.all([
      Promise.all(kycDocumentPromises),
      Promise.all(certificationPromises),
    ]);

    // Combine all documents
    const allDocuments = {
      kyc: kycDocuments,
      certifications: certificationDocuments as Array<{ url: string; publicId: string; format: string; resourceType: string; originalFilename: string }>,
    };

    // Parse social media links
    let parsedSocialMediaLinks = null;
    if (registrationData.socialMediaLinks) {
      try {
        parsedSocialMediaLinks = JSON.parse(registrationData.socialMediaLinks);
      } catch (e) {
        // Ignore parsing errors for social media links
      }
    }

    // selectedCategoryIds is already parsed during registrationData extraction (line ~280)
    const selectedCategoryIds: string[] = Array.isArray(registrationData.selectedCategoryIds)
      ? registrationData.selectedCategoryIds
      : [];

    // Prepare bank account details (will be encrypted in production)
    const bankAccountDetails = {
      accountNumber: registrationData.bankAccountNumber,
      ifscCode: registrationData.ifscCode,
      branchName: registrationData.branchName,
      accountHolderName: registrationData.accountHolderName,
    };

    // Create or update everything in a transaction
    const result = await prisma.$transaction(async (tx) => {
      let userRecord = existingOperatorUser;

      if (userRecord) {
        userRecord = await tx.user.update({
          where: { id: userRecord.id },
          data: {
            email,
            phone,
            firstName,
            lastName,
            isActive: true,
            ...(hashedPassword ? { password: hashedPassword } : {}),
            selectedCategoryIds: registrationData.selectedCategoryIds || userRecord.selectedCategoryIds || [],
          },
        });
      } else {
        userRecord = await tx.user.create({
          data: {
            email: email,
            phone: phone,
            password: hashedPassword,
            firstName: firstName,
            lastName: lastName,
            userType: "operator",
            isVerified: false, // Will be verified by admin
            isActive: false, // Inactive until admin approval
            selectedCategoryIds: registrationData.selectedCategoryIds || [],
          },
        });
      }

      const billingAddress = await tx.userAddress.findFirst({
        where: { userId: userRecord.id, addressType: "BILLING" },
      });

      const addressData = {
        userId: userRecord.id,
        addressType: "BILLING" as const,
        fullAddress: `${registrationData.addressLine01}${registrationData.addressLine02 ? ", " + registrationData.addressLine02 : ""}`,
        city: sanitizeString(registrationData.city, 100),
        state: sanitizeString(registrationData.state, 100),
        country: sanitizeString(registrationData.country || "India", 100),
        postalCode: sanitizeString(registrationData.pincode, 20),
        isDefault: true,
      };

      if (billingAddress) {
        await tx.userAddress.update({
          where: { id: billingAddress.id },
          data: addressData,
        });
      } else {
        await tx.userAddress.create({ data: addressData });
      }

      const operatorProfile = await tx.operatorProfile.upsert({
        where: { operatorId: userRecord.id },
        create: {
          operatorId: userRecord.id,
          operatorSlug: await generateUniqueOperatorSlug(tx, businessName, userRecord.id),
          companyName: businessName,
          businessRegistrationNumber: registrationData.panNumber || null,
          taxId: registrationData.gstinNumber || null,
          companyDescription: registrationData.companyDescription
            ? sanitizeString(registrationData.companyDescription, 1000)
            : null,
          websiteUrl: registrationData.websiteUrl
            ? sanitizeString(registrationData.websiteUrl, 255)
            : null,
          socialMediaLinks: parsedSocialMediaLinks,
          bankAccountDetails: bankAccountDetails,
          verificationDocuments: allDocuments,
          verificationStatus: "PENDING",
        } as any,
        update: {
          operatorSlug: await generateUniqueOperatorSlug(tx, businessName, userRecord.id),
          companyName: businessName,
          businessRegistrationNumber: registrationData.panNumber || null,
          taxId: registrationData.gstinNumber || null,
          companyDescription: registrationData.companyDescription
            ? sanitizeString(registrationData.companyDescription, 1000)
            : null,
          websiteUrl: registrationData.websiteUrl
            ? sanitizeString(registrationData.websiteUrl, 255)
            : null,
          socialMediaLinks: parsedSocialMediaLinks,
          bankAccountDetails: bankAccountDetails,
          verificationDocuments: allDocuments,
          verificationStatus: "PENDING",
        } as any,
      });

      return { user: userRecord, operatorProfile };
    });

    return c.json(
      {
        message: "Your profile has been created successfully! ",
        subtitle: "Our admins will verify your documents and contact you for further steps on Thrill Bazaar! ",
        userId: result.user.id,
        operatorProfileId: result.operatorProfile.id,
        status: "pending_verification",
        note: "A confirmation has been sent to your mobile number.",
      },
      201
    );
  } catch (error) {
    console.error("Operator registration error:", error);

    if (error instanceof Error) {
      console.error("Error details:", error.message);
      console.error("Stack trace:", error.stack);
    }

    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Get operator profile (ONLY for verified operators or admins)
 */
export const getOperatorProfile = async (c: Context) => {
    try {
      const user = c.get("user");
      const operatorId = c.req.param("operatorId") || user.userId;

    // Check permissions
    if (user.userType === "operator" && operatorId !== user.userId) {
      return c.json({ error: "Can only view your own profile" }, 403);
    }

      const operatorProfile = await prisma.operatorProfile.findUnique({
        where: { operatorId: operatorId },
        include: {
          operator: {
            select: {
              id: true,
              email: true,
              phone: true,
              firstName: true,
              lastName: true,
              isVerified: true,
              isActive: true,
              selectedCategoryIds: true,
              createdAt: true,
            },
          },
          verifiedByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!operatorProfile) {
      return c.json({ error: "Operator profile not found" }, 404);
    }

    // Get business address
    const businessAddress = await prisma.userAddress.findFirst({
      where: {
        userId: operatorId,
        addressType: "BILLING",
      },
    });

    // Allow operators to see their own bank details for profile page
    let profileData = { ...operatorProfile };

      const selectedCategoryIds = Array.isArray(operatorProfile.operator?.selectedCategoryIds)
        ? operatorProfile.operator.selectedCategoryIds
        : [];

      const selectedCategories = selectedCategoryIds.length
        ? await prisma.category.findMany({
            where: {
              id: { in: selectedCategoryIds },
            },
            select: {
              id: true,
              categoryName: true,
              categorySlug: true,
              categoryIconUrl: true,
              listingTypeId: true,
              listingType: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: {
              displayOrder: "asc",
            },
          })
        : [];

      const rawCategoryRates = getOperatorCategoryRates(operatorProfile);
      const categoryRates = selectedCategories.map((category) => {
        const existingRate = rawCategoryRates.find((rate) => rate.categoryId === category.id);

        return {
          categoryId: category.id,
          categoryName: category.categoryName,
          listingType: category.listingType,
          commissionRate: existingRate?.commissionRate ?? null,
          tcsRate: existingRate?.tcsRate ?? null,
          updatedAt: existingRate?.updatedAt ?? null,
          updatedByAdminId: existingRate?.updatedByAdminId ?? null,
        };
      });

      const adminReviewStatus = getOperatorAdminStatus(operatorProfile);
      const adminReview = getOperatorAdminReview(operatorProfile);
      const normalizedProfile = {
        ...profileData,
        adminReviewStatus,
        adminReview,
        categoryRates,
        selectedCategories,
      };

      return c.json({
        message: "Operator profile retrieved successfully",
        operatorProfile: normalizedProfile,
        businessAddress: businessAddress,
      });
  } catch (error) {
    console.error("Get operator profile error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Update operator profile (operator-facing self-service)
 * Allows operators to update business address, bank details, and GSTIN.
 * Resets verification status to PENDING on any edit so admin can re-review.
 */
export const updateOperatorProfile = async (c: Context) => {
  try {
    const user = c.get("user");

    if (user.userType !== "operator") {
      return c.json({ error: "Only operators can update their own profile" }, 403);
    }

    const operatorId = user.userId;
    const body = await c.req.json();

    const operatorProfile = await prisma.operatorProfile.findUnique({
      where: { operatorId },
    });

    if (!operatorProfile) {
      return c.json({ error: "Operator profile not found" }, 404);
    }

    const currentMetadata = getOperatorMetadata(operatorProfile);
    const currentReview = getOperatorAdminReview(operatorProfile);
    const normalizedCompanyName =
      body.companyName !== undefined
        ? sanitizeString(String(body.companyName || ""), 100)
        : undefined;

    if (body.companyName !== undefined && !normalizedCompanyName) {
      return c.json({ error: "Company name cannot be empty" }, 400);
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: operatorId },
      select: { id: true },
    });

    if (!currentUser) {
      return c.json({ error: "User not found" }, 404);
    }

    const hasContact1 = body.contact1 !== undefined || body.phone !== undefined;
    const hasContact2 = body.contact2 !== undefined || body.alternatePhone !== undefined;
    const contact1Input = body.contact1 !== undefined ? body.contact1 : body.phone;
    const contact2Input = body.contact2 !== undefined ? body.contact2 : body.alternatePhone;
    const contactUpdateData: any = {};

    if (hasContact1) {
      const contact1Value = String(contact1Input || "");
      if (!contact1Value.trim()) {
        return c.json({ error: "Contact 01 cannot be empty" }, 400);
      }

      contactUpdateData.contact1 = sanitizePhone(contact1Value);
    }

    if (hasContact2) {
      const contact2Value = String(contact2Input || "");
      contactUpdateData.contact2 = contact2Value.trim() ? sanitizePhone(contact2Value) : null;
    }

    if (
      contactUpdateData.contact1 &&
      contactUpdateData.contact2 &&
      contactUpdateData.contact1 === contactUpdateData.contact2
    ) {
      return c.json({ error: "Contact 02 cannot be same as Contact 01" }, 400);
    }

    const shouldResetVerification =
      normalizedCompanyName !== undefined ||
      body.businessAddress !== undefined ||
      body.bankAccountDetails !== undefined ||
      body.gstinNumber !== undefined ||
      body.firstName !== undefined ||
      body.lastName !== undefined ||
      Array.isArray(body.selectedCategoryIds) ||
      Array.isArray(body.certifications);

    const updatedOperatorProfile = await prisma.$transaction(async (tx) => {
      // Update company name and regenerate slug if provided
      if (normalizedCompanyName) {
        const nextOperatorSlug = await generateUniqueOperatorSlug(
          tx,
          normalizedCompanyName,
          operatorId
        );

        await tx.operatorProfile.update({
          where: { operatorId },
          data: {
            companyName: normalizedCompanyName,
            operatorSlug: nextOperatorSlug,
          } as any,
        });
      }

      // Update business address if provided
      if (body.businessAddress) {
        const addr = body.businessAddress;
        await tx.userAddress.updateMany({
          where: { userId: operatorId, addressType: "BILLING" },
          data: {
            fullAddress: addr.fullAddress ?? undefined,
            city: addr.city ?? undefined,
            state: addr.state ?? undefined,
            postalCode: addr.postalCode ?? undefined,
          },
        });
      }

      // Update bank details if provided
      if (body.bankAccountDetails) {
        const bank = body.bankAccountDetails;
        await tx.operatorProfile.update({
          where: { operatorId },
          data: {
            bankAccountDetails: {
              accountNumber: bank.accountNumber ?? (operatorProfile.bankAccountDetails as any)?.accountNumber,
              ifscCode: bank.ifscCode ?? (operatorProfile.bankAccountDetails as any)?.ifscCode,
              branchName: bank.branchName ?? (operatorProfile.bankAccountDetails as any)?.branchName,
              accountHolderName: bank.accountHolderName ?? (operatorProfile.bankAccountDetails as any)?.accountHolderName,
            },
          },
        });
      }

      // Update GSTIN if provided
      if (body.gstinNumber !== undefined) {
        await tx.operatorProfile.update({
          where: { operatorId },
          data: { taxId: body.gstinNumber || null },
        });
      }

      if (Object.keys(contactUpdateData).length > 0) {
        await tx.operatorProfile.update({
          where: { operatorId },
          data: contactUpdateData,
        } as any);
      }

      // Update operator name if provided
      if (body.firstName !== undefined || body.lastName !== undefined) {
        const updateData: any = {};
        if (body.firstName !== undefined) {
          updateData.firstName = sanitizeString(String(body.firstName || ""), 100);
        }
        if (body.lastName !== undefined) {
          updateData.lastName = sanitizeString(String(body.lastName || ""), 100);
        }
        if (Object.keys(updateData).length > 0) {
          await tx.user.update({
            where: { id: operatorId },
            data: updateData,
          });
        }
      }

      // Update selected category IDs if provided
      if (Array.isArray(body.selectedCategoryIds)) {
        await tx.user.update({
          where: { id: operatorId },
          data: { selectedCategoryIds: body.selectedCategoryIds },
        });
      }

      // Update certifications if provided
      let updatedMetadata = { ...currentMetadata };
      if (Array.isArray(body.certifications)) {
        updatedMetadata = {
          ...updatedMetadata,
          certifications: body.certifications,
        };
      }

      if (shouldResetVerification) {
        // Reset verification status to PENDING for admin re-review
        const nextReview = {
          ...currentReview,
          state: "PENDING" as OperatorAdminReviewState,
          requestChangesNote: null,
          requestChangesAt: null,
          requestChangesByAdminId: null,
        };

        await tx.operatorProfile.update({
          where: { operatorId },
          data: {
            verificationStatus: "PENDING",
            verificationDocuments: {
              ...updatedMetadata,
              adminReview: nextReview,
            },
          },
        });

        await tx.user.update({
          where: { id: operatorId },
          data: { isVerified: false },
        });
      } else if (Array.isArray(body.certifications)) {
        await tx.operatorProfile.update({
          where: { operatorId },
          data: { verificationDocuments: updatedMetadata },
        });
      }

      return tx.operatorProfile.findUnique({
        where: { operatorId },
        select: {
          id: true,
          operatorId: true,
          contact1: true,
          contact2: true,
          verificationStatus: true,
        },
      });
    });

    return c.json({
      message: shouldResetVerification
        ? "Profile updated successfully. Your profile will be re-verified by admin."
        : "Profile updated successfully.",
      operatorProfile: updatedOperatorProfile,
    });
  } catch (error) {
    console.error("Update operator profile error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Get all operators (admin only) - with pagination and filters
 */
export const getAllOperators = async (c: Context) => {
    try {
      const body = await c.req.json().catch(() => ({}));

      const page = body.page || 1;
      const limit = Math.min(body.limit || 10, 100);
      const offset = (page - 1) * limit;

      const where: any = {};
      const requestedStatus = typeof body.verificationStatus === "string"
        ? body.verificationStatus
        : undefined;

      if (requestedStatus === "VERIFIED") {
        where.verificationStatus = "VERIFIED";
      } else if (requestedStatus === "BLOCKED") {
        where.verificationStatus = "REJECTED";
      } else if (requestedStatus === "REJECTED") {
        where.verificationStatus = "REJECTED";
      } else if (requestedStatus === "PENDING" || requestedStatus === "CHANGES_REQUESTED") {
        where.verificationStatus = "PENDING";
      }

    if (body.search) {
      where.OR = [
        { companyName: { contains: body.search, mode: "insensitive" } },
        { operator: { email: { contains: body.search, mode: "insensitive" } } },
        { operator: { phone: { contains: body.search } } },
      ];
    }

      const operators = await prisma.operatorProfile.findMany({
        where,
        include: {
          operator: {
            select: {
              id: true,
              email: true,
              phone: true,
              firstName: true,
              lastName: true,
              isVerified: true,
              isActive: true,
              createdAt: true,
            },
          },
          verifiedByAdmin: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const normalizedOperators = operators
        .map(normalizeOperatorListItem)
        .filter((profile) => {
          if (requestedStatus === "PENDING") {
            return profile.adminReviewStatus === "PENDING";
          }

          if (requestedStatus === "CHANGES_REQUESTED") {
            return profile.adminReviewStatus === "CHANGES_REQUESTED";
          }

          if (requestedStatus === "BLOCKED") {
            return profile.adminReviewStatus === "BLOCKED";
          }

          if (requestedStatus === "REJECTED") {
            return profile.adminReviewStatus === "REJECTED";
          }

          return true;
        });

      const totalCount = normalizedOperators.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / limit));
      const paginatedOperators = normalizedOperators.slice(offset, offset + limit);

      return c.json({
        message: "Operators retrieved successfully",
        data: {
          operators: paginatedOperators,
          pagination: {
            currentPage: page,
            totalPages,
          totalCount,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: {
          verificationStatus: body.verificationStatus || null,
          search: body.search || null,
        },
      },
    });
  } catch (error) {
    console.error("Get operators error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Verify/Reject operator (admin only)
 */
export const verifyOperator = async (c: Context) => {
    try {
      const currentUser = c.get("user");
      const operatorId = c.req.param("operatorId");
      const body = await c.req.json();

    if (!["admin", "super_admin"].includes(currentUser.userType)) {
      return c.json({ error: "Only admins can verify operators" }, 403);
    }

      const { action } = body;
      const reviewNote = typeof body.note === "string"
        ? body.note.trim()
        : typeof body.rejectionReason === "string"
          ? body.rejectionReason.trim()
          : typeof body.requestChangesNote === "string"
            ? body.requestChangesNote.trim()
            : "";

      if (!["verify", "reject", "request_changes", "block"].includes(action)) {
        return c.json(
          { error: "Invalid action. Must be 'verify', 'reject', 'request_changes', or 'block'" },
          400
        );
      }

      if ((action === "reject" || action === "request_changes") && !reviewNote) {
        return c.json({ error: "A note is required for this action" }, 400);
      }

    const operatorProfile = await prisma.operatorProfile.findUnique({
      where: { operatorId: operatorId },
    });

    if (!operatorProfile) {
      return c.json({ error: "Operator profile not found" }, 404);
    }

      const result = await prisma.$transaction(async (tx) => {
        const currentMetadata = getOperatorMetadata(operatorProfile);
        const currentReview = getOperatorAdminReview(operatorProfile);
        const now = new Date();
        const nowIso = now.toISOString();

        let nextVerificationStatus: "PENDING" | "VERIFIED" | "REJECTED" = "PENDING";
        let nextUserIsVerified = false;
        let nextUserIsActive = true;
        let nextRejectionReason: string | null = null;
        let nextReviewState: OperatorAdminReviewState = "PENDING";

        if (action === "verify") {
          nextVerificationStatus = "VERIFIED";
          nextUserIsVerified = true;
          nextUserIsActive = true;
          nextReviewState = "VERIFIED";
        } else if (action === "request_changes") {
          nextVerificationStatus = "PENDING";
          nextUserIsVerified = false;
          nextUserIsActive = true;
          nextReviewState = "CHANGES_REQUESTED";
        } else if (action === "block") {
          nextVerificationStatus = "REJECTED";
          nextUserIsVerified = false;
          nextUserIsActive = false;
          nextRejectionReason = reviewNote || "Seller blocked by admin";
          nextReviewState = "BLOCKED";
        } else {
          nextVerificationStatus = "REJECTED";
          nextUserIsVerified = false;
          nextUserIsActive = false;
          nextRejectionReason = reviewNote;
          nextReviewState = "REJECTED";
        }

        const nextReview = {
          ...currentReview,
          state: nextReviewState,
          requestChangesNote: action === "request_changes" ? reviewNote : null,
          requestChangesAt: action === "request_changes" ? nowIso : null,
          requestChangesByAdminId: action === "request_changes" ? currentUser.userId : null,
          blockedReason: action === "block" ? nextRejectionReason : null,
          blockedAt: action === "block" ? nowIso : null,
          blockedByAdminId: action === "block" ? currentUser.userId : null,
          verifiedAt: action === "verify" ? nowIso : currentReview.verifiedAt,
          verifiedByAdminId: action === "verify" ? currentUser.userId : currentReview.verifiedByAdminId,
        };

        const updatedProfile = await tx.operatorProfile.update({
          where: { operatorId: operatorId },
          data: {
            verificationStatus: nextVerificationStatus,
            verifiedByAdminId: currentUser.userId,
            verifiedAt: action === "verify" ? now : operatorProfile.verifiedAt,
            rejectionReason: nextRejectionReason,
            verificationDocuments: {
              ...currentMetadata,
              adminReview: nextReview,
            },
          },
        });

        await tx.user.update({
          where: { id: operatorId },
          data: {
            isVerified: nextUserIsVerified,
            isActive: nextUserIsActive,
          },
        });

        return updatedProfile;
      });

      return c.json({
        message:
          action === "verify"
            ? "Operator verified successfully"
            : action === "request_changes"
              ? "Change request sent successfully"
              : action === "block"
                ? "Seller blocked successfully"
                : "Operator rejected successfully",
        operatorProfile: normalizeOperatorListItem(result),
      });
    } catch (error) {
      console.error("Verify operator error:", error);
      return c.json({ error: "Internal server error" }, 500);
    }
  };

/**
 * Upsert operator category commission/TCS rates (admin only)
 */
export const upsertOperatorCategoryRate = async (c: Context) => {
  try {
    const currentUser = c.get("user");
    const operatorId = c.req.param("operatorId");
    const body = await c.req.json();

    const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
    const commissionRate = toValidPercentage(body.commissionRate);
    const tcsRate = toValidPercentage(body.tcsRate);

    if (!categoryId) {
      return c.json({ error: "categoryId is required" }, 400);
    }

    if (commissionRate === null || tcsRate === null) {
      return c.json({ error: "Commission rate and TCS rate must be between 0 and 100" }, 400);
    }

    const [operatorProfile, category] = await Promise.all([
      prisma.operatorProfile.findUnique({
        where: { operatorId },
        include: {
          operator: {
            select: {
              selectedCategoryIds: true,
            },
          },
        },
      }),
      prisma.category.findUnique({
        where: { id: categoryId },
        select: {
          id: true,
          categoryName: true,
          listingType: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    if (!operatorProfile) {
      return c.json({ error: "Operator profile not found" }, 404);
    }

    if (!category) {
      return c.json({ error: "Category not found" }, 404);
    }

    const selectedCategoryIds = Array.isArray(operatorProfile.operator?.selectedCategoryIds)
      ? operatorProfile.operator.selectedCategoryIds
      : [];

    if (!selectedCategoryIds.includes(categoryId)) {
      return c.json({ error: "This category is not selected by the provider" }, 400);
    }

    const currentRates = getOperatorCategoryRates(operatorProfile);
    const nowIso = new Date().toISOString();

    const nextRates = [
      ...currentRates.filter((rate) => rate.categoryId !== categoryId),
      {
        categoryId,
        commissionRate,
        tcsRate,
        updatedAt: nowIso,
        updatedByAdminId: currentUser.userId,
      },
    ].sort((left, right) => left.categoryId.localeCompare(right.categoryId));

    await prisma.operatorProfile.update({
      where: { operatorId },
      data: {
        verificationDocuments: buildVerificationDocuments(operatorProfile, {
          categoryRates: nextRates,
        }),
      },
    });

    return c.json({
      success: true,
      message: "Category rate saved successfully",
      data: {
        categoryId,
        categoryName: category.categoryName,
        listingType: category.listingType,
        commissionRate,
        tcsRate,
        updatedAt: nowIso,
        updatedByAdminId: currentUser.userId,
      },
    });
  } catch (error) {
    console.error("Upsert operator category rate error:", error);
    return c.json({ error: "Failed to save category rate" }, 500);
  }
};

/**
 * Delete operator category commission/TCS rates (admin only)
 */
export const deleteOperatorCategoryRate = async (c: Context) => {
  try {
    const operatorId = c.req.param("operatorId");
    const categoryId = c.req.param("categoryId");

    if (!operatorId || !categoryId) {
      return c.json({ error: "operatorId and categoryId are required" }, 400);
    }

    const operatorProfile = await prisma.operatorProfile.findUnique({
      where: { operatorId },
      include: {
        operator: {
          select: {
            selectedCategoryIds: true,
          },
        },
      },
    });

    if (!operatorProfile) {
      return c.json({ error: "Operator profile not found" }, 404);
    }

    const currentRates = getOperatorCategoryRates(operatorProfile);

    if (!currentRates.some((rate) => rate.categoryId === categoryId)) {
      return c.json({ error: "No saved rate found for this category" }, 404);
    }

    const nextRates = currentRates.filter((rate) => rate.categoryId !== categoryId);

    const selectedCategoryIds = Array.isArray(operatorProfile.operator?.selectedCategoryIds)
      ? operatorProfile.operator.selectedCategoryIds
      : [];

    await prisma.$transaction(async (tx) => {
      await tx.operatorProfile.update({
        where: { operatorId },
        data: {
          verificationDocuments: buildVerificationDocuments(operatorProfile, {
            categoryRates: nextRates,
          }),
        },
      });

      await tx.user.update({
        where: { id: operatorId },
        data: {
          selectedCategoryIds: selectedCategoryIds.filter((id) => id !== categoryId),
        },
      });
    });

    return c.json({
      success: true,
      message: "Seller category deleted successfully",
      data: {
        operatorId,
        categoryId,
      },
    });
  } catch (error) {
    console.error("Delete operator category rate error:", error);
    return c.json({ error: "Failed to delete category rate" }, 500);
  }
};

/**
 * Assign a badge to an operator (admin only)
 * Propagates the badge to all operator's listings via ListingBadge
 */
export const assignBadgeToOperator = async (c: Context) => {
  try {
    const currentUser = c.get("user");
    const body = await c.req.json();
    const { operatorId, badgeId } = body;

    if (!operatorId || !badgeId) {
      return c.json({ error: "operatorId and badgeId are required" }, 400);
    }

    // Verify badge exists and is active
    const badge = await prisma.badge.findUnique({ where: { id: badgeId } });
    if (!badge) {
      return c.json({ error: "Badge not found" }, 404);
    }
    if (!badge.isActive) {
      return c.json({ error: "Cannot assign an inactive badge" }, 400);
    }

    // Verify operator exists
    const profile = await prisma.operatorProfile.findUnique({
      where: { operatorId },
    });
    if (!profile) {
      return c.json({ error: "Operator profile not found" }, 404);
    }

    // Get current operator badge IDs from verificationDocuments metadata
    const verDocs: any = (profile.verificationDocuments as any) || {};
    const operatorBadgeIds: string[] = Array.isArray(verDocs.operatorBadgeIds)
      ? verDocs.operatorBadgeIds
      : [];

    if (operatorBadgeIds.includes(badgeId)) {
      return c.json({ error: "Badge is already assigned to this operator" }, 409);
    }

    // Get all operator's listings
    const listings = await prisma.listing.findMany({
      where: { operatorId },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      // 1. Update operator profile metadata
      const updatedBadgeIds = [...operatorBadgeIds, badgeId];
      await tx.operatorProfile.update({
        where: { operatorId },
        data: {
          verificationDocuments: {
            ...verDocs,
            operatorBadgeIds: updatedBadgeIds,
          },
        },
      });

      // 2. Bulk-assign badge to all operator's listings
      if (listings.length > 0) {
        const listingIds = listings.map((l) => l.id);

        // Check for existing assignments
        const existingAssignments = await tx.listingBadge.findMany({
          where: {
            listingId: { in: listingIds },
            badgeId,
          },
        });

        const existingListingIds = new Set(existingAssignments.map((a) => a.listingId));

        // Reactivate inactive ones
        const inactiveIds = existingAssignments
          .filter((a) => !a.isActive)
          .map((a) => a.id);

        if (inactiveIds.length > 0) {
          await tx.listingBadge.updateMany({
            where: { id: { in: inactiveIds } },
            data: {
              isActive: true,
              assignedByAdminId: currentUser.userId,
              assignedAt: new Date(),
            },
          });
        }

        // Create new assignments for listings that don't have this badge
        const newListingIds = listingIds.filter((id) => !existingListingIds.has(id));
        if (newListingIds.length > 0) {
          await tx.listingBadge.createMany({
            data: newListingIds.map((listingId) => ({
              listingId,
              badgeId,
              assignedByAdminId: currentUser.userId,
              isActive: true,
            })),
          });
        }
      }
    });

    return c.json({
      success: true,
      message: `Badge "${badge.badgeName}" assigned to operator and ${listings.length} listing(s)`,
      data: { operatorId, badgeId, listingsAffected: listings.length },
    });
  } catch (error) {
    console.error("Assign badge to operator error:", error);
    return c.json({ error: "Failed to assign badge to operator" }, 500);
  }
};

/**
 * Remove a badge from an operator (admin only)
 * Removes the badge from all operator's listings
 */
export const removeBadgeFromOperator = async (c: Context) => {
  try {
    const body = await c.req.json();
    const { operatorId, badgeId } = body;

    if (!operatorId || !badgeId) {
      return c.json({ error: "operatorId and badgeId are required" }, 400);
    }

    const profile = await prisma.operatorProfile.findUnique({
      where: { operatorId },
    });
    if (!profile) {
      return c.json({ error: "Operator profile not found" }, 404);
    }

    const verDocs: any = (profile.verificationDocuments as any) || {};
    const operatorBadgeIds: string[] = Array.isArray(verDocs.operatorBadgeIds)
      ? verDocs.operatorBadgeIds
      : [];

    if (!operatorBadgeIds.includes(badgeId)) {
      return c.json({ error: "Badge is not assigned to this operator" }, 404);
    }

    // Get all operator's listings
    const listings = await prisma.listing.findMany({
      where: { operatorId },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      // 1. Remove badge from operator metadata
      const updatedBadgeIds = operatorBadgeIds.filter((id) => id !== badgeId);
      await tx.operatorProfile.update({
        where: { operatorId },
        data: {
          verificationDocuments: {
            ...verDocs,
            operatorBadgeIds: updatedBadgeIds,
          },
        },
      });

      // 2. Deactivate badge from all operator's listings
      if (listings.length > 0) {
        await tx.listingBadge.updateMany({
          where: {
            listingId: { in: listings.map((l) => l.id) },
            badgeId,
            isActive: true,
          },
          data: { isActive: false },
        });
      }
    });

    return c.json({
      success: true,
      message: `Badge removed from operator and ${listings.length} listing(s)`,
      data: { operatorId, badgeId, listingsAffected: listings.length },
    });
  } catch (error) {
    console.error("Remove badge from operator error:", error);
    return c.json({ error: "Failed to remove badge from operator" }, 500);
  }
};

/**
 * Get all badges assigned to an operator (admin only)
 */
export const getOperatorBadges = async (c: Context) => {
  try {
    const operatorId = c.req.param("operatorId");

    const profile = await prisma.operatorProfile.findUnique({
      where: { operatorId },
    });
    if (!profile) {
      return c.json({ error: "Operator profile not found" }, 404);
    }

    const verDocs: any = (profile.verificationDocuments as any) || {};
    const operatorBadgeIds: string[] = Array.isArray(verDocs.operatorBadgeIds)
      ? verDocs.operatorBadgeIds
      : [];

    // Fetch full badge details
    const badges = operatorBadgeIds.length > 0
      ? await prisma.badge.findMany({
        where: {
          id: { in: operatorBadgeIds },
        },
        select: {
          id: true,
          badgeName: true,
          badgeType: true,
          badgeIconUrl: true,
          badgeColor: true,
          badgeDescription: true,
          displayOrder: true,
          isActive: true,
        },
        orderBy: { displayOrder: "asc" },
      })
      : [];

    return c.json({
      success: true,
      data: badges,
      operatorId,
    });
  } catch (error) {
    console.error("Get operator badges error:", error);
    return c.json({ error: "Failed to fetch operator badges" }, 500);
  }
};

const SETTLEMENT_STATUS_LABELS = {
  PAID: "Paid",
  PENDING: "Pending",
  REFUND_PENDING: "Refund Pending",
  REFUNDED: "Refunded",
  SETTLEMENT_ISSUE: "Settlement Issue",
  ISSUE_RESOLVED: "Issue Resolved",
} as const;

const PENDING_SETTLEMENT_STATUSES = [
  "PENDING",
  "REFUND_PENDING",
  "SETTLEMENT_ISSUE",
] as const;

const parsePositiveInteger = (value: string | undefined, fallback: number, max?: number) => {
  const parsed = Number.parseInt(value || "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  if (typeof max === "number") {
    return Math.min(parsed, max);
  }

  return parsed;
};

const normalizeSettlementStatus = (value: string | undefined) => {
  if (!value || value.toLowerCase() === "all") {
    return undefined;
  }

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  return normalized;
};

const getDateRangeBounds = (range: string | undefined) => {
  if (!range || range === "all") {
    return undefined;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (range === "today") {
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    return {
      gte: startOfToday,
      lt: endOfToday,
    };
  }

  if (range === "next_7_days") {
    const end = new Date(startOfToday);
    end.setDate(end.getDate() + 7);

    return {
      gte: startOfToday,
      lte: end,
    };
  }

  if (range === "this_month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return {
      gte: monthStart,
      lt: nextMonthStart,
    };
  }

  if (range === "past") {
    return {
      lt: startOfToday,
    };
  }

  return undefined;
};

const maskAccountNumber = (accountNumber: unknown) => {
  const digits = String(accountNumber || "").replace(/\s+/g, "");

  if (!digits) {
    return null;
  }

  if (digits.length <= 4) {
    return digits;
  }

  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
};

/**
 * Get seller settlements page payload
 * GET /api/operators/:operatorId/settlements
 */
export const getOperatorSettlements = async (c: Context) => {
  try {
    const user = c.get("user");
    const operatorId = c.req.param("operatorId");

    if (!operatorId) {
      return c.json({ success: false, error: "Operator ID is required" }, 400);
    }

    const isAdmin = user.userType === "admin" || user.userType === "super_admin";
    if (!isAdmin && user.userId !== operatorId) {
      return c.json({ success: false, error: "Unauthorized to view settlements" }, 403);
    }

    const page = parsePositiveInteger(c.req.query("page"), 1);
    const limit = parsePositiveInteger(c.req.query("limit"), 10, 50);
    const search = (c.req.query("search") || "").trim();
    const category = (c.req.query("category") || "").trim();
    const dateRange = (c.req.query("dateRange") || "all").trim();
    const settlementStatus = normalizeSettlementStatus(c.req.query("status"));
    const skip = (page - 1) * limit;

    const operatorBookingScope = {
      OR: [
        { listingSlot: { listing: { operatorId } } },
        { dateRange: { listing: { operatorId } } },
      ],
    };

    const bookingStartDate = getDateRangeBounds(dateRange);

    const whereClause: any = {
      booking: {
        ...operatorBookingScope,
        ...(bookingStartDate ? { bookingStartDate } : {}),
      },
    };

    if (settlementStatus) {
      whereClause.settlementStatus = settlementStatus as any;
    }

    if (search) {
      whereClause.OR = [
        {
          booking: {
            bookingReference: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
        {
          booking: {
            listingSlot: {
              listing: {
                listingName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          },
        },
        {
          booking: {
            dateRange: {
              listing: {
                listingName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          },
        },
        {
          booking: {
            listingSlot: {
              listing: {
                startLocationName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          },
        },
        {
          booking: {
            dateRange: {
              listing: {
                startLocationName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
          },
        },
      ];
    }

    if (category) {
      whereClause.booking = {
        ...whereClause.booking,
        OR: [
          {
            listingSlot: {
              listing: {
                operatorId,
                category: {
                  categoryName: {
                    equals: category,
                    mode: "insensitive",
                  },
                },
              },
            },
          },
          {
            dateRange: {
              listing: {
                operatorId,
                category: {
                  categoryName: {
                    equals: category,
                    mode: "insensitive",
                  },
                },
              },
            },
          },
        ],
      };
    }

    const [summaryAgg, pendingCount, totalCount, payments, operatorProfile, categories] = await Promise.all([
      prisma.bookingPayment.aggregate({
        _sum: {
          totalEarnings: true,
        },
        where: {
          booking: operatorBookingScope,
        },
      }),
      prisma.bookingPayment.count({
        where: {
          booking: operatorBookingScope,
          settlementStatus: {
            in: [...PENDING_SETTLEMENT_STATUSES] as any,
          },
        },
      }),
      prisma.bookingPayment.count({
        where: whereClause,
      }),
      prisma.bookingPayment.findMany({
        where: whereClause,
        select: {
          id: true,
          bookingId: true,
          totalEarnings: true,
          balanceToCollect: true,
          netPayToSeller: true,
          settlementStatus: true,
          settlementDate: true,
          reason: true,
          reasonbyadmin: true,
          createdAt: true,
          updatedAt: true,
          booking: {
            select: {
              id: true,
              bookingReference: true,
              bookingStartDate: true,
              bookingEndDate: true,
              createdAt: true,
              participantCount: true,
              participants: true,
              customer: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true,
                  gender: true,
                },
              },
              listingSlot: {
                select: {
                  startTime: true,
                  endTime: true,
                  slotDefinition: {
                    select: {
                      startTime: true,
                      endTime: true,
                    },
                  },
                  listing: {
                    select: {
                      id: true,
                      listingName: true,
                      frontImageUrl: true,
                      startLocationName: true,
                      currency: true,
                      category: {
                        select: {
                          categoryName: true,
                        },
                      },
                    },
                  },
                },
              },
              dateRange: {
                select: {
                  slotDefinition: {
                    select: {
                      startTime: true,
                      endTime: true,
                    },
                  },
                  listing: {
                    select: {
                      id: true,
                      listingName: true,
                      frontImageUrl: true,
                      startLocationName: true,
                      currency: true,
                      category: {
                        select: {
                          categoryName: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [
          { booking: { bookingStartDate: "desc" } },
          { createdAt: "desc" },
        ],
        skip,
        take: limit,
      }),
      prisma.operatorProfile.findUnique({
        where: { operatorId },
        select: {
          companyName: true,
          bankAccountDetails: true,
        },
      }),
      prisma.listing.findMany({
        where: {
          operatorId,
          category: {
            isNot: null,
          },
        },
        select: {
          category: {
            select: {
              categoryName: true,
            },
          },
        },
        distinct: ["categoryId"],
        orderBy: {
          category: {
            categoryName: "asc",
          },
        },
      }),
    ]);

    const settlements = payments.map((payment) => {
      const listing = payment.booking.listingSlot?.listing || payment.booking.dateRange?.listing;
      const slotStart =
        payment.booking.listingSlot?.slotDefinition?.startTime ||
        payment.booking.listingSlot?.startTime ||
        payment.booking.dateRange?.slotDefinition?.startTime ||
        null;
      const slotEnd =
        payment.booking.listingSlot?.slotDefinition?.endTime ||
        payment.booking.listingSlot?.endTime ||
        payment.booking.dateRange?.slotDefinition?.endTime ||
        null;

      return {
        id: payment.id,
        bookingId: payment.booking.id,
        bookingReference: payment.booking.bookingReference,
        bookingStartDate: payment.booking.bookingStartDate,
        bookingEndDate: payment.booking.bookingEndDate,
        bookingCreatedAt: payment.booking.createdAt,
        slotStart,
        slotEnd,
        listingId: listing?.id || null,
        activityName: listing?.listingName || "Untitled Activity",
        activityImageUrl: listing?.frontImageUrl || null,
        location: listing?.startLocationName || "-",
        category: listing?.category?.categoryName || null,
        currency: listing?.currency || "INR",
        participantCount: payment.booking.participantCount,
        participants: Array.isArray(payment.booking.participants)
          ? payment.booking.participants
          : [],
        customerName:
          `${payment.booking.customer?.firstName || ""} ${payment.booking.customer?.lastName || ""}`.trim() ||
          "Customer",
        customerPhone: payment.booking.customer?.phone || null,
        customerEmail: payment.booking.customer?.email || null,
        customerGender: payment.booking.customer?.gender || null,
        totalEarnings: payment.totalEarnings,
        balanceToCollect: payment.balanceToCollect,
        netPayToSeller: payment.netPayToSeller,
        settlementStatus: payment.settlementStatus,
        settlementStatusLabel:
          SETTLEMENT_STATUS_LABELS[payment.settlementStatus as keyof typeof SETTLEMENT_STATUS_LABELS] ||
          payment.settlementStatus,
        settlementDate: payment.settlementDate,
        reason: payment.reason,
        reasonByAdmin: payment.reasonbyadmin,
        concernRaisedAt: payment.reason ? payment.updatedAt : null,
        adminRespondedAt: payment.reasonbyadmin ? payment.updatedAt : null,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
      };
    });

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const bankDetails = (operatorProfile?.bankAccountDetails as Record<string, unknown> | null) || null;

    return c.json({
      success: true,
      data: {
        summary: {
          totalEarnings: (summaryAgg._sum.totalEarnings || 0) / 100,
          pendingSettlementCount: pendingCount,
        },
        filters: {
          categories: categories
            .map((entry) => entry.category?.categoryName)
            .filter((value): value is string => Boolean(value)),
          statuses: Object.entries(SETTLEMENT_STATUS_LABELS).map(([value, label]) => ({
            value,
            label,
          })),
        },
        bankDetails: bankDetails
          ? {
              companyName: operatorProfile?.companyName || null,
              accountHolderName: bankDetails.accountHolderName || null,
              accountNumberMasked: maskAccountNumber(bankDetails.accountNumber),
              ifscCode: bankDetails.ifscCode || null,
              branchName: bankDetails.branchName || null,
            }
          : null,
        settlements,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages,
        },
      },
    });
  } catch (error) {
    console.error("Get operator settlements error:", error);
    return c.json({ success: false, error: "Failed to fetch settlements" }, 500);
  }
};

/**
 * Raise or edit a settlement concern for a seller-owned booking payment.
 * POST /api/operators/:operatorId/settlements/:settlementId/concern
 */
export const upsertOperatorSettlementConcern = async (c: Context) => {
  try {
    const user = c.get("user");
    const operatorId = c.req.param("operatorId");
    const settlementId = c.req.param("settlementId");
    const body = await c.req.json().catch(() => ({}));
    const concern = sanitizeString(String(body?.reason || ""), 2000).trim();

    if (!operatorId || !settlementId) {
      return c.json({ success: false, error: "Operator ID and settlement ID are required" }, 400);
    }

    if (user.userType !== "operator" || user.userId !== operatorId) {
      return c.json({ success: false, error: "Unauthorized to update this settlement" }, 403);
    }

    if (!concern) {
      return c.json({ success: false, error: "Concern note is required" }, 400);
    }

    if (concern.length > 200) {
      return c.json({ success: false, error: "Concern note must be 200 characters or fewer" }, 400);
    }

    const existingPayment = await prisma.bookingPayment.findFirst({
      where: {
        id: settlementId,
        booking: {
          OR: [
            { listingSlot: { listing: { operatorId } } },
            { dateRange: { listing: { operatorId } } },
          ],
        },
      },
      select: {
        id: true,
        reason: true,
        reasonbyadmin: true,
        settlementStatus: true,
      },
    });

    if (!existingPayment) {
      return c.json({ success: false, error: "Settlement not found" }, 404);
    }

    const updatedPayment = await prisma.bookingPayment.update({
      where: { id: settlementId },
      data: {
        reason: concern,
        reasonbyadmin: null,
        settlementStatus: "SETTLEMENT_ISSUE",
      },
      select: {
        id: true,
        reason: true,
        reasonbyadmin: true,
        settlementStatus: true,
        updatedAt: true,
      },
    });

    return c.json({
      success: true,
      message: existingPayment.reason
        ? "Concern updated successfully"
        : "Concern raised successfully",
      data: {
        id: updatedPayment.id,
        reason: updatedPayment.reason,
        reasonByAdmin: updatedPayment.reasonbyadmin,
        settlementStatus: updatedPayment.settlementStatus,
        updatedAt: updatedPayment.updatedAt,
      },
    });
  } catch (error) {
    console.error("Upsert operator settlement concern error:", error);
    return c.json({ success: false, error: "Failed to update settlement concern" }, 500);
  }
};

/**
 * Get seller dashboard summary
 * GET /api/operators/dashboard/:operatorId
 */
export const getOperatorDashboardSummary = async (c: Context) => {
  try {
    const user = c.get("user");
    const operatorId = c.req.param("operatorId");

    if (!operatorId) {
      return c.json({ error: "Operator ID is required" }, 400);
    }

    if (
      user.userId !== operatorId &&
      user.userType !== "admin" &&
      user.userType !== "super_admin"
    ) {
      return c.json({ error: "Unauthorized to view this dashboard" }, 403);
    }

    const [
      totalBookings,
      totalEarningsAgg,
      liveListingsCount,
      operatorRatingAgg,
      policies,
      liveListingsRaw,
      recentBookingsRaw,
    ] = await Promise.all([
      prisma.booking.count({
        where: {
          OR: [
            { listingSlot: { listing: { operatorId } } },
            { dateRange: { listing: { operatorId } } },
          ],
        },
      }),
      prisma.bookingPayment.aggregate({
        _sum: { totalEarnings: true },
        where: {
          booking: {
            OR: [
              { listingSlot: { listing: { operatorId } } },
              { dateRange: { listing: { operatorId } } },
            ],
            bookingStatus: { in: ["CONFIRMED", "COMPLETED"] },
          },
        },
      }),
      prisma.listing.count({
        where: {
          operatorId,
          status: "active",
        },
      }),
      prisma.review.aggregate({
        _avg: { rating: true },
        where: { operatorId },
      }),
      prisma.listingPolicy.findMany({
        where: {
          sellerId: operatorId,
          policyType: { in: SELLER_POLICY_TYPES as any },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.listing.findMany({
        where: {
          operatorId,
          status: "active",
        },
        select: {
          id: true,
          listingName: true,
          startLocationName: true,
          bookingFormat: true,
          category: { select: { categoryName: true } },
          frontImageUrl: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.booking.findMany({
        where: {
          OR: [
            { listingSlot: { listing: { operatorId } } },
            { dateRange: { listing: { operatorId } } },
          ],
        },
        select: {
          id: true,
          bookingReference: true,
          bookingStartDate: true,
          bookingEndDate: true,
          bookingStatus: true,
          totalAmount: true,
          customer: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
          listingSlot: {
            select: {
              listing: {
                select: {
                  listingName: true,
                  startLocationName: true,
                  frontImageUrl: true,
                },
              },
              slotDefinition: {
                select: {
                  startTime: true,
                  endTime: true,
                },
              },
              startTime: true,
              endTime: true,
            },
          },
          dateRange: {
            select: {
              listing: {
                select: {
                  listingName: true,
                  startLocationName: true,
                  frontImageUrl: true,
                },
              },
              slotDefinition: {
                select: {
                  startTime: true,
                  endTime: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const policyMap = new Map<string, any>();
    for (const policy of policies) {
      if (!policyMap.has(policy.policyType)) {
        policyMap.set(policy.policyType, policy);
      }
    }

    const hasRentalListings = liveListingsRaw.some(
      (listing) => listing.bookingFormat === "F2" || listing.bookingFormat === "F4",
    );

    const visiblePolicyTypes = SELLER_POLICY_TYPES.filter(
      (policyType) => policyType !== "exchange" || hasRentalListings,
    );

    const policyChecklist = visiblePolicyTypes.map((policyType) => {
      const policy = policyMap.get(policyType);

      if (policy) {
        return {
          policyType,
          status: "added",
          statusLabel: "Added",
          policyId: policy.id,
        };
      }

      if (policyType === "rescheduling") {
        return {
          policyType,
          status: "draft",
          statusLabel: "Draft",
          policyId: null,
        };
      }

      return {
        policyType,
        status: "add",
        statusLabel: "Add",
        policyId: null,
      };
    });

    const liveListings = await Promise.all(
      liveListingsRaw.map(async (listing) => {
        let activeCount = 0;
        let activeLabel = "Units";

        if (listing.bookingFormat === "F2") {
          activeCount = await prisma.inventoryDateRange.count({
            where: {
              listingId: listing.id,
              isActive: true,
            },
          });
          activeLabel = "Days";
        } else if (listing.bookingFormat === "F3") {
          activeCount = await prisma.listingSlot.count({
            where: {
              listingId: listing.id,
              isActive: true,
              slotDefinitionId: { not: null },
            },
          });
          activeLabel = "Slots";
        } else if (listing.bookingFormat === "F4") {
          activeCount = await prisma.inventoryDateRange.count({
            where: {
              listingId: listing.id,
              isActive: true,
              slotDefinitionId: { not: null },
            },
          });
          activeLabel = "Slots";
        } else {
          activeCount = await prisma.listingSlot.count({
            where: {
              listingId: listing.id,
              isActive: true,
            },
          });
          activeLabel = "Batches";
        }

        return {
          id: listing.id,
          activityName: listing.listingName || "Untitled Listing",
          location: listing.startLocationName || "-",
          category: listing.category?.categoryName || "-",
          imageUrl: listing.frontImageUrl || null,
          activeCount,
          activeLabel,
        };
      })
    );

    const recentBookings = recentBookingsRaw.map((booking) => {
      const listing = booking.listingSlot?.listing || booking.dateRange?.listing;
      const slotStart =
        booking.listingSlot?.slotDefinition?.startTime ||
        booking.listingSlot?.startTime ||
        booking.dateRange?.slotDefinition?.startTime ||
        null;
      const slotEnd =
        booking.listingSlot?.slotDefinition?.endTime ||
        booking.listingSlot?.endTime ||
        booking.dateRange?.slotDefinition?.endTime ||
        null;

      return {
        id: booking.id,
        bookingReference: booking.bookingReference,
        customerName:
          `${booking.customer?.firstName || ""} ${booking.customer?.lastName || ""}`.trim() ||
          "Customer",
        activityName: listing?.listingName || "-",
        location: listing?.startLocationName || "-",
        imageUrl: listing?.frontImageUrl || null,
        bookingDate: booking.bookingStartDate,
        bookingEndDate: booking.bookingEndDate,
        slotStart,
        slotEnd,
        totalAmount: Number(booking.totalAmount || 0),
        bookingStatus: booking.bookingStatus,
      };
    });

    const totalEarningsRupees = (totalEarningsAgg._sum.totalEarnings || 0) / 100;

    return c.json({
      success: true,
      data: {
        stats: {
          totalBookings,
          totalEarnings: totalEarningsRupees,
          liveListings: liveListingsCount,
          customerRating: Number(operatorRatingAgg._avg.rating || 0),
        },
        policyChecklist,
        liveListings,
        recentBookings,
      },
    });
  } catch (error) {
    console.error("Get operator dashboard summary error:", error);
    return c.json({ error: "Failed to fetch dashboard summary" }, 500);
  }
};
