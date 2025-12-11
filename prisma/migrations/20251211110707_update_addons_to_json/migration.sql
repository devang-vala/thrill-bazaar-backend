/*
  Warnings:

  - You are about to drop the column `addon_description` on the `listing_addons` table. All the data in the column will be lost.
  - You are about to drop the column `addon_name` on the `listing_addons` table. All the data in the column will be lost.
  - You are about to drop the column `display_order` on the `listing_addons` table. All the data in the column will be lost.
  - You are about to drop the column `is_active` on the `listing_addons` table. All the data in the column will be lost.
  - You are about to drop the column `is_mandatory` on the `listing_addons` table. All the data in the column will be lost.
  - You are about to drop the column `max_quantity` on the `listing_addons` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `listing_addons` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[listing_id]` on the table `listing_addons` will be added. If there are existing duplicate values, this will fail.

*/

-- Step 1: Create temporary table with new structure
CREATE TABLE "listing_addons_new" (
    "addon_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "addons" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_addons_new_pkey" PRIMARY KEY ("addon_id")
);

-- Step 2: Migrate data - group by listing_id and aggregate addons into JSON array
INSERT INTO "listing_addons_new" ("addon_id", "listing_id", "addons", "created_at", "updated_at")
SELECT 
    gen_random_uuid() as "addon_id",
    "listing_id",
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'addonName', "addon_name",
                'addonDescription', COALESCE("addon_description", ''),
                'price', "price"::text::numeric,
                'isMandatory', "is_mandatory",
                'maxQuantity', "max_quantity",
                'displayOrder', "display_order",
                'isActive', "is_active"
            )
            ORDER BY "display_order"
        ),
        '[]'::jsonb
    ) as "addons",
    MIN("created_at") as "created_at",
    MAX("updated_at") as "updated_at"
FROM "listing_addons"
GROUP BY "listing_id";

-- Step 3: Drop old table
DROP TABLE "listing_addons";

-- Step 4: Rename new table
ALTER TABLE "listing_addons_new" RENAME TO "listing_addons";

-- Step 5: Add foreign key constraint
ALTER TABLE "listing_addons" ADD CONSTRAINT "listing_addons_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: Create indexes
CREATE UNIQUE INDEX "listing_addons_listing_id_key" ON "listing_addons"("listing_id");
CREATE INDEX "listing_addons_listing_id_idx" ON "listing_addons"("listing_id");
