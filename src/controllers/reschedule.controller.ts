import type { Context } from "hono";
import { prisma } from "../db.js";

// Helper:  Determine booking format from booking data
const determineBookingFormat = (booking:  any): string => {
  if (booking.listingSlotId) {
    if (booking.listingSlot?.batchStartDate && booking.listingSlot?.batchEndDate) {
      const startDate = new Date(booking.listingSlot.batchStartDate);
      const endDate = new Date(booking.listingSlot.batchEndDate);
      if (startDate.getTime() !== endDate.getTime()) {
        return "F1";
      }
    }
    if (booking.listingSlot?.slotDate) {
      return "F3";
    }
    return "F1";
  } else if (booking.dateRangeId) {
    if (booking.dateRange?.slotDefinitionId) {
      return "F4";
    }
    return "F2";
  }
  throw new Error("Unable to determine booking format");
};

// Helper:  Determine booking format from reschedule data
const determineFormatFromReschedule = (reschedule: any): string => {
  if (reschedule.oldBatchId || reschedule.newBatchId) return "F1";
  if (reschedule.oldRentalStartDate || reschedule.newRentalStartDate) return "F2";
  if (reschedule.oldSlotId || reschedule.newSlotId) return "F3";
  if (reschedule.oldDateRangeId || reschedule.newDateRangeId) return "F4";
  return determineBookingFormat(reschedule.booking);
};

/**
 * Check if booking can be rescheduled
 */
const canBookingBeRescheduled = (booking: any): { allowed: boolean; reason?:  string } => {
  // Check if booking is in valid status
  if (booking.bookingStatus === "CANCELLED") {
    return { allowed: false, reason: "Cannot reschedule cancelled booking" };
  }

  if (booking.bookingStatus === "COMPLETED") {
    return { allowed: false, reason: "Cannot reschedule completed booking" };
  }

  if (booking.bookingStatus === "NO_SHOW") {
    return { allowed: false, reason: "Cannot reschedule no-show booking" };
  }

  // Check reschedule limit
  const maxReschedules = booking.maxReschedules ?? 1;
  const rescheduleCount = booking.rescheduleCount ?? 0;

  if (rescheduleCount >= maxReschedules) {
    return { 
      allowed: false, 
      reason: `Maximum reschedule limit (${maxReschedules}) reached. Please contact support for assistance.` 
    };
  }

  // Check if booking date hasn't passed
  const bookingStartDate = new Date(booking.bookingStartDate);
  const now = new Date();
  const hoursUntilStart = (bookingStartDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilStart < 24) {
    return { 
      allowed: false, 
      reason: "Cannot reschedule within 24 hours of the booking start date" 
    };
  }

  return { allowed: true };
};

/**
 * Initiate reschedule request (Customer or Operator)
 * POST /api/reschedules/initiate
 */
