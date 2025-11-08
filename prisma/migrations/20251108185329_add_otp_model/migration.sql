-- CreateTable
CREATE TABLE "otps" (
    "otp_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "otp_code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verification_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otps_pkey" PRIMARY KEY ("otp_id")
);

-- CreateIndex
CREATE INDEX "otps_phone_number_idx" ON "otps"("phone_number");

-- CreateIndex
CREATE INDEX "otps_phone_number_is_verified_idx" ON "otps"("phone_number", "is_verified");
