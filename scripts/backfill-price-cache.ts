import { prisma } from "../src/db.js";

async function main() {
  console.log("Starting backfill for listingPriceCache...");
  const listings = await prisma.listing.findMany({
    select: { id: true, basePriceDisplay: true }
  });
  
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
      console.log(`Updated cache for listing ${listing.id}: ₹${fromPrice}`);
    } else {
      console.log(`Skipped listing ${listing.id} (No valid price found)`);
    }
  }
  
  console.log("Backfill complete!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