export const initiateReschedule = async (c: Context) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");

    console.log("=== RESCHEDULE REQUEST DEBUG ===");
    console.log("Body:", JSON.stringify(body, null, 2));

    const {
      bookingId,
      rescheduleReason,
      newBatchId,
      newRentalStartDate,
      newRentalEndDate,
      newSlotId,
      newDateRangeId,
    } = body;

    // Validate required fields
    if (!bookingId || !rescheduleReason) {
      return c.json(
        {
          success: false,
          message: "Missing required fields:  bookingId, rescheduleReason",
        },
        400
      );
    }

    // Validate reason is not empty
    if (rescheduleReason.trim().length < 10) {
      return c.json(
        {
          success:  false,
          message: "Please provide a more detailed reason for rescheduling (at least 10 characters)",
        },
        400
      );
    }

    // Get booking details
    const booking = await prisma.booking.findUnique({
      where: { id:  bookingId },
      include:  {
        listingSlot: {
          include: {
            listing: {
              select: {
                operatorId: true,
                bookingFormat: true,
              },
            },
            slotDefinition: true,
          },
        },
        dateRange: {
          include: {
            listing: {
              select: {
                operatorId:  true,
                bookingFormat:  true,
              },
            },
            slotDefinition: true,
          },
        },
        reschedules: {
          where: {
            status: {
              in: ["pending", "approved_with_charge"],
            },
          },
        },
      },
    });

    if (!booking) {
      return c.json({ success: false, message: "Booking not found" }, 404);
    }

    // Check if booking can be rescheduled
    const rescheduleCheck = canBookingBeRescheduled(booking);
    if (!rescheduleCheck.allowed) {
      return c.json(
        { success: false, message: rescheduleCheck.reason },
        400
      );
    }

    // Check if there's already a pending reschedule
    const pendingReschedule = booking.reschedules.find(r => r.status === "pending");
    if (pendingReschedule) {
      return c.json(
        {
          success: false,
          message: "A reschedule request is already pending for this booking",
          rescheduleId: pendingReschedule.id,
        },
        409
      );
    }

    // Check for approved_with_charge that hasn't been paid
    const pendingPayment = booking.reschedules.find(r => r.status === "approved_with_charge");
    if (pendingPayment) {
      return c.json(
        {
          success: false,
          message: "You have a reschedule pending payment.Please complete the payment first.",
          rescheduleId: pendingPayment.id,
          requiresPayment: true,
          feeAmount: pendingPayment.rescheduleFeeAmount,
        },
        409
      );
    }

    // Determine operator
    const operatorId =
      booking.listingSlot?.listing?.operatorId ||
      booking.dateRange?.listing?.operatorId;

    if (!operatorId) {
      return c.json(
        { success: false, message: "Unable to determine operator" },
        500
      );
    }

    // Determine booking format
    const bookingFormat = determineBookingFormat(booking);
    console.log("Detected booking format:", bookingFormat);

    // Validate format-specific fields
    if (bookingFormat === "F1" && !newBatchId) {
      return c.json(
        { success: false, message: "newBatchId required for F1 reschedule" },
        400
      );
    }

    if (bookingFormat === "F2" && (! newRentalStartDate || ! newRentalEndDate)) {
      return c.json(
        {
          success: false,
          message: "New rental dates required for F2 reschedule",
        },
        400
      );
    }

    if (bookingFormat === "F3" && !newSlotId) {
      return c.json(
        { success: false, message: "newSlotId required for F3 reschedule" },
        400
      );
    }

    if (bookingFormat === "F4" && !newDateRangeId) {
      return c.json(
        {
          success: false,
          message: "newDateRangeId required for F4 reschedule",
        },
        400
      );
    }

    // Check availability and validate new slot/batch
    let availabilityValid = false;

    if (bookingFormat === "F1") {
      const newBatch = await prisma.listingSlot.findUnique({
        where: { id: newBatchId },
      });

      if (!newBatch || newBatch.availableCount < booking.participantCount || !newBatch.isActive) {
        return c.json(
          {
            success: false,
            message: "New batch not available or insufficient capacity",
          },
          400
        );
      }
      availabilityValid = true;
    } else if (bookingFormat === "F2") {
      const dateRange = await prisma.inventoryDateRange.findFirst({
        where: {
          listingId: booking.dateRange?.listingId,
          availableFromDate: { lte: new Date(newRentalStartDate!) },
          availableToDate:  { gte: new Date(newRentalEndDate!) },
          isActive: true,
        },
      });

      if (!dateRange) {
        return c.json(
          {
            success:  false,
            message: "New dates not available in inventory",
          },
          400
        );
      }

      if (dateRange.totalCapacity !== null && dateRange.availableCount !== null) {
        if (dateRange.availableCount < 1) {
          return c.json(
            { success: false, message: "New dates fully booked" },
            400
          );
        }
      }
      availabilityValid = true;
    } else if (bookingFormat === "F3") {
      const newSlot = await prisma.listingSlot.findUnique({
        where: { id: newSlotId },
      });

      if (!newSlot || newSlot.availableCount < booking.participantCount || !newSlot.isActive) {
        return c.json(
          {
            success: false,
            message: "New slot not available or insufficient capacity",
          },
          400
        );
      }
      availabilityValid = true;
    } else if (bookingFormat === "F4") {
      const newRange = await prisma.inventoryDateRange.findUnique({
        where: { id: newDateRangeId },
      });

      if (
        !newRange ||
        (newRange.availableCount !== null && newRange.availableCount < booking.participantCount) ||
        !newRange.isActive
      ) {
        return c.json(
          {
            success: false,
            message: "New slot not available or insufficient capacity",
          },
          400
        );
      }
      availabilityValid = true;
    }

    if (!availabilityValid) {
      return c.json(
        { success: false, message: "Unable to validate availability" },
        500
      );
    }

    // Create reschedule request
    const rescheduleData:  any = {
      bookingId,
      initiatedByUserId: user.userId,
      initiatedByRole: user.userType === "customer" ? "customer" : "operator",
      operatorId,
      rescheduleReason:  rescheduleReason.trim(),
      status: "pending",
      rescheduleFeeAmount: 0,
      isPaymentRequired: false,
    };

    // Add format-specific fields
    if (bookingFormat === "F1") {
      rescheduleData.oldBatchId = booking.listingSlotId;
      rescheduleData.newBatchId = newBatchId;
    } else if (bookingFormat === "F2") {
      rescheduleData.oldRentalStartDate = booking.bookingStartDate;
      rescheduleData.oldRentalEndDate = booking.bookingEndDate;
      rescheduleData.newRentalStartDate = new Date(newRentalStartDate);
      rescheduleData.newRentalEndDate = new Date(newRentalEndDate);
      rescheduleData.oldDateRangeId = booking.dateRangeId;
      const newRange = await prisma.inventoryDateRange.findFirst({
        where: {
          listingId: booking.dateRange?.listingId,
          availableFromDate: { lte:  new Date(newRentalStartDate) },
          availableToDate:  { gte: new Date(newRentalEndDate) },
        },
      });
      rescheduleData.newDateRangeId = newRange?.id || null;
    } else if (bookingFormat === "F3") {
      rescheduleData.oldSlotId = booking.listingSlotId;
      rescheduleData.newSlotId = newSlotId;
    } else if (bookingFormat === "F4") {
      rescheduleData.oldDateRangeId = booking.dateRangeId;
      rescheduleData.newDateRangeId = newDateRangeId;
    }

    const reschedule = await prisma.reschedule.create({
      data: rescheduleData,
      include: {
        booking:  {
          select: {
            bookingReference: true,
            rescheduleCount: true,
            maxReschedules: true,
          },
        },
      },
    });

    return c.json({
      success: true,
      message: "Reschedule request submitted. Awaiting admin approval.",
      data: {
        ...reschedule,
        remainingReschedules: (booking.maxReschedules ??  1) - (booking.rescheduleCount ?? 0) - 1,
      },
    });
  } catch (error:  any) {
    console.error("Error initiating reschedule:", error);
    return c.json(
      {
        success: false,
        message: error.message || "Failed to initiate reschedule",
      },
      500
    );
  }
};

