import { Hono } from "hono";
import authRouter from "./auth.route.js";
import userRouter from "./user.route.js";
import categoryRouter from "./category.route.js";
import subCategoryRouter from "./subCategory.route.js";

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

export default router;
