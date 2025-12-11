-- AlterTable
ALTER TABLE "listing_variants" ADD COLUMN     "variant_description" TEXT,
ADD COLUMN     "variant_metadata" JSONB;