/**
 * Admin:  Review and approve/reject reschedule
 * PUT /api/reschedules/:rescheduleId/review
 */
export const reviewReschedule = async (c:  Context) => {
  try {
    const rescheduleId = c.req.param("rescheduleId");
    const body = await c.req.json();
    const user = c.get("user");

    if (user.userType !== "admin" && user.userType !== "super_admin") {
      return c.json(
        { success: false, message: "Only admins can review reschedules" },
        403
      );
    }

    const { decision, adminNotes, rescheduleFeeAmount } = body;

    if (! decision || !["approved", "approved_with_charge", "rejected"].includes(decision)) {
      return c.json(
        {
          success: false,
          message: "Invalid decision. Must be 'approved', 'approved_with_charge', or 'rejected'",
        },
        400
      );
    }

    const reschedule = await prisma.reschedule.findUnique({
      where: { id: rescheduleId },
      include: {
        booking:  true,
      },
    });

    if (!reschedule) {
      return c.json(
        { success: false, message: "Reschedule request not found" },
        404
      );
    }

    if (reschedule.status !== "pending") {
      return c.json(
        {
          success: false,
          message: `Reschedule already ${reschedule.status}`,
        },
        400
      );
    }

    // If rejected, just update status
    if (decision === "rejected") {
      const updated = await prisma.reschedule.update({
        where: { id: rescheduleId },
        data: {
          status:  "rejected",
          adminNotes:  adminNotes || null,
          approvedByAdminId: user.userId,
          approvedAt: new Date(),
        },
      });

      return c.json({
        success: true,
        message: "Reschedule request rejected",
        data: updated,
      });
    }

    // If approved with charge, validate fee amount
    if (decision === "approved_with_charge") {
      if (! rescheduleFeeAmount || rescheduleFeeAmount <= 0) {
        return c.json(
          {
            success:  false,
            message: "Reschedule fee amount required for approval with charge",
          },
          400
        );
      }
    }

    const updateData:  any = {
      status: decision,
      adminNotes:  adminNotes || null,
      approvedByAdminId: user.userId,
      approvedAt: new Date(),
    };

    if (decision === "approved_with_charge") {
      updateData.rescheduleFeeAmount = rescheduleFeeAmount;
      updateData.isPaymentRequired = true;
    }

    const updated = await prisma.reschedule.update({
      where: { id: rescheduleId },
      data: updateData,
    });

    // If approved (without charge), process immediately
    if (decision === "approved") {
      await processReschedule(rescheduleId);
    }

    return c.json({
      success: true,
      message: 
        decision === "approved"
          ? "Reschedule approved and processed successfully"
          : "Reschedule approved with charge. Customer must pay before processing.",
      data: updated,
    });
  } catch (error: any) {
    console.error("Error reviewing reschedule:", error);
    return c.json(
      {
        success: false,
        message: error.message || "Failed to review reschedule",
      },
      500
    );
  }
};

