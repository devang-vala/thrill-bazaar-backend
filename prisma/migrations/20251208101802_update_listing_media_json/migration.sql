/*
  Warnings:

  - You are about to drop the column `caption` on the `listing_media` table. All the data in the column will be lost.
  - You are about to drop the column `display_order` on the `listing_media` table. All the data in the column will be lost.
  - You are about to drop the column `is_primary` on the `listing_media` table. All the data in the column will be lost.
  - You are about to drop the column `media_type` on the `listing_media` table. All the data in the column will be lost.
  - You are about to drop the column `media_url` on the `listing_media` table. All the data in the column will be lost.
  - You are about to drop the column `thumbnail_url` on the `listing_media` table. All the data in the column will be lost.
  - Added the required column `media` to the `listing_media` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "listing_media" DROP COLUMN "caption",
DROP COLUMN "display_order",
DROP COLUMN "is_primary",
DROP COLUMN "media_type",
DROP COLUMN "media_url",
DROP COLUMN "thumbnail_url",
ADD COLUMN     "media" JSONB NOT NULL;
