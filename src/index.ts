import dotenv from "dotenv";
// Load environment variables FIRST before any other imports
dotenv.config();

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { prisma } from "./db.js";
import apiRouter from "./routes/index.js";
import { cors } from "hono/cors";
import { configureCloudinary, cloudinarySecrets } from "./config/cloudinary.config.js";
import { initMeilisearch } from "./services/meilisearch.service.js";
const cloudinary = configureCloudinary();
console.log("Cloudinary Secrets Loaded:", cloudinarySecrets);

// Initialize Meilisearch
// Initialize Meilisearch (non-blocking)
initMeilisearch().catch(err => {
  console.warn("⚠️  Meilisearch initialization failed - continuing without it");
  console.warn("Error:", err instanceof Error ? err.message : err);
});

const app = new Hono();

app.use('*', cors({
  origin: '*',
}));

//test endpoint
app.get("/", (c) => {
  return c.text("Hello, Thrill Bazaar Dev!");
});

// Mount API routes under /api
app.route("/api", apiRouter);

serve(
  {
    fetch: app.fetch,
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
  },
  (info) => {
    const boundPort = info?.port ?? process.env.PORT ?? 3000;
    console.log(`Server is running on http://localhost:${boundPort}`);
  }
);