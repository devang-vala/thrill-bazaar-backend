import 'dotenv/config'; // Load env vars before anything else
import { prisma } from "../src/db.js";
import { initMeilisearch, indexListing } from "../src/services/meilisearch.service.js";

async function indexAll() {
    try {
        console.log("Initializing Meilisearch...");
        await initMeilisearch();

        console.log("Fetching all listings...");
        const listings = await prisma.listing.findMany({
            select: { id: true, listingName: true }
        });

        console.log(`Found ${listings.length} listings. Starting indexing...`);

        let successCount = 0;
        let failCount = 0;

        for (const listing of listings) {
            try {
                await indexListing(listing.id);
                successCount++;
                process.stdout.write(`\rIndexed: ${successCount}/${listings.length}`);
            } catch (e) {
                console.error(`\nFailed to index ${listing.listingName}:`, e);
                failCount++;
            }
        }

        console.log(`\n\nIndexing complete!`);
        console.log(`Success: ${successCount}`);
        console.log(`Failed: ${failCount}`);

    } catch (error) {
        console.error("Script failed:", error);
    } finally {
        await prisma.$disconnect();
    }
}

// Check for environment variables if run directly with tsx (which might not load .env automatically if not configured)
// But prisma client usually needs it. Assuming user runs with `tsx --env-file=.env` or `dotenv` preloaded if needed,
// OR since we import from src/db.js which loads dotenv? No, src/index.js loads it. 
// Let's load dotenv here to be safe.


indexAll();
