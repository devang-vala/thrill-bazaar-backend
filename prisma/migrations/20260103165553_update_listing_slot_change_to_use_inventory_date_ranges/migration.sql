/*
  Warnings:

  - You are about to drop the column `base_price` on the `listing_slot_changes` table. All the data in the column will be lost.
  - You are about to drop the column `booked_count` on the `listing_slot_changes` table. All the data in the column will be lost.
  - You are about to drop the column `change_date` on the `listing_slot_changes` table. All the data in the column will be lost.
  - You are about to drop the column `slot_id` on the `listing_slot_changes` table. All the data in the column will be lost.
  - Added the required column `date` to the `listing_slot_changes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `price` to the `listing_slot_changes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `total_capacity` to the `listing_slot_changes` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."listing_slot_changes" DROP CONSTRAINT "listing_slot_changes_slot_id_fkey";

-- AlterTable
ALTER TABLE "listing_slot_changes" DROP COLUMN "base_price",
DROP COLUMN "booked_count",
DROP COLUMN "change_date",
DROP COLUMN "slot_id",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "inventory_date_range_id" TEXT,
ADD COLUMN     "price" INTEGER NOT NULL,
ADD COLUMN     "total_capacity" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "listing_slot_changes" ADD CONSTRAINT "listing_slot_changes_inventory_date_range_id_fkey" FOREIGN KEY ("inventory_date_range_id") REFERENCES "inventory_date_ranges"("range_id") ON DELETE CASCADE ON UPDATE CASCADE;