/**
 * Process reschedule - Updates inventory and booking
 */
const processReschedule = async (rescheduleId: string) => {
  console.log(`=== Processing Reschedule ${rescheduleId} ===`);

  const reschedule = await prisma.reschedule.findUnique({
    where: { id: rescheduleId },
    include:  {
      booking: {
        include: {
          listingSlot: true,
          dateRange: true,
        },
      },
      newBatch: true,
      newSlot: {
        include: {
          slotDefinition: true,
        },
      },
      newDateRange: {
        include: {
          slotDefinition: true,
        },
      },
    },
  });

  if (!reschedule) {
    throw new Error("Reschedule not found");
  }

  const booking = reschedule.booking;
  const bookingFormat = determineFormatFromReschedule(reschedule);

  console.log(`Booking Format: ${bookingFormat}`);
  console.log(`Participant Count: ${booking.participantCount}`);

  await prisma.$transaction(async (tx) => {
    // F1: Multi-day Batch reschedule
    if (bookingFormat === "F1") {
      if (reschedule.oldBatchId) {
        await tx.listingSlot.update({
          where: { id: reschedule.oldBatchId },
          data: {
            availableCount: {
              increment: booking.participantCount,
            },
          },
        });
      }

      if (reschedule.newBatchId) {
        await tx.listingSlot.update({
          where: { id:  reschedule.newBatchId },
          data: {
            availableCount: {
              decrement: booking.participantCount,
            },
          },
        });

        const newBatch = reschedule.newBatch ||
          (await tx.listingSlot.findUnique({ where: { id: reschedule.newBatchId } }));

        if (newBatch) {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              listingSlotId: reschedule.newBatchId,
              bookingStartDate: newBatch.batchStartDate || booking.bookingStartDate,
              bookingEndDate: newBatch.batchEndDate || booking.bookingEndDate,
              rescheduleCount: { increment: 1 },
              lastRescheduledAt: new Date(),
            },
          });
        }
      }
    }

    // F2: Day-wise Rental reschedule
    if (bookingFormat === "F2") {
      if (reschedule.oldDateRangeId) {
        const oldRange = await tx.inventoryDateRange.findUnique({
          where: { id: reschedule.oldDateRangeId },
        });

        if (oldRange && oldRange.availableCount !== null) {
          await tx.inventoryDateRange.update({
            where: { id: reschedule.oldDateRangeId },
            data: {
              availableCount: { increment: 1 },
            },
          });
        }
      }

      if (reschedule.newDateRangeId) {
        const newRange = await tx.inventoryDateRange.findUnique({
          where: { id:  reschedule.newDateRangeId },
        });

        if (newRange && newRange.availableCount !== null) {
          await tx.inventoryDateRange.update({
            where: { id: reschedule.newDateRangeId },
            data: {
              availableCount:  { decrement: 1 },
            },
          });
        }
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          dateRangeId: reschedule.newDateRangeId || booking.dateRangeId,
          bookingStartDate: reschedule.newRentalStartDate || booking.bookingStartDate,
          bookingEndDate: reschedule.newRentalEndDate || booking.bookingEndDate,
          rescheduleCount: { increment: 1 },
          lastRescheduledAt: new Date(),
        },
      });
    }

    // F3: Single-day Slot reschedule
    if (bookingFormat === "F3") {
      if (reschedule.oldSlotId) {
        await tx.listingSlot.update({
          where: { id: reschedule.oldSlotId },
          data: {
            availableCount: {
              increment: booking.participantCount,
            },
          },
        });
      }

      if (reschedule.newSlotId) {
        await tx.listingSlot.update({
          where: { id: reschedule.newSlotId },
          data: {
            availableCount: {
              decrement: booking.participantCount,
            },
          },
        });

        const newSlot = reschedule.newSlot ||
          (await tx.listingSlot.findUnique({ where: { id: reschedule.newSlotId } }));

        if (newSlot) {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              listingSlotId: reschedule.newSlotId,
              bookingStartDate: newSlot.slotDate || booking.bookingStartDate,
              bookingEndDate: newSlot.slotDate || booking.bookingEndDate,
              rescheduleCount: { increment:  1 },
              lastRescheduledAt: new Date(),
            },
          });
        }
      }
    }

    // F4: Slot-based Rental reschedule
    if (bookingFormat === "F4") {
      if (reschedule.oldDateRangeId) {
        const oldRange = await tx.inventoryDateRange.findUnique({
          where:  { id: reschedule.oldDateRangeId },
        });

        if (oldRange && oldRange.availableCount !== null) {
          await tx.inventoryDateRange.update({
            where: { id: reschedule.oldDateRangeId },
            data: {
              availableCount: {
                increment: booking.participantCount,
              },
            },
          });
        }
      }

      if (reschedule.newDateRangeId) {
        const newRange = await tx.inventoryDateRange.findUnique({
          where: { id: reschedule.newDateRangeId },
        });

        if (newRange && newRange.availableCount !== null) {
          await tx.inventoryDateRange.update({
            where: { id: reschedule.newDateRangeId },
            data: {
              availableCount: {
                decrement:  booking.participantCount,
              },
            },
          });
        }

        const newDateRange = reschedule.newDateRange || newRange;

        if (newDateRange) {
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              dateRangeId: reschedule.newDateRangeId,
              bookingStartDate: newDateRange.availableFromDate || booking.bookingStartDate,
              bookingEndDate: newDateRange.availableToDate || booking.bookingEndDate,
              rescheduleCount: { increment: 1 },
              lastRescheduledAt: new Date(),
            },
          });
        }
      }
    }

    // Mark reschedule as processed
    await tx.reschedule.update({
      where: { id: rescheduleId },
      data: {
        isPaymentRequired: false,
        adminNotes: reschedule.adminNotes
          ? `${reschedule.adminNotes}\n[Processed at ${new Date().toISOString()}]`
          : `[Processed at ${new Date().toISOString()}]`,
      },
    });
  });

  console.log(`=== Reschedule ${rescheduleId} processed successfully ===`);
};

