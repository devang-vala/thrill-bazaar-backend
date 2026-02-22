/**
 * Payment Calculation Helper - CORRECT LOGIC (FIXED!)
 * 
 * ACTUAL CORRECT Payment Flow (FROM UI IMAGE):
 * 1. Calculate Base Price × Quantity (includes price overrides)
 * 2. Apply TAX (18%) to base → Subtotal WITH tax
 * 3. Apply Discount/Promo → Total Base Amount
 * 4. Add Add-ons → Total Amount
 * 5. Paid = User-selected amount
 * 6. Balance = Total Amount - Paid
 * 7. Platform Commission = 10% of Total Amount
 * 8. TCS = 1% of Platform Commission
 * 9. Net Pay = Paid - Commission - TCS
 * 10. Total Earnings = Net Pay + Balance
 */

// Default rates (can be overridden by admin in future)
const DEFAULT_TAX_RATE = 1800; // 18% in basis points (1800 = 18%)
const DEFAULT_PLATFORM_COMMISSION_RATE = 1000; // 10% in basis points (1000 = 10%)
const DEFAULT_TCS_RATE_OF_COMMISSION = 100; // 1% of commission in basis points (100 = 1%)

export interface PaymentCalculationInput {
  bookingFormat: "F1" | "F2" | "F3" | "F4";
  totalBasePrice: number; // TOTAL base price in paise (already includes quantity & price overrides)
  quantity: number; // Number of days (F1/F2/F4) or participants (F3) - for display only
  addonsAmount?: number; // Total addons cost in paise
  discountAmount?: number; // Discount amount in paise
  advancePaymentAmount?: number; // EXACT amount user chose to pay (calculated by frontend)
  paymentMethod?: string;
  taxRate?: number; // Tax rate in basis points (1800 = 18%)
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
  amountPaidOnline: number; // User-selected amount
  amountToCollectOffline: number; // Balance = Total - Paid
  paymentMethod: string;
  
  // Platform economics
  platformCommissionRate: number;
  platformCommission: number; // 10% of Total Amount
  tcsRate: number; // Rate applied to commission
  tcsAmount: number; // 1% of Platform Commission
  
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
 * Step 7: User-Selected Paid Amount
 * Step 8: Calculate Balance (Total - Paid)
 * Step 9: Calculate Platform Commission (10% of Total Amount)
 * Step 10: Calculate TCS (1% of Platform Commission)
 * Step 11: Calculate Net Pay to Seller (Paid - Commission - TCS)
 * Step 12: Calculate Total Earnings (Net Pay + Balance)
 */
export function calculatePaymentBreakdown(input: PaymentCalculationInput): PaymentCalculationResult {
  const {
    totalBasePrice,
    quantity,
    addonsAmount = 0,
    discountAmount = 0,
    advancePaymentAmount, // User-selected amount
    paymentMethod = "online",
    taxRate = DEFAULT_TAX_RATE,
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

  // Step 6: Use user-selected paid amount
  // If not provided, default to totalAmount (100% payment)
  const amountPaidOnline = advancePaymentAmount !== undefined ? advancePaymentAmount : totalAmount;

  // Step 7: Calculate Balance
  const amountToCollectOffline = totalAmount - amountPaidOnline;

  // Step 8: Calculate Platform Commission (10% of Total Amount)
  const platformCommission = Math.round((totalAmount * platformCommissionRate) / 10000);

  // Step 9: Calculate TCS (1% of Platform Commission)
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
