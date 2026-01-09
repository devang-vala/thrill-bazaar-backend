-- CreateEnum
CREATE TYPE "RescheduleRole" AS ENUM ('customer', 'operator', 'admin');

-- CreateEnum
CREATE TYPE "RescheduleStatus" AS ENUM ('pending', 'approved', 'approved_with_charge', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "reschedules" (
    "reschedule_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "initiated_by_user_id" TEXT NOT NULL,
    "initiated_by_role" "RescheduleRole" NOT NULL,
    "operator_id" TEXT NOT NULL,
    "reschedule_reason" TEXT,
    "admin_notes" TEXT,
    "status" "RescheduleStatus" NOT NULL DEFAULT 'pending',
    "reschedule_fee_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_payment_required" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_admin_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "old_batch_id" TEXT,
    "new_batch_id" TEXT,
    "old_rental_start_date" TIMESTAMP(3),
    "old_rental_end_date" TIMESTAMP(3),
    "new_rental_start_date" TIMESTAMP(3),
    "new_rental_end_date" TIMESTAMP(3),
    "old_slot_id" TEXT,
    "new_slot_id" TEXT,
    "old_date_range_id" TEXT,
    "new_date_range_id" TEXT,

    CONSTRAINT "reschedules_pkey" PRIMARY KEY ("reschedule_id")
);

-- CreateIndex
CREATE INDEX "reschedules_booking_id_idx" ON "reschedules"("booking_id");

-- CreateIndex
CREATE INDEX "reschedules_status_idx" ON "reschedules"("status");

-- AddForeignKey
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_approved_by_admin_id_fkey" FOREIGN KEY ("approved_by_admin_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_old_batch_id_fkey" FOREIGN KEY ("old_batch_id") REFERENCES "listing_slots"("slot_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_new_batch_id_fkey" FOREIGN KEY ("new_batch_id") REFERENCES "listing_slots"("slot_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_old_slot_id_fkey" FOREIGN KEY ("old_slot_id") REFERENCES "listing_slots"("slot_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_new_slot_id_fkey" FOREIGN KEY ("new_slot_id") REFERENCES "listing_slots"("slot_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_old_date_range_id_fkey" FOREIGN KEY ("old_date_range_id") REFERENCES "inventory_date_ranges"("range_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_new_date_range_id_fkey" FOREIGN KEY ("new_date_range_id") REFERENCES "inventory_date_ranges"("range_id") ON DELETE SET NULL ON UPDATE CASCADE;
