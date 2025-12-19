//  Validation helper functions for authentication and user management
import {
  isValidEmail,
  isValidPhone,
  validatePassword,
  isValidAdminType,
  isValidUserType,
} from "./auth.helper.js";

export interface ValidationResult {
  isValid: boolean;
  message?: string;
}

export const validateCustomerRegistration = (data: {
  phone?: string;
  firstName?: string;
  lastName?: string;
}): ValidationResult => {
  if (!data.phone) {
    return {
      isValid: false,
      message: "Phone number is required for customer registration",
    };
  }

  if (!isValidPhone(data.phone)) {
    return { isValid: false, message: "Invalid phone number format" };
  }

  if (data.firstName && data.firstName.length > 50) {
    return {
      isValid: false,
      message: "First name must be less than 50 characters",
    };
  }

  if (data.lastName && data.lastName.length > 50) {
    return {
      isValid: false,
      message: "Last name must be less than 50 characters",
    };
  }

  return { isValid: true };
};

export const validateAdminRegistration = (data: {
  email?: string;
  password?: string;
  userType?: string;
  firstName?: string;
  lastName?: string;
}): ValidationResult => {
  if (!data.email) {
    return {
      isValid: false,
      message: "Email is required for admin registration",
    };
  }

  if (!data.password) {
    return {
      isValid: false,
      message: "Password is required for admin registration",
    };
  }

  if (!isValidEmail(data.email)) {
    return { isValid: false, message: "Invalid email format" };
  }

  const passwordValidation = validatePassword(data.password);
  if (!passwordValidation.isValid) {
    return passwordValidation;
  }

  if (!data.userType || !isValidAdminType(data.userType)) {
    return {
      isValid: false,
      message: "Valid userType is required (operator, admin, or super_admin)",
    };
  }

  if (data.firstName && data.firstName.length > 50) {
    return {
      isValid: false,
      message: "First name must be less than 50 characters",
    };
  }

  if (data.lastName && data.lastName.length > 50) {
    return {
      isValid: false,
      message: "Last name must be less than 50 characters",
    };
  }

  return { isValid: true };
};

export const validateLoginRequest = (data: {
  email?: string;
  phone?: string;
  password?: string;
}): ValidationResult => {
  if (!data.password) {
    return { isValid: false, message: "Password is required" };
  }

  if (!data.email && !data.phone) {
    return { isValid: false, message: "Either email or phone is required" };
  }

  if (data.email && !isValidEmail(data.email)) {
    return { isValid: false, message: "Invalid email format" };
  }

  if (data.phone && !isValidPhone(data.phone)) {
    return { isValid: false, message: "Invalid phone number format" };
  }

  return { isValid: true };
};

export const validateCustomerLoginRequest = (data: {
  phone?: string;
}): ValidationResult => {
  if (!data.phone) {
    return { isValid: false, message: "Phone number is required" };
  }

  if (!isValidPhone(data.phone)) {
    return { isValid: false, message: "Invalid phone number format" };
  }

  return { isValid: true };
};

export const validateAdminLoginRequest = (data: {
  email?: string;
  password?: string;
}): ValidationResult => {
  if (!data.email) {
    return { isValid: false, message: "Email is required" };
  }

  if (!data.password) {
    return { isValid: false, message: "Password is required" };
  }

  if (!isValidEmail(data.email)) {
    return { isValid: false, message: "Invalid email format" };
  }

  return { isValid: true };
};

export const validateOtpRequest = (data: {
  phone?: string;
  otp?: string;
}): ValidationResult => {
  if (!data.phone) {
    return { isValid: false, message: "Phone number is required" };
  }

  if (!data.otp) {
    return { isValid: false, message: "OTP is required" };
  }

  if (!isValidPhone(data.phone)) {
    return { isValid: false, message: "Invalid phone number format" };
  }

  if (!/^\d{6}$/.test(data.otp)) {
    return { isValid: false, message: "OTP must be 6 digits" };
  }

  return { isValid: true };
};

export const sanitizeString = (
  input: string,
  maxLength: number = 255
): string => {
  if (!input) return "";
  return input.trim().substring(0, maxLength);
};

export const sanitizePhone = (phone: string): string => {
  if (!phone) return "";
  return phone.replace(/[\s\-\(\)]/g, "");
};

