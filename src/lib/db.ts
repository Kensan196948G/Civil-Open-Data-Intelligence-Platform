import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as SQLitePrismaClient } from "@prisma/client";
import { PrismaClient as PostgreSQLPrismaClient } from "../../node_modules/.prisma/client-postgresql";
import { databaseProviderFromUrl, type DatabaseProvider } from "@/lib/database-url";

type AppPrismaClient = SQLitePrismaClient;
type HyperdriveBinding = { connectionString?: string };

const globalForPrisma = globalThis as unknown as {
  prisma?: AppPrismaClient;
  prismaProvider?: string;
  prismaConnectionString?: string;
};

// Cloudflare deployments carry no DATABASE_URL; the Hyperdrive binding is the
// only PostgreSQL source there, keyed off the wrangler env vars.
function isCloudflareDeployTarget(): boolean {
  const target = (process.env.CODIP_DEPLOY_TARGET ?? "").trim();
  return target === "production" || target === "staging";
}

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

function resolveConnection(): { provider: DatabaseProvider; connectionString: string } {
  const envUrl = process.env.DATABASE_URL ?? "";

  if (databaseProviderFromUrl(envUrl) === "postgresql") {
    const hyperdrive = isCloudflareDeployTarget() ? getHyperdriveConnectionString() : null;
    return { provider: "postgresql", connectionString: hyperdrive ?? envUrl };
  }

  if (isCloudflareDeployTarget()) {
    // Workers have no DATABASE_URL, so the scheme check above cannot see
    // PostgreSQL; the Hyperdrive binding decides the provider here.
    const hyperdrive = getHyperdriveConnectionString();
    if (hyperdrive) {
      return { provider: "postgresql", connectionString: hyperdrive };
    }
    throw new Error(
      "[db] no PostgreSQL connection available: Hyperdrive binding is missing and DATABASE_URL is unset",
    );
  }

  return { provider: databaseProviderFromUrl(envUrl), connectionString: envUrl };
}

function createPrismaClient(provider: DatabaseProvider, connectionString: string): AppPrismaClient {
  if (provider === "postgresql") {
    const adapter = new PrismaPg({ connectionString });
    return new PostgreSQLPrismaClient({ adapter }) as unknown as AppPrismaClient;
  }
  return new SQLitePrismaClient();
}

// Resolution is lazy because `getCloudflareContext()` may only be called
// synchronously inside a request on Workers — never at module top level
// (module evaluation also happens during `next build` page-data collection,
// where no Cloudflare context exists at all). The resolved client is cached
// per process / per isolate.
function getPrisma(): AppPrismaClient {
  const { provider, connectionString } = resolveConnection();
  if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaProvider === provider &&
    globalForPrisma.prismaConnectionString === connectionString
  ) {
    return globalForPrisma.prisma;
  }
  const client = createPrismaClient(provider, connectionString);
  globalForPrisma.prisma = client;
  globalForPrisma.prismaProvider = provider;
  globalForPrisma.prismaConnectionString = connectionString;
  return client;
}

export const prisma: AppPrismaClient = new Proxy({} as AppPrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop, client);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
  has(_target, prop) {
    return prop in (getPrisma() as object);
  },
});
