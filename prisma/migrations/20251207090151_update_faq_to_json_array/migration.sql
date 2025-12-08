/*
  Warnings:

  - You are about to drop the column `answer` on the `listing_faqs` table. All the data in the column will be lost.
  - You are about to drop the column `display_order` on the `listing_faqs` table. All the data in the column will be lost.
  - You are about to drop the column `is_active` on the `listing_faqs` table. All the data in the column will be lost.
  - You are about to drop the column `question` on the `listing_faqs` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[listing_id]` on the table `listing_faqs` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `faqs` to the `listing_faqs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "listing_faqs" DROP COLUMN "answer",
DROP COLUMN "display_order",
DROP COLUMN "is_active",
DROP COLUMN "question",
ADD COLUMN     "faqs" JSONB NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "listing_faqs_listing_id_key" ON "listing_faqs"("listing_id");
