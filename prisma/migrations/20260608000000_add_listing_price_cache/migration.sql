CREATE TABLE "listings_price_cache" (
    "listing_id" TEXT NOT NULL,
    "from_price" INTEGER,
    "valid_until" TIMESTAMP(3),
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listings_price_cache_pkey" PRIMARY KEY ("listing_id")
);

CREATE INDEX "listings_price_cache_valid_until_idx" ON "listings_price_cache"("valid_until");
CREATE INDEX IF NOT EXISTS "listing_slot_changes_date_idx" ON "listing_slot_changes"("date");

ALTER TABLE "listings_price_cache"
ADD CONSTRAINT "listings_price_cache_listing_id_fkey"
FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id")
ON DELETE CASCADE ON UPDATE CASCADE;