/**
 * Customer: Complete reschedule payment
 * POST /api/reschedules/:rescheduleId/pay
 */
export const completeReschedulePayment = async (c: Context) => {
  try {
    const rescheduleId = c.req.param("rescheduleId");
    const body = await c.req.json();
    const user = c.get("user");

    const { paymentMethod, transactionId, amountPaid } = body;

    if (!paymentMethod) {
      return c.json(
        { success: false, message: "Payment method is required" },
        400
      );
    }

    const reschedule = await prisma.reschedule.findUnique({
      where: { id: rescheduleId },
      include:  {
        booking: {
          include: {
            customer: true,
          },
        },
      },
    });

    if (!reschedule) {
      return c.json({ success: false, message: "Reschedule not found" }, 404);
    }

    if (reschedule.booking.customerId !== user.userId) {
      return c.json({ success: false, message: "Unauthorized" }, 403);
    }

    if (! reschedule.isPaymentRequired) {
      return c.json(
        { success: false, message: "No payment required for this reschedule" },
        400
      );
    }

    if (reschedule.status !== "approved_with_charge") {
      return c.json(
        { success: false, message: "Reschedule not in payable state" },
        400
      );
    }

    const expectedAmount = Number(reschedule.rescheduleFeeAmount);
    if (amountPaid && Number(amountPaid) !== expectedAmount) {
      return c.json(
        {
          success: false,
          message: `Payment amount mismatch.Expected ₹${expectedAmount}, received ₹${amountPaid}`,
        },
        400
      );
    }

    const finalTransactionId =
      transactionId || `MOCK_TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    console.log(`=== Processing Reschedule Payment ===`);
    console.log(`Reschedule ID: ${rescheduleId}`);
    console.log(`Amount:  ₹${expectedAmount}`);

    // Process the reschedule
    await processReschedule(rescheduleId);

    // Update reschedule with payment info
    await prisma.reschedule.update({
      where: { id: rescheduleId },
      data: {
        isPaymentRequired: false,
        adminNotes: `${reschedule.adminNotes || ""}\n[Payment completed:  ₹${expectedAmount} via ${paymentMethod}, TxnID: ${finalTransactionId} at ${new Date().toISOString()}]`.trim(),
      },
    });

    return c.json({
      success: true,
      message: "Payment processed successfully. Your booking has been rescheduled.",
      data: {
        transactionId: finalTransactionId,
        amountPaid: expectedAmount,
        paymentMethod,
      },
    });
  } catch (error: any) {
    console.error("Error processing reschedule payment:", error);
    return c.json(
      {
        success: false,
        message: error.message || "Failed to process payment",
      },
      500
    );
  }
};

/**
 * Check reschedule eligibility for a booking
 * GET /api/reschedules/check-eligibility/: bookingId
 */
export const checkRescheduleEligibility = async (c: Context) => {
  try {
    const bookingId = c.req.param("bookingId");

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        reschedules: {
          where: {
            status: {
              in: ["pending", "approved_with_charge"],
            },
          },
        },
      },
    });

    if (!booking) {
      return c.json({ success: false, message: "Booking not found" }, 404);
    }

    const eligibility = canBookingBeRescheduled(booking);
    const pendingReschedule = booking.reschedules.find(r => r.status === "pending");
    const pendingPayment = booking.reschedules.find(r => r.status === "approved_with_charge");

    return c.json({
      success: true,
      data: {
        canReschedule: eligibility.allowed && !pendingReschedule && !pendingPayment,
        reason: eligibility.reason,
        rescheduleCount: booking.rescheduleCount ??  0,
        maxReschedules: booking.maxReschedules ?? 1,
        remainingReschedules: Math.max(0, (booking.maxReschedules ??  1) - (booking.rescheduleCount ?? 0)),
        hasPendingReschedule:  !!pendingReschedule,
        pendingRescheduleId: pendingReschedule?.id || null,
        hasPendingPayment: !! pendingPayment,
        pendingPaymentRescheduleId: pendingPayment?.id || null,
        pendingPaymentAmount: pendingPayment ?  Number(pendingPayment.rescheduleFeeAmount) : null,
      },
    });
  } catch (error: any) {
    console.error("Error checking reschedule eligibility:", error);
    return c.json(
      {
        success: false,
        message: error.message || "Failed to check eligibility",
      },
      500
    );
  }
};

/**
 * Get reschedules for a booking
 */
export const getReschedulesByBooking = async (c:  Context) => {
  try {
    const bookingId = c.req.param("bookingId");

    const reschedules = await prisma.reschedule.findMany({
      where: { bookingId },
      include:  {
        initiatedBy: {
          select: {
            id: true,
            firstName: true,
            lastName:  true,
            email: true,
          },
        },
        approvedByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName:  true,
          },
        },
        oldBatch: true,
        newBatch: true,
        oldSlot: {
          include: { slotDefinition: true },
        },
        newSlot:  {
          include: { slotDefinition: true },
        },
        oldDateRange: true,
        newDateRange: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return c.json({
      success: true,
      data: reschedules,
    });
  } catch (error: any) {
    console.error("Error fetching reschedules:", error);
    return c.json(
      {
        success: false,
        message: error.message || "Failed to fetch reschedules",
      },
      500
    );
  }
};

/**
 * Get all pending reschedules (Admin only)
 */
export const getPendingReschedules = async (c: Context) => {
  try {
    const user = c.get("user");

    if (user.userType !== "admin" && user.userType !== "super_admin") {
      return c.json({ success: false, message: "Admin access required" }, 403);
    }

    const reschedules = await prisma.reschedule.findMany({
      where: { status: "pending" },
      include: {
        booking: {
          include: {
            customer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            listingSlot: {
              include: {
                listing: {
                  select: {
                    id: true,
                    listingName: true,
                    bookingFormat: true,
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
                    bookingFormat: true,
                  },
                },
              },
            },
          },
        },
        initiatedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        oldBatch: true,
        newBatch: true,
        oldSlot: true,
        newSlot: true,
        oldDateRange: true,
        newDateRange: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return c.json({
      success: true,
      data: reschedules,
      count: reschedules.length,
    });
  } catch (error: any) {
    console.error("Error fetching pending reschedules:", error);
    return c.json(
      {
        success: false,
        message: error.message || "Failed to fetch pending reschedules",
      },
      500
    );
  }
};

/**
 * Cancel reschedule request
 */
export const cancelReschedule = async (c: Context) => {
  try {
    const rescheduleId = c.req.param("rescheduleId");
    const user = c.get("user");

    const reschedule = await prisma.reschedule.findUnique({
      where: { id: rescheduleId },
    });

    if (!reschedule) {
      return c.json({ success: false, message: "Reschedule not found" }, 404);
    }

    if (
      reschedule.initiatedByUserId !== user.userId &&
      user.userType !== "admin" &&
      user.userType !== "super_admin"
    ) {
      return c.json(
        { success: false, message: "Unauthorized to cancel this request" },
        403
      );
    }

    if (reschedule.status !== "pending" && reschedule.status !== "approved_with_charge") {
      return c.json(
        {
          success: false,
          message: "Can only cancel pending or unpaid reschedule requests",
        },
        400
      );
    }

    const updated = await prisma.reschedule.update({
      where: { id: rescheduleId },
      data: {
        status:  "cancelled",
      },
    });

    return c.json({
      success: true,
      message: "Reschedule request cancelled",
      data: updated,
    });
  } catch (error: any) {
    console.error("Error cancelling reschedule:", error);
    return c.json(
      {
        success:  false,
        message: error.message || "Failed to cancel reschedule",
      },
      500
    );
  }
};

/**
 * Get reschedule by ID
 */
export const getRescheduleById = async (c: Context) => {
  try {
    const rescheduleId = c.req.param("rescheduleId");

    const reschedule = await prisma.reschedule.findUnique({
      where: { id: rescheduleId },
      include: {
        booking: {
          include: {
            customer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            listingSlot: {
              include: {
                listing: {
                  select: {
                    id: true,
                    listingName: true,
                    frontImageUrl: true,
                    bookingFormat: true,
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
                    bookingFormat:  true,
                  },
                },
              },
            },
          },
        },
        initiatedBy: {
          select:  {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        approvedByAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        oldBatch:  true,
        newBatch:  true,
        oldSlot:  {
          include: { slotDefinition: true },
        },
        newSlot: {
          include: { slotDefinition:  true },
        },
        oldDateRange: true,
        newDateRange: true,
      },
    });

    if (!reschedule) {
      return c.json({ success: false, message: "Reschedule not found" }, 404);
    }

    return c.json({
      success: true,
      data: reschedule,
    });
  } catch (error: any) {
    console.error("Error fetching reschedule:", error);
    return c.json(
      {
        success: false,
        message: error.message || "Failed to fetch reschedule",
      },
      500
    );
  }
};