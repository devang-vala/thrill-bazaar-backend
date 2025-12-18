-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_start_country_id_fkey" FOREIGN KEY ("start_country_id") REFERENCES "countries"("country_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_start_primary_division_id_fkey" FOREIGN KEY ("start_primary_division_id") REFERENCES "primary_divisions"("primary_division_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_start_secondary_division_id_fkey" FOREIGN KEY ("start_secondary_division_id") REFERENCES "secondary_divisions"("secondary_division_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_end_country_id_fkey" FOREIGN KEY ("end_country_id") REFERENCES "countries"("country_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_end_primary_division_id_fkey" FOREIGN KEY ("end_primary_division_id") REFERENCES "primary_divisions"("primary_division_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_end_secondary_division_id_fkey" FOREIGN KEY ("end_secondary_division_id") REFERENCES "secondary_divisions"("secondary_division_id") ON DELETE SET NULL ON UPDATE CASCADE;