export const sanitizeEmail = (email: string): string => {
  if (!email) return "";
  return email.toLowerCase().trim();
};

export const validateProfileUpdate = (
  data: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
  },
  userType: string
): ValidationResult => {
  // Customers can only update phone and names
  if (userType === "customer") {
    if (data.phone) {
      return {
        isValid: false,
        message: "Customers cannot update email address",
      };
    }
  } else {
    // Admin users can only update email and names
    if (data.phone) {
      return {
        isValid: false,
        message: "Admin users cannot update phone number",
      };
    }

    if (data.email && !isValidEmail(data.email)) {
      return { isValid: false, message: "Invalid email format" };
    }
  }

  if (data.firstName && data.firstName.length > 50) {
    return {
      isValid: false,
      message: "First name must be less than 50 characters",
    };
  }

  if (data.lastName && data.lastName.length > 50) {
    return {
      isValid: false,
      message: "Last name must be less than 50 characters",
    };
  }

  // Check if at least one field is provided
  if (!data.email && !data.phone && !data.firstName && !data.lastName) {
    return {
      isValid: false,
      message: "At least one field must be provided to update",
    };
  }

  return { isValid: true };
};

export const validatePasswordChange = (data: {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}): ValidationResult => {
  if (!data.currentPassword) {
    return { isValid: false, message: "Current password is required" };
  }

  if (!data.newPassword) {
    return { isValid: false, message: "New password is required" };
  }

  if (!data.confirmPassword) {
    return { isValid: false, message: "Password confirmation is required" };
  }

  if (data.newPassword !== data.confirmPassword) {
    return {
      isValid: false,
      message: "New password and confirmation do not match",
    };
  }

  if (data.currentPassword === data.newPassword) {
    return {
      isValid: false,
      message: "New password must be different from current password",
    };
  }

  const passwordValidation = validatePassword(data.newPassword);
  if (!passwordValidation.isValid) {
    return passwordValidation;
  }

  return { isValid: true };
};

export const validateUsersListQuery = (query: {
  page?: string;
  limit?: string;
  userType?: string;
  isActive?: string;
  isVerified?: string;
  search?: string;
}): ValidationResult => {
  // Validate page
  if (query.page && (isNaN(Number(query.page)) || Number(query.page) < 1)) {
    return { isValid: false, message: "Page must be a positive number" };
  }

  // Validate limit
  if (
    query.limit &&
    (isNaN(Number(query.limit)) ||
      Number(query.limit) < 1 ||
      Number(query.limit) > 100)
  ) {
    return {
      isValid: false,
      message: "Limit must be a number between 1 and 100",
    };
  }

  // Validate userType
  if (query.userType && !isValidUserType(query.userType)) {
    return { isValid: false, message: "Invalid user type" };
  }

  // Validate boolean fields
  if (
    query.isActive &&
    !["true", "false"].includes(query.isActive.toLowerCase())
  ) {
    return { isValid: false, message: "isActive must be true or false" };
  }

  if (
    query.isVerified &&
    !["true", "false"].includes(query.isVerified.toLowerCase())
  ) {
    return { isValid: false, message: "isVerified must be true or false" };
  }

  // Validate search length
  if (query.search && query.search.length < 2) {
    return {
      isValid: false,
      message: "Search query must be at least 2 characters",
    };
  }

  return { isValid: true };
};

export const validateUsersListBody = (body: {
  page?: number;
  limit?: number;
  userType?: string;
  isActive?: boolean;
  isVerified?: boolean;
  search?: string;
}): ValidationResult => {
  // Validate page
  if (body.page && (typeof body.page !== "number" || body.page < 1)) {
    return { isValid: false, message: "Page must be a positive number" };
  }

  // Validate limit
  if (
    body.limit &&
    (typeof body.limit !== "number" || body.limit < 1 || body.limit > 100)
  ) {
    return {
      isValid: false,
      message: "Limit must be a number between 1 and 100",
    };
  }

  // Validate userType
  if (body.userType && !isValidUserType(body.userType)) {
    return { isValid: false, message: "Invalid user type" };
  }

  // Validate boolean fields
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    return { isValid: false, message: "isActive must be a boolean" };
  }

  if (body.isVerified !== undefined && typeof body.isVerified !== "boolean") {
    return { isValid: false, message: "isVerified must be a boolean" };
  }

  // Validate search length
  if (body.search && body.search.length < 2) {
    return {
      isValid: false,
      message: "Search query must be at least 2 characters",
    };
  }

  return { isValid: true };
};

