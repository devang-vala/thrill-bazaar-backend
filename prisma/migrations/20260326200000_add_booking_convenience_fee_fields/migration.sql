ALTER TABLE "booking_payments"
ADD COLUMN "convenience_fee_rate" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "convenience_fee_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "total_payable_online" INTEGER NOT NULL DEFAULT 0;
