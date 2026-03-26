/**
 * Payment Calculation Helper - CORRECT LOGIC (FIXED!)
 * 
 * ACTUAL CORRECT Payment Flow (FROM UI IMAGE):
 * 1. Calculate Base Price × Quantity (includes price overrides)
 * 2. Apply TAX (18%) to base → Subtotal WITH tax
 * 3. Apply Discount/Promo → Total Base Amount
 * 4. Add Add-ons → Total Amount
 * 5. Paid online = Advance % of Total Base Amount + full Add-ons
 * 6. Balance = Total Amount - Paid
 * 7. Platform Commission = Admin-configured % of Total Amount
 * 8. TCS = Admin-configured % of Platform Commission
 * 9. Net Pay = Paid - Commission - TCS
 * 10. Total Earnings = Net Pay + Balance
 */

// Default rates
const DEFAULT_TAX_RATE = 1800; // 18% in basis points (1800 = 18%)
const DEFAULT_PLATFORM_COMMISSION_RATE = 0; // Listing-specific, fallback to 0%
const DEFAULT_TCS_RATE_OF_COMMISSION = 0; // Listing-specific, fallback to 0%

export interface PaymentCalculationInput {
  bookingFormat: "F1" | "F2" | "F3" | "F4";
  totalBasePrice: number; // TOTAL base price in paise (already includes quantity & price overrides)
  quantity: number; // Number of days (F1/F2/F4) or participants (F3) - for display only
  addonsAmount?: number; // Total addons cost in paise
  discountAmount?: number; // Discount amount in paise
  advancePaymentAmount?: number; // Optional explicit override
  advancePaymentPercentage?: number; // Advance % applied on total base amount in basis points
  paymentMethod?: string;
  taxRate?: number; // Tax rate in basis points (1800 = 18%)
  convenienceFeeRate?: number; // Convenience fee on online payment in basis points
  platformCommissionRate?: number; // Platform commission rate in basis points
  tcsRateOfCommission?: number; // TCS as % of commission in basis points
}

export interface PaymentCalculationResult {
  // Basic info
  totalBasePrice: number; // Total base price WITHOUT tax (with price overrides)
  quantity: number; // For display
  taxRate: number;
  taxAmount: number; // Tax on base price
  
  // Calculation breakdown
  subtotalWithTax: number; // Total Base Price + Tax
  discountAmount: number;
  totalBaseAmount: number; // Subtotal WITH Tax - Discount
  addonsAmount: number;
  totalAmount: number; // Total Base Amount + Addons
  
  // Payment split
  amountPaidOnline: number; // Advance % of Total Base Amount + full Add-ons
  amountToCollectOffline: number; // Balance = Total - Paid
  convenienceFeeRate: number;
  convenienceFeeAmount: number;
  totalPayableOnline: number;
  paymentMethod: string;
  
  // Platform economics
  platformCommissionRate: number;
  platformCommission: number; // Admin-configured % of Total Amount
  tcsRate: number; // Rate applied to commission
  tcsAmount: number; // Admin-configured % of Platform Commission
  
  // Seller economics
  netPayToSeller: number; // Paid - Commission - TCS (from advance payment)
  balanceToCollect: number; // Same as amountToCollectOffline
  totalEarnings: number; // Net Pay + Balance
}

/**
 * Calculate all payment amounts for a booking
 * 
 * CORRECT CALCULATION FLOW (MATCHES UI IMAGE):
 * Step 1: Base Price × Quantity (with price overrides)
 * Step 2: Apply TAX (18%) to base
 * Step 3: Subtotal = Base + Tax
 * Step 4: Apply Discount to Subtotal
 * Step 5: Total Base Amount = Subtotal - Discount
 * Step 6: Add Add-ons to get Total Amount
 * Step 7: Calculate Paid Amount using advance % on Total Base Amount + full Add-ons
 * Step 8: Calculate Balance (Total - Paid)
 * Step 9: Calculate Platform Commission (admin-configured % of Total Amount)
 * Step 10: Calculate TCS (admin-configured % of Platform Commission)
 * Step 11: Calculate Net Pay to Seller (Paid - Commission - TCS)
 * Step 12: Calculate Total Earnings (Net Pay + Balance)
 */
export function calculatePaymentBreakdown(input: PaymentCalculationInput): PaymentCalculationResult {
  const {
    totalBasePrice,
    quantity,
    addonsAmount = 0,
    discountAmount = 0,
    advancePaymentAmount,
    advancePaymentPercentage = 10000,
    paymentMethod = "online",
    taxRate = DEFAULT_TAX_RATE,
    convenienceFeeRate = 0,
    platformCommissionRate = DEFAULT_PLATFORM_COMMISSION_RATE,
    tcsRateOfCommission = DEFAULT_TCS_RATE_OF_COMMISSION,
  } = input;

  // Step 1: Total Base Price (already includes price overrides)
  // Step 2: Apply TAX FIRST (18% of base price)
  const taxAmount = Math.round((totalBasePrice * taxRate) / 10000);

  // Step 3: Calculate Subtotal WITH tax
  const subtotalWithTax = totalBasePrice + taxAmount;

  // Step 4: Apply discount to subtotal WITH tax
  const totalBaseAmount = subtotalWithTax - discountAmount;

  // Step 5: Add addons to get Total Amount
  const totalAmount = totalBaseAmount + addonsAmount;

  // Step 6: Calculate online payment.
  // Advance percentage is applied only on the base amount; add-ons are always collected online.
  const calculatedAdvanceOnBaseAmount = Math.round((totalBaseAmount * advancePaymentPercentage) / 10000);
  const calculatedPaidOnline = Math.min(
    totalAmount,
    Math.max(0, calculatedAdvanceOnBaseAmount + addonsAmount)
  );
  const amountPaidOnline = advancePaymentAmount !== undefined ? advancePaymentAmount : calculatedPaidOnline;

  // Step 7: Calculate Balance
  const amountToCollectOffline = totalAmount - amountPaidOnline;

  // Step 7.1: Calculate convenience fee on the online payment amount
  const convenienceFeeAmount = Math.round((amountPaidOnline * convenienceFeeRate) / 10000);
  const totalPayableOnline = amountPaidOnline + convenienceFeeAmount;

  // Step 8: Calculate Platform Commission
  const platformCommission = Math.round((totalAmount * platformCommissionRate) / 10000);

  // Step 9: Calculate TCS on platform commission
  const tcsAmount = Math.round((platformCommission * tcsRateOfCommission) / 10000);

  // Step 10: Calculate Net Pay to Seller (Paid - Commission - TCS)
  const netPayToSeller = amountPaidOnline - platformCommission - tcsAmount;

  // Step 11: Calculate Total Earnings (Net Pay + Balance)
  const totalEarnings = netPayToSeller + amountToCollectOffline;

  return {
    // Basic info
    totalBasePrice,
    quantity,
    taxRate,
    taxAmount,
    
    // Calculation breakdown
    subtotalWithTax,
    discountAmount,
    totalBaseAmount,
    addonsAmount,
    totalAmount,
    
    // Payment split
    amountPaidOnline,
    amountToCollectOffline,
    convenienceFeeRate,
    convenienceFeeAmount,
    totalPayableOnline,
    paymentMethod,
    
    // Platform economics
    platformCommissionRate,
    platformCommission,
    tcsRate: tcsRateOfCommission,
    tcsAmount,
    
    // Seller economics
    netPayToSeller,
    balanceToCollect: amountToCollectOffline,
    totalEarnings,
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
 * - F1: Number of participants
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
      return participantCount;
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
