import dotenv from "dotenv";
// Load environment variables FIRST before any other imports
dotenv.config();

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { ensurePrismaConnected, prisma } from "./db.js";
import apiRouter from "./routes/index.js";
import { cors } from "hono/cors";
import { configureCloudinary, cloudinarySecrets } from "./config/cloudinary.config.js";
import { initMeilisearch } from "./services/meilisearch.service.js";
const cloudinary = configureCloudinary();
// console.log("Cloudinary Secrets Loaded:", cloudinarySecrets);

const ensureBookingReasonColumn = async () => {
  try {
    const rows = (await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'bookings'
          AND column_name = 'reason'
      ) AS exists
    `)) as Array<{ exists: boolean }>;

    const hasReasonColumn = rows?.[0]?.exists === true;
    if (!hasReasonColumn) {
      console.warn("[DB Drift] Missing bookings.reason column. Applying safe auto-fix...");
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "reason" TEXT;`
      );
      console.log("[DB Drift] Added bookings.reason column successfully.");
    }
  } catch (error) {
    console.warn(
      "[DB Drift] Failed to verify/apply bookings.reason column fix:",
      error instanceof Error ? error.message : error
    );
  }
};

const ensureBookingPaymentConcernColumns = async () => {
  try {
    const rows = (await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'booking_payments'
        AND column_name IN ('reason', 'reason_by_admin')
    `)) as Array<{ column_name: string }>;

    const existingColumns = new Set(rows.map((row) => row.column_name));

    if (!existingColumns.has("reason")) {
      console.warn('[DB Drift] Missing booking_payments.reason column. Applying safe auto-fix...');
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "booking_payments" ADD COLUMN IF NOT EXISTS "reason" TEXT;`
      );
      console.log("[DB Drift] Added booking_payments.reason column successfully.");
    }

    if (!existingColumns.has("reason_by_admin")) {
      console.warn('[DB Drift] Missing booking_payments.reason_by_admin column. Applying safe auto-fix...');
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "booking_payments" ADD COLUMN IF NOT EXISTS "reason_by_admin" TEXT;`
      );
      console.log("[DB Drift] Added booking_payments.reason_by_admin column successfully.");
    }
  } catch (error) {
    console.warn(
      "[DB Drift] Failed to verify/apply booking_payments concern column fix:",
      error instanceof Error ? error.message : error
    );
  }
};

const ensureBookingPaymentSettlementModeColumn = async () => {
  try {
    const rows = (await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'booking_payments'
          AND column_name = 'settlement_mode'
      ) AS exists
    `)) as Array<{ exists: boolean }>;

    const hasSettlementModeColumn = rows?.[0]?.exists === true;

    if (!hasSettlementModeColumn) {
      console.warn('[DB Drift] Missing booking_payments.settlement_mode column. Applying safe auto-fix...');
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "booking_payments" ADD COLUMN IF NOT EXISTS "settlement_mode" TEXT;`
      );
      console.log("[DB Drift] Added booking_payments.settlement_mode column successfully.");
    }
  } catch (error) {
    console.warn(
      "[DB Drift] Failed to verify/apply booking_payments settlement_mode column fix:",
      error instanceof Error ? error.message : error
    );
  }
};

// Initialize Meilisearch
// Initialize Meilisearch (non-blocking)
initMeilisearch().catch(err => {
  console.warn("⚠️  Meilisearch initialization failed - continuing without it");
  console.warn("Error:", err instanceof Error ? err.message : err);
});

const app = new Hono();

app.use('*', cors({
  origin: '*',
}));

//test endpoint
app.get("/", (c) => {
  return c.text("Hello, Thrill Bazaar Dev!");
});

// Mount API routes under /api
app.route("/api", apiRouter);

const startServer = async () => {
  await ensurePrismaConnected();
  await ensureBookingReasonColumn();
  await ensureBookingPaymentConcernColumns();
  await ensureBookingPaymentSettlementModeColumn();

  serve(
    {
      fetch: app.fetch,
      port: process.env.PORT ? Number(process.env.PORT) : 3000,
    },
    (info) => {
      const boundPort = info?.port ?? process.env.PORT ?? 3000;
      console.log(`Server is running on http://localhost:${boundPort}`);
    }
  );
};

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
