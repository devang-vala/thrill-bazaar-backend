import type { Context } from "hono";
import { prisma } from "../db.js";

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
        message: "Only customers can create bookings. Please login as a customer." 
      }, 403);
    }
    
    const {
      customerId,
      listingId,
      variantId,
      listingSlotId,
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
    console.log("- participantCount:", participantCount);
    console.log("- participants:", participants);
    
    // Validate required fields with specific error messages
    const missingFields = [];
    if (!customerId) missingFields.push("customerId");
    if (!listingSlotId) missingFields.push("listingSlotId");
    if (!participantCount) missingFields.push("participantCount");
    if (!participants) missingFields.push("participants");
    
    if (missingFields.length > 0) {
      console.log("VALIDATION FAILED - Missing fields:", missingFields);
      return c.json({ 
        success: false, 
        message: `Missing required fields: ${missingFields.join(", ")}` 
      }, 400);
    }

    // Get slot details
    const slot = await prisma.listingSlot.findUnique({
      where: { id: listingSlotId },
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

    if (!slot) {
      return c.json({ success: false, message: "Slot not found" }, 404);
    }

    if (slot.availableCount < participantCount) {
      return c.json({ success: false, message: "Not enough capacity available" }, 400);
    }

    // Create booking with all details in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create booking with all metadata
      const booking = await tx.booking.create({
        data: {
          bookingReference: generateBookingReference(),
          customerId,
          listingSlotId,
          bookingStartDate: slot.batchStartDate!,
          bookingEndDate: slot.batchEndDate!,
          participantCount,
          totalDays: 1,
          basePrice: slot.basePrice,
          totalAmount: totalAmount,
          bookingStatus: "CONFIRMED",
          participants: participants,
          contactDetails: contactDetails,
          selectedAddons: selectedAddons || [],
          pricingDetails: {
            subtotal,
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

      // Update slot availability
      await tx.listingSlot.update({
        where: { id: listingSlotId },
        data: {
          availableCount: {
            decrement: participantCount,
          },
        },
      });

      return {
        booking,
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

    if (!customerId || !listingId || !selectedDates || selectedDates.length === 0) {
      return c.json({ success: false, message: "Missing required fields" }, 400);
    }

    // Sort dates to get start and end
    const sortedDates = [...selectedDates].sort();
    const startDate = new Date(sortedDates[0] + "T00:00:00Z");
    const endDate = new Date(sortedDates[sortedDates.length - 1] + "T00:00:00Z");

    // Get listing details for basePrice
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { 
        listingName: true, 
        currency: true, 
        taxRate: true,
        operatorId: true,
      }
    });

    if (!listing) {
      return c.json({ success: false, message: "Listing not found" }, 404);
    }

    // Find the date range for the variant to get base price
    const dateRange = await prisma.inventoryDateRange.findFirst({
      where: {
        listingId,
        variantId: variantId || null,
        availableFromDate: { lte: startDate },
        availableToDate: { gte: endDate },
      },
    });

    // Create booking and update availability in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create booking
      const booking = await tx.booking.create({
        data: {
          bookingReference: generateBookingReference(),
          customerId,
          dateRangeId: dateRange?.id || null,
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

      // Create ListingSlotChange entries for each booked date to mark them as unavailable
      for (const dateStr of selectedDates) {
        const changeDate = new Date(dateStr + "T00:00:00Z");
        
        // Check if an entry already exists for this date
        const existing = await tx.listingSlotChange.findFirst({
          where: {
            listingId,
            variantId: variantId || null,
            slotId: null,
            changeDate,
          },
        });

        if (existing) {
          // Update existing entry - increment booked count
          await tx.listingSlotChange.update({
            where: { id: existing.id },
            data: {
              bookedCount: { increment: 1 },
              triggerType: "customer_book",
            },
          });
        } else {
          // Create new entry
          await tx.listingSlotChange.create({
            data: {
              slotId: null,
              listingId,
              variantId: variantId || null,
              changeDate,
              basePrice: dateRange?.basePricePerDay || 0,
              availableCount: 0, // Not used for F2, we track bookedCount
              bookedCount: 1,
              triggerType: "customer_book",
            },
          });
        }
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
                category: {
                  select: {
                    categoryName: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return c.json({ success: true, data: bookings });
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    return c.json({ success: false, message: "Failed to fetch bookings" }, 500);
  }
};