export const validateUpdateAnyUser = (data: {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  userType?: string;
  isActive?: boolean;
  isVerified?: boolean;
  password?: string;
}): ValidationResult => {
  // Validate email format
  if (data.email && !isValidEmail(data.email)) {
    return { isValid: false, message: "Invalid email format" };
  }

  // Validate phone format
  if (data.phone && !isValidPhone(data.phone)) {
    return { isValid: false, message: "Invalid phone number format" };
  }

  // Validate name lengths
  if (data.firstName && data.firstName.length > 50) {
    return {
      isValid: false,
      message: "First name must be less than 50 characters",
    };
  }

  if (data.lastName && data.lastName.length > 50) {
    return {
      isValid: false,
      message: "Last name must be less than 50 characters",
    };
  }

  // Validate user type
  if (data.userType && !isValidUserType(data.userType)) {
    return { isValid: false, message: "Invalid user type" };
  }

  // Validate boolean fields
  if (data.isActive !== undefined && typeof data.isActive !== "boolean") {
    return { isValid: false, message: "isActive must be a boolean" };
  }

  if (data.isVerified !== undefined && typeof data.isVerified !== "boolean") {
    return { isValid: false, message: "isVerified must be a boolean" };
  }

  // Validate password
  if (data.password) {
    const passwordValidation = validatePassword(data.password);
    if (!passwordValidation.isValid) {
      return passwordValidation;
    }
  }

  // Check if at least one field is provided
  if (
    !data.email &&
    !data.phone &&
    !data.firstName &&
    !data.lastName &&
    !data.userType &&
    data.isActive === undefined &&
    data.isVerified === undefined &&
    !data.password
  ) {
    return {
      isValid: false,
      message: "At least one field must be provided to update",
    };
  }

  return { isValid: true };
};

export const validateManageUserStatus = (data: {
  isActive?: boolean;
}): ValidationResult => {
  if (data.isActive === undefined) {
    return {
      isValid: false,
      message: "isActive field is required",
    };
  }

  if (typeof data.isActive !== "boolean") {
    return {
      isValid: false,
      message: "isActive must be a boolean value",
    };
  }

  return { isValid: true };
};

// Slug generation utility
export const generateSlug = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
};

// Booking format validation
export const isValidBookingFormat = (format: string): boolean => {
  return ["F1", "F2", "F3", "F4"].includes(format);
};

