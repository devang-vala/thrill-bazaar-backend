import type { Context } from "hono";
import crypto from "crypto";
import Razorpay from "razorpay";
import { prisma } from "../db.js";
import {
  calculatePaymentBreakdown,
  rupeesToPaise,
  getQuantityForBookingFormat,
  type PaymentCalculationInput,
} from "../helpers/payment.helper.js";
import { generateOtp, isMasterOtp, sendOtpSMS } from "../helpers/auth.helper.js";

const BOOKING_DEBUG = process.env.BOOKING_DEBUG === "true";
const BOOKING_RESERVATION_TTL_MS = 10 * 60 * 1000;
const MAX_RAZORPAY_RECEIPT_LENGTH = 40;
const RESERVATION_TRANSACTION_OPTIONS = {
  isolationLevel: "Serializable" as any,
  maxWait: 15_000,
  timeout: 30_000,
};

const debugLog = (...args: unknown[]) => {
  if (BOOKING_DEBUG) {
    console.log(...args);
  }
};

// Generate unique booking reference
const generateBookingReference = () => {
  const prefix = "BOK";
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${prefix}-${year}-${random}`;
};

const percentageToBasisPoints = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    return fallback;
  }

  return Math.max(0, Math.round(numericValue * 100));
};

const getConvenienceFeeRateInBasisPoints = async () => {
  const latestSetting = await prisma.setting.findFirst({
    orderBy: { createdAt: "desc" },
    select: { convenienceFeePercentage: true },
  });

  return percentageToBasisPoints(latestSetting?.convenienceFeePercentage, 0);
};

const createBookingOtp = () => generateOtp();

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type SupportedBookingFormat = "F1" | "F2" | "F3" | "F4";
type ReservationStatus = "PENDING_PAYMENT" | "COMPLETED" | "PAYMENT_FAILED" | "RELEASED" | "EXPIRED";

interface PreparedReservation {
  customerId: string;
  listingId: string;
  variantId?: string;
  bookingFormat: SupportedBookingFormat;
  listingSlotId?: string;
  dateRangeId?: string;
  selectedDate?: string;
  selectedDates?: string[];
  participantCount: number;
  participants: any[];
  contactDetails: any;
  selectedAddons: Array<{ addonId: string; quantity: number }>;
  promoCode: string | null;
  discountAmount: number;
  paymentMethod: string;
  currency: string;
  basePrice: number;
  bookingStartDate: Date;
  bookingEndDate: Date;
  totalDays: number;
  paymentBreakdown: ReturnType<typeof calculatePaymentBreakdown>;
  pricingDetailsForBooking: Record<string, unknown>;
  inventoryReserved: boolean;
}

const buildSafeReceipt = (incomingReceipt?: string) => {
  const fallback = `receipt_${Date.now().toString(36)}`;
  const raw = (incomingReceipt || fallback).trim();
  const normalized = raw.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  const safe = normalized || fallback;
  return safe.slice(0, MAX_RAZORPAY_RECEIPT_LENGTH);
};

const getRazorpayInstance = () => {
  const key_id = process.env.RAZORPAY_API_KEY;
  const key_secret = process.env.RAZORPAY_SECRET_KEY;
  const isPlaceholderKey =
    !key_id ||
    !key_secret ||
    key_id === "your_razorpay_api_key_here" ||
    key_secret === "your_razorpay_secret_key_here";

  if (isPlaceholderKey) {
    throw new Error(
      "Razorpay API keys are not configured. Replace RAZORPAY_API_KEY and RAZORPAY_SECRET_KEY in thrill-bazaar-backend/.env with real Dashboard keys."
    );
  }

  return new Razorpay({ key_id, key_secret });
};

const verifyRazorpaySignature = (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
) => {
  const secret = process.env.RAZORPAY_SECRET_KEY;
  if (!secret) {
    throw new Error("Razorpay secret key is not configured");
  }

  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return expectedSignature === razorpaySignature;
};

const generateReservationReference = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `RSV-${year}-${random}`;
};

const normalizeSelectedAddonRows = (selectedAddons: unknown) => {
  if (!Array.isArray(selectedAddons)) return [] as Array<{ addonId: string; quantity: number }>;

  return selectedAddons
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const addonId = String((item as { addonId?: unknown }).addonId || "").trim();
      const quantity = Number((item as { quantity?: unknown }).quantity || 0);

      if (!addonId || !Number.isFinite(quantity) || quantity <= 0) {
        return null;
      }

      return {
        addonId,
        quantity,
      };
    })
    .filter((item): item is { addonId: string; quantity: number } => Boolean(item));
};

const normalizeSelectedDates = (selectedDates: unknown) => {
  if (!Array.isArray(selectedDates)) return [] as string[];

  return selectedDates
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort();
};

const normalizeDateOnlyKey = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().split("T")[0];
};

const toUtcStartOfDay = (dateValue: string) => new Date(`${dateValue}T00:00:00.000Z`);

const toJsonDateString = (value?: Date | string | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const getReservationLockKeys = (prepared: PreparedReservation) => {
  if (prepared.bookingFormat === "F1") {
    return [`slot:${prepared.listingSlotId}`];
  }

  if (prepared.bookingFormat === "F2") {
    return (prepared.selectedDates || []).map((selectedDate) => `range:${prepared.dateRangeId}:${selectedDate}`);
  }

  return [`range:${prepared.dateRangeId}:${prepared.selectedDate || normalizeDateOnlyKey(prepared.bookingStartDate)}`];
};

const acquireReservationLocks = async (tx: TxClient, prepared: PreparedReservation) => {
  const lockKeys = [...new Set(getReservationLockKeys(prepared))].sort();

  for (const lockKey of lockKeys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  }
};

const buildPricingDetailsForStorage = (prepared: PreparedReservation) => ({
  ...prepared.pricingDetailsForBooking,
  bookingFormat: prepared.bookingFormat,
  currency: prepared.currency,
  basePrice: prepared.basePrice,
  bookingStartDate: toJsonDateString(prepared.bookingStartDate),
  bookingEndDate: toJsonDateString(prepared.bookingEndDate),
});

const buildBookingPayloadForReservation = (prepared: PreparedReservation) => ({
  customerId: prepared.customerId,
  listingId: prepared.listingId,
  variantId: prepared.variantId || null,
  bookingFormat: prepared.bookingFormat,
  listingSlotId: prepared.listingSlotId || null,
  dateRangeId: prepared.dateRangeId || null,
  selectedDate: prepared.selectedDate || null,
  selectedDates: prepared.selectedDates || [],
  participantCount: prepared.participantCount,
  participants: prepared.participants,
  contactDetails: prepared.contactDetails,
  selectedAddons: prepared.selectedAddons,
  promoCode: prepared.promoCode,
  discountAmount: prepared.discountAmount,
  paymentMethod: prepared.paymentMethod,
  currency: prepared.currency,
  basePrice: prepared.basePrice,
  bookingStartDate: toJsonDateString(prepared.bookingStartDate),
  bookingEndDate: toJsonDateString(prepared.bookingEndDate),
  totalDays: prepared.totalDays,
});

const bookingReservationDelegate = (client: any) => client.bookingReservation;

const CANCELLATION_REASON_SUFFIXES = {
  customer: "cancelled by customer",
  seller: "cancelled by seller",
} as const;

const stripCancellationReasonSuffix = (value: string) =>
  value
    .replace(/\s*[-,|:]*\s*cancelled by seller\s*$/i, "")
    .replace(/\s*[-,|:]*\s*cancelled by customer\s*$/i, "")
    .trim();

const buildCancellationReason = (
  rawReason: string,
  cancelledBy: keyof typeof CANCELLATION_REASON_SUFFIXES,
) => {
  const normalizedReason = stripCancellationReasonSuffix(rawReason);
  const suffix = CANCELLATION_REASON_SUFFIXES[cancelledBy];
  return normalizedReason ? `${normalizedReason} ${suffix}` : suffix;
};

const isInventoryConflictError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("just booked by someone else") ||
    normalized.includes("no longer available") ||
    normalized.includes("reservation expired") ||
    normalized.includes("can no longer be completed") ||
    normalized.includes("date is blocked") ||
    normalized.includes("currently locked by another checkout")
  );
};

const ADMIN_RESCHEDULE_ACTIVITY_STATUS = {
  PENDING: "RESCHEDULE_PENDING",
  APPROVED: "RESCHEDULE_APPROVED",
  IN_PROGRESS: "RESCHEDULE_INPROGRESS",
  REJECTED: "RESCHEDULE_REJECTED",
} as const;

const getAdminActivityStatus = (
  bookingStatus: string | null | undefined,
  latestRescheduleStatus: string | null | undefined,
  latestReschedulePaymentRequired?: boolean | null,
  latestRescheduleChangedAt?: Date | string | null,
  lastRescheduledAt?: Date | string | null,
) => {
  const normalizedBookingStatus = String(bookingStatus || "").toUpperCase();
  const normalizedRescheduleStatus = String(latestRescheduleStatus || "").toLowerCase();
  const processedAt = lastRescheduledAt ? new Date(lastRescheduledAt).getTime() : NaN;
  const latestChangeAt = latestRescheduleChangedAt ? new Date(latestRescheduleChangedAt).getTime() : NaN;
  const isLatestRescheduleProcessed =
    Number.isFinite(processedAt) &&
    (!Number.isFinite(latestChangeAt) || processedAt >= latestChangeAt);

  if (normalizedBookingStatus === "CONFIRMED") {
    if (normalizedRescheduleStatus === "pending") {
      return ADMIN_RESCHEDULE_ACTIVITY_STATUS.PENDING;
    }

    if (normalizedRescheduleStatus === "approved" || isLatestRescheduleProcessed) {
      return ADMIN_RESCHEDULE_ACTIVITY_STATUS.APPROVED;
    }

    if (normalizedRescheduleStatus === "approved_with_charge") {
      return latestReschedulePaymentRequired === false
        ? ADMIN_RESCHEDULE_ACTIVITY_STATUS.APPROVED
        : ADMIN_RESCHEDULE_ACTIVITY_STATUS.IN_PROGRESS;
    }

    if (normalizedRescheduleStatus === "rejected") {
      return ADMIN_RESCHEDULE_ACTIVITY_STATUS.REJECTED;
    }
  }

  return normalizedBookingStatus;
};

const generateUniqueBookingOtp = async (excludeBookingId?: string) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const otp = createBookingOtp();
    const existingBooking = await prisma.booking.findFirst({
      where: {
        otp,
        ...(excludeBookingId ? { NOT: { id: excludeBookingId } } : {}),
      },
      select: { id: true },
    });

    if (!existingBooking) {
      return otp;
    }
  }

  throw new Error("Failed to generate a unique booking OTP");
};

const releaseReservationInventoryTx = async (
  tx: TxClient,
  reservation: {
    id: string;
    status: string;
    inventoryReserved: boolean;
    listingSlotId: string | null;
    dateRangeId: string | null;
    selectedDate: Date | null;
    selectedDates: unknown;
    participantCount: number;
  },
  nextStatus: ReservationStatus,
  failureReason?: string,
) => {
  if (reservation.status !== "PENDING_PAYMENT") {
    return;
  }

  if (reservation.inventoryReserved) {
    if (reservation.listingSlotId) {
      await tx.listingSlot.update({
        where: { id: reservation.listingSlotId },
        data: {
          availableCount: {
            increment: reservation.participantCount,
          },
        },
      });
    } else if (reservation.dateRangeId) {
      const selectedDates = normalizeSelectedDates(reservation.selectedDates);
      if (selectedDates.length > 0) {
        for (const selectedDate of selectedDates) {
          const slotChange = await tx.listingSlotChange.findFirst({
            where: {
              inventoryDateRangeId: reservation.dateRangeId,
              date: toUtcStartOfDay(selectedDate),
            },
            orderBy: { createdAt: "desc" },
          });

          if (slotChange) {
            await tx.listingSlotChange.update({
              where: { id: slotChange.id },
              data: {
                availableCount: {
                  increment: reservation.participantCount,
                },
                triggerType: "customer_cancel",
              },
            });
          }
        }
      } else if (reservation.selectedDate) {
        const slotChange = await tx.listingSlotChange.findFirst({
          where: {
            inventoryDateRangeId: reservation.dateRangeId,
            date: reservation.selectedDate,
          },
          orderBy: { createdAt: "desc" },
        });

        if (slotChange) {
          await tx.listingSlotChange.update({
            where: { id: slotChange.id },
            data: {
              availableCount: {
                increment: reservation.participantCount,
              },
              triggerType: "customer_cancel",
            },
          });
        }
      }
    }
  }

  await bookingReservationDelegate(tx).update({
    where: { id: reservation.id },
    data: {
      status: nextStatus,
      releasedAt: new Date(),
      failureReason: failureReason || null,
    },
  });
};

const releaseExpiredReservationsForPreparedBooking = async (tx: TxClient, prepared: PreparedReservation) => {
  const now = new Date();
  const candidates = await bookingReservationDelegate(tx).findMany({
    where: {
      status: "PENDING_PAYMENT",
      expiresAt: { lte: now },
      OR: prepared.listingSlotId
        ? [{ listingSlotId: prepared.listingSlotId }]
        : [{ dateRangeId: prepared.dateRangeId }],
    },
    select: {
      id: true,
      status: true,
      inventoryReserved: true,
      listingSlotId: true,
      dateRangeId: true,
      selectedDate: true,
      selectedDates: true,
      participantCount: true,
    },
  });

  const preparedDateSet = new Set(prepared.selectedDates || (prepared.selectedDate ? [prepared.selectedDate] : []));

  for (const reservation of candidates) {
    if (prepared.listingSlotId) {
      await releaseReservationInventoryTx(tx, reservation, "EXPIRED", "Reservation expired before payment.");
      continue;
    }

    const reservationDates = normalizeSelectedDates(reservation.selectedDates);
    const candidateDates =
      reservationDates.length > 0
        ? reservationDates
        : reservation.selectedDate
          ? [normalizeDateOnlyKey(reservation.selectedDate)]
          : [];
    const overlaps = candidateDates.some((dateKey) => preparedDateSet.has(dateKey));

    if (overlaps) {
      await releaseReservationInventoryTx(tx, reservation, "EXPIRED", "Reservation expired before payment.");
    }
  }
};

const assertNoActiveReservationConflictTx = async (tx: TxClient, prepared: PreparedReservation) => {
  const now = new Date();

  if (prepared.bookingFormat === "F1" && prepared.listingSlotId) {
    const activeReservations = await bookingReservationDelegate(tx).findMany({
      where: {
        status: "PENDING_PAYMENT",
        expiresAt: { gt: now },
        listingSlotId: prepared.listingSlotId,
      },
      select: { participantCount: true },
    });

    const heldParticipantCount = activeReservations.reduce(
      (sum: number, reservation: { participantCount: number }) => sum + (reservation.participantCount || 0),
      0,
    );

    if (heldParticipantCount === 0) {
      return;
    }

    const slot = await tx.listingSlot.findUnique({
      where: { id: prepared.listingSlotId },
      select: {
        availableCount: true,
        totalCapacity: true,
        bookings: {
          where: {
            bookingStatus: { in: ["CONFIRMED", "COMPLETED"] },
          },
          select: { participantCount: true },
        },
      },
    });

    if (!slot) {
      throw new Error("This batch is no longer available.");
    }

    const bookedParticipants = slot.bookings.reduce(
      (sum, booking) => sum + (booking.participantCount || 0),
      0,
    );
    const maxRemainingCapacity = Math.max(0, (slot.totalCapacity || 0) - bookedParticipants);
    const effectiveAvailableCount = Math.min(Math.max(0, slot.availableCount || 0), maxRemainingCapacity);

    if (effectiveAvailableCount < prepared.participantCount) {
      throw new Error("This batch is currently locked by another checkout. Please try again in a moment.");
    }

    return;
  }

  if (prepared.bookingFormat === "F2") {
    const preparedDateSet = new Set(prepared.selectedDates || []);
    const activeReservations = await bookingReservationDelegate(tx).findMany({
      where: {
        status: "PENDING_PAYMENT",
        expiresAt: { gt: now },
        bookingFormat: "F2",
        listingId: prepared.listingId,
        variantId: prepared.variantId || null,
      },
      select: {
        id: true,
        selectedDate: true,
        selectedDates: true,
      },
    });

    for (const reservation of activeReservations) {
      const reservationDates = normalizeSelectedDates(reservation.selectedDates);
      const candidateDates =
        reservationDates.length > 0
          ? reservationDates
          : reservation.selectedDate
            ? [normalizeDateOnlyKey(reservation.selectedDate)]
            : [];
      const overlaps = candidateDates.some((dateKey) => preparedDateSet.has(dateKey));

      if (overlaps) {
        throw new Error("These dates are currently locked by another checkout. Please try again in a moment.");
      }
    }

    return;
  }

  const preparedDateKey = prepared.selectedDate || normalizeDateOnlyKey(prepared.bookingStartDate);
  if (prepared.bookingFormat === "F3") {
    const activeReservations = await bookingReservationDelegate(tx).findMany({
      where: {
        status: "PENDING_PAYMENT",
        expiresAt: { gt: now },
        bookingFormat: "F3",
        dateRangeId: prepared.dateRangeId,
        selectedDate: toUtcStartOfDay(preparedDateKey),
      },
      select: { participantCount: true },
    });

    const heldParticipantCount = activeReservations.reduce(
      (sum: number, reservation: { participantCount: number }) => sum + (reservation.participantCount || 0),
      0,
    );

    if (heldParticipantCount === 0) {
      return;
    }

    const dateRange = await tx.inventoryDateRange.findUnique({
      where: { id: prepared.dateRangeId! },
      select: {
        totalCapacity: true,
        availableCount: true,
      },
    });

    if (!dateRange) {
      throw new Error("Date range not found");
    }

    const bookingDate = toUtcStartOfDay(preparedDateKey);
    const availabilityRow = await tx.listingSlotChange.findFirst({
      where: {
        inventoryDateRangeId: prepared.dateRangeId!,
        date: bookingDate,
      },
      orderBy: { createdAt: "desc" },
      select: { availableCount: true },
    });
    const bookedCounts = await getBookedDateRangeCountsTx(tx, prepared.dateRangeId!, [preparedDateKey]);
    const bookedCount = bookedCounts.get(preparedDateKey) || 0;
    const baselineAvailableCount =
      dateRange.totalCapacity === null
        ? Math.max(0, dateRange.availableCount || 0)
        : Math.max(0, dateRange.totalCapacity - bookedCount);
    const effectiveAvailableCount = Math.max(
      0,
      availabilityRow ? availabilityRow.availableCount : baselineAvailableCount,
    );

    if (effectiveAvailableCount < prepared.participantCount) {
      throw new Error("This batch is currently locked by another checkout. Please try again in a moment.");
    }

    return;
  }

  const activeReservation = await bookingReservationDelegate(tx).findFirst({
    where: {
      status: "PENDING_PAYMENT",
      expiresAt: { gt: now },
      dateRangeId: prepared.dateRangeId,
      selectedDate: toUtcStartOfDay(preparedDateKey),
    },
    select: { id: true },
  });

  if (activeReservation) {
    throw new Error("This slot is currently locked by another checkout. Please try again in a moment.");
  }
};

const getBookedDateRangeCountsTx = async (
  tx: TxClient,
  dateRangeId: string,
  dateKeys: string[],
) => {
  const uniqueDateKeys = [...new Set(dateKeys.filter(Boolean))].sort();
  const counts = new Map<string, number>();

  if (uniqueDateKeys.length === 0) {
    return counts;
  }

  const rangeStart = toUtcStartOfDay(uniqueDateKeys[0]);
  const rangeEnd = toUtcStartOfDay(uniqueDateKeys[uniqueDateKeys.length - 1]);
  const dateKeySet = new Set(uniqueDateKeys);

  const bookings = await tx.booking.findMany({
    where: {
      dateRangeId,
      bookingStatus: { in: ["CONFIRMED", "COMPLETED"] },
      bookingStartDate: { lte: rangeEnd },
      bookingEndDate: { gte: rangeStart },
    },
    select: {
      participantCount: true,
      pricingDetails: true,
      bookingStartDate: true,
      bookingEndDate: true,
    },
  });

  for (const booking of bookings) {
    const pricingDetails = booking.pricingDetails as { selectedDates?: string[] } | null;
    const bookingDateKeys =
      pricingDetails?.selectedDates && Array.isArray(pricingDetails.selectedDates)
        ? pricingDetails.selectedDates.map((value) => String(value || "").trim()).filter(Boolean)
        : [];

    const normalizedBookingDates =
      bookingDateKeys.length > 0
        ? bookingDateKeys
        : (() => {
            const dates: string[] = [];
            const currentDate = new Date(booking.bookingStartDate);
            const endDate = new Date(booking.bookingEndDate);
            while (currentDate <= endDate) {
              dates.push(currentDate.toISOString().split("T")[0]);
              currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
            return dates;
          })();

    for (const dateKey of normalizedBookingDates) {
      if (!dateKeySet.has(dateKey)) {
        continue;
      }

      counts.set(dateKey, (counts.get(dateKey) || 0) + (booking.participantCount || 1));
    }
  }

  return counts;
};

const ensureDateAvailabilityRowTx = async (
  tx: TxClient,
  input: {
    dateRangeId: string;
    listingId: string;
    variantId?: string;
    dateValue: Date;
    price: number;
    totalCapacity: number | null;
    baselineAvailableCount: number;
  },
) => {
  const existingSlotChange = await tx.listingSlotChange.findFirst({
    where: {
      inventoryDateRangeId: input.dateRangeId,
      date: input.dateValue,
    },
    orderBy: { createdAt: "desc" },
  });

  if (existingSlotChange) {
    return existingSlotChange;
  }

  return tx.listingSlotChange.create({
    data: {
      inventoryDateRangeId: input.dateRangeId,
      listingId: input.listingId,
      variantId: input.variantId || null,
      date: input.dateValue,
      price: input.price,
      totalCapacity: input.totalCapacity || 0,
      availableCount: input.baselineAvailableCount,
      triggerType: "seller_update",
    },
  });
};

const reservePreparedInventoryTx = async (tx: TxClient, prepared: PreparedReservation) => {
  if (prepared.bookingFormat === "F1") {
    const slot = await tx.listingSlot.findUnique({
      where: { id: prepared.listingSlotId! },
      include: {
        bookings: {
          where: {
            bookingStatus: { in: ["CONFIRMED", "COMPLETED"] },
          },
          select: { participantCount: true },
        },
      },
    });

    if (!slot || !slot.isActive) {
      throw new Error("This batch is no longer available.");
    }

    const bookedParticipants = slot.bookings.reduce(
      (sum, booking) => sum + (booking.participantCount || 0),
      0,
    );
    const maxRemainingCapacity = Math.max(0, (slot.totalCapacity || 0) - bookedParticipants);
    const effectiveAvailableCount = Math.min(Math.max(0, slot.availableCount || 0), maxRemainingCapacity);

    if (effectiveAvailableCount < prepared.participantCount) {
      throw new Error("This batch was just booked by someone else. Please reselect an available batch.");
    }

    await tx.listingSlot.update({
      where: { id: prepared.listingSlotId! },
      data: {
        availableCount: effectiveAvailableCount - prepared.participantCount,
      },
    });

    return true;
  }

  if (prepared.bookingFormat === "F2") {
    const dateRange = await tx.inventoryDateRange.findUnique({
      where: { id: prepared.dateRangeId! },
      select: {
        id: true,
        listingId: true,
        variantId: true,
        basePricePerDay: true,
        totalCapacity: true,
        availableCount: true,
      },
    });

    if (!dateRange) {
      throw new Error("Date range not found");
    }

    if (
      dateRange.totalCapacity === null ||
      dateRange.availableCount === null ||
      dateRange.totalCapacity <= 0
    ) {
      throw new Error(
        "This rental inventory is not configured correctly. Please contact support or choose another option.",
      );
    }

    const bookedCounts = await getBookedDateRangeCountsTx(tx, prepared.dateRangeId!, prepared.selectedDates || []);

    for (const selectedDate of prepared.selectedDates || []) {
      const dateValue = toUtcStartOfDay(selectedDate);
      const isBlocked = await tx.inventoryBlockedDate.findFirst({
        where: {
          listingId: prepared.listingId,
          variantId: prepared.variantId || undefined,
          blockedDate: dateValue,
        },
      });

      if (isBlocked) {
        throw new Error(`The date ${selectedDate} is no longer available.`);
      }

      const bookedCount = bookedCounts.get(selectedDate) || 0;
      const baselineAvailableCount = Math.max(0, (dateRange.totalCapacity || 0) - bookedCount);
      const availabilityRow = await ensureDateAvailabilityRowTx(tx, {
        dateRangeId: prepared.dateRangeId!,
        listingId: prepared.listingId,
        variantId: prepared.variantId,
        dateValue,
        price: Number(dateRange.basePricePerDay || 0),
        totalCapacity: dateRange.totalCapacity,
        baselineAvailableCount,
      });
      const effectiveAvailableCount = Math.max(0, availabilityRow.availableCount);

      if (effectiveAvailableCount < prepared.participantCount) {
        throw new Error(`The date ${selectedDate} was just booked by someone else. Please pick another date.`);
      }

      await tx.listingSlotChange.update({
        where: { id: availabilityRow.id },
        data: {
          availableCount: {
            decrement: prepared.participantCount,
          },
          triggerType: "customer_book",
        },
      });
    }

    return true;
  }

  const bookingDateKey = prepared.selectedDate || normalizeDateOnlyKey(prepared.bookingStartDate);
  const bookingDate = toUtcStartOfDay(bookingDateKey);
  const dateRange = await tx.inventoryDateRange.findUnique({
    where: { id: prepared.dateRangeId! },
    select: {
      id: true,
      listingId: true,
      variantId: true,
      basePricePerDay: true,
      totalCapacity: true,
      availableCount: true,
    },
  });

  if (!dateRange) {
    throw new Error("Date range not found");
  }

  const isBlocked = await tx.inventoryBlockedDate.findFirst({
    where: {
      listingId: prepared.listingId,
      variantId: prepared.variantId || undefined,
      blockedDate: bookingDate,
    },
  });

  if (isBlocked) {
      throw new Error("This date is blocked and not available for booking.");
  }

  const bookedCounts = await getBookedDateRangeCountsTx(tx, prepared.dateRangeId!, [bookingDateKey]);
  const bookedCount = bookedCounts.get(bookingDateKey) || 0;
  const baselineAvailableCount =
    dateRange.totalCapacity === null
      ? Math.max(0, dateRange.availableCount || 0)
      : Math.max(0, dateRange.totalCapacity - bookedCount);
  const availabilityRow = await ensureDateAvailabilityRowTx(tx, {
    dateRangeId: prepared.dateRangeId!,
    listingId: prepared.listingId,
    variantId: prepared.variantId,
    dateValue: bookingDate,
    price: Number(dateRange.basePricePerDay || 0),
    totalCapacity: dateRange.totalCapacity,
    baselineAvailableCount,
  });
  const effectiveAvailableCount = Math.max(0, availabilityRow.availableCount);

  if (effectiveAvailableCount < prepared.participantCount) {
    throw new Error("This slot was just booked by someone else. Please reselect an available slot.");
  }

  await tx.listingSlotChange.update({
    where: { id: availabilityRow.id },
    data: {
      availableCount: {
        decrement: prepared.participantCount,
      },
      triggerType: "customer_book",
    },
  });

  return true;
};

const prepareBookingReservation = async (body: any) => {
  const customerId = String(body?.customerId || "").trim();
  const listingId = String(body?.listingId || "").trim();
  const variantId = body?.variantId ? String(body.variantId).trim() : undefined;
  const bookingFormat = String(body?.bookingFormat || "").trim() as SupportedBookingFormat;
  const selectedAddons = normalizeSelectedAddonRows(body?.selectedAddons);
  const promoCode = body?.promoCode ? String(body.promoCode).trim() : null;
  const discountAmount = Number(body?.discountAmount || 0);
  const paymentMethod = String(body?.paymentMethod || "online").trim() || "online";

  if (!customerId || !listingId || !bookingFormat) {
    throw new Error("Missing required booking details.");
  }

  const customer = await prisma.user.findUnique({
    where: { id: customerId },
    select: { id: true, email: true },
  });

  if (!customer) {
    throw new Error("Customer not found. Please login again.");
  }

  if (bookingFormat === "F1") {
    const listingSlotId = String(body?.listingSlotId || body?.batchId || "").trim();
    const participantCount = Number(body?.participantCount || 0);
    if (!listingSlotId || !participantCount || !Array.isArray(body?.participants)) {
      throw new Error("Missing slot or participant details.");
    }

    const slot = await prisma.listingSlot.findUnique({
      where: { id: listingSlotId },
      include: {
        listing: {
          select: {
            listingName: true,
            currency: true,
            taxRate: true,
            advanceBookingPercentage: true,
            platformCommissionPercentage: true,
            tcsPercentage: true,
            bookingFormat: true,
          },
        },
      },
    });

    if (!slot || !slot.isActive) {
      throw new Error("Selected batch is no longer available.");
    }

    const bookingStartDate = slot.batchStartDate ? new Date(slot.batchStartDate) : slot.slotDate ? new Date(slot.slotDate) : null;
    const bookingEndDate = slot.batchEndDate ? new Date(slot.batchEndDate) : slot.slotDate ? new Date(slot.slotDate) : null;

    if (!bookingStartDate || !bookingEndDate) {
      throw new Error("Invalid slot: missing date information.");
    }

    const totalDays = Math.max(1, Math.ceil((bookingEndDate.getTime() - bookingStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const quantity = getQuantityForBookingFormat("F1", participantCount, totalDays);
    const convenienceFeeRate = await getConvenienceFeeRateInBasisPoints();
    const addonsTotal = selectedAddons.reduce((sum, addon) => sum + Number(addon.quantity || 0) * 0, 0);
    void addonsTotal;

    const paymentBreakdown = calculatePaymentBreakdown({
      bookingFormat: "F1",
      totalBasePrice: rupeesToPaise(slot.basePrice * Math.max(1, participantCount)),
      quantity,
      addonsAmount: rupeesToPaise(Number(body?.addonsTotal || 0)),
      discountAmount: rupeesToPaise(discountAmount || 0),
      advancePaymentPercentage: percentageToBasisPoints(slot.listing.advanceBookingPercentage, 10000),
      paymentMethod,
      taxRate: percentageToBasisPoints(slot.listing.taxRate, 1800),
      convenienceFeeRate,
      platformCommissionRate: percentageToBasisPoints(slot.listing.platformCommissionPercentage),
      tcsRateOfCommission: percentageToBasisPoints(slot.listing.tcsPercentage),
    });

    return {
      customerId,
      listingId,
      variantId,
      bookingFormat: "F1" as const,
      listingSlotId,
      participantCount,
      participants: body.participants,
      contactDetails: body.contactDetails || {},
      selectedAddons,
      promoCode,
      discountAmount,
      paymentMethod,
      currency: slot.listing.currency || "INR",
      basePrice: slot.basePrice,
      bookingStartDate,
      bookingEndDate,
      totalDays,
      paymentBreakdown,
      pricingDetailsForBooking: {
        totalBasePrice: paymentBreakdown.totalBasePrice / 100,
        quantity: paymentBreakdown.quantity,
        subtotalWithTax: paymentBreakdown.subtotalWithTax / 100,
        discountAmount: paymentBreakdown.discountAmount / 100,
        taxAmount: paymentBreakdown.taxAmount / 100,
        totalBaseAmount: paymentBreakdown.totalBaseAmount / 100,
        addonsTotal: paymentBreakdown.addonsAmount / 100,
        totalAmount: paymentBreakdown.totalAmount / 100,
        promoCode,
        amountPaidNow: paymentBreakdown.amountPaidOnline / 100,
        amountPendingAtVenue: paymentBreakdown.amountToCollectOffline / 100,
        convenienceFeeRate: paymentBreakdown.convenienceFeeRate / 100,
        convenienceFeeAmount: paymentBreakdown.convenienceFeeAmount / 100,
        totalPayableOnline: paymentBreakdown.totalPayableOnline / 100,
        paymentMethod: paymentBreakdown.paymentMethod,
        platformCommission: paymentBreakdown.platformCommission / 100,
        tcsAmount: paymentBreakdown.tcsAmount / 100,
        netPayToSeller: paymentBreakdown.netPayToSeller / 100,
        totalEarnings: paymentBreakdown.totalEarnings / 100,
      },
      inventoryReserved: true,
    };
  }

  if (bookingFormat === "F2") {
    const dateRangeId = String(body?.dateRangeId || "").trim();
    const selectedDates = normalizeSelectedDates(body?.selectedDates);

    if (!dateRangeId || selectedDates.length === 0) {
      throw new Error("Missing selected dates for this booking.");
    }

    const dateRange = await prisma.inventoryDateRange.findUnique({
      where: { id: dateRangeId },
      include: {
        listing: {
          select: {
            listingName: true,
            currency: true,
            taxRate: true,
            advanceBookingPercentage: true,
            platformCommissionPercentage: true,
            tcsPercentage: true,
            bookingFormat: true,
          },
        },
      },
    });

    if (!dateRange || !dateRange.isActive) {
      throw new Error("Date range not found.");
    }

    if (
      dateRange.totalCapacity === null ||
      dateRange.availableCount === null ||
      dateRange.totalCapacity <= 0
    ) {
      throw new Error(
        "This rental inventory is not configured correctly. Please contact support or choose another option.",
      );
    }

    const bookingStartDate = toUtcStartOfDay(selectedDates[0]);
    const bookingEndDate = toUtcStartOfDay(selectedDates[selectedDates.length - 1]);
    if (bookingStartDate < dateRange.availableFromDate || bookingEndDate > dateRange.availableToDate) {
      throw new Error("Selected dates are outside the available date range.");
    }

    const convenienceFeeRate = await getConvenienceFeeRateInBasisPoints();
    const paymentBreakdown = calculatePaymentBreakdown({
      bookingFormat: "F2",
      totalBasePrice: rupeesToPaise(Number(body?.subtotal || 0)),
      quantity: selectedDates.length,
      addonsAmount: rupeesToPaise(Number(body?.addonsTotal || 0)),
      discountAmount: rupeesToPaise(discountAmount || 0),
      advancePaymentPercentage: percentageToBasisPoints(dateRange.listing.advanceBookingPercentage, 10000),
      paymentMethod,
      taxRate: percentageToBasisPoints(dateRange.listing.taxRate, 1800),
      convenienceFeeRate,
      platformCommissionRate: percentageToBasisPoints(dateRange.listing.platformCommissionPercentage),
      tcsRateOfCommission: percentageToBasisPoints(dateRange.listing.tcsPercentage),
    });

    return {
      customerId,
      listingId,
      variantId,
      bookingFormat: "F2" as const,
      dateRangeId,
      selectedDates,
      participantCount: 1,
      participants: Array.isArray(body?.participants) ? body.participants : [],
      contactDetails: body.contactDetails || {},
      selectedAddons,
      promoCode,
      discountAmount,
      paymentMethod,
      currency: dateRange.listing.currency || "INR",
      basePrice: selectedDates.length > 0 ? Number(body?.subtotal || 0) / selectedDates.length : Number(body?.subtotal || 0),
      bookingStartDate,
      bookingEndDate,
      totalDays: selectedDates.length,
      paymentBreakdown,
      pricingDetailsForBooking: {
        selectedDates,
        totalBasePrice: paymentBreakdown.totalBasePrice / 100,
        quantity: paymentBreakdown.quantity,
        subtotalWithTax: paymentBreakdown.subtotalWithTax / 100,
        discountAmount: paymentBreakdown.discountAmount / 100,
        taxAmount: paymentBreakdown.taxAmount / 100,
        totalBaseAmount: paymentBreakdown.totalBaseAmount / 100,
        addonsTotal: paymentBreakdown.addonsAmount / 100,
        totalAmount: paymentBreakdown.totalAmount / 100,
        promoCode,
        amountPaidNow: paymentBreakdown.amountPaidOnline / 100,
        amountPendingAtVenue: paymentBreakdown.amountToCollectOffline / 100,
        convenienceFeeRate: paymentBreakdown.convenienceFeeRate / 100,
        convenienceFeeAmount: paymentBreakdown.convenienceFeeAmount / 100,
        totalPayableOnline: paymentBreakdown.totalPayableOnline / 100,
        paymentMethod: paymentBreakdown.paymentMethod,
        platformCommission: paymentBreakdown.platformCommission / 100,
        tcsAmount: paymentBreakdown.tcsAmount / 100,
        netPayToSeller: paymentBreakdown.netPayToSeller / 100,
        totalEarnings: paymentBreakdown.totalEarnings / 100,
      },
      inventoryReserved: true,
    };
  }

  const dateRangeId = String(body?.dateRangeId || "").trim();
  const selectedDate =
    bookingFormat === "F3"
      ? String(body?.selectedDate || body?.selectedDates?.[0] || "").trim()
      : normalizeSelectedDates(body?.selectedDates)[0] || "";
  const participantCount = bookingFormat === "F3" ? Number(body?.participantCount || 0) : 1;

  if (!dateRangeId || !selectedDate || !participantCount) {
    throw new Error("Missing slot selection for this booking.");
  }

  const dateRange = await prisma.inventoryDateRange.findUnique({
    where: { id: dateRangeId },
    include: {
      listing: {
        select: {
          listingName: true,
          currency: true,
          taxRate: true,
          advanceBookingPercentage: true,
          platformCommissionPercentage: true,
          tcsPercentage: true,
          bookingFormat: true,
        },
      },
    },
  });

  if (!dateRange || !dateRange.isActive) {
    throw new Error("Selected slot is no longer available.");
  }

  const bookingDate = toUtcStartOfDay(selectedDate);
  let effectivePrice = dateRange.basePricePerDay;
  const priceOverride = await prisma.listingSlotChange.findFirst({
    where: {
      inventoryDateRangeId: dateRangeId,
      date: bookingDate,
    },
    orderBy: { createdAt: "desc" },
  });

  if (priceOverride) {
    effectivePrice = priceOverride.price;
  }

  const totalDays = 1;
  const quantity = getQuantityForBookingFormat(bookingFormat, participantCount, totalDays);
  const totalBasePriceMultiplier = bookingFormat === "F3" ? Math.max(1, participantCount) : quantity;
  const convenienceFeeRate = await getConvenienceFeeRateInBasisPoints();
  const paymentBreakdown = calculatePaymentBreakdown({
    bookingFormat,
    totalBasePrice: rupeesToPaise(effectivePrice * totalBasePriceMultiplier),
    quantity,
    addonsAmount: rupeesToPaise(Number(body?.addonsTotal || 0)),
    discountAmount: rupeesToPaise(discountAmount || 0),
    advancePaymentPercentage: percentageToBasisPoints(dateRange.listing.advanceBookingPercentage, 10000),
    paymentMethod,
    taxRate: percentageToBasisPoints(dateRange.listing.taxRate, 1800),
    convenienceFeeRate,
    platformCommissionRate: percentageToBasisPoints(dateRange.listing.platformCommissionPercentage),
    tcsRateOfCommission: percentageToBasisPoints(dateRange.listing.tcsPercentage),
  });

  return {
    customerId,
    listingId,
    variantId,
    bookingFormat,
    dateRangeId,
    selectedDate,
    selectedDates: [selectedDate],
    participantCount,
    participants: Array.isArray(body?.participants) ? body.participants : [],
    contactDetails: body.contactDetails || {},
    selectedAddons,
    promoCode,
    discountAmount,
    paymentMethod,
    currency: dateRange.listing.currency || "INR",
    basePrice: effectivePrice,
    bookingStartDate: bookingDate,
    bookingEndDate: bookingDate,
    totalDays,
    paymentBreakdown,
    pricingDetailsForBooking: {
      totalBasePrice: paymentBreakdown.totalBasePrice / 100,
      quantity: paymentBreakdown.quantity,
      subtotalWithTax: paymentBreakdown.subtotalWithTax / 100,
      discountAmount: paymentBreakdown.discountAmount / 100,
      taxAmount: paymentBreakdown.taxAmount / 100,
      totalBaseAmount: paymentBreakdown.totalBaseAmount / 100,
      addonsTotal: paymentBreakdown.addonsAmount / 100,
      totalAmount: paymentBreakdown.totalAmount / 100,
      promoCode,
      amountPaidNow: paymentBreakdown.amountPaidOnline / 100,
      amountPendingAtVenue: paymentBreakdown.amountToCollectOffline / 100,
      convenienceFeeRate: paymentBreakdown.convenienceFeeRate / 100,
      convenienceFeeAmount: paymentBreakdown.convenienceFeeAmount / 100,
      totalPayableOnline: paymentBreakdown.totalPayableOnline / 100,
      paymentMethod: paymentBreakdown.paymentMethod,
      platformCommission: paymentBreakdown.platformCommission / 100,
      tcsAmount: paymentBreakdown.tcsAmount / 100,
      netPayToSeller: paymentBreakdown.netPayToSeller / 100,
      totalEarnings: paymentBreakdown.totalEarnings / 100,
    },
    inventoryReserved: true,
  };
};

const createBookingFromReservationTx = async (tx: TxClient, reservation: any) => {
  const bookingPayload = reservation.bookingPayload as Record<string, any>;
  const pricingDetails = reservation.pricingDetails as Record<string, any>;
  const paymentBreakdown = pricingDetails.paymentBreakdown as Record<string, number>;
  const bookingOtp = await generateUniqueBookingOtp();

  const booking = await tx.booking.create({
    data: {
      bookingReference: generateBookingReference(),
      customerId: bookingPayload.customerId,
      listingSlotId: bookingPayload.listingSlotId || null,
      dateRangeId: bookingPayload.dateRangeId || null,
      bookingStartDate: new Date(bookingPayload.bookingStartDate),
      bookingEndDate: new Date(bookingPayload.bookingEndDate),
      participantCount: Number(bookingPayload.participantCount || 1),
      totalDays: Number(bookingPayload.totalDays || 1),
      basePrice: Number(bookingPayload.basePrice || 0),
      totalAmount: Number(pricingDetails.totalAmount || 0),
      bookingStatus: "CONFIRMED",
      otp: bookingOtp,
      otpVerification: false,
      participants: bookingPayload.participants || [],
      contactDetails: bookingPayload.contactDetails || {},
      selectedAddons: bookingPayload.selectedAddons || [],
      pricingDetails,
    },
  });

  await tx.bookingPayment.create({
    data: {
      bookingId: booking.id,
      totalBasePrice: Number(paymentBreakdown.totalBasePrice || 0),
      quantity: Number(paymentBreakdown.quantity || 1),
      taxRate: Number(paymentBreakdown.taxRate || 0),
      subtotalWithTax: Number(paymentBreakdown.subtotalWithTax || 0),
      discountAmount: Number(paymentBreakdown.discountAmount || 0),
      taxAmount: Number(paymentBreakdown.taxAmount || 0),
      totalBaseAmount: Number(paymentBreakdown.totalBaseAmount || 0),
      addonsAmount: Number(paymentBreakdown.addonsAmount || 0),
      totalAmount: Number(paymentBreakdown.totalAmount || 0),
      amountPaidOnline: Number(paymentBreakdown.amountPaidOnline || 0),
      amountToCollectOffline: Number(paymentBreakdown.amountToCollectOffline || 0),
      convenienceFeeRate: Number(paymentBreakdown.convenienceFeeRate || 0),
      convenienceFeeAmount: Number(paymentBreakdown.convenienceFeeAmount || 0),
      totalPayableOnline: Number(paymentBreakdown.totalPayableOnline || 0),
      paymentMethod: String(paymentBreakdown.paymentMethod || bookingPayload.paymentMethod || "online"),
      platformCommissionRate: Number(paymentBreakdown.platformCommissionRate || 0),
      platformCommission: Number(paymentBreakdown.platformCommission || 0),
      tcsRate: Number(paymentBreakdown.tcsRate || 0),
      tcsAmount: Number(paymentBreakdown.tcsAmount || 0),
      netPayToSeller: Number(paymentBreakdown.netPayToSeller || 0),
      balanceToCollect: Number(paymentBreakdown.balanceToCollect || 0),
      totalEarnings: Number(paymentBreakdown.totalEarnings || 0),
      settlementStatus: "PENDING",
    },
  });

  return booking;
};

export const initiateBookingReservation = async (c: Context) => {
  try {
    const user = c.get("user");
    if (user && user.userType !== "customer") {
      return c.json(
        { success: false, message: "Only customers can create bookings.Please login as a customer." },
        403,
      );
    }

    const body = await c.req.json();
    const prepared = await prepareBookingReservation(body);
    const expiresAt = new Date(Date.now() + BOOKING_RESERVATION_TTL_MS);

    const reservation = await prisma.$transaction(async (tx) => {
      await acquireReservationLocks(tx, prepared);
      await releaseExpiredReservationsForPreparedBooking(tx, prepared);
      await assertNoActiveReservationConflictTx(tx, prepared);
      const inventoryReserved = await reservePreparedInventoryTx(tx, prepared);

      return bookingReservationDelegate(tx).create({
        data: {
          reservationReference: generateReservationReference(),
          customerId: prepared.customerId,
          listingId: prepared.listingId,
          variantId: prepared.variantId || null,
          bookingFormat: prepared.bookingFormat,
          listingSlotId: prepared.listingSlotId || null,
          dateRangeId: prepared.dateRangeId || null,
          selectedDate: prepared.selectedDate ? toUtcStartOfDay(prepared.selectedDate) : null,
          selectedDates: prepared.selectedDates || [],
          participantCount: prepared.participantCount,
          currency: prepared.currency,
          paymentMethod: prepared.paymentMethod,
          inventoryReserved,
          pricingDetails: {
            ...buildPricingDetailsForStorage(prepared),
            paymentBreakdown: prepared.paymentBreakdown,
          },
          bookingPayload: buildBookingPayloadForReservation(prepared),
          status: "PENDING_PAYMENT",
          expiresAt,
        },
      });
    }, RESERVATION_TRANSACTION_OPTIONS);

    try {
      const razorpay = getRazorpayInstance();
      const order = await razorpay.orders.create({
        amount: Number(prepared.paymentBreakdown.totalPayableOnline),
        currency: prepared.currency || "INR",
        receipt: buildSafeReceipt(reservation.reservationReference),
        notes: {
          reservationId: reservation.id,
          listingId: prepared.listingId,
          customerId: prepared.customerId,
        },
      });

      await bookingReservationDelegate(prisma).update({
        where: { id: reservation.id },
        data: {
          razorpayOrderId: order.id,
        },
      });

      return c.json({
        success: true,
        data: {
          reservationId: reservation.id,
          reservationReference: reservation.reservationReference,
          expiresAt: expiresAt.toISOString(),
          orderId: order.id,
          amount: order.amount,
          amountInRupees: Number(order.amount) / 100,
          currency: order.currency,
          receipt: order.receipt,
          razorpayKeyId: process.env.RAZORPAY_API_KEY,
        },
      });
    } catch (error: any) {
      await prisma.$transaction(async (tx) => {
        const reservationForRelease = await bookingReservationDelegate(tx).findUnique({
          where: { id: reservation.id },
          select: {
            id: true,
            status: true,
            inventoryReserved: true,
            listingSlotId: true,
            dateRangeId: true,
            selectedDate: true,
            selectedDates: true,
            participantCount: true,
          },
        });

        if (reservationForRelease) {
          await releaseReservationInventoryTx(
            tx,
            reservationForRelease,
            "PAYMENT_FAILED",
            error?.message || "Failed to create Razorpay order.",
          );
        }
      }, RESERVATION_TRANSACTION_OPTIONS);

      throw error;
    }
  } catch (error: any) {
    const message = error?.message || "Failed to reserve booking inventory.";
    console.error("Error initiating booking reservation:", error);
    return c.json(
      { success: false, message },
      isInventoryConflictError(message) ? 409 : 500,
    );
  }
};

export const confirmBookingReservation = async (c: Context) => {
  try {
    const user = c.get("user");
    if (user && user.userType !== "customer") {
      return c.json(
        { success: false, message: "Only customers can complete bookings.Please login as a customer." },
        403,
      );
    }

    const body = await c.req.json();
    const reservationId = String(body?.reservationId || "").trim();
    const razorpayOrderId = String(body?.razorpay_order_id || "").trim();
    const razorpayPaymentId = String(body?.razorpay_payment_id || "").trim();
    const razorpaySignature = String(body?.razorpay_signature || "").trim();

    if (!reservationId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return c.json({ success: false, message: "Missing required payment verification fields" }, 400);
    }

    if (!verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
      return c.json({ success: false, message: "Payment verification failed." }, 400);
    }

    const completed = await prisma.$transaction(async (tx) => {
      const reservation = await bookingReservationDelegate(tx).findUnique({
        where: { id: reservationId },
      });

      if (!reservation) {
        throw new Error("Reservation not found.");
      }

      if (reservation.status === "COMPLETED" && reservation.bookingId) {
        return { bookingId: reservation.bookingId };
      }

      const bookingPayload = reservation.bookingPayload as Record<string, any>;
      const preparedForLocks: PreparedReservation = {
        customerId: String(bookingPayload.customerId || ""),
        listingId: String(bookingPayload.listingId || ""),
        variantId: bookingPayload.variantId || undefined,
        bookingFormat: reservation.bookingFormat as SupportedBookingFormat,
        listingSlotId: reservation.listingSlotId || undefined,
        dateRangeId: reservation.dateRangeId || undefined,
        selectedDate: bookingPayload.selectedDate || undefined,
        selectedDates: normalizeSelectedDates(bookingPayload.selectedDates),
        participantCount: Number(bookingPayload.participantCount || 1),
        participants: Array.isArray(bookingPayload.participants) ? bookingPayload.participants : [],
        contactDetails: bookingPayload.contactDetails || {},
        selectedAddons: normalizeSelectedAddonRows(bookingPayload.selectedAddons),
        promoCode: bookingPayload.promoCode || null,
        discountAmount: Number(bookingPayload.discountAmount || 0),
        paymentMethod: String(bookingPayload.paymentMethod || "online"),
        currency: String(bookingPayload.currency || "INR"),
        basePrice: Number(bookingPayload.basePrice || 0),
        bookingStartDate: new Date(bookingPayload.bookingStartDate),
        bookingEndDate: new Date(bookingPayload.bookingEndDate),
        totalDays: Number(bookingPayload.totalDays || 1),
        paymentBreakdown: (reservation.pricingDetails as any).paymentBreakdown,
        pricingDetailsForBooking: reservation.pricingDetails as Record<string, unknown>,
        inventoryReserved: reservation.inventoryReserved,
      };

      await acquireReservationLocks(tx, preparedForLocks);

      if (reservation.razorpayOrderId && reservation.razorpayOrderId !== razorpayOrderId) {
        throw new Error("Payment order does not match the reserved booking.");
      }

      if (reservation.expiresAt <= new Date()) {
        await releaseReservationInventoryTx(
          tx,
          {
            id: reservation.id,
            status: reservation.status,
            inventoryReserved: reservation.inventoryReserved,
            listingSlotId: reservation.listingSlotId,
            dateRangeId: reservation.dateRangeId,
            selectedDate: reservation.selectedDate,
            selectedDates: reservation.selectedDates,
            participantCount: reservation.participantCount,
          },
          "EXPIRED",
          "Payment finished after the reservation expired.",
        );
        throw new Error("Your reservation expired before payment was completed. Please try booking again.");
      }

      if (reservation.status !== "PENDING_PAYMENT") {
        throw new Error("This reservation can no longer be completed.");
      }

      const booking = await createBookingFromReservationTx(tx, reservation);
      await bookingReservationDelegate(tx).update({
        where: { id: reservation.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
          bookingId: booking.id,
        },
      });

      return { bookingId: booking.id };
    }, RESERVATION_TRANSACTION_OPTIONS);

    return c.json({
      success: true,
      message: "Booking confirmed successfully.",
      data: completed,
    });
  } catch (error: any) {
    const message = error?.message || "Failed to confirm booking.";
    console.error("Error confirming booking reservation:", error);
    return c.json(
      { success: false, message },
      isInventoryConflictError(message) ? 409 : 500,
    );
  }
};

export const releaseBookingReservation = async (c: Context) => {
  try {
    const reservationId = c.req.param("reservationId");
    if (!reservationId) {
      return c.json({ success: false, message: "Reservation ID is required." }, 400);
    }

    await prisma.$transaction(async (tx) => {
      const reservation = await bookingReservationDelegate(tx).findUnique({
        where: { id: reservationId },
      });

      if (!reservation || reservation.status !== "PENDING_PAYMENT") {
        return;
      }

      const bookingPayload = reservation.bookingPayload as Record<string, any>;
      const preparedForLocks: PreparedReservation = {
        customerId: String(bookingPayload.customerId || ""),
        listingId: String(bookingPayload.listingId || ""),
        variantId: bookingPayload.variantId || undefined,
        bookingFormat: reservation.bookingFormat as SupportedBookingFormat,
        listingSlotId: reservation.listingSlotId || undefined,
        dateRangeId: reservation.dateRangeId || undefined,
        selectedDate: bookingPayload.selectedDate || undefined,
        selectedDates: normalizeSelectedDates(bookingPayload.selectedDates),
        participantCount: Number(bookingPayload.participantCount || 1),
        participants: [],
        contactDetails: {},
        selectedAddons: [],
        promoCode: null,
        discountAmount: 0,
        paymentMethod: "online",
        currency: String(bookingPayload.currency || "INR"),
        basePrice: Number(bookingPayload.basePrice || 0),
        bookingStartDate: new Date(bookingPayload.bookingStartDate),
        bookingEndDate: new Date(bookingPayload.bookingEndDate),
        totalDays: Number(bookingPayload.totalDays || 1),
        paymentBreakdown: (reservation.pricingDetails as any).paymentBreakdown,
        pricingDetailsForBooking: {},
        inventoryReserved: reservation.inventoryReserved,
      };

      await acquireReservationLocks(tx, preparedForLocks);
      await releaseReservationInventoryTx(
        tx,
        {
          id: reservation.id,
          status: reservation.status,
          inventoryReserved: reservation.inventoryReserved,
          listingSlotId: reservation.listingSlotId,
          dateRangeId: reservation.dateRangeId,
          selectedDate: reservation.selectedDate,
          selectedDates: reservation.selectedDates,
          participantCount: reservation.participantCount,
        },
        "RELEASED",
        "Customer left checkout before completing payment.",
      );
    }, RESERVATION_TRANSACTION_OPTIONS);

    return c.json({ success: true, message: "Reservation released." });
  } catch (error: any) {
    console.error("Error releasing booking reservation:", error);
    return c.json(
      { success: false, message: error?.message || "Failed to release reservation." },
      500,
    );
  }
};

// Create comprehensive booking with participants and addons
export const createBooking = async (c: Context) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");
    
    debugLog("=== BOOKING REQUEST DEBUG ===");
    debugLog("Booking request summary:", {
      customerId: body?.customerId,
      listingId: body?.listingId,
      listingSlotId: body?.listingSlotId,
      dateRangeId: body?.dateRangeId,
      participantCount: body?.participantCount,
      selectedDate: body?.selectedDate,
      userType: user?.userType,
      role: user?.role,
    });
    
    // Check if user is a customer
    if (user && user.userType !== "customer") {
      return c.json({ 
        success: false, 
        message: "Only customers can create bookings.Please login as a customer." 
      }, 403);
    }
    
    const {
      customerId,
      listingId,
      variantId,
      listingSlotId,  // For F1 format
      dateRangeId,    // For F3/F4 format
      selectedDate,   // For F3/F4 - specific booking date
      participantCount,
      participants,
      contactDetails,
      selectedAddons,
      promoCode,
      discountAmount,
      subtotal,
      addonsTotal,
      taxAmount,
      totalAmount,
      amountPaidNow,
      amountPendingAtVenue,
      paymentMethod,
    } = body;

    debugLog("Field validation", {
      customerId,
      listingSlotId,
      dateRangeId,
      participantCount,
      participantItems: Array.isArray(participants) ? participants.length : 0,
    });
    
    // Validate required fields with specific error messages
    const missingFields = [];
    if (!customerId) missingFields.push("customerId");
    if (!listingSlotId && !dateRangeId) missingFields.push("listingSlotId or dateRangeId");
    if (!participantCount) missingFields.push("participantCount");
    if (!participants) missingFields.push("participants");
    
    if (missingFields.length > 0) {
      debugLog("VALIDATION FAILED - Missing fields", missingFields);
      return c.json({ 
        success: false, 
        message: `Missing required fields: ${missingFields.join(", ")}` 
      }, 400);
    }

    // Verify customer exists
    const customer = await prisma.user.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      debugLog("VALIDATION FAILED - Customer not found", customerId);
      return c.json({ 
        success: false, 
        message: "Customer not found. Please login again." 
      }, 404);
    }

    debugLog("Customer verified", customer.email);

    // Get slot/dateRange details based on format
    let slot: any = null;
    let dateRange: any = null;
    let listingDetails: any = null;

    if (listingSlotId) {
      // F1 format - using listing_slots table
      slot = await prisma.listingSlot.findUnique({
        where: { id: listingSlotId },
        include: {
          listing: {
            select: { 
              listingName: true, 
              currency: true, 
              taxRate: true,
              advanceBookingPercentage: true,
              platformCommissionPercentage: true,
              tcsPercentage: true,
              operatorId: true,
              bookingFormat: true,
            }
          }
        }
      });

      if (!slot) {
        return c.json({ success: false, message: "Slot not found" }, 404);
      }

      if (slot.availableCount < participantCount) {
        return c.json({ success: false, message: "Not enough capacity available" }, 400);
      }

      listingDetails = slot.listing;
    } else if (dateRangeId) {
      // F3/F4 format - using inventory_date_ranges table
      dateRange = await prisma.inventoryDateRange.findUnique({
        where: { id: dateRangeId },
        include: {
          listing: {
            select: { 
              listingName: true, 
              currency: true, 
              taxRate: true,
              advanceBookingPercentage: true,
              platformCommissionPercentage: true,
              tcsPercentage: true,
              operatorId: true,
              bookingFormat: true,
            }
          },
          slotDefinition: {
            select: {
              startTime: true,
              endTime: true,
            }
          }
        }
      });

      if (!dateRange) {
        return c.json({ success: false, message: "Date range not found" }, 404);
      }

      // For F3/F4, check per-date availability using ListingSlotChange if available
      const bookingDate = selectedDate ? new Date(selectedDate) : null;
      let effectiveAvailableCount = dateRange.availableCount || 0;
      
      if (bookingDate) {
        // Check if there's a per-date override
        const slotChange = await prisma.listingSlotChange.findFirst({
          where: {
            inventoryDateRangeId: dateRangeId,
            date: bookingDate,
          },
        });
        
        if (slotChange) {
          effectiveAvailableCount = slotChange.availableCount;
        }

        // Check if the date is blocked
        const isBlocked = await prisma.inventoryBlockedDate.findFirst({
          where: {
            listingId: dateRange.listingId,
            variantId: dateRange.variantId || undefined,
            blockedDate: bookingDate,
          },
        });

        if (isBlocked) {
          return c.json({ success: false, message: "This date is blocked and not available for booking" }, 400);
        }
      }

      if (effectiveAvailableCount < participantCount) {
        return c.json({ success: false, message: "Not enough capacity available" }, 400);
      }

      listingDetails = dateRange.listing;
    } else {
      return c.json({ success: false, message: "Invalid booking format" }, 400);
    }

    // Determine booking dates based on slot type
    let bookingStartDate: Date;
    let bookingEndDate: Date;
    let basePrice: number;
    
    if (slot) {
      // F1 format - from listing_slots
      if (slot.batchStartDate && slot.batchEndDate) {
        bookingStartDate = new Date(slot.batchStartDate);
        bookingEndDate = new Date(slot.batchEndDate);
      } else if (slot.slotDate) {
        bookingStartDate = new Date(slot.slotDate);
        bookingEndDate = new Date(slot.slotDate);
      } else {
        return c.json({ 
          success: false, 
          message: "Invalid slot: missing date information" 
        }, 400);
      }
      basePrice = slot.basePrice;
    } else if (dateRange) {
      // F3/F4 format - from inventory_date_ranges
      // Use selectedDate for F3/F4 if provided, otherwise fall back to range dates
      if (selectedDate) {
        bookingStartDate = new Date(selectedDate);
        bookingEndDate = new Date(selectedDate);
      } else {
        bookingStartDate = new Date(dateRange.availableFromDate);
        bookingEndDate = new Date(dateRange.availableToDate);
      }
      
      // Check for price override for the specific date
      let effectivePrice = dateRange.basePricePerDay;
      if (selectedDate) {
        const priceOverride = await prisma.listingSlotChange.findFirst({
          where: {
            inventoryDateRangeId: dateRangeId,
            date: new Date(selectedDate),
          },
        });
        if (priceOverride) {
          effectivePrice = priceOverride.price;
        }
      }
      basePrice = effectivePrice;
    } else {
      return c.json({ 
        success: false, 
        message: "Invalid booking: missing slot or date range" 
      }, 400);
    }

    debugLog("Booking dates", { bookingStartDate, bookingEndDate });

    // Calculate total days
    const timeDiff = bookingEndDate.getTime() - bookingStartDate.getTime();
    const totalDays = Math.max(1, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)) + 1);

    // Get booking format from listing
    const bookingFormat = listingDetails.bookingFormat as "F1" | "F2" | "F3" | "F4";

    // Calculate quantity based on booking format
    const quantity = getQuantityForBookingFormat(bookingFormat, participantCount, totalDays);

    // Calculate TOTAL base price.
    // F1/F3 are participant-priced; F2/F4 are already date-based totals.
    const totalBasePriceMultiplier =
      bookingFormat === "F1" || bookingFormat === "F3"
        ? Math.max(1, participantCount)
        : quantity;
    const totalBasePrice = rupeesToPaise(basePrice * totalBasePriceMultiplier);

    // Calculate payment breakdown with CORRECT logic
    const convenienceFeeRate = await getConvenienceFeeRateInBasisPoints();

    const paymentInput: PaymentCalculationInput = {
      bookingFormat,
      totalBasePrice, // TOTAL base price (with price overrides)
      quantity, // For display only
      addonsAmount: rupeesToPaise(addonsTotal || 0),
      discountAmount: rupeesToPaise(discountAmount || 0),
      advancePaymentPercentage: percentageToBasisPoints(listingDetails.advanceBookingPercentage, 10000),
      paymentMethod: paymentMethod || "online",
      taxRate: percentageToBasisPoints(listingDetails.taxRate, 1800),
      convenienceFeeRate,
      platformCommissionRate: percentageToBasisPoints(listingDetails.platformCommissionPercentage),
      tcsRateOfCommission: percentageToBasisPoints(listingDetails.tcsPercentage),
    };

    const paymentBreakdown = calculatePaymentBreakdown(paymentInput);

    debugLog("Payment breakdown", {
      totalBasePrice: paymentBreakdown.totalBasePrice / 100,
      quantity: paymentBreakdown.quantity,
      taxAmount: paymentBreakdown.taxAmount / 100,
      subtotalWithTax: paymentBreakdown.subtotalWithTax / 100,
      discountAmount: paymentBreakdown.discountAmount / 100,
      totalBaseAmount: paymentBreakdown.totalBaseAmount / 100,
      addonsAmount: paymentBreakdown.addonsAmount / 100,
      totalAmount: paymentBreakdown.totalAmount / 100,
      amountPaidOnline: paymentBreakdown.amountPaidOnline / 100,
      amountToCollectOffline: paymentBreakdown.amountToCollectOffline / 100,
      platformCommission: paymentBreakdown.platformCommission / 100,
      tcsAmount: paymentBreakdown.tcsAmount / 100,
      netPayToSeller: paymentBreakdown.netPayToSeller / 100,
      totalEarnings: paymentBreakdown.totalEarnings / 100,
    });

    // Create booking with all details in transaction
    const result = await prisma.$transaction(async (tx) => {
      const bookingOtp = await generateUniqueBookingOtp();

      // Create booking with all metadata
      const booking = await tx.booking.create({
        data: {
          bookingReference: generateBookingReference(),
          customerId,
          listingSlotId: listingSlotId || null,
          dateRangeId: dateRangeId || null,
          bookingStartDate,
          bookingEndDate,
          participantCount,
          totalDays,
          basePrice: basePrice,
          totalAmount: paymentBreakdown.totalAmount / 100, // Store in rupees
          bookingStatus: "CONFIRMED",
          otp: bookingOtp,
          otpVerification: false,
          participants: participants,
          contactDetails: contactDetails,
          selectedAddons: selectedAddons || [],
          pricingDetails: {
            totalBasePrice: paymentBreakdown.totalBasePrice / 100,
            quantity: paymentBreakdown.quantity,
            subtotalWithTax: paymentBreakdown.subtotalWithTax / 100,
            discountAmount: paymentBreakdown.discountAmount / 100,
            taxAmount: paymentBreakdown.taxAmount / 100,
            totalBaseAmount: paymentBreakdown.totalBaseAmount / 100,
            addonsTotal: paymentBreakdown.addonsAmount / 100,
            totalAmount: paymentBreakdown.totalAmount / 100,
            promoCode: promoCode || null,
            amountPaidNow: paymentBreakdown.amountPaidOnline / 100,
            amountPendingAtVenue: paymentBreakdown.amountToCollectOffline / 100,
            convenienceFeeRate: paymentBreakdown.convenienceFeeRate / 100,
            convenienceFeeAmount: paymentBreakdown.convenienceFeeAmount / 100,
            totalPayableOnline: paymentBreakdown.totalPayableOnline / 100,
            paymentMethod: paymentBreakdown.paymentMethod,
            platformCommission: paymentBreakdown.platformCommission / 100,
            tcsAmount: paymentBreakdown.tcsAmount / 100,
            netPayToSeller: paymentBreakdown.netPayToSeller / 100,
            totalEarnings: paymentBreakdown.totalEarnings / 100,
          },
        },
      });

      // Create BookingPayment record with CORRECT fields
      const bookingPayment = await tx.bookingPayment.create({
        data: {
          bookingId: booking.id,
          totalBasePrice: paymentBreakdown.totalBasePrice,
          quantity: paymentBreakdown.quantity,
          taxRate: paymentBreakdown.taxRate,
          subtotalWithTax: paymentBreakdown.subtotalWithTax,
          discountAmount: paymentBreakdown.discountAmount,
          taxAmount: paymentBreakdown.taxAmount,
          totalBaseAmount: paymentBreakdown.totalBaseAmount,
          addonsAmount: paymentBreakdown.addonsAmount,
          totalAmount: paymentBreakdown.totalAmount,
          amountPaidOnline: paymentBreakdown.amountPaidOnline,
          amountToCollectOffline: paymentBreakdown.amountToCollectOffline,
          convenienceFeeRate: paymentBreakdown.convenienceFeeRate,
          convenienceFeeAmount: paymentBreakdown.convenienceFeeAmount,
          totalPayableOnline: paymentBreakdown.totalPayableOnline,
          paymentMethod: paymentBreakdown.paymentMethod,
          platformCommissionRate: paymentBreakdown.platformCommissionRate,
          platformCommission: paymentBreakdown.platformCommission,
          tcsRate: paymentBreakdown.tcsRate,
          tcsAmount: paymentBreakdown.tcsAmount,
          netPayToSeller: paymentBreakdown.netPayToSeller,
          balanceToCollect: paymentBreakdown.balanceToCollect,
          totalEarnings: paymentBreakdown.totalEarnings,
          settlementStatus: "PENDING",
        },
      });

      // Update availability based on format
      if (listingSlotId) {
        // F1 - update listing_slots table
        await tx.listingSlot.update({
          where: { id: listingSlotId },
          data: {
            availableCount: {
              decrement: participantCount,
            },
          },
        });
      } else if (dateRangeId) {
        // F3/F4 - update per-date availability using ListingSlotChange table
        const bookingDate = selectedDate ? new Date(selectedDate) : bookingStartDate;
        
        // Check if a slot change already exists for this date
        const existingSlotChange = await tx.listingSlotChange.findFirst({
          where: {
            inventoryDateRangeId: dateRangeId,
            date: bookingDate,
          },
        });

        if (existingSlotChange) {
          // Update existing slot change - decrement availableCount
          await tx.listingSlotChange.update({
            where: { id: existingSlotChange.id },
            data: {
              availableCount: {
                decrement: participantCount,
              },
              triggerType: "customer_book",
            },
          });
        } else {
          // Create new slot change with decremented count from base range
          const dateRangeData = await tx.inventoryDateRange.findUnique({
            where: { id: dateRangeId },
          });
          
          if (dateRangeData) {
            await tx.listingSlotChange.create({
              data: {
                inventoryDateRangeId: dateRangeId,
                listingId: dateRangeData.listingId,
                variantId: dateRangeData.variantId || null,
                date: bookingDate,
                price: dateRangeData.basePricePerDay,
                totalCapacity: dateRangeData.totalCapacity || 0,
                availableCount: (dateRangeData.availableCount || 0) - participantCount,
                triggerType: "customer_book",
              },
            });
          }
        }
      }

      return {
        booking,
        bookingPayment,
        bookingReference: booking.bookingReference,
      };
    });

    return c.json({ 
      success: true, 
      data: result,
      message: "Booking created successfully. Proceed to payment."
    });
  } catch (error: any) {
    console.error("Error creating booking:", error);
    return c.json({ 
      success: false, 
      message: error.message || "Failed to create booking" 
    }, 500);
  }
};

// Create booking for F1 (Multi-day Batch) - Legacy
export const createF1Booking = async (c: Context) => {
  try {
    const user = c.get("user");
    
    // Check if user is a customer
    if (user && user.userType !== "customer") {
      return c.json({ 
        success: false, 
        message: "Only customers can create bookings. Please login as a customer." 
      }, 403);
    }
    
    const { customerId, listingSlotId, participantCount } = await c.req.json();

    if (!customerId || !listingSlotId || !participantCount) {
      return c.json({ success: false, message: "Missing required fields" }, 400);
    }

    // Get slot details
    const slot = await prisma.listingSlot.findUnique({
      where: { id: listingSlotId },
      include: {
        listing: {
          select: { listingName: true, currency: true, taxRate: true }
        }
      }
    });

    if (!slot) {
      return c.json({ success: false, message: "Slot not found" }, 404);
    }

    if (slot.availableCount < participantCount) {
      return c.json({ success: false, message: "Not enough capacity available" }, 400);
    }

    // Calculate pricing
    const basePrice = slot.basePrice;
    const totalAmount = basePrice * participantCount;

    // Create booking and update slot availability in transaction
    const result = await prisma.$transaction(async (tx) => {
      const bookingOtp = await generateUniqueBookingOtp();

      // Create booking
      const booking = await tx.booking.create({
        data: {
          bookingReference: generateBookingReference(),
          customerId,
          listingSlotId,
          bookingStartDate: slot.batchStartDate!,
          bookingEndDate: slot.batchEndDate!,
          participantCount,
          totalDays: 1, // F1 is typically multi-day but counted as 1 batch
          basePrice,
          totalAmount,
          bookingStatus: "CONFIRMED",
          otp: bookingOtp,
          otpVerification: false,
        },
      });

      // Update slot availability
      await tx.listingSlot.update({
        where: { id: listingSlotId },
        data: {
          availableCount: {
            decrement: participantCount,
          },
        },
      });

      return booking;
    });

    return c.json({ success: true, data: result });
  } catch (error) {
    console.error("Error creating F1 booking:", error);
    return c.json({ success: false, message: "Failed to create booking" }, 500);
  }
};

// Create booking for F2 (Day-wise Rental)
export const createF2Booking = async (c: Context) => {
  try {
    const user = c.get("user");
    
    // Check if user is a customer
    if (user && user.userType !== "customer") {
      return c.json({ 
        success: false, 
        message: "Only customers can create bookings. Please login as a customer." 
      }, 403);
    }
    
    const {
      customerId,
      listingId,
      variantId,
      dateRangeId, // NEW: ID from inventory_date_ranges table
      selectedDates, // Array of date strings ['2026-01-04', '2026-01-05', '2026-01-06']
      contactDetails,
      selectedAddons,
      promoCode,
      discountAmount,
      subtotal,
      addonsTotal,
      taxAmount,
      totalAmount,
      amountPaidNow,
      amountPendingAtVenue,
      paymentMethod,
    } = await c.req.json();

    if (!customerId || !listingId || !dateRangeId || !selectedDates || selectedDates.length === 0) {
      return c.json({ success: false, message: "Missing required fields" }, 400);
    }

    // Sort dates to get start and end
    const sortedDates = [...selectedDates].sort();
    const startDate = new Date(sortedDates[0] + "T00:00:00Z");
    const endDate = new Date(sortedDates[sortedDates.length - 1] + "T00:00:00Z");

    // Get date range details for validation and pricing
    const dateRange = await prisma.inventoryDateRange.findUnique({
      where: { id: dateRangeId },
      include: {
        listing: {
          select: { 
            listingName: true, 
            currency: true, 
            taxRate: true,
            advanceBookingPercentage: true,
            platformCommissionPercentage: true,
            tcsPercentage: true,
            operatorId: true,
          }
        }
      }
    });

    if (!dateRange) {
      return c.json({ success: false, message: "Date range not found" }, 404);
    }

    // Validate that booking dates fall within the date range
    if (startDate < dateRange.availableFromDate || endDate > dateRange.availableToDate) {
      return c.json({ 
        success: false, 
        message: "Selected dates are outside the available date range" 
      }, 400);
    }

    // Check per-date availability by counting existing bookings for each selected date
    if (dateRange.totalCapacity !== null) {
      // Fetch all active bookings for this date range
      const activeBookings = await prisma.booking.findMany({
        where: {
          dateRangeId: dateRangeId,
          bookingStatus: { in: ["CONFIRMED", "COMPLETED"] },
          // Get bookings that might overlap with our selected dates
          bookingStartDate: { lte: endDate },
          bookingEndDate: { gte: startDate },
        },
        select: {
          pricingDetails: true,
          bookingStartDate: true,
          bookingEndDate: true,
        },
      });

      // Build a map of booked dates count per date
      const bookedDatesCount: Record<string, number> = {};
      activeBookings.forEach((booking) => {
        // Try to get selectedDates from pricingDetails
        const pricingDetails = booking.pricingDetails as { selectedDates?: string[] } | null;
        let bookingSelectedDates: string[] = [];
        
        if (pricingDetails?.selectedDates && Array.isArray(pricingDetails.selectedDates)) {
          bookingSelectedDates = pricingDetails.selectedDates;
        } else {
          // Fall back to generating dates from start/end if selectedDates not available
          const bookingStartDate = new Date(booking.bookingStartDate);
          const bookingEndDate = new Date(booking.bookingEndDate);
          const currentDate = new Date(bookingStartDate);
          while (currentDate <= bookingEndDate) {
            bookingSelectedDates.push(currentDate.toISOString().split("T")[0]);
            currentDate.setDate(currentDate.getDate() + 1);
          }
        }
        
        // Count bookings per date
        bookingSelectedDates.forEach((dateStr) => {
          bookedDatesCount[dateStr] = (bookedDatesCount[dateStr] || 0) + 1;
        });
      });

      // Check if all selected dates have available capacity
      const unavailableDates: string[] = [];
      selectedDates.forEach((dateStr: string) => {
        const bookedCount = bookedDatesCount[dateStr] || 0;
        const availableForDate = dateRange.totalCapacity! - bookedCount;
        if (availableForDate < 1) {
          unavailableDates.push(dateStr);
        }
      });

      if (unavailableDates.length > 0) {
        return c.json({ 
          success: false, 
          message: `No availability for selected dates: ${unavailableDates.join(", ")}` 
        }, 400);
      }
    }

    // Calculate payment breakdown using the payment helper
    const totalDays = selectedDates.length;
    
    const convenienceFeeRate = await getConvenienceFeeRateInBasisPoints();

    const paymentInput: PaymentCalculationInput = {
      bookingFormat: "F2",
      totalBasePrice: rupeesToPaise(subtotal), // Total base price (includes overrides)
      quantity: totalDays,
      addonsAmount: rupeesToPaise(addonsTotal || 0),
      discountAmount: rupeesToPaise(discountAmount || 0),
      advancePaymentPercentage: percentageToBasisPoints(dateRange.listing.advanceBookingPercentage, 10000),
      paymentMethod: paymentMethod || "online",
      taxRate: percentageToBasisPoints(dateRange.listing.taxRate, 1800),
      convenienceFeeRate,
      platformCommissionRate: percentageToBasisPoints(dateRange.listing.platformCommissionPercentage),
      tcsRateOfCommission: percentageToBasisPoints(dateRange.listing.tcsPercentage),
    };

    const paymentBreakdown = calculatePaymentBreakdown(paymentInput);

    debugLog("F2 Payment breakdown", paymentBreakdown);

    // Create booking in transaction
    const result = await prisma.$transaction(async (tx) => {
      const bookingOtp = await generateUniqueBookingOtp();

      // Create booking
      const booking = await tx.booking.create({
        data: {
          bookingReference: generateBookingReference(),
          customerId,
          dateRangeId: dateRangeId,
          bookingStartDate: startDate,
          bookingEndDate: endDate,
          participantCount: 1, // For rentals, we use 1 as default
          totalDays: selectedDates.length,
          basePrice: subtotal / selectedDates.length, // Base price per day
          totalAmount: paymentBreakdown.totalAmount / 100, // Store in rupees
          bookingStatus: "CONFIRMED",
          otp: bookingOtp,
          otpVerification: false,
          contactDetails: contactDetails,
          selectedAddons: selectedAddons || [],
          pricingDetails: {
            selectedDates,
            totalBasePrice: paymentBreakdown.totalBasePrice / 100,
            quantity: paymentBreakdown.quantity,
            subtotalWithTax: paymentBreakdown.subtotalWithTax / 100,
            discountAmount: paymentBreakdown.discountAmount / 100,
            taxAmount: paymentBreakdown.taxAmount / 100,
            totalBaseAmount: paymentBreakdown.totalBaseAmount / 100,
            addonsTotal: paymentBreakdown.addonsAmount / 100,
            totalAmount: paymentBreakdown.totalAmount / 100,
            promoCode: promoCode || null,
            amountPaidNow: paymentBreakdown.amountPaidOnline / 100,
            amountPendingAtVenue: paymentBreakdown.amountToCollectOffline / 100,
            convenienceFeeRate: paymentBreakdown.convenienceFeeRate / 100,
            convenienceFeeAmount: paymentBreakdown.convenienceFeeAmount / 100,
            totalPayableOnline: paymentBreakdown.totalPayableOnline / 100,
            paymentMethod: paymentBreakdown.paymentMethod,
          },
        },
      });

      // Create BookingPayment record with CORRECT fields
      const bookingPayment = await tx.bookingPayment.create({
        data: {
          bookingId: booking.id,
          totalBasePrice: paymentBreakdown.totalBasePrice,
          quantity: paymentBreakdown.quantity,
          taxRate: paymentBreakdown.taxRate,
          subtotalWithTax: paymentBreakdown.subtotalWithTax,
          discountAmount: paymentBreakdown.discountAmount,
          taxAmount: paymentBreakdown.taxAmount,
          totalBaseAmount: paymentBreakdown.totalBaseAmount,
          addonsAmount: paymentBreakdown.addonsAmount,
          totalAmount: paymentBreakdown.totalAmount,
          amountPaidOnline: paymentBreakdown.amountPaidOnline,
          amountToCollectOffline: paymentBreakdown.amountToCollectOffline,
          convenienceFeeRate: paymentBreakdown.convenienceFeeRate,
          convenienceFeeAmount: paymentBreakdown.convenienceFeeAmount,
          totalPayableOnline: paymentBreakdown.totalPayableOnline,
          paymentMethod: paymentBreakdown.paymentMethod,
          platformCommissionRate: paymentBreakdown.platformCommissionRate,
          platformCommission: paymentBreakdown.platformCommission,
          tcsRate: paymentBreakdown.tcsRate,
          tcsAmount: paymentBreakdown.tcsAmount,
          netPayToSeller: paymentBreakdown.netPayToSeller,
          balanceToCollect: paymentBreakdown.balanceToCollect,
          totalEarnings: paymentBreakdown.totalEarnings,
          settlementStatus: "PENDING",
        },
      });

      // Note: For F2 bookings, availability is tracked per-date via the selectedDates
      // in pricingDetails of each booking. We don't use the availableCount field
      // on inventoryDateRange for per-date tracking.

      return {
        booking,
        bookingPayment,
        bookingReference: booking.bookingReference,
      };
    });

    return c.json({ 
      success: true, 
      data: result,
      message: "F2 rental booking created successfully."
    });
  } catch (error: any) {
    console.error("Error creating F2 booking:", error);
    return c.json({ 
      success: false, 
      message: error.message || "Failed to create F2 booking" 
    }, 500);
  }
};

// Cancel booking
export const cancelBooking = async (c: Context) => {
  try {
    const bookingId = c.req.param("bookingId");
    const user = c.get("user");
    const body = await c.req.json().catch(() => ({}));
    const reason = String(body?.reason || "").trim();

    if (!bookingId) {
      return c.json({ success: false, message: "Booking ID required" }, 400);
    }

    if (!user) {
      return c.json({ success: false, message: "Authentication required" }, 401);
    }

    if (!reason) {
      return c.json({ success: false, message: "Cancellation reason is required" }, 400);
    }

    // Get booking details
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        customerId: true,
        listingSlotId: true,
        dateRangeId: true,
        bookingStartDate: true,
        participantCount: true,
        bookingStatus: true,
        payment: {
          select: {
            id: true,
            settlementStatus: true,
          },
        },
        listingSlot: {
          select: {
            listing: {
              select: {
                operatorId: true,
                bookingFormat: true,
              },
            },
          },
        },
        dateRange: {
          select: {
            id: true,
            listingId: true,
            variantId: true,
            basePricePerDay: true,
            totalCapacity: true,
            availableCount: true,
            listing: {
              select: {
                operatorId: true,
                bookingFormat: true,
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return c.json({ success: false, message: "Booking not found" }, 404);
    }

    if (booking.bookingStatus === "CANCELLED") {
      return c.json({ success: false, message: "Booking already cancelled" }, 400);
    }

    const operatorId =
      booking.listingSlot?.listing?.operatorId || booking.dateRange?.listing?.operatorId || null;
    const isAdmin = user.userType === "admin" || user.userType === "super_admin";
    const isBookingCustomer = user.userType === "customer" && booking.customerId === user.userId;
    const isBookingOperator = user.userType === "operator" && operatorId === user.userId;

    if (!isAdmin && !isBookingCustomer && !isBookingOperator) {
      return c.json({ success: false, message: "Unauthorized to cancel this booking" }, 403);
    }

    const cancellationReason = buildCancellationReason(
      reason,
      isBookingOperator ? "seller" : "customer",
    );

    // Update booking and restore availability in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update booking status
      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          bookingStatus: "CANCELLED",
          reason: cancellationReason,
          otp: null,
          otpVerification: false,
        },
      });

      if (booking.payment && booking.payment.settlementStatus !== "REFUNDED") {
        await tx.bookingPayment.update({
          where: { bookingId },
          data: {
            settlementStatus: "REFUND_PENDING",
          },
        });
      }

      // Restore slot availability (for F1, F3, F4)
      if (booking.listingSlotId) {
        await tx.listingSlot.update({
          where: { id: booking.listingSlotId },
          data: {
            availableCount: {
              increment: booking.participantCount,
            },
          },
        });
      }

      const bookingFormat =
        booking.listingSlot?.listing?.bookingFormat || booking.dateRange?.listing?.bookingFormat;

      if (booking.dateRangeId && booking.dateRange && bookingFormat !== "F2") {
        const existingSlotChange = await tx.listingSlotChange.findFirst({
          where: {
            inventoryDateRangeId: booking.dateRangeId,
            date: booking.bookingStartDate,
          },
        });

        if (existingSlotChange) {
          await tx.listingSlotChange.update({
            where: { id: existingSlotChange.id },
            data: {
              availableCount: {
                increment: booking.participantCount,
              },
              triggerType: "customer_cancel",
            },
          });
        } else {
          const nextAvailableCount = Math.min(
            booking.dateRange.totalCapacity ?? Number.MAX_SAFE_INTEGER,
            (booking.dateRange.availableCount || 0) + booking.participantCount,
          );

          await tx.listingSlotChange.create({
            data: {
              inventoryDateRangeId: booking.dateRangeId,
              listingId: booking.dateRange.listingId,
              variantId: booking.dateRange.variantId || null,
              date: booking.bookingStartDate,
              price: booking.dateRange.basePricePerDay,
              totalCapacity: booking.dateRange.totalCapacity || 0,
              availableCount:
                booking.dateRange.totalCapacity !== null &&
                booking.dateRange.totalCapacity !== undefined
                  ? nextAvailableCount
                  : (booking.dateRange.availableCount || 0) + booking.participantCount,
              triggerType: "customer_cancel",
            },
          });
        }
      }

      return updatedBooking;
    });

    return c.json({ success: true, data: result, message: "Booking cancelled successfully" });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    return c.json({ success: false, message: "Failed to cancel booking" }, 500);
  }
};

// Verify booking OTP and mark customer as checked in
export const verifyBookingOtp = async (c: Context) => {
  try {
    const bookingId = c.req.param("bookingId");
    const user = c.get("user");
    const body = await c.req.json().catch(() => ({}));
    const otp = String(body?.otp || "").replace(/\D/g, "").trim();

    if (!bookingId) {
      return c.json({ success: false, message: "Booking ID required" }, 400);
    }

    if (!otp || otp.length !== 6) {
      return c.json({ success: false, message: "Valid 6 digit OTP is required" }, 400);
    }

    if (!user) {
      return c.json({ success: false, message: "Authentication required" }, 401);
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bookingReference: true,
        bookingStatus: true,
        otp: true,
        otpVerification: true,
        listingSlot: {
          select: {
            listing: {
              select: {
                operatorId: true,
              },
            },
          },
        },
        dateRange: {
          select: {
            listing: {
              select: {
                operatorId: true,
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return c.json({ success: false, message: "Booking not found" }, 404);
    }

    const operatorId =
      booking.listingSlot?.listing?.operatorId ||
      booking.dateRange?.listing?.operatorId ||
      null;

    if (!operatorId) {
      return c.json({ success: false, message: "Unable to resolve booking operator" }, 400);
    }

    const isAdmin = user.userType === "admin" || user.userType === "super_admin";
    if (!isAdmin && user.userId !== operatorId) {
      return c.json({ success: false, message: "Unauthorized to verify OTP for this booking" }, 403);
    }

    if (booking.bookingStatus === "CANCELLED") {
      return c.json({ success: false, message: "Cannot verify OTP for cancelled booking" }, 400);
    }

    if (booking.otpVerification) {
      return c.json({
        success: true,
        message: "OTP already verified for this booking",
        data: booking,
      });
    }

    const normalizedStoredOtp = String(booking.otp || "").replace(/\D/g, "");

    if (!normalizedStoredOtp && !isMasterOtp(otp)) {
      return c.json({
        success: false,
        message: "No active OTP found for this booking. Please resend OTP and try again.",
      }, 400);
    }

    const isOtpValid = normalizedStoredOtp === otp || isMasterOtp(otp);

    if (!isOtpValid) {
      return c.json({
        success: false,
        message: "Invalid OTP entered",
        debug: process.env.NODE_ENV !== "production" ? { expectedOtp: normalizedStoredOtp || null } : undefined,
      }, 400);
    }

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        otpVerification: true,
        bookingStatus: "COMPLETED",
        otp: null,
      },
    });

    return c.json({
      success: true,
      message: "OTP verified successfully. Customer checked in.",
      data: updatedBooking,
    });
  } catch (error) {
    console.error("Error verifying booking OTP:", error);
    return c.json({ success: false, message: "Failed to verify booking OTP" }, 500);
  }
};

// Resend booking OTP for check-in flow
export const resendBookingOtp = async (c: Context) => {
  try {
    const bookingId = c.req.param("bookingId");
    const user = c.get("user");

    if (!bookingId) {
      return c.json({ success: false, message: "Booking ID required" }, 400);
    }

    if (!user) {
      return c.json({ success: false, message: "Authentication required" }, 401);
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bookingStatus: true,
        otpVerification: true,
        customer: {
          select: {
            phone: true,
          },
        },
        contactDetails: true,
        listingSlot: {
          select: {
            listing: {
              select: {
                operatorId: true,
              },
            },
          },
        },
        dateRange: {
          select: {
            listing: {
              select: {
                operatorId: true,
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return c.json({ success: false, message: "Booking not found" }, 404);
    }

    const operatorId =
      booking.listingSlot?.listing?.operatorId ||
      booking.dateRange?.listing?.operatorId ||
      null;

    if (!operatorId) {
      return c.json({ success: false, message: "Unable to resolve booking operator" }, 400);
    }

    const isAdmin = user.userType === "admin" || user.userType === "super_admin";
    if (!isAdmin && user.userId !== operatorId) {
      return c.json({ success: false, message: "Unauthorized to resend OTP for this booking" }, 403);
    }

    if (booking.bookingStatus === "CANCELLED") {
      return c.json({ success: false, message: "Cannot resend OTP for cancelled booking" }, 400);
    }

    if (booking.otpVerification) {
      return c.json({ success: false, message: "Booking is already checked in" }, 400);
    }

    const newOtp = await generateUniqueBookingOtp(bookingId);

    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        otp: newOtp,
        otpVerification: false,
      },
    });

    const contactDetails =
      booking.contactDetails && typeof booking.contactDetails === "object"
        ? (booking.contactDetails as Record<string, unknown>)
        : null;

    const customerPhone =
      booking.customer?.phone ||
      (typeof contactDetails?.phone === "string" ? contactDetails.phone : null) ||
      (typeof contactDetails?.mobile === "string" ? contactDetails.mobile : null) ||
      (typeof contactDetails?.phoneNumber === "string" ? contactDetails.phoneNumber : null);

    let smsSent = false;
    if (customerPhone) {
      smsSent = await sendOtpSMS(customerPhone, newOtp);
    }

    const exposeOtp = process.env.NODE_ENV !== "production";

    return c.json({
      success: true,
      message: smsSent ? "Booking OTP resent successfully" : "Booking OTP regenerated successfully",
      data: {
        bookingId,
        smsSent,
        otp: exposeOtp ? newOtp : !smsSent ? newOtp : undefined,
      },
    });
  } catch (error) {
    console.error("Error resending booking OTP:", error);
    return c.json({ success: false, message: "Failed to resend booking OTP" }, 500);
  }
};

// Get user's bookings
export const getUserBookings = async (c: Context) => {
  try {
    const customerId = c.req.param("customerId");

    if (!customerId) {
      return c.json({ success: false, message: "Customer ID required" }, 400);
    }

    const bookings = await prisma.booking.findMany({
      where: { customerId },
      include: {
        listingSlot: {
          include: {
            listing: {
              select: {
                id: true,
                listingName: true,
                frontImageUrl: true,
                currency: true,
                startLocationName: true,
                bookingFormat: true,
                operator: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    operatorProfile: {
                      select: {
                        companyName: true,
                      },
                    },
                  },
                },
                category: {
                  select: {
                    categoryName: true,
                  },
                },
                badges: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    badge: {
                      select: {
                        id: true,
                        badgeName: true,
                        badgeIconUrl: true,
                        badgeColor: true,
                      },
                    },
                  },
                  take: 1,
                  orderBy: { badge: { displayOrder: "asc" } },
                },
                tags: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    tag: {
                      select: {
                        id: true,
                        tagName: true,
                        tagColor: true,
                      },
                    },
                  },
                  take: 2,
                  orderBy: { tag: { displayOrder: "asc" } },
                },
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
        dateRange: {
          include: {
            listing: {
              select: {
                id: true,
                listingName: true,
                frontImageUrl: true,
                currency: true,
                startLocationName: true,
                bookingFormat: true,
                operator: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    operatorProfile: {
                      select: {
                        companyName: true,
                      },
                    },
                  },
                },
                category: {
                  select: {
                    categoryName: true,
                  },
                },
                badges: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    badge: {
                      select: {
                        id: true,
                        badgeName: true,
                        badgeIconUrl: true,
                        badgeColor: true,
                      },
                    },
                  },
                  take: 1,
                  orderBy: { badge: { displayOrder: "asc" } },
                },
                tags: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    tag: {
                      select: {
                        id: true,
                        tagName: true,
                        tagColor: true,
                      },
                    },
                  },
                  take: 2,
                  orderBy: { tag: { displayOrder: "asc" } },
                },
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
        review: true,
        payment: true,
        reschedules: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            createdAt: true,
            approvedAt: true,
            isPaymentRequired: true,
            rescheduleFeeAmount: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedBookings = bookings.map((booking: any) => ({
      ...booking,
      listingSlot: booking.listingSlot
        ? {
            ...booking.listingSlot,
            startTime:
              booking.listingSlot.slotDefinition?.startTime ||
              booking.listingSlot.startTime,
            endTime:
              booking.listingSlot.slotDefinition?.endTime ||
              booking.listingSlot.endTime,
          }
        : null,
      dateRange: booking.dateRange
        ? {
            ...booking.dateRange,
            startTime: booking.dateRange.slotDefinition?.startTime || null,
            endTime: booking.dateRange.slotDefinition?.endTime || null,
          }
        : null,
    }));

    return c.json({ success: true, data: formattedBookings });
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    return c.json({ success: false, message: "Failed to fetch bookings" }, 500);
  }
};

// Get booking with reschedule history
export const getBookingWithReschedules = async (c: Context) => {
  try {
    const bookingId = c.req.param("bookingId");

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        listingSlot: {
          include: {
            listing: {
              select: {
                id: true,
                listingName: true,
                frontImageUrl: true,
                currency: true,
                startLocationName: true,
                endLocationName: true,
                startGoogleMapsUrl: true,
                operatorId: true,
                bookingFormat: true,
                addons: true, // Include addons to enrich selectedAddons
                category: {
                  select: {
                    categoryName: true,
                  },
                },
                badges: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    badge: {
                      select: {
                        id: true,
                        badgeName: true,
                        badgeIconUrl: true,
                        badgeColor: true,
                      },
                    },
                  },
                  take: 1,
                  orderBy: { badge: { displayOrder: "asc" } },
                },
                tags: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    tag: {
                      select: {
                        id: true,
                        tagName: true,
                        tagColor: true,
                      },
                    },
                  },
                  take: 2,
                  orderBy: { tag: { displayOrder: "asc" } },
                },
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
        dateRange: {
          include: {
            listing: {
              select: {
                id: true,
                listingName: true,
                frontImageUrl: true,
                currency: true,
                startLocationName: true,
                endLocationName: true,
                startGoogleMapsUrl: true,
                operatorId: true,
                bookingFormat: true,
                addons: true, // Include addons to enrich selectedAddons
                category: {
                  select: {
                    categoryName: true,
                  },
                },
                badges: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    badge: {
                      select: {
                        id: true,
                        badgeName: true,
                        badgeIconUrl: true,
                        badgeColor: true,
                      },
                    },
                  },
                  take: 1,
                  orderBy: { badge: { displayOrder: "asc" } },
                },
                tags: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    tag: {
                      select: {
                        id: true,
                        tagName: true,
                        tagColor: true,
                      },
                    },
                  },
                  take: 2,
                  orderBy: { tag: { displayOrder: "asc" } },
                },
              },
            },
            slotDefinition: {
              select: {
                startTime:  true,
                endTime: true,
              },
            },
          },
        },
        payment: true,
        review: true,
        reschedules: {
          orderBy: { createdAt: "desc" },
          include: {
            initiatedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            approvedByAdmin: {
              select: {
                id: true,
                firstName: true,
                lastName:  true,
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return c.json({ success: false, message: "Booking not found" }, 404);
    }

    // Enrich selectedAddons with full addon details
    let enrichedAddons: any[] = [];
    if (booking.selectedAddons && Array.isArray(booking.selectedAddons)) {
      // Get addons JSON from the listing
      const listingAddonsRecord = booking.listingSlot?.listing?.addons || booking.dateRange?.listing?.addons;
      const listingAddons = listingAddonsRecord ? (listingAddonsRecord as any).addons : [];
      
      enrichedAddons = booking.selectedAddons.map((selectedAddon: any) => {
        const addonDetails = Array.isArray(listingAddons) 
          ? listingAddons.find((addon: any) => addon.id === selectedAddon.addonId)
          : null;
          
        if (addonDetails) {
          return {
            id: addonDetails.id,
            addonId: selectedAddon.addonId,
            name: addonDetails.addonName,
            description: addonDetails.addonDescription || "",
            price: addonDetails.price, // Use 'price' not 'addonPrice'
            quantity: selectedAddon.quantity || 1,
            totalPrice: (addonDetails.price || 0) * (selectedAddon.quantity || 1),
          };
        }
        // If addon details not found, return minimal info
        return {
          addonId: selectedAddon.addonId,
          name: "Unknown Add-on",
          description: "",
          quantity: selectedAddon.quantity || 1,
          price: 0,
          totalPrice: 0,
        };
      });
    }

    // Add startTime and endTime from slotDefinition to listingSlot for easier access
    const formattedBooking = {
      ...booking,
      selectedAddons: enrichedAddons, // Replace with enriched data
      listingSlot: booking.listingSlot ?  {
        ...booking.listingSlot,
        startTime:  booking.listingSlot.slotDefinition?.startTime || booking.listingSlot.startTime,
        endTime: booking.listingSlot.slotDefinition?.endTime || booking.listingSlot.endTime,
      } : null,
    };

    return c.json({ success: true, data: formattedBooking });
  } catch (error) {
    console.error("Error fetching booking with reschedules:", error);
    return c.json(
      { success: false, message: "Failed to fetch booking" },
      500
    );
  }
};

/**
 * Get all bookings (Admin only)
 * GET /api/bookings/admin/all
 */
export const getAdminBookings = async (c: Context) => {
  try {
    const user = c.get("user");

    // Only admin can view all bookings
    if (user.userType !== "admin" && user.userType !== "super_admin") {
      return c.json(
        { success: false, message: "Admin access required" },
        403
      );
    }

    const parsePositiveInteger = (value: string | undefined, fallback: number, max?: number) => {
      const parsed = Number.parseInt(value || "", 10);

      if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
      }

      return typeof max === "number" ? Math.min(parsed, max) : parsed;
    };

    const normalizeSettlementStatus = (value: string | undefined) => {
      if (!value || value.toLowerCase() === "all") {
        return undefined;
      }

      return value.trim().toUpperCase().replace(/\s+/g, "_");
    };

    const page = parsePositiveInteger(c.req.query("page"), 1);
    const limit = parsePositiveInteger(c.req.query("limit"), 10, 50);
    const search = (c.req.query("search") || "").trim();
    const category = (c.req.query("category") || "").trim();
    const activityStatus = (c.req.query("status") || c.req.query("bookingStatus") || "").trim();
    const paymentStatus = normalizeSettlementStatus(c.req.query("paymentStatus"));
    const startDate = (c.req.query("startDate") || "").trim();
    const endDate = (c.req.query("endDate") || "").trim();
    const skip = (page - 1) * limit;

    const normalizedStartDate = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const normalizedEndDate = endDate ? new Date(`${endDate}T23:59:59`) : null;

    const whereClause: any = {};

    const normalizedActivityStatus = activityStatus.toUpperCase();
    const shouldPostFilterConfirmedActivity =
      normalizedActivityStatus === "CONFIRMED" ||
      normalizedActivityStatus === ADMIN_RESCHEDULE_ACTIVITY_STATUS.PENDING ||
      normalizedActivityStatus === ADMIN_RESCHEDULE_ACTIVITY_STATUS.APPROVED ||
      normalizedActivityStatus === ADMIN_RESCHEDULE_ACTIVITY_STATUS.IN_PROGRESS ||
      normalizedActivityStatus === ADMIN_RESCHEDULE_ACTIVITY_STATUS.REJECTED;

    if (normalizedActivityStatus && normalizedActivityStatus !== "ALL") {
      if (shouldPostFilterConfirmedActivity) {
        whereClause.bookingStatus = "CONFIRMED";
      } else if (normalizedActivityStatus === "CANCELLED") {
        whereClause.bookingStatus = {
          in: ["CANCELLED", "NO_SHOW"],
        };
      } else {
        whereClause.bookingStatus = normalizedActivityStatus;
      }
    }

    if (paymentStatus) {
      whereClause.payment = {
        is: {
          settlementStatus: paymentStatus as any,
        },
      };
    }

    if (normalizedStartDate || normalizedEndDate) {
      whereClause.AND = [
        ...(whereClause.AND || []),
        {
          ...(normalizedStartDate ? { bookingEndDate: { gte: normalizedStartDate } } : {}),
          ...(normalizedEndDate ? { bookingStartDate: { lte: normalizedEndDate } } : {}),
        },
      ];
    }

    if (category) {
      whereClause.AND = [
        ...(whereClause.AND || []),
        {
          OR: [
            {
              listingSlot: {
                listing: {
                  category: {
                    categoryName: category,
                  },
                },
              },
            },
            {
              dateRange: {
                listing: {
                  category: {
                    categoryName: category,
                  },
                },
              },
            },
          ],
        },
      ];
    }

    if (search) {
      whereClause.AND = [
        ...(whereClause.AND || []),
        {
          OR: [
            {
              bookingReference: {
                contains: search,
                mode: "insensitive",
              },
            },
            {
              customer: {
                firstName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
            {
              customer: {
                lastName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
            {
              customer: {
                email: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            },
            {
              customer: {
                phone: {
                  contains: search,
                },
              },
            },
            {
              listingSlot: {
                listing: {
                  listingName: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              },
            },
            {
              dateRange: {
                listing: {
                  listingName: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              },
            },
            {
              listingSlot: {
                listing: {
                  operator: {
                    firstName: {
                      contains: search,
                      mode: "insensitive",
                    },
                  },
                },
              },
            },
            {
              listingSlot: {
                listing: {
                  operator: {
                    lastName: {
                      contains: search,
                      mode: "insensitive",
                    },
                  },
                },
              },
            },
            {
              listingSlot: {
                listing: {
                  operator: {
                    operatorProfile: {
                      companyName: {
                        contains: search,
                        mode: "insensitive",
                      },
                    },
                  },
                },
              },
            },
            {
              dateRange: {
                listing: {
                  operator: {
                    firstName: {
                      contains: search,
                      mode: "insensitive",
                    },
                  },
                },
              },
            },
            {
              dateRange: {
                listing: {
                  operator: {
                    lastName: {
                      contains: search,
                      mode: "insensitive",
                    },
                  },
                },
              },
            },
            {
              dateRange: {
                listing: {
                  operator: {
                    operatorProfile: {
                      companyName: {
                        contains: search,
                        mode: "insensitive",
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      ];
    }

    const listingSelect = {
      id: true,
      listingName: true,
      frontImageUrl: true,
      currency: true,
      startLocationName: true,
      operatorId: true,
      category: {
        select: {
          categoryName: true,
        },
      },
      operator: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          operatorProfile: {
            select: {
              companyName: true,
            },
          },
        },
      },
    };

    const bookingSelect = {
      id: true,
      bookingReference: true,
      bookingStartDate: true,
      bookingEndDate: true,
      participantCount: true,
      totalAmount: true,
      bookingStatus: true,
      rescheduleCount: true,
      lastRescheduledAt: true,
      createdAt: true,
      updatedAt: true,
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      payment: {
        select: {
          settlementStatus: true,
        },
      },
      reschedules: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        select: {
          id: true,
          status: true,
          isPaymentRequired: true,
          createdAt: true,
          approvedAt: true,
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
            select: listingSelect,
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
            select: listingSelect,
          },
        },
      },
    } as const;

    const [bookings, bookingCounts, paymentCounts, rescheduleCounts, rescheduleInProgressCandidates, categories] = await Promise.all([
      prisma.booking.findMany({
        where: whereClause,
        select: bookingSelect,
        orderBy: {
          createdAt: "desc",
        },
        ...(shouldPostFilterConfirmedActivity ? {} : { skip, take: limit }),
      }),
      prisma.booking.groupBy({
        by: ["bookingStatus"],
        _count: {
          _all: true,
        },
      }),
      prisma.bookingPayment.groupBy({
        by: ["settlementStatus"],
        _count: {
          _all: true,
        },
      }),
      prisma.reschedule.groupBy({
        by: ["status"],
        _count: {
          _all: true,
        },
      }),
      prisma.reschedule.findMany({
        where: {
          status: "approved_with_charge",
          isPaymentRequired: true,
        },
        select: {
          createdAt: true,
          approvedAt: true,
          booking: {
            select: {
              lastRescheduledAt: true,
            },
          },
        },
      }),
      prisma.listing.findMany({
        where: {
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

    const bookingCountMap = Object.fromEntries(
      bookingCounts.map((entry) => [entry.bookingStatus, entry._count._all])
    ) as Record<string, number>;
    const paymentCountMap = Object.fromEntries(
      paymentCounts.map((entry) => [entry.settlementStatus, entry._count._all])
    ) as Record<string, number>;
    const rescheduleCountMap = Object.fromEntries(
      rescheduleCounts.map((entry) => [entry.status, entry._count._all])
    ) as Record<string, number>;
    const rescheduleInProgressCount = rescheduleInProgressCandidates.filter((reschedule) => {
      const processedAt = reschedule.booking?.lastRescheduledAt
        ? new Date(reschedule.booking.lastRescheduledAt).getTime()
        : NaN;
      const latestChangeAt = new Date(reschedule.approvedAt || reschedule.createdAt).getTime();

      return !(
        Number.isFinite(processedAt) &&
        (!Number.isFinite(latestChangeAt) || processedAt >= latestChangeAt)
      );
    }).length;

    const mappedBookings = bookings.map((booking) => {
      const listing = booking.listingSlot?.listing || booking.dateRange?.listing;
      const operator = listing?.operator;
      const latestReschedule = booking.reschedules[0] || null;
      const adminActivityStatus = getAdminActivityStatus(
        booking.bookingStatus,
        latestReschedule?.status,
        latestReschedule?.isPaymentRequired,
        latestReschedule?.approvedAt || latestReschedule?.createdAt,
        booking.lastRescheduledAt,
      );
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
        bookingStartDate: booking.bookingStartDate,
        bookingEndDate: booking.bookingEndDate,
        participantCount: booking.participantCount,
        totalAmount: Number(booking.totalAmount),
        bookingStatus: booking.bookingStatus,
        adminActivityStatus,
        rescheduleCount: booking.rescheduleCount,
        lastRescheduledAt: booking.lastRescheduledAt,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        slotStart,
        slotEnd,
        customer: booking.customer,
        activity: {
          id: listing?.id || null,
          name: listing?.listingName || "Unknown Listing",
          imageUrl: listing?.frontImageUrl || null,
          location: listing?.startLocationName || "-",
          category: listing?.category?.categoryName || null,
          currency: listing?.currency || "INR",
        },
        operator: {
          id: operator?.id || null,
          companyName:
            operator?.operatorProfile?.companyName ||
            `${operator?.firstName || ""} ${operator?.lastName || ""}`.trim() ||
            "Unknown Operator",
          phone: operator?.phone || "",
          email: operator?.email || "",
        },
        payment: {
          settlementStatus: booking.payment?.settlementStatus || "PENDING",
        },
        latestReschedule: latestReschedule
          ? {
              id: latestReschedule.id,
              status: latestReschedule.status,
              isPaymentRequired: latestReschedule.isPaymentRequired,
              createdAt: latestReschedule.createdAt,
              approvedAt: latestReschedule.approvedAt,
            }
          : null,
      };
    });

    const filteredBookings =
      normalizedActivityStatus && normalizedActivityStatus !== "ALL"
        ? mappedBookings.filter((booking) => booking.adminActivityStatus === normalizedActivityStatus)
        : mappedBookings;

    const totalCount = shouldPostFilterConfirmedActivity
      ? filteredBookings.length
      : await prisma.booking.count({
          where: whereClause,
        });

    const data = shouldPostFilterConfirmedActivity
      ? filteredBookings.slice(skip, skip + limit)
      : filteredBookings;

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    return c.json({
      success: true,
      data,
      count: totalCount,
      page,
      totalPages,
      summary: {
        totalBookings:
          (bookingCountMap.CONFIRMED || 0) +
          (bookingCountMap.COMPLETED || 0) +
          (bookingCountMap.CANCELLED || 0) +
          (bookingCountMap.NO_SHOW || 0),
        cancellationAndRefunds: paymentCountMap.REFUND_PENDING || 0,
        reschedulePending: rescheduleCountMap.pending || 0,
        rescheduleRequests:
          (rescheduleCountMap.pending || 0) +
          (rescheduleCountMap.approved || 0) +
          (rescheduleCountMap.approved_with_charge || 0) +
          (rescheduleCountMap.rejected || 0),
        rescheduleInProgress: rescheduleInProgressCount,
        unsettled: paymentCountMap.PENDING || 0,
        settlementIssues: paymentCountMap.SETTLEMENT_ISSUE || 0,
      },
      filters: {
        categories: categories
          .map((entry) => entry.category?.categoryName)
          .filter((value): value is string => Boolean(value)),
        bookingStatuses: [
          "CONFIRMED",
          "COMPLETED",
          "CANCELLED",
          "NO_SHOW",
          ADMIN_RESCHEDULE_ACTIVITY_STATUS.PENDING,
          ADMIN_RESCHEDULE_ACTIVITY_STATUS.APPROVED,
          ADMIN_RESCHEDULE_ACTIVITY_STATUS.IN_PROGRESS,
          ADMIN_RESCHEDULE_ACTIVITY_STATUS.REJECTED,
        ],
        paymentStatuses: [
          "PAID",
          "PENDING",
          "REFUND_PENDING",
          "REFUNDED",
          "SETTLEMENT_ISSUE",
          "ISSUE_RESOLVED",
        ],
      },
    });
  } catch (error) {
    console.error("Error fetching admin bookings:", error);
    return c.json(
      { success: false, message: "Failed to fetch bookings" },
      500
    );
  }
};

/**
 * Get single booking by ID (Admin only)
 * GET /api/bookings/admin/:bookingId
 */
export const getAdminBookingById = async (c: Context) => {
  try {
    const user = c.get("user");
    const bookingId = c.req.param("bookingId");

    // Only admin can view all bookings
    if (user.userType !== "admin" && user.userType !== "super_admin") {
      return c.json(
        { success: false, message: "Admin access required" },
        403
      );
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        listingSlot: {
          include: {
            listing: {
              select: {
                id: true,
                listingName: true,
                frontImageUrl: true,
                currency: true,
                startLocationName: true,
                operatorId: true,
                bookingFormat: true,
                taxRate: true,
                addons: true,
                category: {
                  select: { categoryName: true },
                },
                operator: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                    operatorProfile: {
                      select: {
                        companyName: true,
                      },
                    },
                  },
                },
                badges: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    badge: {
                      select: { id: true, badgeName: true, badgeIconUrl: true, badgeColor: true },
                    },
                  },
                  take: 1,
                  orderBy: { badge: { displayOrder: "asc" } },
                },
                tags: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    tag: {
                      select: { id: true, tagName: true, tagColor: true },
                    },
                  },
                  take: 2,
                  orderBy: { tag: { displayOrder: "asc" } },
                },
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
        dateRange: {
          include: {
            listing: {
              select: {
                id: true,
                listingName: true,
                frontImageUrl: true,
                currency: true,
                startLocationName: true,
                operatorId: true,
                bookingFormat: true,
                taxRate: true,
                addons: true,
                category: {
                  select: { categoryName: true },
                },
                operator: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                    operatorProfile: {
                      select: {
                        companyName: true,
                      },
                    },
                  },
                },
                badges: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    badge: {
                      select: { id: true, badgeName: true, badgeIconUrl: true, badgeColor: true },
                    },
                  },
                  take: 1,
                  orderBy: { badge: { displayOrder: "asc" } },
                },
                tags: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    tag: {
                      select: { id: true, tagName: true, tagColor: true },
                    },
                  },
                  take: 2,
                  orderBy: { tag: { displayOrder: "asc" } },
                },
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
        payment: true,
        reschedules: {
          orderBy: { createdAt: "desc" },
          include: {
            initiatedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            approvedByAdmin: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return c.json({ success: false, message: "Booking not found" }, 404);
    }

    let enrichedAddons: any[] = [];
    if (booking.selectedAddons && Array.isArray(booking.selectedAddons)) {
      const listingAddonsRecord =
        booking.listingSlot?.listing?.addons || booking.dateRange?.listing?.addons;
      const listingAddons = listingAddonsRecord ? (listingAddonsRecord as any).addons : [];

      enrichedAddons = booking.selectedAddons.map((selectedAddon: any) => {
        const addonDetails = Array.isArray(listingAddons)
          ? listingAddons.find((addon: any) => addon.id === selectedAddon.addonId)
          : null;

        if (addonDetails) {
          return {
            id: addonDetails.id,
            addonId: selectedAddon.addonId,
            name: addonDetails.addonName,
            description: addonDetails.addonDescription || "",
            price: addonDetails.price || 0,
            quantity: selectedAddon.quantity || 1,
            totalPrice: (addonDetails.price || 0) * (selectedAddon.quantity || 1),
          };
        }

        return {
          addonId: selectedAddon.addonId,
          name: selectedAddon.name || "Unknown Add-on",
          description: selectedAddon.description || "",
          quantity: selectedAddon.quantity || 1,
          price: selectedAddon.price || 0,
          totalPrice:
            selectedAddon.totalPrice ||
            (selectedAddon.price || 0) * (selectedAddon.quantity || 1),
        };
      });
    }

    // Add startTime and endTime from slotDefinition for easier access
    const formattedBooking = {
      ...booking,
      selectedAddons: enrichedAddons,
      listingSlot: booking.listingSlot
        ? {
            ...booking.listingSlot,
            startTime:
              booking.listingSlot.slotDefinition?.startTime ||
              booking.listingSlot.startTime,
            endTime:
              booking.listingSlot.slotDefinition?.endTime ||
              booking.listingSlot.endTime,
          }
        : null,
      dateRange: booking.dateRange
        ? {
            ...booking.dateRange,
            startTime: booking.dateRange.slotDefinition?.startTime || null,
            endTime: booking.dateRange.slotDefinition?.endTime || null,
          }
        : null,
    };

    return c.json({ success: true, data: formattedBooking });
  } catch (error) {
    console.error("Error fetching admin booking by ID:", error);
    return c.json(
      { success: false, message: "Failed to fetch booking" },
      500
    );
  }
};

/**
 * Update booking settlement state (Admin only)
 * PUT /api/bookings/admin/:bookingId/settlement
 */
export const updateAdminBookingSettlement = async (c: Context) => {
  try {
    const user = c.get("user");
    const bookingId = c.req.param("bookingId");
    const body = await c.req.json().catch(() => ({}));

    if (user.userType !== "admin" && user.userType !== "super_admin") {
      return c.json({ success: false, message: "Admin access required" }, 403);
    }

    if (!bookingId) {
      return c.json({ success: false, message: "Booking ID is required" }, 400);
    }

    const action = String(body?.action || "").trim().toLowerCase();
    const settlementMode = String(body?.settlementMode || "").trim();
    const settlementDateRaw = String(body?.settlementDate || "").trim();
    const settlementStatusRaw = String(body?.settlementStatus || "").trim().toUpperCase();
    const resolutionNote = String(body?.resolutionNote || "").trim();

    if (
      action !== "settle" &&
      action !== "unsettle" &&
      action !== "resolve_issue" &&
      action !== "mark_refunded" &&
      action !== "save_refund_note"
    ) {
      return c.json({ success: false, message: "Invalid settlement action" }, 400);
    }

    const existingBooking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bookingStatus: true,
        payment: {
          select: {
            id: true,
            settlementStatus: true,
            settlementDate: true,
            settlementmode: true,
          },
        },
      },
    });

    if (!existingBooking) {
      return c.json({ success: false, message: "Booking not found" }, 404);
    }

    if (!existingBooking.payment) {
      return c.json({ success: false, message: "Payment record not found for this booking" }, 404);
    }

    const isSettlementIssueFlow = existingBooking.payment.settlementStatus === "SETTLEMENT_ISSUE";
    const isCancellationRefundFlow =
      existingBooking.bookingStatus === "CANCELLED" && !isSettlementIssueFlow;

    let nextSettlementDate: Date | null = null;

    if (action === "settle") {
      if (!settlementMode) {
        return c.json({ success: false, message: "Settlement mode is required" }, 400);
      }

      if (!settlementDateRaw) {
        return c.json({ success: false, message: "Settlement date is required" }, 400);
      }

      nextSettlementDate = new Date(`${settlementDateRaw}T00:00:00`);

      if (Number.isNaN(nextSettlementDate.getTime())) {
        return c.json({ success: false, message: "Invalid settlement date" }, 400);
      }
    }

    if (action === "resolve_issue") {
      if (!resolutionNote) {
        return c.json({ success: false, message: "Resolution note is required" }, 400);
      }

      if (isSettlementIssueFlow) {
        // Settlement issue resolution should work even if the booking itself is cancelled.
      } else if (isCancellationRefundFlow) {
        if (settlementStatusRaw !== "REFUND_PENDING" && settlementStatusRaw !== "REFUNDED") {
          return c.json(
            {
              success: false,
              message: "Refund status must be REFUND_PENDING or REFUNDED",
            },
            400,
          );
        }
      } else {
        if (existingBooking.payment.settlementStatus !== "SETTLEMENT_ISSUE") {
          return c.json({ success: false, message: "Only settlement issues can be resolved" }, 400);
        }
      }
    }

    if (action === "mark_refunded") {
      if (existingBooking.payment.settlementStatus !== "REFUND_PENDING") {
        return c.json({ success: false, message: "Only refund pending payments can be marked as refunded" }, 400);
      }

      if (settlementStatusRaw !== "REFUNDED") {
        return c.json({ success: false, message: "Settlement status must be REFUNDED" }, 400);
      }

      if (!resolutionNote) {
        return c.json({ success: false, message: "Resolution note is required" }, 400);
      }
    }

    if (action === "save_refund_note") {
      if (existingBooking.bookingStatus !== "CANCELLED") {
        return c.json({ success: false, message: "Refund notes can only be saved for cancelled bookings" }, 400);
      }

      if (!resolutionNote) {
        return c.json({ success: false, message: "Resolution note is required" }, 400);
      }
    }

    if (action === "mark_refunded") {
      if (existingBooking.payment.settlementStatus !== "REFUND_PENDING") {
        return c.json({ success: false, message: "Only refund pending payments can be marked as refunded" }, 400);
      }

      if (settlementStatusRaw !== "REFUNDED") {
        return c.json({ success: false, message: "Settlement status must be REFUNDED" }, 400);
      }

      if (!resolutionNote) {
        return c.json({ success: false, message: "Resolution note is required" }, 400);
      }
    }

    const updatedPayment = await prisma.bookingPayment.update({
      where: { bookingId },
      select: {
        id: true,
        bookingId: true,
        settlementStatus: true,
        settlementDate: true,
        settlementmode: true,
        updatedAt: true,
      },
      data:
        action === "settle"
          ? {
              settlementStatus: "PAID",
              settlementDate: nextSettlementDate,
              settlementmode: settlementMode,
            }
          : action === "resolve_issue"
            ? {
                settlementStatus:
                  isCancellationRefundFlow
                    ? (settlementStatusRaw as "REFUND_PENDING" | "REFUNDED")
                    : "ISSUE_RESOLVED",
                reasonbyadmin: resolutionNote,
              }
          : action === "mark_refunded"
            ? {
                settlementStatus: "REFUNDED",
                settlementDate: new Date(),
                reasonbyadmin: resolutionNote,
              }
          : action === "save_refund_note"
            ? {
                reasonbyadmin: resolutionNote,
              }
          : {
              settlementStatus: "PENDING",
              settlementDate: null,
              settlementmode: null,
            },
    });

    return c.json({
      success: true,
      message:
        action === "settle"
          ? "Payment settled successfully"
          : action === "resolve_issue"
            ? isCancellationRefundFlow
              ? "Refund status updated successfully"
              : "Settlement issue resolved successfully"
            : action === "mark_refunded"
              ? "Payment marked as refunded successfully"
            : action === "save_refund_note"
              ? "Refund note saved successfully"
            : "Payment unsettled successfully",
      data: {
        id: updatedPayment.id,
        bookingId: updatedPayment.bookingId,
        settlementStatus: updatedPayment.settlementStatus,
        settlementDate: updatedPayment.settlementDate,
        settlementMode: updatedPayment.settlementmode,
        updatedAt: updatedPayment.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating admin booking settlement:", error);
    return c.json({ success: false, message: "Failed to update settlement status" }, 500);
  }
};

/**
 * Get operator/seller bookings
 * GET /api/bookings/operator/:operatorId
 */
export const getOperatorBookings = async (c: Context) => {
  try {
    const user = c.get("user");
    const operatorId = c.req.param("operatorId");

    if (!operatorId) {
      return c.json({ success: false, message: "Operator ID required" }, 400);
    }

    // Check if user is authorized to view these bookings
    // Must be the operator themselves or an admin
    if (
      user.userId !== operatorId &&
      user.userType !== "admin" &&
      user.userType !== "super_admin"
    ) {
      return c.json(
        { success: false, message: "Unauthorized to view these bookings" },
        403
      );
    }

    // Get all bookings for listings owned by this operator
    const bookings = await prisma.booking.findMany({
      where: {
        OR: [
          {
            listingSlot: {
              listing: {
                operatorId: operatorId,
              },
            },
          },
          {
            dateRange: {
              listing: {
                operatorId: operatorId,
              },
            },
          },
        ],
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            profileImg: true,
          },
        },
        listingSlot: {
          include: {
            listing: {
              select: {
                id: true,
                listingName: true,
                frontImageUrl: true,
                currency: true,
                startLocationName: true,
                bookingFormat: true,
                category: {
                  select: { categoryName: true },
                },
                badges: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    badge: {
                      select: { id: true, badgeName: true, badgeIconUrl: true, badgeColor: true },
                    },
                  },
                  take: 1,
                  orderBy: { badge: { displayOrder: "asc" } },
                },
                tags: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    tag: {
                      select: { id: true, tagName: true, tagColor: true },
                    },
                  },
                  take: 2,
                  orderBy: { tag: { displayOrder: "asc" } },
                },
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
        dateRange: {
          include: {
            listing: {
              select: {
                id: true,
                listingName: true,
                frontImageUrl: true,
                currency: true,
                startLocationName: true,
                bookingFormat: true,
                category: {
                  select: { categoryName: true },
                },
                badges: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    badge: {
                      select: { id: true, badgeName: true, badgeIconUrl: true, badgeColor: true },
                    },
                  },
                  take: 1,
                  orderBy: { badge: { displayOrder: "asc" } },
                },
                tags: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    isActive: true,
                    tag: {
                      select: { id: true, tagName: true, tagColor: true },
                    },
                  },
                  take: 2,
                  orderBy: { tag: { displayOrder: "asc" } },
                },
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
        reschedules: {
          orderBy: { createdAt: "desc" },
          take: 5, // Limit to last 5 reschedules
        },
        payment: true, // Include payment details
      },
      orderBy: { createdAt: "desc" },
    });

    // Format bookings with aggregated data
    const formattedBookings = bookings.map((booking: any) => ({
      ...booking,
      listingSlot: booking.listingSlot
        ? {
            ...booking.listingSlot,
            startTime:
              booking.listingSlot.slotDefinition?.startTime ||
              booking.listingSlot.startTime,
            endTime:
              booking.listingSlot.slotDefinition?.endTime ||
              booking.listingSlot.endTime,
          }
        : null,
      dateRange: booking.dateRange
        ? {
            ...booking.dateRange,
            startTime:
              booking.dateRange.slotDefinition?.startTime || null,
            endTime:
              booking.dateRange.slotDefinition?.endTime || null,
          }
        : null,
    }));

    return c.json({ success: true, data: formattedBookings });
  } catch (error) {
    console.error("Error fetching operator bookings:", error);
    if (error instanceof Error) {
      console.error("Stack trace:", error.stack);
    }
    return c.json(
      {
        success: false,
        message: "Failed to fetch bookings",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      500
    );
  }
};
