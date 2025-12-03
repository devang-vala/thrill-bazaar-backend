import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { prisma } from "./db.js";
import dotenv from "dotenv";
import apiRouter from "./routes/index.js";
import { cors } from "hono/cors"; //

const app = new Hono();

dotenv.config();

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