import { Hono } from "hono";

const router = new Hono();

router.get("/", (c) => c.text("API root"));

export default router;
