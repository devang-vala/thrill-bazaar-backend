import "dotenv/config";
import { PrismaClient } from "../prisma/src/generated/prisma/client.js";

const globalForPrisma = globalThis as typeof globalThis & {
	prisma?: PrismaClient;
	prismaConnectPromise?: Promise<void>;
};

const buildPrismaDatasourceUrl = () => {
	const rawUrl = process.env.DATABASE_URL;
	if (!rawUrl) return rawUrl;

	try {
		const url = new URL(rawUrl);
		const isSupabasePooler = url.hostname.includes("pooler.supabase.com");
		if (isSupabasePooler && !url.searchParams.has("connection_limit")) {
			url.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT || "1");
		}
		if (isSupabasePooler && !url.searchParams.has("pool_timeout")) {
			url.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT || "20");
		}
		return url.toString();
	} catch {
		return rawUrl;
	}
};

export const prisma =
	globalForPrisma.prisma ??
	new PrismaClient({
		datasourceUrl: buildPrismaDatasourceUrl(),
	});

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}

const getConnectPromise = (): Promise<void> => {
	if (!globalForPrisma.prismaConnectPromise) {
		globalForPrisma.prismaConnectPromise = prisma.$connect().finally(() => {
			if (globalForPrisma.prismaConnectPromise) {
				globalForPrisma.prismaConnectPromise = undefined;
			}
		});
	}

	return globalForPrisma.prismaConnectPromise;
};

export const ensurePrismaConnected = async (): Promise<void> => {
	await getConnectPromise();
};

const isTransientPrismaConnectionError = (error: unknown): boolean => {
	if (!error || typeof error !== "object") return false;

	const maybeCode = (error as { code?: unknown }).code;
	if (maybeCode === "P1017") return true;

	const maybeMessage = (error as { message?: unknown }).message;
	if (typeof maybeMessage === "string") {
		return (
			maybeMessage.includes("Server has closed the connection") ||
			maybeMessage.includes("Engine is not yet connected")
		);
	}

	return false;
};

export const withPrismaRetry = async <T>(
	operation: () => Promise<T>,
	context = "Prisma operation"
): Promise<T> => {
	try {
		await ensurePrismaConnected();
		return await operation();
	} catch (error) {
		if (!isTransientPrismaConnectionError(error)) {
			throw error;
		}

		console.warn(`[Prisma] ${context} failed with a connection error. Reconnecting and retrying once...`);
		await ensurePrismaConnected();
		return operation();
	}
};
