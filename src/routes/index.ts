import { Hono } from "hono";
import authRouter from "./auth.route.js";
import userRouter from "./user.route.js";
import categoryRouter from "./category.route.js";
import subCategoryRouter from "./subCategory.route.js";
import listingRouter from "./listing.route.js";
import listingMediaRouter from "./listingMedia.route.js";
import listingVariantsRouter from "./listingVariants.route.js";
import listingContentRouter from "./listingContent.route.js";
import listingAddonsRouter from "./listingAddons.route.js";
import listingInclusionsExclusionsRouter from "./listingInclusionsExclusions.route.js";
import listingPoliciesRouter from "./listingPolicies.route.js";

const router = new Hono();

// Test endpoint to verify API router is working
router.get("/", (c) => c.text("API root"));

// Mount auth routes
router.route("/auth", authRouter);

// Mount user routes
router.route("/user", userRouter);

// Mount category routes
router.route("/categories", categoryRouter);

// Mount sub-category routes
router.route("/sub-categories", subCategoryRouter);

// Mount listing routes
router.route("/listings", listingRouter);
router.route("/listing-media", listingMediaRouter);
router.route("/listing-variants", listingVariantsRouter);
router.route("/listing-content", listingContentRouter);
router.route("/listing-addons", listingAddonsRouter);
router.route(
  "/listing-inclusions-exclusions",
  listingInclusionsExclusionsRouter
);
router.route("/listing-policies", listingPoliciesRouter);

export default router;
