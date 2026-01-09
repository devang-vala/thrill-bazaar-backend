import type { Context } from "hono";
import { prisma } from "../db.js";
import { format } from "date-fns";

// Helper:  Generate reschedule reference
const generateRescheduleReference = () => {
  const prefix = "RSC";
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0");
  return `${prefix}-${year}-${random}`;
};

// Helper:  Determine booking format from booking data
const determineBookingFormat = (booking: any): string => {
  if (booking.listingSlotId) {
    // Check if it's F1 or F3/F4
    if (
      booking.listingSlot?.batchStartDate &&
      booking.listingSlot?.batchEndDate
    ) {
      return "F1";
    } else if (booking.listingSlot?.slotDate) {
      return booking.listingSlot?.slotDefinitionId ? "F3" : "F4";
    }
  } else if (booking.dateRangeId) {
    // It's F2
    return "F2";
  }
  throw new Error("Unable to determine booking format");
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
    console.log("User:", user);

    const {
      bookingId,
      rescheduleReason,
      // F1 fields
      newBatchId,
      // F2 fields
      newRentalStartDate,
      newRentalEndDate,
      // F3/F4 fields
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

    // Get booking details
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        listingSlot: {
          include: {
            listing: {
              select: {
                operatorId: true,
                bookingFormat: true,
              },
            },
          },
        },
        dateRange: {
          include: {
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

    // Check if booking is already cancelled or completed
    if (booking.bookingStatus === "CANCELLED") {
      return c.json(
        { success: false, message: "Cannot reschedule cancelled booking" },
        400
      );
    }

    // Check if there's already a pending reschedule
    const existingReschedule = await prisma.reschedule.findFirst({
      where: {
        bookingId,
        status: "pending",
      },
    });

    if (existingReschedule) {
      return c.json(
        {
          success: false,
          message: "A reschedule request is already pending for this booking",
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

    if (
      bookingFormat === "F2" &&
      (! newRentalStartDate || ! newRentalEndDate)
    ) {
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

    // Check availability of new slot/batch/dateRange
    let availabilityValid = false;

    if (bookingFormat === "F1") {
      const newBatch = await prisma.listingSlot.findUnique({
        where: { id: newBatchId },
      });

      if (
        !newBatch ||
        newBatch.availableCount < booking.participantCount ||
        ! newBatch.isActive
      ) {
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
      // For F2, check if dates are available in the date range
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

      // Check capacity if applicable
      if (
        dateRange.totalCapacity !== null &&
        dateRange.availableCount !== null
      ) {
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
        where: { id:  newSlotId },
      });

      if (
        !newSlot ||
        newSlot.availableCount < booking.participantCount ||
        !newSlot.isActive
      ) {
        return c.json(
          {
            success: false,
            message:  "New slot not available or insufficient capacity",
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
        (newRange.availableCount !== null &&
          newRange.availableCount < booking.participantCount) ||
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
      initiatedByRole:  user.userType === "customer" ? "customer" : "operator",
      operatorId,
      rescheduleReason,
      status: "pending",
      rescheduleFeeAmount: 0, // Admin will set this during approval
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
      // Find the new date range that covers the requested dates
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
    });

    return c.json({
      success: true,
      message: "Reschedule request submitted. Awaiting admin approval.",
      data: reschedule,
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

    // Only admin can review
    if (user.userType !== "admin" && user.userType !== "super_admin") {
      return c.json(
        { success: false, message: "Only admins can review reschedules" },
        403
      );
    }

    const { decision, adminNotes, rescheduleFeeAmount } = body;

    if (!decision || !["approved", "approved_with_charge", "rejected"].includes(decision)) {
      return c.json(
        {
          success: false,
          message: "Invalid decision. Must be 'approved', 'approved_with_charge', or 'rejected'",
        },
        400
      );
    }

    // Get reschedule request
    const reschedule = await prisma.reschedule.findUnique({
      where: { id: rescheduleId },
      include: {
        booking:  {
          include: {
            listingSlot: true,
            dateRange: true,
          },
        },
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
            success: false,
            message: "Reschedule fee amount required for approval with charge",
          },
          400
        );
      }
    }

    // Determine booking format
    const bookingFormat = determineBookingFormat(reschedule.booking);

    // Update reschedule status
    const updateData:  any = {
      status: decision,
      adminNotes: adminNotes || null,
      approvedByAdminId: user.userId,
      approvedAt:  new Date(),
    };

    if (decision === "approved_with_charge") {
      updateData.rescheduleFeeAmount = rescheduleFeeAmount;
      updateData.isPaymentRequired = true;
    }

    const updated = await prisma.reschedule.update({
      where: { id: rescheduleId },
      data:  updateData,
    });

    // If approved (without charge), process immediately
    if (decision === "approved") {
      await processReschedule(rescheduleId);
    }

    return c.json({
      success: true,
      message: 
        decision === "approved"
          ? "Reschedule approved and processed"
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
 * Process reschedule (internal function)
 * This updates inventory and booking
 */
const processReschedule = async (rescheduleId: string) => {
  const reschedule = await prisma.reschedule.findUnique({
    where: { id: rescheduleId },
    include:  {
      booking: {
        include: {
          listingSlot: true,
          dateRange: true,
        },
      },
    },
  });

  if (!reschedule) {
    throw new Error("Reschedule not found");
  }

  const booking = reschedule.booking;
  const bookingFormat = determineBookingFormat(booking);

  await prisma.$transaction(async (tx) => {
    // F1: Restore old batch, decrement new batch
    if (bookingFormat === "F1") {
      // Restore old batch capacity
      if (reschedule.oldBatchId) {
        await tx.listingSlot.update({
          where: { id:  reschedule.oldBatchId },
          data: {
            availableCount: {
              increment: booking.participantCount,
            },
          },
        });
      }

      // Decrement new batch capacity
      if (reschedule.newBatchId) {
        await tx.listingSlot.update({
          where: { id: reschedule.newBatchId },
          data: {
            availableCount: {
              decrement: booking.participantCount,
            },
          },
        });

        // Get new batch details for booking update
        const newBatch = await tx.listingSlot.findUnique({
          where: { id: reschedule.newBatchId },
        });

        // Update booking
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            listingSlotId: reschedule.newBatchId,
            bookingStartDate: newBatch?.batchStartDate || booking.bookingStartDate,
            bookingEndDate: newBatch?.batchEndDate || booking.bookingEndDate,
          },
        });
      }
    }

    // F2: Restore old date range, decrement new date range
    if (bookingFormat === "F2") {
      // Restore old date range capacity
      if (reschedule.oldDateRangeId) {
        await tx.inventoryDateRange.update({
          where: { id: reschedule.oldDateRangeId },
          data: {
            availableCount: {
              increment: 1,
            },
          },
        });
      }

      // Decrement new date range capacity
      if (reschedule.newDateRangeId) {
        await tx.inventoryDateRange.update({
          where: { id: reschedule.newDateRangeId },
          data: {
            availableCount: {
              decrement: 1,
            },
          },
        });

        // Update booking
        await tx.booking.update({
          where: { id:  booking.id },
          data: {
            dateRangeId: reschedule.newDateRangeId,
            bookingStartDate: reschedule.newRentalStartDate || booking.bookingStartDate,
            bookingEndDate: reschedule.newRentalEndDate || booking.bookingEndDate,
          },
        });
      }
    }

    // F3: Restore old slot, decrement new slot
    if (bookingFormat === "F3") {
      // Restore old slot capacity
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

      // Decrement new slot capacity
      if (reschedule.newSlotId) {
        await tx.listingSlot.update({
          where: { id: reschedule.newSlotId },
          data: {
            availableCount: {
              decrement:  booking.participantCount,
            },
          },
        });

        // Get new slot details
        const newSlot = await tx.listingSlot.findUnique({
          where: { id: reschedule.newSlotId },
        });

        // Update booking
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            listingSlotId: reschedule.newSlotId,
            bookingStartDate: newSlot?.slotDate || booking.bookingStartDate,
            bookingEndDate: newSlot?.slotDate || booking.bookingEndDate,
          },
        });
      }
    }

    // F4: Restore old date range, decrement new date range
    if (bookingFormat === "F4") {
      // Restore old date range capacity
      if (reschedule.oldDateRangeId) {
        await tx.inventoryDateRange.update({
          where: { id: reschedule.oldDateRangeId },
          data: {
            availableCount: {
              increment: booking.participantCount,
            },
          },
        });
      }

      // Decrement new date range capacity
      if (reschedule.newDateRangeId) {
        await tx.inventoryDateRange.update({
          where: { id: reschedule.newDateRangeId },
          data: {
            availableCount: {
              decrement: booking.participantCount,
            },
          },
        });

        // Get new date range details
        const newRange = await tx.inventoryDateRange.findUnique({
          where: { id: reschedule.newDateRangeId },
        });

        // Update booking
        await tx.booking.update({
          where: { id:  booking.id },
          data: {
            dateRangeId: reschedule.newDateRangeId,
            bookingStartDate: newRange?.availableFromDate || booking.bookingStartDate,
            bookingEndDate: newRange?.availableToDate || booking.bookingEndDate,
          },
        });
      }
    }
  });

  console.log(`Reschedule ${rescheduleId} processed successfully`);
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

    const { paymentMethod, transactionId } = body;

    // Get reschedule
    const reschedule = await prisma.reschedule.findUnique({
      where: { id: rescheduleId },
      include: {
        booking: {
          include: {
            customer: true,
          },
        },
      },
    });

    if (!reschedule) {
      return c.json(
        { success: false, message: "Reschedule not found" },
        404
      );
    }

    // Verify user is the customer
    if (reschedule.booking.customerId !== user.userId) {
      return c.json(
        { success: false, message: "Unauthorized" },
        403
      );
    }

    // Check if payment is required
    if (! reschedule.isPaymentRequired) {
      return c.json(
        { success: false, message: "No payment required for this reschedule" },
        400
      );
    }

    // Check status
    if (reschedule.status !== "approved_with_charge") {
      return c.json(
        { success: false, message: "Reschedule not in payable state" },
        400
      );
    }

    // TODO: Integrate with Razorpay or payment gateway
    // For now, we'll just mark as paid and process

    // Process the reschedule
    await processReschedule(rescheduleId);

    // Update reschedule to mark payment complete (optional:  add payment tracking)
    await prisma.reschedule.update({
      where: { id: rescheduleId },
      data: {
        adminNotes: `${reschedule.adminNotes || ""}\nPayment completed:  ${transactionId || "N/A"}`,
      },
    });

    return c.json({
      success: true,
      message: "Payment processed and reschedule completed",
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
 * Get reschedule history for a booking
 * GET /api/reschedules/booking/:bookingId
 */
export const getReschedulesByBooking = async (c: Context) => {
  try {
    const bookingId = c.req.param("bookingId");

    const reschedules = await prisma.reschedule.findMany({
      where: { bookingId },
      include: {
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
 * GET /api/reschedules/pending
 */
export const getPendingReschedules = async (c:  Context) => {
  try {
    const user = c.get("user");

    // Only admin can view all pending
    if (user.userType !== "admin" && user.userType !== "super_admin") {
      return c.json(
        { success: false, message: "Admin access required" },
        403
      );
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
                    listingName: true,
                  },
                },
              },
            },
            dateRange: {
              include:  {
                listing: {
                  select: {
                    listingName: true,
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
        message:  error.message || "Failed to fetch pending reschedules",
      },
      500
    );
  }
};

/**
 * Cancel reschedule request (before admin approval)
 * POST /api/reschedules/:rescheduleId/cancel
 */
export const cancelReschedule = async (c: Context) => {
  try {
    const rescheduleId = c.req.param("rescheduleId");
    const user = c.get("user");

    const reschedule = await prisma.reschedule.findUnique({
      where: { id: rescheduleId },
      include: {
        booking: true,
      },
    });

    if (!reschedule) {
      return c.json(
        { success: false, message:  "Reschedule not found" },
        404
      );
    }

    // Only the initiator or admin can cancel
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

    // Can only cancel if pending
    if (reschedule.status !== "pending") {
      return c.json(
        {
          success: false,
          message: "Can only cancel pending reschedule requests",
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
        success: false,
        message:  error.message || "Failed to cancel reschedule",
      },
      500
    );
  }
};

/**
 * Get reschedule by ID
 * GET /api/reschedules/:rescheduleId
 */
export const getRescheduleById = async (c: Context) => {
  try {
    const rescheduleId = c.req.param("rescheduleId");

    const reschedule = await prisma.reschedule.findUnique({
      where:  { id: rescheduleId },
      include: {
        booking: {
          include: {
            customer: {
              select:  {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            listingSlot: {
              include: {
                listing:  {
                  select: {
                    listingName: true,
                    frontImageUrl: true,
                  },
                },
              },
            },
            dateRange: {
              include: {
                listing: {
                  select: {
                    listingName: true,
                    frontImageUrl:  true,
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
        oldBatch: {
          include: {
            listing: {
              select: {
                listingName: true,
              },
            },
          },
        },
        newBatch:  {
          include: {
            listing: {
              select: {
                listingName: true,
              },
            },
          },
        },
        oldSlot: {
          include: {
            listing: {
              select: {
                listingName:  true,
              },
            },
            slotDefinition: true,
          },
        },
        newSlot: {
          include: {
            listing: {
              select: {
                listingName: true,
              },
            },
            slotDefinition: true,
          },
        },
        oldDateRange:  {
          include: {
            listing: {
              select: {
                listingName: true,
              },
            },
          },
        },
        newDateRange: {
          include: {
            listing: {
              select: {
                listingName:  true,
              },
            },
          },
        },
      },
    });

    if (!reschedule) {
      return c.json(
        { success: false, message: "Reschedule not found" },
        404
      );
    }

    return c.json({
      success: true,
      data:  reschedule,
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