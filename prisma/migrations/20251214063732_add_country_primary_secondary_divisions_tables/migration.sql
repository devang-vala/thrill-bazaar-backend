-- CreateTable
CREATE TABLE "Country" (
    "country_id" SERIAL NOT NULL,
    "country_name" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("country_id")
);

-- CreateTable
CREATE TABLE "PrimaryDivision" (
    "primary_division_id" SERIAL NOT NULL,
    "country_id" INTEGER NOT NULL,
    "division_name" TEXT NOT NULL,
    "division_code" TEXT NOT NULL,

    CONSTRAINT "PrimaryDivision_pkey" PRIMARY KEY ("primary_division_id")
);

-- CreateTable
CREATE TABLE "SecondaryDivision" (
    "secondary_division_id" SERIAL NOT NULL,
    "primary_division_id" INTEGER NOT NULL,
    "division_name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "SecondaryDivision_pkey" PRIMARY KEY ("secondary_division_id")
);

-- AddForeignKey
ALTER TABLE "PrimaryDivision" ADD CONSTRAINT "PrimaryDivision_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "Country"("country_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondaryDivision" ADD CONSTRAINT "SecondaryDivision_primary_division_id_fkey" FOREIGN KEY ("primary_division_id") REFERENCES "PrimaryDivision"("primary_division_id") ON DELETE RESTRICT ON UPDATE CASCADE;
