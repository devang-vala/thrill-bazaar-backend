import type { Context } from "hono";
import { prisma } from "../db.js";
import {
  calculatePaymentBreakdown,
  rupeesToPaise,
  getQuantityForBookingFormat,
  type PaymentCalculationInput,
} from "../helpers/payment.helper.js";

// Generate unique booking reference
const generateBookingReference = () => {
  const prefix = "BOK";
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${prefix}-${year}-${random}`;
};

// Create comprehensive booking with participants and addons
export const createBooking = async (c: Context) => {
  try {
    const body = await c.req.json();
    const user = c.get("user");
    
    // Debug logging
    console.log("=== BOOKING REQUEST DEBUG ===");
    console.log("Body received:", JSON.stringify(body, null, 2));
    console.log("User from token:", user);
    
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

    // Detailed validation logging
    console.log("Field validation:");
    console.log("- customerId:", customerId);
    console.log("- listingSlotId:", listingSlotId);
    console.log("- dateRangeId:", dateRangeId);
    console.log("- participantCount:", participantCount);
    console.log("- participants:", participants);
    
    // Validate required fields with specific error messages
    const missingFields = [];
    if (!customerId) missingFields.push("customerId");
    if (!listingSlotId && !dateRangeId) missingFields.push("listingSlotId or dateRangeId");
    if (!participantCount) missingFields.push("participantCount");
    if (!participants) missingFields.push("participants");
    
    if (missingFields.length > 0) {
      console.log("VALIDATION FAILED - Missing fields:", missingFields);
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
      console.log("VALIDATION FAILED - Customer not found:", customerId);
      return c.json({ 
        success: false, 
        message: "Customer not found. Please login again." 
      }, 404);
    }

    console.log("Customer verified:", customer.email);

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

      if (dateRange.availableCount && dateRange.availableCount < participantCount) {
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
      bookingStartDate = new Date(dateRange.availableFromDate);
      bookingEndDate = new Date(dateRange.availableToDate);
      basePrice = dateRange.basePricePerDay;
    } else {
      return c.json({ 
        success: false, 
        message: "Invalid booking: missing slot or date range" 
      }, 400);
    }

    console.log("Booking dates:", { bookingStartDate, bookingEndDate });

    // Calculate total days
    const timeDiff = bookingEndDate.getTime() - bookingStartDate.getTime();
    const totalDays = Math.max(1, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)) + 1);

    // Get booking format from listing
    const bookingFormat = listingDetails.bookingFormat as "F1" | "F2" | "F3" | "F4";

    // Calculate quantity based on booking format
    const quantity = getQuantityForBookingFormat(bookingFormat, participantCount, totalDays);

    // Calculate payment breakdown
    const paymentInput: PaymentCalculationInput = {
      bookingFormat,
      basePrice: rupeesToPaise(basePrice), // Convert to paise
      quantity,
      addonsAmount: rupeesToPaise(addonsTotal || 0),
      discountAmount: rupeesToPaise(discountAmount || 0),
      amountPaidOnline: amountPaidNow ? rupeesToPaise(amountPaidNow) : undefined,
      paymentMethod: paymentMethod || "online",
      taxRate: listingDetails.taxRate ? Math.round(listingDetails.taxRate * 100) : 1800, // Convert to basis points
    };

    const paymentBreakdown = calculatePaymentBreakdown(paymentInput);

    console.log("Payment breakdown:", paymentBreakdown);

    // Create booking with all details in transaction
    const result = await prisma.$transaction(async (tx) => {
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
          participants: participants,
          contactDetails: contactDetails,
          selectedAddons: selectedAddons || [],
          pricingDetails: {
            subtotal: paymentBreakdown.subtotalAmount / 100,
            addonsTotal: paymentBreakdown.addonsAmount / 100,
            taxAmount: paymentBreakdown.taxAmount / 100,
            discountAmount: paymentBreakdown.discountAmount / 100,
            promoCode: promoCode || null,
            totalAmount: paymentBreakdown.totalAmount / 100,
            amountPaidNow: paymentBreakdown.amountPaidOnline / 100,
            amountPendingAtVenue: paymentBreakdown.amountToCollectOffline / 100,
            paymentMethod: paymentBreakdown.paymentMethod,
          },
        },
      });

      // Create BookingPayment record
      const bookingPayment = await tx.bookingPayment.create({
        data: {
          bookingId: booking.id,
          basePrice: paymentBreakdown.basePrice,
          quantity: paymentBreakdown.quantity,
          subtotalAmount: paymentBreakdown.subtotalAmount,
          addonsAmount: paymentBreakdown.addonsAmount,
          discountAmount: paymentBreakdown.discountAmount,
          taxAmount: paymentBreakdown.taxAmount,
          totalAmount: paymentBreakdown.totalAmount,
          amountPaidOnline: paymentBreakdown.amountPaidOnline,
          amountToCollectOffline: paymentBreakdown.amountToCollectOffline,
          paymentMethod: paymentBreakdown.paymentMethod,
          platformCommissionRate: paymentBreakdown.platformCommissionRate,
          platformCommission: paymentBreakdown.platformCommission,
          tcsRate: paymentBreakdown.tcsRate,
          tcsAmount: paymentBreakdown.tcsAmount,
          sellerGrossEarnings: paymentBreakdown.sellerGrossEarnings,
          netPayableToSeller: paymentBreakdown.netPayableToSeller,
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
        // F3/F4 - update inventory_date_ranges table
        await tx.inventoryDateRange.update({
          where: { id: dateRangeId },
          data: {
            availableCount: {
              decrement: participantCount,
            },
          },
        });
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

    // Check availability if capacity tracking is enabled
    if (dateRange.totalCapacity !== null && dateRange.availableCount !== null) {
      if (dateRange.availableCount < 1) {
        return c.json({ success: false, message: "No availability for selected dates" }, 400);
      }
    }

    // Create booking and update availability in transaction
    const result = await prisma.$transaction(async (tx) => {
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
          basePrice: subtotal || totalAmount,
          totalAmount: totalAmount,
          bookingStatus: "CONFIRMED",
          contactDetails: contactDetails,
          selectedAddons: selectedAddons || [],
          pricingDetails: {
            selectedDates,
            subtotal: subtotal || totalAmount,
            addonsTotal: addonsTotal || 0,
            taxAmount: taxAmount || 0,
            discountAmount: discountAmount || 0,
            promoCode: promoCode || null,
            totalAmount,
            amountPaidNow: amountPaidNow || totalAmount,
            amountPendingAtVenue: amountPendingAtVenue || 0,
            paymentMethod: paymentMethod || "online",
          },
        },
      });

      // Update availability count if capacity tracking is enabled
      if (dateRange.totalCapacity !== null && dateRange.availableCount !== null) {
        await tx.inventoryDateRange.update({
          where: { id: dateRangeId },
          data: {
            availableCount: {
              decrement: 1,
            },
          },
        });
      }

      return {
        booking,
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

    if (!bookingId) {
      return c.json({ success: false, message: "Booking ID required" }, 400);
    }

    // Get booking details
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return c.json({ success: false, message: "Booking not found" }, 404);
    }

    if (booking.bookingStatus === "CANCELLED") {
      return c.json({ success: false, message: "Booking already cancelled" }, 400);
    }

    // Update booking and restore availability in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update booking status
      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          bookingStatus: "CANCELLED",
        },
      });

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

      // For F2, we'll add the logic later to update listing_slot_changes

      return updatedBooking;
    });

    return c.json({ success: true, data: result });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    return c.json({ success: false, message: "Failed to cancel booking" }, 500);
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
                  select: {
                    categoryName: true,
                  },
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
      },
      orderBy: { createdAt: "desc" },
    });

    return c.json({ success: true, data: bookings });
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
                operatorId: true,
                bookingFormat: true,
                category: {
                  select: {
                    categoryName: true,
                  },
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
                category: {
                  select: {
                    categoryName: true,
                  },
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

    // Add startTime and endTime from slotDefinition to listingSlot for easier access
    const formattedBooking = {
      ...booking,
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

    const bookings = await prisma.booking.findMany({
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
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return c.json({ success: true, data: bookings });
  } catch (error) {
    console.error("Error fetching admin bookings:", error);
    return c.json(
      { success: false, message: "Failed to fetch bookings" },
      500
    );
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
                  select: {
                    categoryName: true,
                  },
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
                  select: {
                    categoryName: true,
                  },
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
    return c.json(
      { success: false, message: "Failed to fetch bookings" },
      500
    );
  }
};