// Category validation functions
export const validateCreateCategory = (data: {
  categoryName?: string;
  categorySlug?: string;
  categoryIconUrl?: string;
  categoryDescription?: string;
  displayOrder?: number;
  bookingFormat?: string;
  isEndLocation?: boolean;
  isRental?: boolean;
  hasVariantCatA?: boolean;
  isInclusionsExclusionsAllowed?: boolean;
  isAddonsAllowed?: boolean;
  isBookingOptionAllowed?: boolean;
  isFaqAllowed?: boolean;
  isDayWiseAllowed?: boolean;
  isActive?: boolean;
}): ValidationResult => {
  if (!data.categoryName) {
    return { isValid: false, message: "Category name is required" };
  }

  if (data.categoryName.length > 100) {
    return {
      isValid: false,
      message: "Category name must be less than 100 characters",
    };
  }

  if (data.categorySlug && data.categorySlug.length > 100) {
    return {
      isValid: false,
      message: "Category slug must be less than 100 characters",
    };
  }

  if (data.categoryIconUrl && data.categoryIconUrl.length > 255) {
    return {
      isValid: false,
      message: "Category icon URL must be less than 255 characters",
    };
  }

  if (data.categoryDescription && data.categoryDescription.length > 500) {
    return {
      isValid: false,
      message: "Category description must be less than 500 characters",
    };
  }

  if (!data.bookingFormat) {
    return { isValid: false, message: "Booking format is required" };
  }

  if (!isValidBookingFormat(data.bookingFormat)) {
    return {
      isValid: false,
      message: "Invalid booking format. Must be F1, F2, F3, or F4",
    };
  }

  if (
    data.displayOrder !== undefined &&
    (typeof data.displayOrder !== "number" || data.displayOrder < 0)
  ) {
    return {
      isValid: false,
      message: "Display order must be a non-negative number",
    };
  }

  if (data.isRental !== undefined && typeof data.isRental !== "boolean") {
    return { isValid: false, message: "isRental must be a boolean" };
  }

  if (
    data.hasVariantCatA !== undefined &&
    typeof data.hasVariantCatA !== "boolean"
  ) {
    return { isValid: false, message: "hasVariantCatA must be a boolean" };
  }

  if (
    data.isEndLocation !== undefined &&
    typeof data.isEndLocation !== "boolean"
  ) {
    return { isValid: false, message: "isEndLocation must be a boolean" };
  }

  if (
    data.isInclusionsExclusionsAllowed !== undefined &&
    typeof data.isInclusionsExclusionsAllowed !== "boolean"
  ) {
    return { isValid: false, message: "isInclusionsExclusionsAllowed must be a boolean" };
  }

  if (
    data.isAddonsAllowed !== undefined &&
    typeof data.isAddonsAllowed !== "boolean"
  ) {
    return { isValid: false, message: "isAddonsAllowed must be a boolean" };
  }

  if (
    data.isBookingOptionAllowed !== undefined &&
    typeof data.isBookingOptionAllowed !== "boolean"
  ) {
    return { isValid: false, message: "isBookingOptionAllowed must be a boolean" };
  }

  if (
    data.isFaqAllowed !== undefined &&
    typeof data.isFaqAllowed !== "boolean"
  ) {
    return { isValid: false, message: "isFaqAllowed must be a boolean" };
  }

  if (
    data.isDayWiseAllowed !== undefined &&
    typeof data.isDayWiseAllowed !== "boolean"
  ) {
    return { isValid: false, message: "isDayWiseAllowed must be a boolean" };
  }

  if (data.isActive !== undefined && typeof data.isActive !== "boolean") {
    return { isValid: false, message: "isActive must be a boolean" };
  }

  return { isValid: true };
};

export const validateUpdateCategory = (data: {
  categoryName?: string;
  categorySlug?: string;
  categoryIconUrl?: string;
  categoryDescription?: string;
  displayOrder?: number;
  bookingFormat?: string;
  isRental?: boolean;
  hasVariantCatA?: boolean;
  isInclusionsExclusionsAllowed?: boolean;
  isAddonsAllowed?: boolean;
  isBookingOptionAllowed?: boolean;
  isFaqAllowed?: boolean;
  isDayWiseAllowed?: boolean;
  isActive?: boolean;
}): ValidationResult => {
  // Check if at least one field is provided
  if (
    !data.categoryName &&
    !data.categorySlug &&
    data.categoryIconUrl === undefined &&
    data.categoryDescription === undefined &&
    data.displayOrder === undefined &&
    !data.bookingFormat &&
    data.isRental === undefined &&
    data.hasVariantCatA === undefined &&
    data.isInclusionsExclusionsAllowed === undefined &&
    data.isAddonsAllowed === undefined &&
    data.isBookingOptionAllowed === undefined &&
    data.isFaqAllowed === undefined &&
    data.isDayWiseAllowed === undefined &&
    data.isActive === undefined
  ) {
    return {
      isValid: false,
      message: "At least one field must be provided to update",
    };
  }

  if (data.categoryName && data.categoryName.length > 100) {
    return {
      isValid: false,
      message: "Category name must be less than 100 characters",
    };
  }

  if (data.categorySlug && data.categorySlug.length > 100) {
    return {
      isValid: false,
      message: "Category slug must be less than 100 characters",
    };
  }

  if (data.categoryIconUrl && data.categoryIconUrl.length > 255) {
    return {
      isValid: false,
      message: "Category icon URL must be less than 255 characters",
    };
  }

  if (data.categoryDescription && data.categoryDescription.length > 500) {
    return {
      isValid: false,
      message: "Category description must be less than 500 characters",
    };
  }

  if (data.bookingFormat && !isValidBookingFormat(data.bookingFormat)) {
    return {
      isValid: false,
      message: "Invalid booking format. Must be F1, F2, F3, or F4",
    };
  }

  if (
    data.displayOrder !== undefined &&
    (typeof data.displayOrder !== "number" || data.displayOrder < 0)
  ) {
    return {
      isValid: false,
      message: "Display order must be a non-negative number",
    };
  }

  if (data.isRental !== undefined && typeof data.isRental !== "boolean") {
    return { isValid: false, message: "isRental must be a boolean" };
  }

  if (
    data.hasVariantCatA !== undefined &&
    typeof data.hasVariantCatA !== "boolean"
  ) {
    return { isValid: false, message: "hasVariantCatA must be a boolean" };
  }

  if (
    data.isInclusionsExclusionsAllowed !== undefined &&
    typeof data.isInclusionsExclusionsAllowed !== "boolean"
  ) {
    return { isValid: false, message: "isInclusionsExclusionsAllowed must be a boolean" };
  }

  if (
    data.isAddonsAllowed !== undefined &&
    typeof data.isAddonsAllowed !== "boolean"
  ) {
    return { isValid: false, message: "isAddonsAllowed must be a boolean" };
  }

  if (
    data.isBookingOptionAllowed !== undefined &&
    typeof data.isBookingOptionAllowed !== "boolean"
  ) {
    return { isValid: false, message: "isBookingOptionAllowed must be a boolean" };
  }

  if (
    data.isFaqAllowed !== undefined &&
    typeof data.isFaqAllowed !== "boolean"
  ) {
    return { isValid: false, message: "isFaqAllowed must be a boolean" };
  }

  if (
    data.isDayWiseAllowed !== undefined &&
    typeof data.isDayWiseAllowed !== "boolean"
  ) {
    return { isValid: false, message: "isDayWiseAllowed must be a boolean" };
  }

  if (data.isActive !== undefined && typeof data.isActive !== "boolean") {
    return { isValid: false, message: "isActive must be a boolean" };
  }

  return { isValid: true };
};

