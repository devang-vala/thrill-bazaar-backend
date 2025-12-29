import { Hono } from "hono";
import {
  createBooking,
  createF1Booking,
  cancelBooking,
  getUserBookings,
} from "../controllers/booking.controller.js";

const bookingRouter = new Hono();

// Create comprehensive booking with all details
bookingRouter.post("/create", createBooking);

// Create F1 booking (legacy)
bookingRouter.post("/f1", createF1Booking);

// Cancel booking
bookingRouter.post("/:bookingId/cancel", cancelBooking);

// Get user bookings
bookingRouter.get("/user/:customerId", getUserBookings);

export default bookingRouter;