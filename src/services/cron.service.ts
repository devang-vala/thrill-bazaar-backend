import { prisma } from "../db.js";

/**
 * Calculates and updates the `fromPrice` for all active listings.
 * This ensures the SEO meta tags and search results display the correct minimum price.
 */
export const syncAllListingPrices = async () => {
  console.log("[CRON] Starting periodic price cache synchronization...");
  try {
    const listings = await prisma.listing.findMany({
      where: { status: { not: "draft" } }, // only calculate for non-draft listings
      select: { id: true, basePriceDisplay: true }
    });

    let updatedCount = 0;
    
    for (const listing of listings) {
      const slots = await prisma.listingSlot.aggregate({
        where: { listingId: listing.id, isActive: true },
        _min: { basePrice: true }
      });
      
      const ranges = await prisma.inventoryDateRange.aggregate({
        where: { listingId: listing.id, isActive: true },
        _min: { basePricePerDay: true }
      });
      
      let fromPrice = null;
      const slotMin = slots._min.basePrice;
      const rangeMin = ranges._min.basePricePerDay;
      
      if (slotMin !== null && rangeMin !== null) {
        fromPrice = Math.min(slotMin, rangeMin);
      } else if (slotMin !== null) {
        fromPrice = slotMin;
      } else if (rangeMin !== null) {
        fromPrice = rangeMin;
      } else {
        // Fallback to basePriceDisplay if no slots or ranges exist
        const bp = Number(listing.basePriceDisplay);
        fromPrice = !isNaN(bp) && bp > 0 ? bp : null;
      }
      
      if (fromPrice !== null) {
        await prisma.listingPriceCache.upsert({
          where: { listingId: listing.id },
          create: {
            listingId: listing.id,
            fromPrice: fromPrice,
          },
          update: {
            fromPrice: fromPrice,
          }
        });
        updatedCount++;
      }
    }
    
    console.log(`[CRON] Price sync complete. Successfully updated ${updatedCount} listings.`);
  } catch (error) {
    console.error("[CRON] Error syncing listing prices:", error);
  }
};
