-- CreateTable
CREATE TABLE "listing_faqs" (
    "faq_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_faqs_pkey" PRIMARY KEY ("faq_id")
);

-- CreateIndex
CREATE INDEX "listing_faqs_listing_id_idx" ON "listing_faqs"("listing_id");

-- AddForeignKey
ALTER TABLE "listing_faqs" ADD CONSTRAINT "listing_faqs_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("listing_id") ON DELETE CASCADE ON UPDATE CASCADE;
