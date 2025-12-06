-- AlterTable
ALTER TABLE "listings" ALTER COLUMN "operator_id" DROP NOT NULL,
ALTER COLUMN "category_id" DROP NOT NULL,
ALTER COLUMN "sub_cat_id" DROP NOT NULL,
ALTER COLUMN "listing_name" DROP NOT NULL,
ALTER COLUMN "listing_slug" DROP NOT NULL,
ALTER COLUMN "booking_format" DROP NOT NULL;
