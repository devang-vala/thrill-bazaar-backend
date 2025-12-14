/*
  Warnings:

  - You are about to drop the `Country` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PrimaryDivision` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SecondaryDivision` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."PrimaryDivision" DROP CONSTRAINT "PrimaryDivision_country_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."SecondaryDivision" DROP CONSTRAINT "SecondaryDivision_primary_division_id_fkey";

-- DropTable
DROP TABLE "public"."Country";

-- DropTable
DROP TABLE "public"."PrimaryDivision";

-- DropTable
DROP TABLE "public"."SecondaryDivision";

-- CreateTable
CREATE TABLE "countries" (
    "country_id" TEXT NOT NULL,
    "country_name" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("country_id")
);

-- CreateTable
CREATE TABLE "primary_divisions" (
    "primary_division_id" TEXT NOT NULL,
    "country_id" TEXT NOT NULL,
    "division_name" TEXT NOT NULL,
    "division_code" TEXT NOT NULL,

    CONSTRAINT "primary_divisions_pkey" PRIMARY KEY ("primary_division_id")
);

-- CreateTable
CREATE TABLE "secondary_divisions" (
    "secondary_division_id" TEXT NOT NULL,
    "primary_division_id" TEXT NOT NULL,
    "division_name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "secondary_divisions_pkey" PRIMARY KEY ("secondary_division_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "countries_country_code_key" ON "countries"("country_code");

-- AddForeignKey
ALTER TABLE "primary_divisions" ADD CONSTRAINT "primary_divisions_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("country_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secondary_divisions" ADD CONSTRAINT "secondary_divisions_primary_division_id_fkey" FOREIGN KEY ("primary_division_id") REFERENCES "primary_divisions"("primary_division_id") ON DELETE RESTRICT ON UPDATE CASCADE;
