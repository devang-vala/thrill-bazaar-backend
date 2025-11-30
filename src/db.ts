import { PrismaClient } from "../prisma/src/generated/prisma/client.js";

export const prisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL
})