-- CreateEnum
CREATE TYPE "BookingFormat" AS ENUM ('F1', 'F2', 'F3', 'F4');

-- CreateTable
CREATE TABLE "categories" (
    "category_id" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "category_slug" TEXT NOT NULL,
    "category_icon_url" TEXT,
    "category_description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "booking_format" "BookingFormat" NOT NULL,
    "is_rental" BOOLEAN NOT NULL DEFAULT false,
    "has_variant_catA" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("category_id")
);

-- CreateTable
CREATE TABLE "sub_categories" (
    "sub_cat_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "sub_cat_name" TEXT NOT NULL,
    "sub_cat_slug" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_categories_pkey" PRIMARY KEY ("sub_cat_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_category_slug_key" ON "categories"("category_slug");

-- CreateIndex
CREATE UNIQUE INDEX "sub_categories_sub_cat_slug_key" ON "sub_categories"("sub_cat_slug");

-- AddForeignKey
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("category_id") ON DELETE CASCADE ON UPDATE CASCADE;
