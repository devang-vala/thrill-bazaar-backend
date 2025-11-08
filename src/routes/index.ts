import { Hono } from "hono";
import authRouter from "./auth.route.js";

const router = new Hono();

router.get("/", (c) => c.text("API root"));

// Mount auth routes
router.route("/auth", authRouter);

export default router;
