import { Hono } from "hono";
import {
  createF1Booking,
  cancelBooking,
  getUserBookings,
} from "../controllers/booking.controller.js";

const bookingRouter = new Hono();

// Create F1 booking
bookingRouter.post("/f1", createF1Booking);

// Cancel booking
bookingRouter.post("/:bookingId/cancel", cancelBooking);

// Get user bookings
bookingRouter.get("/user/:customerId", getUserBookings);

export default bookingRouter;