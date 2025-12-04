-- CreateTable
CREATE TABLE "listing_metadata_field_options" (
    "option_id" TEXT NOT NULL,
    "field_definition_id" TEXT NOT NULL,
    "option_value" TEXT NOT NULL,
    "option_label" TEXT NOT NULL,
    "option_description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_metadata_field_options_pkey" PRIMARY KEY ("option_id")
);

-- CreateIndex
CREATE INDEX "listing_metadata_field_options_field_definition_id_idx" ON "listing_metadata_field_options"("field_definition_id");

-- CreateIndex
CREATE INDEX "listing_metadata_field_options_is_active_idx" ON "listing_metadata_field_options"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "listing_metadata_field_options_field_definition_id_option_v_key" ON "listing_metadata_field_options"("field_definition_id", "option_value");

-- AddForeignKey
ALTER TABLE "listing_metadata_field_options" ADD CONSTRAINT "listing_metadata_field_options_field_definition_id_fkey" FOREIGN KEY ("field_definition_id") REFERENCES "listing_metadata_field_definitions"("field_definition_id") ON DELETE CASCADE ON UPDATE CASCADE;
