import { Hono } from "hono";
import { recomputeListingPrices } from "../controllers/cron.controller.js";

const cronRouter = new Hono();

cronRouter.get("/recompute-prices", recomputeListingPrices);

export default cronRouter;
