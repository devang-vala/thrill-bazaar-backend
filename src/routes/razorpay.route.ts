import { Hono } from "hono";
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  getRazorpayKey,
} from "../controllers/razorpay.controller.js";

const razorpayRouter = new Hono();

// GET  /api/payments/razorpay/key  – Return the public Razorpay key
razorpayRouter.get("/key", getRazorpayKey);

// POST /api/payments/razorpay/create-order  – Create a Razorpay order
razorpayRouter.post("/create-order", createRazorpayOrder);

// POST /api/payments/razorpay/verify  – Verify payment signature
razorpayRouter.post("/verify", verifyRazorpayPayment);

export default razorpayRouter;
