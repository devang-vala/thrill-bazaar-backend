ALTER TABLE "listings"
ADD COLUMN "platform_commission_percentage" DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
ADD COLUMN "tcs_percentage" DECIMAL(5, 2) NOT NULL DEFAULT 0.00;
