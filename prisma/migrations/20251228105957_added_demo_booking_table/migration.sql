-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "bookings" (
    "booking_id" TEXT NOT NULL,
    "booking_reference" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "listing_slot_id" TEXT,
    "date_range_id" TEXT,
    "booking_start_date" TIMESTAMP(3) NOT NULL,
    "booking_end_date" TIMESTAMP(3) NOT NULL,
    "participant_count" INTEGER NOT NULL,
    "total_days" INTEGER NOT NULL DEFAULT 1,
    "base_price" DECIMAL(10,2) NOT NULL,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "booking_status" "BookingStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("booking_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_reference_key" ON "bookings"("booking_reference");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listing_slot_id_fkey" FOREIGN KEY ("listing_slot_id") REFERENCES "listing_slots"("slot_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_date_range_id_fkey" FOREIGN KEY ("date_range_id") REFERENCES "inventory_date_ranges"("range_id") ON DELETE RESTRICT ON UPDATE CASCADE;
