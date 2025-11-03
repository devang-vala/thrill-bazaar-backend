import { defineConfig } from "prisma/config";
import 'dotenv/config';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("Environment variable DATABASE_URL is not set.");
}

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: dbUrl,
  },
});