-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "is_addons_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_booking_option_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_inclusions_exclusions_allowed" BOOLEAN NOT NULL DEFAULT false;
