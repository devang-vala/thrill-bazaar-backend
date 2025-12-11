/*
  Warnings:

  - The primary key for the `listing_inclusions_exclusions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `description` on the `listing_inclusions_exclusions` table. All the data in the column will be lost.
  - You are about to drop the column `display_order` on the `listing_inclusions_exclusions` table. All the data in the column will be lost.
  - You are about to drop the column `id` on the `listing_inclusions_exclusions` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `listing_inclusions_exclusions` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[listing_id]` on the table `listing_inclusions_exclusions` will be added. If there are existing duplicate values, this will fail.

*/

-- Step 1: Create temporary table with new structure
CREATE TABLE "listing_inclusions_exclusions_new" (
    "inclusion_exclusion_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "inclusions" TEXT[],
    "exclusions" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_inclusions_exclusions_new_pkey" PRIMARY KEY ("inclusion_exclusion_id")
);

-- Step 2: Migrate data - group by listing_id and aggregate inclusions/exclusions into arrays
INSERT INTO "listing_inclusions_exclusions_new" ("inclusion_exclusion_id", "listing_id", "inclusions", "exclusions", "created_at", "updated_at")
SELECT 
    gen_random_uuid() as "inclusion_exclusion_id",
    "listing_id",
    ARRAY_AGG("description") FILTER (WHERE "type" = 'inclusion') as "inclusions",
    ARRAY_AGG("description") FILTER (WHERE "type" = 'exclusion') as "exclusions",
    MIN("created_at") as "created_at",
    MAX("updated_at") as "updated_at"
FROM "listing_inclusions_exclusions"
GROUP BY "listing_id";

-- Step 3: Drop old table
DROP TABLE "listing_inclusions_exclusions";

-- Step 4: Rename new table
ALTER TABLE "listing_inclusions_exclusions_new" RENAME TO "listing_inclusions_exclusions";

-- Step 5: Add foreign key constraint
ALTER TABLE "listing_inclusions_exclusions" ADD CONSTRAINT "listing_inclusions_exclusions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: Create indexes
CREATE UNIQUE INDEX "listing_inclusions_exclusions_listing_id_key" ON "listing_inclusions_exclusions"("listing_id");
CREATE INDEX "listing_inclusions_exclusions_listing_id_idx" ON "listing_inclusions_exclusions"("listing_id");
