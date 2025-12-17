import type { Context } from "hono";
import meilisearchService from "../services/meilisearch.service.js";

export const search = async (c: Context) => {
    try {
        const q = c.req.query("q") || "";
        const limit = parseInt(c.req.query("limit") || "20");
        const offset = parseInt(c.req.query("offset") || "0");
        const sort = c.req.query("sort");
        const filter = c.req.query("filter"); // e.g., "status = 'active'"

        const result = await meilisearchService.searchListings(q, {
            limit,
            offset,
            sort: sort ? [sort] : undefined,
            filter: filter,
        });

        return c.json({ success: true, data: result });
    } catch (error) {
        console.error("Search error:", error);
        return c.json({ success: false, message: "Search failed" }, 500);
    }
};
