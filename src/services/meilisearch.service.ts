import { MeiliSearch } from "meilisearch";
import { prisma } from "../db.js";

let meilisearchAvailable = false;
let client: MeiliSearch | null = null;

const LISTINGS_INDEX = "listings";

/**
 * Lazily initialize the MeiliSearch client (reads env vars at call time,
 * not at module-load time, to avoid ES-module hoisting issues with dotenv).
 */
const getClient = (): MeiliSearch | null => {
    if (client) return client;

    const url = process.env.MEILISEARCH_URL || "";
    const key = process.env.MEILISEARCH_MASTER_KEY || "";

    if (!url || !key) return null;

    client = new MeiliSearch({ host: url, apiKey: key });
    return client;
};

/**
 * Initialize Meilisearch index and settings
 */
export const initMeilisearch = async () => {
    try {
        // Check if Meilisearch is configured
        const meiliClient = getClient();
        if (!meiliClient) {
            console.log("ℹ️  MeiliSearch not configured - search functionality will use database queries");
            return;
        }

        // Test connection first
        try {
            await meiliClient.health();
            console.log("✅ MeiliSearch health check passed");
            meilisearchAvailable = true;
        } catch (healthError) {
            console.log("ℹ️  MeiliSearch service unavailable - falling back to database search");
            meilisearchAvailable = false;
            return;
        }

        // Explicitly create the index if it doesn't exist
        try {
            await meiliClient.createIndex(LISTINGS_INDEX, { primaryKey: 'id' });
            console.log(`✅ Created MeiliSearch index: ${LISTINGS_INDEX}`);
        } catch (createError: any) {
            // Index might already exist, which is fine
            if (createError?.code === 'index_already_exists') {
                console.log(`ℹ️  MeiliSearch index ${LISTINGS_INDEX} already exists`);
            } else {
                console.log("ℹ️  Could not create index:", createError?.message || createError);
            }
        }

        const index = meiliClient.index(LISTINGS_INDEX);

        // Update index settings
        await index.updateSettings({
            searchableAttributes: [
                "listingName",
                "listingSlug",
                "operatorName",
                "categoryName",
                "subCategoryName",
                "startLocationName",
                "endLocationName",
                "startPrimaryDivisionName",
                "startSecondaryDivisionName",
                "endPrimaryDivisionName",
                "endSecondaryDivisionName",
                "startCountryName",
                "endCountryName",
                "contentOverview",
            ],
            filterableAttributes: [
                "id",
                "status",
                "categoryId",
                "subCatId",
                "operatorId",
                "startCountryId",
                "endCountryId",
                "startPrimaryDivisionId",
                "startSecondaryDivisionId",
                "endPrimaryDivisionId",
                "endSecondaryDivisionId",
                "bookingFormat",
                "basePriceDisplay",
                "rating",
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

        console.log("✅ MeiliSearch initialized and settings updated successfully");
    } catch (error) {
        console.log("ℹ️  MeiliSearch initialization skipped - using database search");
        meilisearchAvailable = false;
    }
};

/**
 * Index a single listing by ID
 */
export const indexListing = async (listingId: string) => {
    try {
        // Check if Meilisearch is available
        if (!meilisearchAvailable || !getClient()) {
            return; // Silently skip if MeiliSearch is not available
        }

        const listing = await prisma.listing.findUnique({
            where: { id: listingId },
            include: {
                category: true,
                subCategory: true,
                operator: { select: { firstName: true, lastName: true } },
                startPrimaryDivision: true,
                startSecondaryDivision: true,
                endPrimaryDivision: true,
                endSecondaryDivision: true,
                startCountry: true,
                endCountry: true,
                content: true,
                media: {
                    take: 1,
                    orderBy: { createdAt: 'asc' }
                },
            },
        });

        if (!listing) {
            return;
        }

        const overview = listing.content.find(c => c.contentType === 'overview')?.contentText || "";
        const operatorName = [listing.operator?.firstName, listing.operator?.lastName].filter(Boolean).join(" ") || "";

        const document = {
            id: listing.id,
            listingName: listing.listingName,
            listingSlug: listing.listingSlug,
            status: listing.status,
            operatorId: listing.operatorId,
            operatorName,
            categoryId: listing.categoryId,
            categoryName: listing.category?.categoryName || "",
            subCatId: listing.subCatId,
            subCategoryName: listing.subCategory?.subCatName || "",
            startLocationName: listing.startLocationName,
            endLocationName: listing.endLocationName,
            startPrimaryDivisionId: listing.startPrimaryDivisionId,
            startPrimaryDivisionName: listing.startPrimaryDivision?.division_name || "",
            startSecondaryDivisionId: listing.startSecondaryDivisionId,
            startSecondaryDivisionName: listing.startSecondaryDivision?.division_name || "",
            endPrimaryDivisionId: listing.endPrimaryDivisionId,
            endPrimaryDivisionName: listing.endPrimaryDivision?.division_name || "",
            endSecondaryDivisionId: listing.endSecondaryDivisionId,
            endSecondaryDivisionName: listing.endSecondaryDivision?.division_name || "",
            startCountryId: listing.startCountryId,
            startCountryName: listing.startCountry?.country_name || "",
            endCountryId: listing.endCountryId,
            endCountryName: listing.endCountry?.country_name || "",
            bookingFormat: listing.bookingFormat,
            basePriceDisplay: Number(listing.basePriceDisplay),
            frontImageUrl: listing.frontImageUrl,
            contentOverview: overview,
            createdAt: listing.createdAt.toISOString(),
            updatedAt: listing.updatedAt.toISOString(),
        };

        const index = getClient()!.index(LISTINGS_INDEX);
        
        // Check if index exists, if not try to create it
        try {
            await index.getStats();
        } catch (statsError: any) {
            if (statsError?.code === 'index_not_found') {
                await getClient()!.createIndex(LISTINGS_INDEX, { primaryKey: 'id' });
            } else {
                throw statsError;
            }
        }
        
        await index.addDocuments([document]);

    } catch (error: any) {
        // Silently fail - don't spam console with errors
        // Only log if it's a critical error
        if (error?.response?.status !== 404) {
            console.log(`Note: Could not index listing ${listingId} in MeiliSearch`);
        }
    }
};

/**
 * Remove a listing from the index
 */
export const removeListing = async (listingId: string) => {
    try {
        if (!meilisearchAvailable || !getClient()) {
            return; // Silently skip if MeiliSearch is not available
        }
        
        const index = getClient()!.index(LISTINGS_INDEX);
        await index.deleteDocument(listingId);
    } catch (error) {
        // Silently fail
    }
};

/**
 * Search listings
 */
export const searchListings = async (query: string, options: any = {}) => {
    try {
        if (!meilisearchAvailable || !getClient()) {
            throw new Error("MeiliSearch not available");
        }
        
        const index = getClient()!.index(LISTINGS_INDEX);

        // Default filters
        const filter = options.filter || [];

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
        throw error;
    }
};

export default {
    initMeilisearch,
    indexListing,
    removeListing,
    searchListings,
};
