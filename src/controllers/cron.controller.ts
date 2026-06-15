import type { Context } from "hono";
import { prisma, withPrismaRetry } from "../db.js";
import { upsertListingPriceCache } from "../utils/pricingCache.js";

type StaleCacheRow = {
  listing_id: string;
};

const startOfUtcDay = (date = new Date()): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const recomputeListingPrices = async (c: Context) => {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authorization = c.req.header("Authorization");

    if (!cronSecret || authorization !== cronSecret) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    const today = startOfUtcDay();
    const staleRows = await withPrismaRetry(
      () =>
        prisma.$queryRaw<StaleCacheRow[]>`
          SELECT "listing_id"
          FROM "listings_price_cache"
          WHERE "valid_until" IS NULL OR "valid_until" <= ${today}
        `,
      "fetch stale listing price cache rows",
    );

    const failures: Array<{ listingId: string; error: string }> = [];
    let updatedCount = 0;

    for (const row of staleRows) {
      try {
        await upsertListingPriceCache(row.listing_id);
        updatedCount += 1;
      } catch (error) {
        failures.push({
          listingId: row.listing_id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return c.json({
      success: failures.length === 0,
      updatedCount,
      failedCount: failures.length,
      failures,
    }, failures.length === 0 ? 200 : 207);
  } catch (error) {
    console.error("Recompute listing prices cron error:", error);
    return c.json({ success: false, error: "Failed to recompute listing prices" }, 500);
  }
};
