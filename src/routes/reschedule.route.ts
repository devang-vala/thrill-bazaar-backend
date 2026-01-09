import { Hono } from "hono";
import {
  initiateReschedule,
  reviewReschedule,
  completeReschedulePayment,
  getReschedulesByBooking,
  getPendingReschedules,
  cancelReschedule,
  getRescheduleById,
} from "../controllers/reschedule.controller.js";
import {
  authenticateToken,
  requireAdmin,
} from "../middlewares/auth.middleware.js";

const rescheduleRouter = new Hono();

// All reschedule routes require authentication
rescheduleRouter.use(authenticateToken);

// Customer/Operator:  Initiate reschedule request
rescheduleRouter.post("/initiate", initiateReschedule);

// Admin: Review (approve/reject) reschedule
rescheduleRouter.put("/:rescheduleId/review", requireAdmin, reviewReschedule);

// Customer: Complete payment for approved reschedule with charge
rescheduleRouter.post("/:rescheduleId/pay", completeReschedulePayment);

// Get reschedule history for a specific booking
rescheduleRouter.get("/booking/:bookingId", getReschedulesByBooking);

// Admin: Get all pending reschedules
rescheduleRouter.get("/pending", requireAdmin, getPendingReschedules);

// Cancel reschedule request (only if pending)
rescheduleRouter.post("/:rescheduleId/cancel", cancelReschedule);

// Get reschedule details by ID
rescheduleRouter.get("/:rescheduleId", getRescheduleById);

export default rescheduleRouter;