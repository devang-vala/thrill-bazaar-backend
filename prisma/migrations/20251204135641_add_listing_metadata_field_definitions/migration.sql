-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('text', 'textarea', 'number', 'select', 'multiselect', 'boolean', 'date', 'time', 'datetime', 'json_array');

-- CreateTable
CREATE TABLE "listing_metadata_field_definitions" (
    "field_definition_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "is_it_a_filter" BOOLEAN NOT NULL DEFAULT false,
    "field_key" TEXT NOT NULL,
    "field_label" TEXT NOT NULL,
    "field_type" "FieldType" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "validation_rules" JSONB,
    "default_value" TEXT,
    "help_text" TEXT,
    "placeholder_text" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "field_group" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_admin_id" TEXT,

    CONSTRAINT "listing_metadata_field_definitions_pkey" PRIMARY KEY ("field_definition_id")
);

-- CreateIndex
CREATE INDEX "listing_metadata_field_definitions_category_id_idx" ON "listing_metadata_field_definitions"("category_id");

-- CreateIndex
CREATE INDEX "listing_metadata_field_definitions_is_active_idx" ON "listing_metadata_field_definitions"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "listing_metadata_field_definitions_category_id_field_key_key" ON "listing_metadata_field_definitions"("category_id", "field_key");

-- AddForeignKey
ALTER TABLE "listing_metadata_field_definitions" ADD CONSTRAINT "listing_metadata_field_definitions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("category_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_metadata_field_definitions" ADD CONSTRAINT "listing_metadata_field_definitions_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
