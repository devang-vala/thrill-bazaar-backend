-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "listing_type_id" TEXT;

-- CreateTable
CREATE TABLE "listing_types" (
    "listing_type_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_types_pkey" PRIMARY KEY ("listing_type_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listing_types_name_key" ON "listing_types"("name");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_listing_type_id_fkey" FOREIGN KEY ("listing_type_id") REFERENCES "listing_types"("listing_type_id") ON DELETE SET NULL ON UPDATE CASCADE;
