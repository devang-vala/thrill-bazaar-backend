-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "contact_details" JSONB,
ADD COLUMN     "participants" JSONB,
ADD COLUMN     "pricing_details" JSONB,
ADD COLUMN     "selected_addons" JSONB;
