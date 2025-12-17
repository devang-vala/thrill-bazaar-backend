/*
  Warnings:

  - You are about to drop the column `is_active` on the `listing_variant_metadata_field_definitions` table. All the data in the column will be lost.
  - You are about to drop the column `is_active` on the `listing_variant_metadata_field_options` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."listing_variant_metadata_field_definitions_is_active_idx";

-- DropIndex
DROP INDEX "public"."listing_variant_metadata_field_options_is_active_idx";

-- AlterTable
ALTER TABLE "listing_variant_metadata_field_definitions" DROP COLUMN "is_active";

-- AlterTable
ALTER TABLE "listing_variant_metadata_field_options" DROP COLUMN "is_active";