// Sub-category validation functions
export const validateCreateSubCategory = (data: {
  categoryId?: string;
  subCatName?: string;
  subCatSlug?: string;
  displayOrder?: number;
  isActive?: boolean;
}): ValidationResult => {
  if (!data.categoryId) {
    return { isValid: false, message: "Category ID is required" };
  }

  if (!data.subCatName) {
    return { isValid: false, message: "Sub-category name is required" };
  }

  if (data.subCatName.length > 100) {
    return {
      isValid: false,
      message: "Sub-category name must be less than 100 characters",
    };
  }

  if (data.subCatSlug && data.subCatSlug.length > 100) {
    return {
      isValid: false,
      message: "Sub-category slug must be less than 100 characters",
    };
  }

  if (
    data.displayOrder !== undefined &&
    (typeof data.displayOrder !== "number" || data.displayOrder < 0)
  ) {
    return {
      isValid: false,
      message: "Display order must be a non-negative number",
    };
  }

  if (data.isActive !== undefined && typeof data.isActive !== "boolean") {
    return { isValid: false, message: "isActive must be a boolean" };
  }

  return { isValid: true };
};

export const validateUpdateSubCategory = (data: {
  categoryId?: string;
  subCatName?: string;
  subCatSlug?: string;
  displayOrder?: number;
  isActive?: boolean;
}): ValidationResult => {
  // Check if at least one field is provided
  if (
    !data.categoryId &&
    !data.subCatName &&
    !data.subCatSlug &&
    data.displayOrder === undefined &&
    data.isActive === undefined
  ) {
    return {
      isValid: false,
      message: "At least one field must be provided to update",
    };
  }

  if (data.subCatName && data.subCatName.length > 100) {
    return {
      isValid: false,
      message: "Sub-category name must be less than 100 characters",
    };
  }

  if (data.subCatSlug && data.subCatSlug.length > 100) {
    return {
      isValid: false,
      message: "Sub-category slug must be less than 100 characters",
    };
  }

  if (
    data.displayOrder !== undefined &&
    (typeof data.displayOrder !== "number" || data.displayOrder < 0)
  ) {
    return {
      isValid: false,
      message: "Display order must be a non-negative number",
    };
  }

  if (data.isActive !== undefined && typeof data.isActive !== "boolean") {
    return { isValid: false, message: "isActive must be a boolean" };
  }

  return { isValid: true };
};


