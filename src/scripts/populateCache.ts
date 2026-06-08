import { prisma } from "../db.js";
import { upsertListingPriceCache } from "../utils/pricingCache.js";

const populateCache = async () => {
  const listings = await prisma.listing.findMany({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  let updatedCount = 0;
  const failures: Array<{ listingId: string; error: string }> = [];

  for (const listing of listings) {
    try {
      await upsertListingPriceCache(listing.id);
      updatedCount += 1;
    } catch (error) {
      failures.push({
        listingId: listing.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  console.log(
    `Price cache population complete. Updated ${updatedCount}/${listings.length} listings.`,
  );

  if (failures.length > 0) {
    console.error("Failed listings:", JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
};

populateCache()
  .catch((error) => {
    console.error("Populate price cache failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
