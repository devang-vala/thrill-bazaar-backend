-- AlterTable
ALTER TABLE "inventory_date_ranges" ADD COLUMN     "slot_definition_id" TEXT;

-- AddForeignKey
ALTER TABLE "inventory_date_ranges" ADD CONSTRAINT "inventory_date_ranges_slot_definition_id_fkey" FOREIGN KEY ("slot_definition_id") REFERENCES "slot_definitions"("slot_definition_id") ON DELETE CASCADE ON UPDATE CASCADE;
