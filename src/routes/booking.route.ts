import { Hono } from "hono";
import {
  createBooking,
  createF1Booking,
  createF2Booking,
  cancelBooking,
  getUserBookings,
  getBookingWithReschedules,
  getAdminBookings,
} from "../controllers/booking.controller.js";
import {
  authenticateToken,
  requireAdmin,
  optionalAuth,
} from "../middlewares/auth.middleware.js";

const bookingRouter = new Hono();

// Admin:  Get all bookings
bookingRouter.get("/admin/all", authenticateToken, requireAdmin, getAdminBookings);

// Create comprehensive booking with all details
bookingRouter.post("/create", optionalAuth, createBooking);

// Create F1 booking (legacy)
bookingRouter.post("/f1", optionalAuth, createF1Booking);

// Create F2 booking (day-wise rental)
bookingRouter.post("/f2", optionalAuth, createF2Booking);

// Cancel booking
bookingRouter.post("/:bookingId/cancel", optionalAuth, cancelBooking);

// Get user bookings
bookingRouter.get("/user/:customerId", optionalAuth, getUserBookings);

// Get booking with reschedule history
bookingRouter.get("/:bookingId/with-reschedules", optionalAuth, getBookingWithReschedules);

export default bookingRouter;