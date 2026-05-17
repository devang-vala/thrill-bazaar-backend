const DEFAULT_TAX_RATE = 1800; // 18% in basis points
const DEFAULT_PLATFORM_COMMISSION_RATE = 0;
const DEFAULT_TCS_RATE_OF_COMMISSION = 0;

export interface PaymentCalculationInput {
  bookingFormat: "F1" | "F2" | "F3" | "F4";
  totalBasePrice: number; // Tax-inclusive base subtotal in paise
  quantity: number; // Number of days (F1/F2/F4) or participants (F3) for display
  addonsAmount?: number; // Add-ons total in paise
  discountAmount?: number; // Discount amount in paise
  advancePaymentAmount?: number; // Optional explicit override in paise
  advancePaymentPercentage?: number; // Basis points (e.g. 5000 = 50%)
  paymentMethod?: string;
  taxRate?: number; // Basis points (e.g. 1800 = 18%)
  convenienceFeeRate?: number; // Basis points
  platformCommissionRate?: number; // Basis points
  tcsRateOfCommission?: number; // Basis points
}

export interface PaymentCalculationResult {
  totalBasePrice: number; // Stored as the tax-inclusive base subtotal in paise
  quantity: number;
  taxRate: number; // Basis points
  taxAmount: number; // Derived tax portion in paise
  subtotalWithTax: number; // Canonical tax-inclusive base subtotal in paise
  discountAmount: number;
  totalBaseAmount: number; // subtotalWithTax - discountAmount
  addonsAmount: number;
  totalAmount: number; // totalBaseAmount + addonsAmount
  amountPaidOnline: number;
  amountToCollectOffline: number;
  convenienceFeeRate: number;
  convenienceFeeAmount: number;
  totalPayableOnline: number;
  paymentMethod: string;
  platformCommissionRate: number;
  platformCommission: number;
  tcsRate: number;
  tcsAmount: number;
  netPayToSeller: number;
  balanceToCollect: number;
  totalEarnings: number;
}

function basisPointsToPercent(rateInBasisPoints: number): number {
  return rateInBasisPoints / 100;
}

export function calculatePaymentBreakdown(
  input: PaymentCalculationInput,
): PaymentCalculationResult {
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

  const subtotalWithTax = totalBasePrice;
  const taxRatePercent = basisPointsToPercent(taxRate);
  const taxAmount =
    taxRatePercent > 0
      ? Math.round(
          subtotalWithTax -
            (subtotalWithTax * 100) / (100 + taxRatePercent),
        )
      : 0;
  const totalBaseAmount = subtotalWithTax - discountAmount;
  const totalAmount = totalBaseAmount + addonsAmount;

  const calculatedAdvanceOnBaseAmount = Math.round(
    (totalBaseAmount * advancePaymentPercentage) / 10000,
  );
  const calculatedPaidOnline = Math.min(
    totalAmount,
    Math.max(0, calculatedAdvanceOnBaseAmount + addonsAmount),
  );
  const amountPaidOnline =
    advancePaymentAmount !== undefined
      ? advancePaymentAmount
      : calculatedPaidOnline;
  const amountToCollectOffline = totalAmount - amountPaidOnline;

  const convenienceFeeAmount = Math.round(
    (amountPaidOnline * convenienceFeeRate) / 10000,
  );
  const totalPayableOnline = amountPaidOnline + convenienceFeeAmount;

  const platformCommission = Math.round(
    (totalAmount * platformCommissionRate) / 10000,
  );
  const tcsAmount = Math.round(
    (platformCommission * tcsRateOfCommission) / 10000,
  );
  const netPayToSeller = amountPaidOnline - platformCommission - tcsAmount;
  const totalEarnings = netPayToSeller + amountToCollectOffline;

  return {
    totalBasePrice: subtotalWithTax,
    quantity,
    taxRate,
    taxAmount,
    subtotalWithTax,
    discountAmount,
    totalBaseAmount,
    addonsAmount,
    totalAmount,
    amountPaidOnline,
    amountToCollectOffline,
    convenienceFeeRate,
    convenienceFeeAmount,
    totalPayableOnline,
    paymentMethod,
    platformCommissionRate,
    platformCommission,
    tcsRate: tcsRateOfCommission,
    tcsAmount,
    netPayToSeller,
    balanceToCollect: amountToCollectOffline,
    totalEarnings,
  };
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

export function formatAmount(paise: number): string {
  return `₹${paiseToRupees(paise).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getQuantityForBookingFormat(
  bookingFormat: "F1" | "F2" | "F3" | "F4",
  participantCount: number,
  totalDays: number,
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
