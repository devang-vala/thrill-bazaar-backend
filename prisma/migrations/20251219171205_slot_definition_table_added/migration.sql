/*
  Warnings:

  - You are about to drop the column `batch_end_date` on the `listing_slots` table. All the data in the column will be lost.
  - You are about to drop the column `batch_end_time` on the `listing_slots` table. All the data in the column will be lost.
  - You are about to drop the column `batch_start_date` on the `listing_slots` table. All the data in the column will be lost.
  - You are about to drop the column `batch_start_time` on the `listing_slots` table. All the data in the column will be lost.
  - You are about to drop the column `format_type` on the `listing_slots` table. All the data in the column will be lost.
  - You are about to drop the column `primary_contact_phone` on the `listing_slots` table. All the data in the column will be lost.
  - You are about to drop the column `secondary_contact_phone` on the `listing_slots` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `listing_slots` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "listing_slots" DROP COLUMN "batch_end_date",
DROP COLUMN "batch_end_time",
DROP COLUMN "batch_start_date",
DROP COLUMN "batch_start_time",
DROP COLUMN "format_type",
DROP COLUMN "primary_contact_phone",
DROP COLUMN "secondary_contact_phone",
DROP COLUMN "updated_at",
ADD COLUMN     "end_time" TEXT,
ADD COLUMN     "slot_date" TIMESTAMP(3),
ADD COLUMN     "slot_definition_id" TEXT,
ADD COLUMN     "start_time" TEXT;

-- CreateTable
CREATE TABLE "slot_definitions" (
    "slot_definition_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slot_definitions_pkey" PRIMARY KEY ("slot_definition_id")
);

-- CreateIndex
CREATE INDEX "slot_definitions_listing_id_variant_id_idx" ON "slot_definitions"("listing_id", "variant_id");

-- CreateIndex
CREATE INDEX "listing_slots_listing_id_variant_id_idx" ON "listing_slots"("listing_id", "variant_id");

-- AddForeignKey
ALTER TABLE "listing_slots" ADD CONSTRAINT "listing_slots_slot_definition_id_fkey" FOREIGN KEY ("slot_definition_id") REFERENCES "slot_definitions"("slot_definition_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_definitions" ADD CONSTRAINT "slot_definitions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_definitions" ADD CONSTRAINT "slot_definitions_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "listing_variants"("variant_id") ON DELETE CASCADE ON UPDATE CASCADE;
