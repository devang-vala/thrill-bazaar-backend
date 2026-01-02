import { MeiliSearch } from "meilisearch";
import { prisma } from "../db.js";

const MEILISEARCH_URL = process.env.MEILISEARCH_URL || "https://ms-e6d837043f67-36807.sgp.meilisearch.io" || "http://localhost:7700";
const MEILISEARCH_MASTER_KEY = process.env.MEILISEARCH_MASTER_KEY || "2adc8426a5d364691097e000391ae77b2fb1e0de";

const client = new MeiliSearch({
    host: MEILISEARCH_URL,
    apiKey: MEILISEARCH_MASTER_KEY,
});

const LISTINGS_INDEX = "listings";

/**
 * Initialize Meilisearch index and settings
 */
export const initMeilisearch = async () => {
    try {
        // Check if Meilisearch is configured
        if (!MEILISEARCH_URL || !MEILISEARCH_MASTER_KEY) {
            console.warn("⚠️  Meilisearch not configured - search functionality will be disabled");
            return;
        }

        const index = client.index(LISTINGS_INDEX);

        // Test connection first
        try {
            await client.health();
        } catch (healthError) {
            console.warn("⚠️  Meilisearch health check failed - service may be down");
            console.warn("Search functionality will be limited until Meilisearch is available");
            return;
        }

        // Check if index exists, create if not (Meilisearch creates lazily on add documents, but setting settings ensures it)
        await index.updateSettings({
            searchableAttributes: [
                "listingName",
                "listingSlug",
                "startLocationName",
                "endLocationName",
                "categoryName",
                "subCategoryName",
                "startCountryName",
                "endCountryName",
                "contentOverview", // From content.overview
            ],
            filterableAttributes: [
                "id",
                "status",
                "categoryId",
                "subCatId",
                "startCountryId",
                "endCountryId",
                "bookingFormat",
                "basePriceDisplay",
                "rating", // if enabled
            ],
            sortableAttributes: [
                "createdAt",
                "updatedAt",
                "basePriceDisplay",
            ],
            rankingRules: [
                "words",
                "typo",
                "proximity",
                "attribute",
                "sort",
                "exactness",
            ]
        });

        console.log("✅ Meilisearch initialized and settings updated successfully");
    } catch (error) {
        console.warn("⚠️  Failed to initialize Meilisearch settings (might be down or misconfigured)");
        console.warn("Error details:", error instanceof Error ? error.message : error);
        console.warn("Search functionality will continue without Meilisearch");
    }
};

/**
 * Index a single listing by ID
 */
export const indexListing = async (listingId: string) => {
    try {
        const listing = await prisma.listing.findUnique({
            where: { id: listingId },
            include: {
                category: true,
                subCategory: true,
                content: true, // to get overview
                media: {
                    take: 1,
                    orderBy: { createdAt: 'asc' }
                },
                // We might want countries too if we want to search by country name efficiently
                // assuming country/division logic is handled via relations or IDs
            },
        });

        if (!listing) {
            console.warn(`Listing ${listingId} not found for indexing`);
            return;
        }

        // Only index valid listings (active? or maybe index all and filter by status?)
        // Prudent to index all and filter by status in search for flexibility (e.g. admin search)
        // But user requirement says: "listing may get updated, even deleted, or inactived on any time... so consider all these things"
        // If it's deleted, we remove. If inactive, we update the status field and filter in query.

        const overview = listing.content.find(c => c.contentType === 'overview')?.contentText || "";

        const document = {
            id: listing.id,
            listingName: listing.listingName,
            listingSlug: listing.listingSlug,
            status: listing.status,
            categoryId: listing.categoryId,
            categoryName: listing.category?.categoryName || "",
            subCatId: listing.subCatId,
            subCategoryName: listing.subCategory?.subCatName || "",
            startLocationName: listing.startLocationName,
            endLocationName: listing.endLocationName,
            startCountryId: listing.startCountryId,
            endCountryId: listing.endCountryId,
            bookingFormat: listing.bookingFormat,
            basePriceDisplay: Number(listing.basePriceDisplay),
            frontImageUrl: listing.frontImageUrl,
            contentOverview: overview,
            createdAt: listing.createdAt.toISOString(),
            updatedAt: listing.updatedAt.toISOString(),
        };

        const index = client.index(LISTINGS_INDEX);
        await index.addDocuments([document]);
        console.log(`Indexed listing ${listingId}`);

    } catch (error) {
        console.error(`Failed to index listing ${listingId}:`, error);
    }
};

/**
 * Remove a listing from the index
 */
export const removeListing = async (listingId: string) => {
    try {
        const index = client.index(LISTINGS_INDEX);
        await index.deleteDocument(listingId);
        console.log(`Removed listing ${listingId} from index`);
    } catch (error) {
        console.error(`Failed to remove listing ${listingId}:`, error);
    }
};

/**
 * Search listings
 */
export const searchListings = async (query: string, options: any = {}) => {
    try {
        const index = client.index(LISTINGS_INDEX);

        // Default filters
        const filter = options.filter || [];
        // Ensure we default to active listings if not specified? 
        // Or let the controller handle that. 
        // Usually public search only shows active.

        const searchOptions = {
            limit: options.limit || 20,
            offset: options.offset || 0,
            filter: filter,
            sort: options.sort,
            facets: options.facets,
        };

        const result = await index.search(query, searchOptions);
        return result;
    } catch (error) {
        console.error("Search error:", error);
        throw error;
    }
};

export default {
    initMeilisearch,
    indexListing,
    removeListing,
    searchListings,
};
