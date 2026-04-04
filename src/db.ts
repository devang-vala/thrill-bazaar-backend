import "dotenv/config";
import { PrismaClient } from "../prisma/src/generated/prisma/client.js";

export const prisma = new PrismaClient();

const isTransientPrismaConnectionError = (error: unknown): boolean => {
	if (!error || typeof error !== "object") return false;

	const maybeCode = (error as { code?: unknown }).code;
	if (maybeCode === "P1017") return true;

	const maybeMessage = (error as { message?: unknown }).message;
	if (typeof maybeMessage === "string") {
		return maybeMessage.includes("Server has closed the connection");
	}

	return false;
};

export const withPrismaRetry = async <T>(
	operation: () => Promise<T>,
	context = "Prisma operation"
): Promise<T> => {
	try {
		return await operation();
	} catch (error) {
		if (!isTransientPrismaConnectionError(error)) {
			throw error;
		}

		console.warn(`[Prisma] ${context} failed with closed connection. Reconnecting and retrying once...`);

		try {
			await prisma.$disconnect();
		} catch {
			// Ignore disconnect failures and try reconnect anyway.
		}

		await prisma.$connect();
		return operation();
	}
};