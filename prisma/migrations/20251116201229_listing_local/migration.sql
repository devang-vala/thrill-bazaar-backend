-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('draft', 'pending_approval', 'active', 'rejected', 'archived');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('overview', 'day_itinerary', 'pickup_dropoff', 'difficulty', 'fitness', 'things_to_carry', 'faq', 'why_choose_us', 'safety_commitment', 'how_to_reach');

-- CreateEnum
CREATE TYPE "InclusionType" AS ENUM ('inclusion', 'exclusion');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('image', 'video');

-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('cancellation', 'rescheduling', 'exchange', 'terms_conditions', 'why_choose_us');

-- CreateTable
CREATE TABLE "listing_addons" (
    "addon_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "addon_name" TEXT NOT NULL,
    "addon_description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "max_quantity" INTEGER,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_addons_pkey" PRIMARY KEY ("addon_id")
);

-- CreateTable
CREATE TABLE "listing_content" (
    "content_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "content_type" "ContentType" NOT NULL,
    "content_order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "content_text" TEXT,
    "image_urls" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_content_pkey" PRIMARY KEY ("content_id")
);

-- CreateTable
CREATE TABLE "listing_inclusions_exclusions" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "type" "InclusionType" NOT NULL,
    "description" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_inclusions_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_media" (
    "media_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "content_id" TEXT,
    "media_type" "MediaType" NOT NULL,
    "media_url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_media_pkey" PRIMARY KEY ("media_id")
);

-- CreateTable
CREATE TABLE "listing_policies" (
    "policy_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "policy_type" "PolicyType" NOT NULL,
    "policy_content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_policies_pkey" PRIMARY KEY ("policy_id")
);

-- CreateTable
CREATE TABLE "listing_variants" (
    "variant_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "variant_name" TEXT NOT NULL,
    "variant_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_variants_pkey" PRIMARY KEY ("variant_id")
);

-- CreateTable
CREATE TABLE "listings" (
    "listing_id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "sub_cat_id" TEXT NOT NULL,
    "listing_name" TEXT NOT NULL,
    "listing_slug" TEXT NOT NULL,
    "tba_id" TEXT,
    "front_image_url" TEXT,
    "booking_format" "BookingFormat" NOT NULL,
    "has_multiple_options" BOOLEAN NOT NULL DEFAULT false,
    "status" "ListingStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "approved_by_admin_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "start_country_id" TEXT,
    "start_primary_division_id" TEXT,
    "start_secondary_division_id" TEXT,
    "end_country_id" TEXT,
    "end_primary_division_id" TEXT,
    "end_secondary_division_id" TEXT,
    "start_location_name" TEXT,
    "start_location_coordinates" TEXT,
    "start_google_maps_url" TEXT,
    "end_location_name" TEXT,
    "end_location_coordinates" TEXT,
    "end_google_maps_url" TEXT,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "advance_booking_percentage" DECIMAL(5,2) NOT NULL DEFAULT 25.00,
    "base_price_display" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "currency" TEXT NOT NULL DEFAULT 'INR',

    CONSTRAINT "listings_pkey" PRIMARY KEY ("listing_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listings_listing_slug_key" ON "listings"("listing_slug");

-- AddForeignKey
ALTER TABLE "listing_addons" ADD CONSTRAINT "listing_addons_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_content" ADD CONSTRAINT "listing_content_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_inclusions_exclusions" ADD CONSTRAINT "listing_inclusions_exclusions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "listing_content"("content_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_policies" ADD CONSTRAINT "listing_policies_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_variants" ADD CONSTRAINT "listing_variants_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("category_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_sub_cat_id_fkey" FOREIGN KEY ("sub_cat_id") REFERENCES "sub_categories"("sub_cat_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_approved_by_admin_id_fkey" FOREIGN KEY ("approved_by_admin_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