export const validateOperatorCompleteRegistration = (data: {
  email?:  string;
  phone?: string;
  password?: string;
  businessName?: string;
  operatorName?: string;
  contactNumber?: string;
  contactEmail?: string;
  addressLine01?: string;
  city?: string;
  state?: string;
  pincode?: string;
  bankAccountNumber?: string;
  confirmBankAccountNumber?: string;
  ifscCode?: string;
  accountHolderName?: string;
}): ValidationResult => {
  // Email validation
  if (!data.email) {
    return { isValid: false, message: "Email is required" };
  }
  if (!isValidEmail(data.email)) {
    return { isValid: false, message: "Invalid email format" };
  }

  // Phone validation
  if (! data.phone) {
    return { isValid: false, message:  "Phone number is required" };
  }
  if (!isValidPhone(data.phone)) {
    return { isValid: false, message: "Invalid phone number format" };
  }

  // Password validation
  if (!data.password) {
    return { isValid: false, message: "Password is required" };
  }
  const passwordValidation = validatePassword(data.password);
  if (!passwordValidation.isValid) {
    return passwordValidation;
  }

  // Business name
  if (!data.businessName || data.businessName.trim().length === 0) {
    return { isValid: false, message: "Business name is required" };
  }

  // Operator name
  if (!data.operatorName || data.operatorName.trim().length === 0) {
    return { isValid: false, message: "Operator name is required" };
  }

  // Contact number
  if (!data. contactNumber) {
    return { isValid:  false, message: "Contact number is required" };
  }

  // Contact email
  if (! data.contactEmail) {
    return { isValid: false, message: "Contact email is required" };
  }
  if (!isValidEmail(data.contactEmail)) {
    return { isValid: false, message:  "Invalid contact email format" };
  }

  // Address validation
  if (!data.addressLine01 || data.addressLine01.trim().length === 0) {
    return { isValid: false, message: "Address line 1 is required" };
  }
  if (!data.city || data.city.trim().length === 0) {
    return { isValid: false, message: "City is required" };
  }
  if (!data.state || data.state.trim().length === 0) {
    return { isValid: false, message: "State is required" };
  }
  if (!data.pincode || data.pincode.trim().length === 0) {
    return { isValid: false, message:  "Pincode is required" };
  }

  // Bank details validation
  if (!data.bankAccountNumber) {
    return { isValid: false, message: "Bank account number is required" };
  }
  if (!data. confirmBankAccountNumber) {
    return { isValid: false, message: "Please confirm bank account number" };
  }
  if (data.bankAccountNumber !== data.confirmBankAccountNumber) {
    return { isValid:  false, message: "Bank account numbers do not match" };
  }
  if (!data.ifscCode) {
    return { isValid: false, message: "IFSC code is required" };
  }
  if (!data.accountHolderName) {
    return { isValid: false, message: "Account holder name is required" };
  }

  return { isValid: true };
};


export const validateOperatorProfileUpdate = (data: {
  companyName?: string;
  companyLogoUrl?: string;
  companyDescription?: string;
  websiteUrl?: string;
  socialMediaLinks?: any;
}): ValidationResult => {
  if (
    !data.companyName &&
    data.companyLogoUrl === undefined &&
    data.companyDescription === undefined &&
    data. websiteUrl === undefined &&
    data.socialMediaLinks === undefined
  ) {
    return {
      isValid: false,
      message: "At least one field must be provided to update",
    };
  }

  if (data.companyName && data. companyName.length > 100) {
    return {
      isValid: false,
      message: "Company name must be less than 100 characters",
    };
  }

  if (data.companyLogoUrl && data.companyLogoUrl.length > 255) {
    return {
      isValid: false,
      message: "Company logo URL must be less than 255 characters",
    };
  }

  if (data. companyDescription && data.companyDescription.length > 1000) {
    return {
      isValid: false,
      message:  "Company description must be less than 1000 characters",
    };
  }

  if (data.websiteUrl && data.websiteUrl.length > 255) {
    return {
      isValid: false,
      message:  "Website URL must be less than 255 characters",
    };
  }

  return { isValid: true };
};