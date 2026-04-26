-- CreateEnum
CREATE TYPE "BookingReservationStatus" AS ENUM ('PENDING_PAYMENT', 'COMPLETED', 'PAYMENT_FAILED', 'RELEASED', 'EXPIRED');

-- CreateTable
CREATE TABLE "booking_reservations" (
    "reservation_id" TEXT NOT NULL,
    "reservation_reference" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "booking_format" "BookingFormat" NOT NULL,
    "listing_slot_id" TEXT,
    "date_range_id" TEXT,
    "selected_date" TIMESTAMP(3),
    "selected_dates" JSONB,
    "participant_count" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "payment_method" TEXT,
    "inventory_reserved" BOOLEAN NOT NULL DEFAULT false,
    "pricing_details" JSONB NOT NULL,
    "booking_payload" JSONB NOT NULL,
    "status" "BookingReservationStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "razorpay_order_id" TEXT,
    "razorpay_payment_id" TEXT,
    "razorpay_signature" TEXT,
    "booking_id" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_reservations_pkey" PRIMARY KEY ("reservation_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_reservations_reservation_reference_key" ON "booking_reservations"("reservation_reference");

-- CreateIndex
CREATE UNIQUE INDEX "booking_reservations_razorpay_order_id_key" ON "booking_reservations"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_reservations_razorpay_payment_id_key" ON "booking_reservations"("razorpay_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_reservations_booking_id_key" ON "booking_reservations"("booking_id");

-- CreateIndex
CREATE INDEX "booking_reservations_customer_id_status_expires_at_idx" ON "booking_reservations"("customer_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "booking_reservations_listing_slot_id_status_expires_at_idx" ON "booking_reservations"("listing_slot_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "booking_reservations_date_range_id_status_expires_at_idx" ON "booking_reservations"("date_range_id", "status", "expires_at");
