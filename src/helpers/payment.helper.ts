/**
 * Payment Calculation Helper
 * 
 * Handles all payment-related calculations for bookings including:
 * - Subtotal calculation based on booking format
 * - Tax calculation
 * - Platform commission
 * - TCS (Tax Collected at Source)
 * - Seller earnings
 */

// Default rates (can be overridden by admin in future)
const DEFAULT_TAX_RATE = 1800; // 18% in basis points (1800 = 18%)
const DEFAULT_PLATFORM_COMMISSION_RATE = 1000; // 10% in basis points (1000 = 10%)
const DEFAULT_TCS_RATE = 100; // 1% in basis points (100 = 1%)

export interface PaymentCalculationInput {
  bookingFormat: "F1" | "F2" | "F3" | "F4";
  basePrice: number; // Price in paise (INR) or cents
  quantity: number; // Number of days (F1/F2/F4) or participants (F3)
  addonsAmount?: number; // Total addons cost in paise
  discountAmount?: number; // Discount amount in paise
  amountPaidOnline?: number; // Amount paid now (if partial payment)
  paymentMethod?: string;
  taxRate?: number; // Override tax rate in basis points
  platformCommissionRate?: number; // Override platform rate in basis points
  tcsRate?: number; // Override TCS rate in basis points
}

export interface PaymentCalculationResult {
  basePrice: number;
  quantity: number;
  subtotalAmount: number;
  addonsAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  amountPaidOnline: number;
  amountToCollectOffline: number;
  paymentMethod: string;
  platformCommissionRate: number;
  platformCommission: number;
  tcsRate: number;
  tcsAmount: number;
  sellerGrossEarnings: number;
  netPayableToSeller: number;
}

/**
 * Calculate all payment amounts for a booking
 * 
 * Flow:
 * 1. subtotalAmount = basePrice × quantity
 * 2. taxableAmount = subtotalAmount + addonsAmount - discountAmount
 * 3. taxAmount = taxableAmount × taxRate / 10000
 * 4. totalAmount = taxableAmount + taxAmount
 * 5. platformCommission = totalAmount × platformCommissionRate / 10000
 * 6. tcsAmount = totalAmount × tcsRate / 10000
 * 7. sellerGrossEarnings = totalAmount - platformCommission - tcsAmount
 * 8. netPayableToSeller = sellerGrossEarnings (same for now, may deduct more later)
 */
export function calculatePaymentBreakdown(input: PaymentCalculationInput): PaymentCalculationResult {
  const {
    basePrice,
    quantity,
    addonsAmount = 0,
    discountAmount = 0,
    amountPaidOnline,
    paymentMethod = "online",
    taxRate = DEFAULT_TAX_RATE,
    platformCommissionRate = DEFAULT_PLATFORM_COMMISSION_RATE,
    tcsRate = DEFAULT_TCS_RATE,
  } = input;

  // Step 1: Calculate subtotal (base × quantity)
  const subtotalAmount = basePrice * quantity;

  // Step 2: Calculate taxable amount (after addons and discount)
  const taxableAmount = subtotalAmount + addonsAmount - discountAmount;

  // Step 3: Calculate tax (GST at 18% default)
  const taxAmount = Math.round((taxableAmount * taxRate) / 10000);

  // Step 4: Calculate total amount
  const totalAmount = taxableAmount + taxAmount;

  // Step 5: Calculate payment split
  // Default: 50% now, 50% at venue (can be customized)
  const defaultPaidOnline = Math.round(totalAmount * 0.5);
  const actualPaidOnline = amountPaidOnline !== undefined ? amountPaidOnline : defaultPaidOnline;
  const amountToCollectOffline = totalAmount - actualPaidOnline;

  // Step 6: Calculate platform commission (on total amount)
  const platformCommission = Math.round((totalAmount * platformCommissionRate) / 10000);

  // Step 7: Calculate TCS (on total amount)
  const tcsAmount = Math.round((totalAmount * tcsRate) / 10000);

  // Step 8: Calculate seller earnings
  const sellerGrossEarnings = totalAmount - platformCommission - tcsAmount;
  const netPayableToSeller = sellerGrossEarnings; // Same for now

  return {
    basePrice,
    quantity,
    subtotalAmount,
    addonsAmount,
    discountAmount,
    taxAmount,
    totalAmount,
    amountPaidOnline: actualPaidOnline,
    amountToCollectOffline,
    paymentMethod,
    platformCommissionRate,
    platformCommission,
    tcsRate,
    tcsAmount,
    sellerGrossEarnings,
    netPayableToSeller,
  };
}

/**
 * Convert amount from rupees to paise
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Convert amount from paise to rupees
 */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/**
 * Format amount for display (in rupees with 2 decimal places)
 */
export function formatAmount(paise: number): string {
  return `₹${paiseToRupees(paise).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Get quantity label based on booking format
 */
export function getQuantityLabel(bookingFormat: "F1" | "F2" | "F3" | "F4"): string {
  switch (bookingFormat) {
    case "F1":
      return "No. of Days";
    case "F2":
      return "No. of Days";
    case "F3":
      return "No. of Participants";
    case "F4":
      return "No. of Days";
    default:
      return "Quantity";
  }
}

/**
 * Determine quantity based on booking format
 * - F1: Number of days between start and end date
 * - F2: Number of days between start and end date
 * - F3: Number of participants
 * - F4: Number of days between start and end date
 */
export function getQuantityForBookingFormat(
  bookingFormat: "F1" | "F2" | "F3" | "F4",
  participantCount: number,
  totalDays: number
): number {
  switch (bookingFormat) {
    case "F1":
      return totalDays;
    case "F2":
      return totalDays;
    case "F3":
      return participantCount;
    case "F4":
      return totalDays;
    default:
      return 1;
  }
}
