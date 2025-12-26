import type { Context } from "hono";
import { prisma } from "../db.js";
import { configureCloudinary } from "../config/cloudinary.config.js";
import { Readable } from "stream";
import {
  hashPassword,
  formatUserResponse,
} from "../helpers/auth.helper.js";
import {
  validateOperatorCompleteRegistration,
  validateOperatorProfileUpdate,
  sanitizeEmail,
  sanitizePhone,
  sanitizeString,
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
  addressLine02?:  string;
  city: string;
  state: string;
  pincode: string;
  country?:  string;
  
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
            url: result?. secure_url,
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

    // Extract all text fields
    const registrationData = {
      email:  body.email as string,
      phone: body. phone as string,
      password:  body.password as string,
      businessName: body.businessName as string,
      operatorName:  body.operatorName as string,
      contactNumber: body.contactNumber as string,
      contactEmail: body.contactEmail as string,
      addressLine01: body. addressLine01 as string,
      addressLine02: body.addressLine02 as string,
      city: body.city as string,
      state: body.state as string,
      pincode: body.pincode as string,
      country: body.country as string,
      panNumber: body.panNumber as string,
      gstinNumber: body.gstinNumber as string,
      bankAccountNumber: body.bankAccountNumber as string,
      confirmBankAccountNumber: body.confirmBankAccountNumber as string,
      ifscCode: body.ifscCode as string,
      branchName:  body.branchName as string,
      accountHolderName:  body.accountHolderName as string,
      websiteUrl:  body.websiteUrl as string,
      companyDescription: body. companyDescription as string,
      socialMediaLinks: body.socialMediaLinks as string,
    };

    // Validate registration data
    const validation = validateOperatorCompleteRegistration(registrationData);
    if (! validation.isValid) {
      return c.json({ error: validation.message }, 400);
    }

    // Sanitize inputs
    const email = sanitizeEmail(registrationData.email);
    const phone = sanitizePhone(registrationData. phone);
    const businessName = sanitizeString(registrationData.businessName, 100);
    const operatorName = sanitizeString(registrationData. operatorName, 100);

    // Check if email already exists
    const existingUser = await prisma.user.findFirst({
      where: { email:  email },
    });

    if (existingUser) {
      return c.json({ error: "Email already registered" }, 409);
    }

    // Check if phone already exists
    const existingPhone = await prisma.user.findFirst({
      where: { phone: phone },
    });

    if (existingPhone) {
      return c.json({ error: "Phone number already registered" }, 409);
    }

    // Validate bank account confirmation
    if (registrationData.bankAccountNumber !== registrationData.confirmBankAccountNumber) {
      return c.json({ error: "Bank account numbers do not match" }, 400);
    }

    // Collect uploaded files
    const documentFiles: { key: string; file: File }[] = [];
    
    // KYC Documents
    if (body.panDocument && body.panDocument instanceof File) {
      documentFiles. push({ key: "pan_document", file: body.panDocument });
    }
    if (body.businessLicense && body.businessLicense instanceof File) {
      documentFiles.push({ key: "business_license", file: body.businessLicense });
    }
    if (body.idProof && body.idProof instanceof File) {
      documentFiles. push({ key: "id_proof", file: body.idProof });
    }

    // Certifications (can be multiple)
    const certificationFiles: File[] = [];
    if (body.certifications) {
      if (Array.isArray(body.certifications)) {
        certificationFiles.push(...body.certifications. filter((f): f is File => f instanceof File));
      } else if (body.certifications instanceof File) {
        certificationFiles.push(body.certifications);
      }
    }

    // Validate that at least PAN and Business License are uploaded
    const hasPan = documentFiles.some(d => d.key === "pan_document");
    const hasBusinessLicense = documentFiles.some(d => d.key === "business_license");
    
    if (!hasPan || !hasBusinessLicense) {
      return c.json(
        { error: "PAN document and Business License are required" },
        400
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(registrationData. password);

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

    // Prepare bank account details (will be encrypted in production)
    const bankAccountDetails = {
      accountNumber: registrationData.bankAccountNumber,
      ifscCode: registrationData.ifscCode,
      branchName: registrationData.branchName,
      accountHolderName: registrationData.accountHolderName,
    };

    // Create everything in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const newUser = await tx.user.create({
        data: {
          email: email,
          phone:  phone,
          password: hashedPassword,
          firstName: firstName,
          lastName: lastName,
          userType: "operator",
          isVerified: false, // Will be verified by admin
          isActive: false, // Inactive until admin approval
        },
      });

      // Create business address
      await tx.userAddress.create({
        data: {
          userId: newUser. id,
          addressType: "BILLING",
          fullAddress: `${registrationData.addressLine01}${registrationData.addressLine02 ? ", " + registrationData.addressLine02 : ""}`,
          city: sanitizeString(registrationData.city, 100),
          state: sanitizeString(registrationData.state, 100),
          country: sanitizeString(registrationData.country || "India", 100),
          postalCode: sanitizeString(registrationData.pincode, 20),
          isDefault: true,
        },
      });

      // Create operator profile with all details
      const operatorProfile = await tx.operatorProfile.create({
        data: {
          operatorId: newUser.id,
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
        },
      });

      return { user: newUser, operatorProfile };
    });

    return c.json(
      {
        message: "Your profile has been created successfully! ",
        subtitle: "Our admins will verify your documents and contact you for further steps on Thrill Bazaar! ",
        userId: result.user.id,
        operatorProfileId: result.operatorProfile. id,
        status: "pending_verification",
        note: "A confirmation has been sent to your mobile number.",
      },
      201
    );
  } catch (error) {
    console.error("Operator registration error:", error);
    
    if (error instanceof Error) {
      console.error("Error details:", error. message);
      console.error("Stack trace:", error. stack);
    }
    
    return c.json({ error: "Internal server error" }, 500);
  }
};

