import { PrismaClient as SQLitePrismaClient } from "@prisma/client";
import { PrismaClient as PostgreSQLPrismaClient } from "../../node_modules/.prisma/client-postgresql";
import { databaseProviderFromUrl } from "@/lib/database-url";

type AppPrismaClient = SQLitePrismaClient;

const globalForPrisma = globalThis as unknown as {
  prisma?: AppPrismaClient;
  prismaProvider?: string;
};

function createPrismaClient(): AppPrismaClient {
  const provider = databaseProviderFromUrl();
  if (provider === "postgresql") {
    return new PostgreSQLPrismaClient() as unknown as AppPrismaClient;
  }
  return new SQLitePrismaClient();
}

const provider = databaseProviderFromUrl();
export const prisma =
  globalForPrisma.prisma && globalForPrisma.prismaProvider === provider
    ? globalForPrisma.prisma
    : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaProvider = provider;
}
