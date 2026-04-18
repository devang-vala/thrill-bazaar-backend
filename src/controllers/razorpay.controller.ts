import type { Context } from "hono";
import Razorpay from "razorpay";
import crypto from "crypto";

const MAX_RAZORPAY_RECEIPT_LENGTH = 40;

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

/**
 * POST /api/payments/razorpay/create-order
 * Creates a Razorpay order to be used by the frontend checkout.
 *
 * Body:
 *   amount      – Amount in RUPEES (not paise). We multiply by 100 here.
 *   currency    – "INR" (default)
 *   receipt     – Arbitrary receipt string (e.g. booking reference)
 *   notes       – Optional key-value metadata object
 */
export const createRazorpayOrder = async (c: Context) => {
  try {
    const { amount, currency = "INR", receipt, notes } = await c.req.json();

    if (!amount || Number(amount) <= 0) {
      return c.json({ success: false, message: "A valid amount is required" }, 400);
    }

    const razorpay = getRazorpayInstance();

    // Razorpay expects amount in smallest currency unit (paise for INR)
    const amountInPaise = Math.round(Number(amount) * 100);

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency,
      receipt: buildSafeReceipt(receipt),
      notes: notes || {},
    });

    return c.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,          // in paise
        amountInRupees: Number(order.amount) / 100,
        currency: order.currency,
        receipt: order.receipt,
        razorpayKeyId: process.env.RAZORPAY_API_KEY,
      },
    });
  } catch (error: any) {
    console.error("Error creating Razorpay order:", error);
    return c.json({
      success: false,
      message: error?.message || "Failed to create payment order",
    }, 500);
  }
};

/**
 * POST /api/payments/razorpay/verify
 * Verifies the HMAC-SHA256 signature returned by Razorpay after a successful payment.
 *
 * Body:
 *   razorpay_order_id   – The order ID from createRazorpayOrder
 *   razorpay_payment_id – The payment ID from Razorpay checkout
 *   razorpay_signature  – The signature to verify
 */
export const verifyRazorpayPayment = async (c: Context) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      await c.req.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return c.json({ success: false, message: "Missing required payment verification fields" }, 400);
    }

    const secret = process.env.RAZORPAY_SECRET_KEY;
    if (!secret) {
      return c.json({ success: false, message: "Razorpay secret key is not configured" }, 500);
    }

    // Build the expected signature: HMAC-SHA256 of "<orderId>|<paymentId>" with secret
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    const isValid = expectedSignature === razorpay_signature;

    if (!isValid) {
      return c.json({
        success: false,
        message: "Payment verification failed – invalid signature",
      }, 400);
    }

    return c.json({
      success: true,
      message: "Payment verified successfully",
      data: {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        verified: true,
      },
    });
  } catch (error: any) {
    console.error("Error verifying Razorpay payment:", error);
    return c.json({
      success: false,
      message: error?.message || "Failed to verify payment",
    }, 500);
  }
};

/**
 * GET /api/payments/razorpay/key
 * Returns the public Razorpay key ID so the frontend can initialise the checkout.
 */
export const getRazorpayKey = async (c: Context) => {
  const key = process.env.RAZORPAY_API_KEY;
  if (!key || key === "your_razorpay_api_key_here") {
    return c.json({ success: false, message: "Razorpay is not configured" }, 500);
  }
  return c.json({ success: true, data: { key } });
};
