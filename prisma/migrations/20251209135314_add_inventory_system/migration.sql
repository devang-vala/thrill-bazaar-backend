-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('seller_update', 'customer_book', 'customer_cancel', 'customer_reschedule');

-- CreateTable
CREATE TABLE "listing_slots" (
    "slot_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "primary_contact_phone" TEXT,
    "secondary_contact_phone" TEXT,
    "format_type" "BookingFormat" NOT NULL,
    "batch_start_date" TIMESTAMP(3) NOT NULL,
    "batch_start_time" TIMESTAMP(3),
    "batch_end_date" TIMESTAMP(3) NOT NULL,
    "batch_end_time" TIMESTAMP(3),
    "base_price" INTEGER NOT NULL,
    "total_capacity" INTEGER NOT NULL,
    "available_count" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_slots_pkey" PRIMARY KEY ("slot_id")
);

-- CreateTable
CREATE TABLE "listing_slot_changes" (
    "change_id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "change_date" TIMESTAMP(3) NOT NULL,
    "base_price" INTEGER NOT NULL,
    "available_count" INTEGER NOT NULL,
    "booked_count" INTEGER NOT NULL,
    "trigger_type" "TriggerType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_slot_changes_pkey" PRIMARY KEY ("change_id")
);

-- CreateTable
CREATE TABLE "inventory_date_ranges" (
    "range_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "available_from_date" TIMESTAMP(3) NOT NULL,
    "available_to_date" TIMESTAMP(3) NOT NULL,
    "base_price_per_day" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "primary_contact_phone" TEXT,
    "secondary_contact_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_date_ranges_pkey" PRIMARY KEY ("range_id")
);

-- CreateTable
CREATE TABLE "inventory_blocked_dates" (
    "blocked_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "blocked_date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_by_operator_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_blocked_dates_pkey" PRIMARY KEY ("blocked_id")
);

-- AddForeignKey
ALTER TABLE "listing_slots" ADD CONSTRAINT "listing_slots_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_slots" ADD CONSTRAINT "listing_slots_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "listing_variants"("variant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_slot_changes" ADD CONSTRAINT "listing_slot_changes_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "listing_slots"("slot_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_slot_changes" ADD CONSTRAINT "listing_slot_changes_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_slot_changes" ADD CONSTRAINT "listing_slot_changes_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "listing_variants"("variant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_date_ranges" ADD CONSTRAINT "inventory_date_ranges_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_date_ranges" ADD CONSTRAINT "inventory_date_ranges_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "listing_variants"("variant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_blocked_dates" ADD CONSTRAINT "inventory_blocked_dates_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_blocked_dates" ADD CONSTRAINT "inventory_blocked_dates_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "listing_variants"("variant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_blocked_dates" ADD CONSTRAINT "inventory_blocked_dates_created_by_operator_id_fkey" FOREIGN KEY ("created_by_operator_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;