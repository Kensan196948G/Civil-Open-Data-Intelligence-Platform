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

  let env: Record<string, unknown>;
  try {
    env = getCloudflareContext().env as Record<string, unknown>;
  } catch (error) {
    console.error(
      `[db] failed to read Cloudflare context while resolving Hyperdrive binding "${bindingName}"; falling back to DATABASE_URL`,
      error,
    );
    return null;
  }

  const binding = env[bindingName] as HyperdriveBinding | undefined;
  if (typeof binding?.connectionString === "string" && binding.connectionString.trim()) {
    return binding.connectionString;
  }

  console.error(
    `[db] Cloudflare Hyperdrive binding "${bindingName}" is missing or has no connectionString; falling back to DATABASE_URL`,
  );
  return null;
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
