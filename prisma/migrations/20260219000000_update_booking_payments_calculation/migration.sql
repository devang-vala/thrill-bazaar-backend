-- AlterTable: Update booking_payments table with CORRECT payment calculation fields
-- This migration adds new fields for proper payment tracking
-- CORRECT LOGIC: Tax applied FIRST, then discount

-- Add new fields to booking_payments table
ALTER TABLE "booking_payments" 
  ADD COLUMN IF NOT EXISTS "total_base_price" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax_rate" INTEGER NOT NULL DEFAULT 1800,
  ADD COLUMN IF NOT EXISTS "subtotal_with_tax" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax_amount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_base_amount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "net_pay_to_seller" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "balance_to_collect" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_earnings" INTEGER NOT NULL DEFAULT 0;

-- Update existing records with CORRECT calculation
-- Step 1: Calculate total base price
-- Step 2: Apply tax FIRST (18%)
-- Step 3: Subtract discount
-- Step 4: Calculate earnings
UPDATE "booking_payments" SET
  "total_base_price" = "base_price" * "quantity",
  "tax_rate" = 1800,
  "tax_amount" = ROUND(("base_price" * "quantity") * 1800 / 10000),
  "subtotal_with_tax" = ("base_price" * "quantity") + ROUND(("base_price" * "quantity") * 1800 / 10000),
  "total_base_amount" = ("base_price" * "quantity") + ROUND(("base_price" * "quantity") * 1800 / 10000) - "discount_amount",
  "net_pay_to_seller" = "amount_paid_online" - "platform_commission" - "tcs_amount",
  "balance_to_collect" = "amount_to_collect_offline",
  "total_earnings" = ("amount_paid_online" - "platform_commission" - "tcs_amount") + "amount_to_collect_offline"
WHERE "total_base_price" = 0;

-- Note: Old fields (base_price, subtotal_amount, etc) can be removed in future migration

