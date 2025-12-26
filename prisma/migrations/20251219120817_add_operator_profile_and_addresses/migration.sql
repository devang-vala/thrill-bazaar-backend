-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('HOME', 'BILLING', 'SHIPPING', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "operator_profiles" (
    "operator_profile_id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "company_logo_url" TEXT,
    "business_registration_number" TEXT,
    "tax_id" TEXT,
    "company_description" TEXT,
    "website_url" TEXT,
    "social_media_links" JSONB,
    "bank_account_details" JSONB,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verification_documents" JSONB,
    "verified_by_admin_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "rating_average" DOUBLE PRECISION DEFAULT 0,
    "total_bookings" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operator_profiles_pkey" PRIMARY KEY ("operator_profile_id")
);

-- CreateTable
CREATE TABLE "user_addresses" (
    "address_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "address_type" "AddressType" NOT NULL DEFAULT 'OTHER',
    "full_address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_addresses_pkey" PRIMARY KEY ("address_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operator_profiles_operator_id_key" ON "operator_profiles"("operator_id");

-- CreateIndex
CREATE INDEX "operator_profiles_operator_id_idx" ON "operator_profiles"("operator_id");

-- CreateIndex
CREATE INDEX "operator_profiles_verification_status_idx" ON "operator_profiles"("verification_status");

-- CreateIndex
CREATE INDEX "operator_profiles_verified_by_admin_id_idx" ON "operator_profiles"("verified_by_admin_id");

-- CreateIndex
CREATE INDEX "user_addresses_user_id_idx" ON "user_addresses"("user_id");

-- AddForeignKey
ALTER TABLE "operator_profiles" ADD CONSTRAINT "operator_profiles_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_profiles" ADD CONSTRAINT "operator_profiles_verified_by_admin_id_fkey" FOREIGN KEY ("verified_by_admin_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
