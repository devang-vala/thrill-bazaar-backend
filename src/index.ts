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
import cron from "node-cron";
import { syncAllListingPrices } from "./services/cron.service.js";
const cloudinary = configureCloudinary();

// Configure max body size (50MB for image uploads)
const MAX_BODY_SIZE = 50 * 1024 * 1024; // 50MB
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

// Enhanced CORS configuration for production
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://www.thrillbazaar.com',
  'https://thrillbazaar.com',
  'https://api.thrillbazaar.com',
  'https://thrill-bazaar-frontend-ten.vercel.app'
];

app.use('*', cors({
  origin: (origin) => {
    // Allow requests from specified origins or wildcard
    if (!origin) return '*'; // Allow requests without origin header
    if (allowedOrigins.includes(origin)) return origin;
    return process.env.NODE_ENV === 'production' ? undefined : '*';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  credentials: true,
  maxAge: 600,
}));

//test endpoint
// Trigger rebuild for Vercel CORS
app.get("/", (c) => {
  return c.text("Hellooooo 😎");
});

app.get("/cors-test", (c) => {
  return c.text("DEPLOYMENT_SUCCESSFUL");
});

// Mount API routes under /api
app.route("/api", apiRouter);

const startServer = async () => {
  await ensurePrismaConnected();
  await ensureBookingReasonColumn();
  await ensureBookingPaymentConcernColumns();
  await ensureBookingPaymentSettlementModeColumn();

  // Initialize background cron jobs
  console.log("Setting up background cron jobs...");
  cron.schedule("0 * * * *", () => {
    syncAllListingPrices();
  });

  serve(
    {
      fetch: app.fetch,
      port: process.env.PORT ? Number(process.env.PORT) : 3000,
      // Note: For @hono/node-server, body size limits are handled by Node.js
      // Configure via environment or use middleware approach
    },
    (info) => {
      const boundPort = info?.port ?? process.env.PORT ?? 3000;
      console.log(`Server is running on http://localhost:${boundPort}`);
      console.log(`Max upload size: ${(MAX_BODY_SIZE / 1024 / 1024).toFixed(0)}MB`);
    }
  );
};

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
