/*
  Warnings:

  - You are about to drop the column `is_verified_booking` on the `reviews` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[email,phone]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[operator_slug]` on the table `operator_profiles` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[primaryslug]` on the table `primary_divisions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[secondaryslug]` on the table `secondary_divisions` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PAID', 'PENDING', 'REFUND_PENDING', 'REFUNDED', 'SETTLEMENT_ISSUE', 'ISSUE_RESOLVED');

-- CreateEnum
CREATE TYPE "BadgeType" AS ENUM ('certification', 'performance', 'special');

-- CreateEnum
CREATE TYPE "TagType" AS ENUM ('promotional', 'characteristic', 'tier');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('offer', 'promocode');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('price', 'percentage');

-- CreateEnum
CREATE TYPE "BookingOptionApprovalStatus" AS ENUM ('pending_approval', 'approved', 'rejected');

-- DropIndex
DROP INDEX "public"."User_email_key";

-- DropIndex
DROP INDEX "public"."User_phone_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "alternate_phone" TEXT,
ADD COLUMN     "date_of_birth" TIMESTAMP(3),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "is_password_system_generated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selected_category_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "otp" TEXT,
ADD COLUMN     "otp_verification" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "listing_metadata_field_definitions" ADD COLUMN     "image_url" TEXT;

-- AlterTable
ALTER TABLE "listing_variants" ADD COLUMN     "approval_status" "BookingOptionApprovalStatus" NOT NULL DEFAULT 'pending_approval';

-- AlterTable
ALTER TABLE "operator_profiles" ADD COLUMN     "operator_slug" TEXT;

-- AlterTable
ALTER TABLE "primary_divisions" ADD COLUMN     "primaryslug" TEXT;

-- AlterTable
ALTER TABLE "reviews" DROP COLUMN "is_verified_booking",
ADD COLUMN     "flagged_reason" TEXT,
ADD COLUMN     "is_flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reply_review" TEXT;

-- AlterTable
ALTER TABLE "secondary_divisions" ADD COLUMN     "secondaryslug" TEXT;

-- CreateTable
CREATE TABLE "badges" (
    "badge_id" TEXT NOT NULL,
    "badge_name" TEXT NOT NULL,
    "badge_type" "BadgeType" NOT NULL,
    "badge_icon_url" TEXT,
    "badge_description" TEXT,
    "badge_color" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_admin_id" TEXT,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("badge_id")
);

-- CreateTable
CREATE TABLE "listing_badges" (
    "listing_badge_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "badge_id" TEXT NOT NULL,
    "assigned_by_admin_id" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_badges_pkey" PRIMARY KEY ("listing_badge_id")
);

-- CreateTable
CREATE TABLE "booking_payments" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "total_base_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "tax_rate" INTEGER NOT NULL,
    "subtotal_with_tax" INTEGER NOT NULL,
    "discount_amount" INTEGER NOT NULL,
    "tax_amount" INTEGER NOT NULL,
    "total_base_amount" INTEGER NOT NULL,
    "addons_amount" INTEGER NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "amount_paid_online" INTEGER NOT NULL,
    "amount_to_collect_offline" INTEGER NOT NULL,
    "convenience_fee_rate" INTEGER NOT NULL DEFAULT 0,
    "convenience_fee_amount" INTEGER NOT NULL DEFAULT 0,
    "total_payable_online" INTEGER NOT NULL DEFAULT 0,
    "payment_method" TEXT,
    "platform_commission_rate" INTEGER NOT NULL,
    "platform_commission" INTEGER NOT NULL,
    "tcs_rate" INTEGER NOT NULL,
    "tcs_amount" INTEGER NOT NULL,
    "net_pay_to_seller" INTEGER NOT NULL,
    "balance_to_collect" INTEGER NOT NULL,
    "total_earnings" INTEGER NOT NULL,
    "settlement_status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "settlement_date" TIMESTAMP(3),
    "settlement_mode" TEXT,
    "reason" TEXT,
    "reason_by_admin" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers_promocodes" (
    "offer_promocode_id" TEXT NOT NULL,
    "type" "OfferType" NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" "DiscountType" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "min_order_amount" DECIMAL(10,2),
    "max_discount_limit" DECIMAL(10,2),
    "description" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "apply_to_all_sellers" BOOLEAN NOT NULL DEFAULT false,
    "apply_to_all_categories" BOOLEAN NOT NULL DEFAULT false,
    "apply_to_all_listings" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_promocodes_pkey" PRIMARY KEY ("offer_promocode_id")
);

-- CreateTable
CREATE TABLE "settings" (
    "setting_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "instagram_link" TEXT,
    "facebook_link" TEXT,
    "twitter_link" TEXT,
    "email" TEXT NOT NULL,
    "convenience_fee_percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("setting_id")
);

-- CreateTable
CREATE TABLE "tags" (
    "tag_id" TEXT NOT NULL,
    "tag_name" TEXT NOT NULL,
    "tag_type" "TagType" NOT NULL,
    "tag_color" TEXT,
    "description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_admin_id" TEXT,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("tag_id")
);

-- CreateTable
CREATE TABLE "listing_tags" (
    "listing_tag_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "assigned_by_admin_id" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_tags_pkey" PRIMARY KEY ("listing_tag_id")
);

-- CreateTable
CREATE TABLE "_OfferTargetCategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OfferTargetCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_OfferTargetListings" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OfferTargetListings_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_OfferTargetSellers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OfferTargetSellers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "badges_badge_name_key" ON "badges"("badge_name");

-- CreateIndex
CREATE INDEX "badges_badge_type_idx" ON "badges"("badge_type");

-- CreateIndex
CREATE INDEX "badges_is_active_idx" ON "badges"("is_active");

-- CreateIndex
CREATE INDEX "badges_display_order_idx" ON "badges"("display_order");

-- CreateIndex
CREATE INDEX "listing_badges_listing_id_idx" ON "listing_badges"("listing_id");

-- CreateIndex
CREATE INDEX "listing_badges_badge_id_idx" ON "listing_badges"("badge_id");

-- CreateIndex
CREATE INDEX "listing_badges_is_active_idx" ON "listing_badges"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "listing_badges_listing_id_badge_id_key" ON "listing_badges"("listing_id", "badge_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_payments_booking_id_key" ON "booking_payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "offers_promocodes_code_key" ON "offers_promocodes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tag_name_key" ON "tags"("tag_name");

-- CreateIndex
CREATE INDEX "tags_tag_type_idx" ON "tags"("tag_type");

-- CreateIndex
CREATE INDEX "tags_is_active_idx" ON "tags"("is_active");

-- CreateIndex
CREATE INDEX "tags_display_order_idx" ON "tags"("display_order");

-- CreateIndex
CREATE INDEX "listing_tags_listing_id_idx" ON "listing_tags"("listing_id");

-- CreateIndex
CREATE INDEX "listing_tags_tag_id_idx" ON "listing_tags"("tag_id");

-- CreateIndex
CREATE INDEX "listing_tags_is_active_idx" ON "listing_tags"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "listing_tags_listing_id_tag_id_key" ON "listing_tags"("listing_id", "tag_id");

-- CreateIndex
CREATE INDEX "_OfferTargetCategories_B_index" ON "_OfferTargetCategories"("B");

-- CreateIndex
CREATE INDEX "_OfferTargetListings_B_index" ON "_OfferTargetListings"("B");

-- CreateIndex
CREATE INDEX "_OfferTargetSellers_B_index" ON "_OfferTargetSellers"("B");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_phone_key" ON "User"("email", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "operator_profiles_operator_slug_key" ON "operator_profiles"("operator_slug");

-- CreateIndex
CREATE INDEX "operator_profiles_operator_slug_idx" ON "operator_profiles"("operator_slug");

-- CreateIndex
CREATE UNIQUE INDEX "primary_divisions_primaryslug_key" ON "primary_divisions"("primaryslug");

-- CreateIndex
CREATE INDEX "reviews_is_flagged_idx" ON "reviews"("is_flagged");

-- CreateIndex
CREATE UNIQUE INDEX "secondary_divisions_secondaryslug_key" ON "secondary_divisions"("secondaryslug");

-- AddForeignKey
ALTER TABLE "badges" ADD CONSTRAINT "badges_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_badges" ADD CONSTRAINT "listing_badges_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_badges" ADD CONSTRAINT "listing_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badges"("badge_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_badges" ADD CONSTRAINT "listing_badges_assigned_by_admin_id_fkey" FOREIGN KEY ("assigned_by_admin_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_tags" ADD CONSTRAINT "listing_tags_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_tags" ADD CONSTRAINT "listing_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("tag_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_tags" ADD CONSTRAINT "listing_tags_assigned_by_admin_id_fkey" FOREIGN KEY ("assigned_by_admin_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OfferTargetCategories" ADD CONSTRAINT "_OfferTargetCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "categories"("category_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OfferTargetCategories" ADD CONSTRAINT "_OfferTargetCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "offers_promocodes"("offer_promocode_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OfferTargetListings" ADD CONSTRAINT "_OfferTargetListings_A_fkey" FOREIGN KEY ("A") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OfferTargetListings" ADD CONSTRAINT "_OfferTargetListings_B_fkey" FOREIGN KEY ("B") REFERENCES "offers_promocodes"("offer_promocode_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OfferTargetSellers" ADD CONSTRAINT "_OfferTargetSellers_A_fkey" FOREIGN KEY ("A") REFERENCES "offers_promocodes"("offer_promocode_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OfferTargetSellers" ADD CONSTRAINT "_OfferTargetSellers_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
