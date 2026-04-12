import "dotenv/config";
import { PrismaClient } from "../prisma/src/generated/prisma/client.js";

const globalForPrisma = globalThis as typeof globalThis & {
	prisma?: PrismaClient;
	prismaConnectPromise?: Promise<void>;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

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
