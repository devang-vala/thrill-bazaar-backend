CREATE TABLE "wishlist_items" (
    "wishlist_item_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("wishlist_item_id")
);

CREATE UNIQUE INDEX "wishlist_items_user_id_listing_id_key" ON "wishlist_items"("user_id", "listing_id");
CREATE INDEX "wishlist_items_user_id_created_at_idx" ON "wishlist_items"("user_id", "created_at");
CREATE INDEX "wishlist_items_listing_id_idx" ON "wishlist_items"("listing_id");

ALTER TABLE "wishlist_items"
ADD CONSTRAINT "wishlist_items_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wishlist_items"
ADD CONSTRAINT "wishlist_items_listing_id_fkey"
FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;
