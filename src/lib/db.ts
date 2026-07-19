import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as SQLitePrismaClient } from "@prisma/client";
import { PrismaClient as PostgreSQLPrismaClient } from "../../node_modules/.prisma/client-postgresql";
import { databaseProviderFromUrl } from "@/lib/database-url";

type AppPrismaClient = SQLitePrismaClient;
type HyperdriveBinding = { connectionString?: string };

const globalForPrisma = globalThis as unknown as {
  prisma?: AppPrismaClient;
  prismaProvider?: string;
  prismaConnectionString?: string;
};

function getHyperdriveConnectionString(): string | null {
  const bindingName = (process.env.CODIP_HYPERDRIVE_BINDING ?? "HYPERDRIVE").trim() || "HYPERDRIVE";

  try {
    const env = getCloudflareContext().env as Record<string, unknown>;
    const binding = env[bindingName] as HyperdriveBinding | undefined;
    return typeof binding?.connectionString === "string" && binding.connectionString.trim()
      ? binding.connectionString
      : null;
  } catch {
    return null;
  }
}

function getPostgreSqlConnectionString(): string {
  return getHyperdriveConnectionString() ?? process.env.DATABASE_URL ?? "";
}

function createPrismaClient(connectionString: string): AppPrismaClient {
  const provider = databaseProviderFromUrl();
  if (provider === "postgresql") {
    const adapter = new PrismaPg({ connectionString });
    return new PostgreSQLPrismaClient({ adapter }) as unknown as AppPrismaClient;
  }
  return new SQLitePrismaClient();
}

const provider = databaseProviderFromUrl();
const connectionString = provider === "postgresql" ? getPostgreSqlConnectionString() : process.env.DATABASE_URL ?? "";
export const prisma =
  globalForPrisma.prisma &&
  globalForPrisma.prismaProvider === provider &&
  globalForPrisma.prismaConnectionString === connectionString
    ? globalForPrisma.prisma
    : createPrismaClient(connectionString);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaProvider = provider;
  globalForPrisma.prismaConnectionString = connectionString;
}
