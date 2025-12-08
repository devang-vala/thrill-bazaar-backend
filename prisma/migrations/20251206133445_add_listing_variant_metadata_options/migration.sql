-- CreateTable
CREATE TABLE "listing_variant_metadata_field_definitions" (
    "variant_field_definition_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "field_label" TEXT NOT NULL,
    "field_type" "FieldType" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "validation_rules" JSONB,
    "help_text" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "field_group" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_admin_id" TEXT,

    CONSTRAINT "listing_variant_metadata_field_definitions_pkey" PRIMARY KEY ("variant_field_definition_id")
);

-- CreateTable
CREATE TABLE "listing_variant_metadata_field_options" (
    "variant_option_id" TEXT NOT NULL,
    "variant_field_definition_id" TEXT NOT NULL,
    "option_value" TEXT NOT NULL,
    "option_label" TEXT NOT NULL,
    "option_description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_variant_metadata_field_options_pkey" PRIMARY KEY ("variant_option_id")
);

-- CreateIndex
CREATE INDEX "listing_variant_metadata_field_definitions_category_id_idx" ON "listing_variant_metadata_field_definitions"("category_id");

-- CreateIndex
CREATE INDEX "listing_variant_metadata_field_definitions_is_active_idx" ON "listing_variant_metadata_field_definitions"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "listing_variant_metadata_field_definitions_category_id_fiel_key" ON "listing_variant_metadata_field_definitions"("category_id", "field_key");

-- CreateIndex
CREATE INDEX "listing_variant_metadata_field_options_variant_field_defini_idx" ON "listing_variant_metadata_field_options"("variant_field_definition_id");

-- CreateIndex
CREATE INDEX "listing_variant_metadata_field_options_is_active_idx" ON "listing_variant_metadata_field_options"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "listing_variant_metadata_field_options_variant_field_defini_key" ON "listing_variant_metadata_field_options"("variant_field_definition_id", "option_value");

-- AddForeignKey
ALTER TABLE "listing_variant_metadata_field_definitions" ADD CONSTRAINT "listing_variant_metadata_field_definitions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("category_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_variant_metadata_field_definitions" ADD CONSTRAINT "listing_variant_metadata_field_definitions_created_by_admi_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_variant_metadata_field_options" ADD CONSTRAINT "listing_variant_metadata_field_options_variant_field_defin_fkey" FOREIGN KEY ("variant_field_definition_id") REFERENCES "listing_variant_metadata_field_definitions"("variant_field_definition_id") ON DELETE CASCADE ON UPDATE CASCADE;