/**
 * Get operator profile (ONLY for verified operators or admins)
 */
export const getOperatorProfile = async (c:  Context) => {
  try {
    const user = c.get("user");
    const operatorId = c.req.param("operatorId") || user.userId;

    // Check permissions
    if (user.userType === "operator" && operatorId !== user.userId) {
      return c.json({ error: "Can only view your own profile" }, 403);
    }

    const operatorProfile = await prisma. operatorProfile.findUnique({
      where: { operatorId: operatorId },
      include: {
        operator: {
          select: {
            id:  true,
            email: true,
            phone: true,
            firstName: true,
            lastName:  true,
            isVerified:  true,
            isActive: true,
            createdAt: true,
          },
        },
        verifiedByAdmin: {
          select: {
            id:  true,
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
    const businessAddress = await prisma. userAddress.findFirst({
      where: {
        userId: operatorId,
        addressType:  "BILLING",
      },
    });

    // Hide sensitive bank details from operator view
    let profileData = { ...operatorProfile };
    if (user.userType === "operator") {
      profileData = {
        ...profileData,
        bankAccountDetails: null, // Hide bank details from operator
      };
    }

    return c.json({
      message: "Operator profile retrieved successfully",
      operatorProfile: profileData,
      businessAddress: businessAddress,
    });
  } catch (error) {
    console.error("Get operator profile error:", error);
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

    const where:  any = {};

    if (body.verificationStatus) {
      where.verificationStatus = body.verificationStatus;
    }

    if (body.search) {
      where.OR = [
        { companyName: { contains: body. search, mode: "insensitive" } },
        { operator: { email: { contains: body.search, mode: "insensitive" } } },
        { operator: { phone: { contains: body.search } } },
      ];
    }

    const [operators, totalCount] = await Promise.all([
      prisma. operatorProfile.findMany({
        where,
        include: {
          operator: {
            select:  {
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
            select:  {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.operatorProfile.count({ where }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    return c.json({
      message: "Operators retrieved successfully",
      data: {
        operators,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: {
          verificationStatus: body. verificationStatus || null,
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

    if (!["admin", "super_admin"].includes(currentUser. userType)) {
      return c.json({ error: "Only admins can verify operators" }, 403);
    }

    const { action, rejectionReason } = body;

    if (! ["verify", "reject"].includes(action)) {
      return c.json(
        { error: "Invalid action.  Must be 'verify' or 'reject'" },
        400
      );
    }

    if (action === "reject" && ! rejectionReason) {
      return c.json({ error: "Rejection reason is required" }, 400);
    }

    const operatorProfile = await prisma.operatorProfile.findUnique({
      where: { operatorId: operatorId },
    });

    if (!operatorProfile) {
      return c.json({ error: "Operator profile not found" }, 404);
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedProfile = await tx.operatorProfile. update({
        where: { operatorId: operatorId },
        data: {
          verificationStatus: action === "verify" ? "VERIFIED" : "REJECTED",
          verifiedByAdminId: currentUser.userId,
          verifiedAt: new Date(),
          rejectionReason: action === "reject" ? rejectionReason : null,
        },
      });

      await tx.user.update({
        where: { id: operatorId },
        data: {
          isVerified: action === "verify",
          isActive:  action === "verify",
        },
      });

      return updatedProfile;
    });

    return c.json({
      message: `Operator ${action === "verify" ? "verified" :  "rejected"} successfully`,
      operatorProfile: result,
    });
  } catch (error) {
    console.error("Verify operator error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
};