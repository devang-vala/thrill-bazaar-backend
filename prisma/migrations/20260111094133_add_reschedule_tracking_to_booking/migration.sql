-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "last_rescheduled_at" TIMESTAMP(3),
ADD COLUMN     "max_reschedules" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reschedule_count" INTEGER NOT NULL DEFAULT 0;
