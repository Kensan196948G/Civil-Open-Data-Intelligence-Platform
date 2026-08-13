import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as SQLitePrismaClient } from "@prisma/client";
// `.prisma/client-postgresql` resolves through the legacy node_modules path
// (the `.prisma` directory has no package.json, so the generated client's
// `exports` conditions never apply). That legacy resolution always lands on
// the Node entry (native query engine), which cannot run on Workers — so both
// engine entries are imported statically and the right one is picked at
// runtime. The wasm entry lazy-loads its engine, so merely importing it is
// side-effect-free on Node.
import {
  Prisma as PostgreSQLNodePrisma,
  PrismaClient as PostgreSQLNodePrismaClient,
} from ".prisma/client-postgresql";
import {
  Prisma as PostgreSQLWasmPrisma,
  PrismaClient as PostgreSQLWasmPrismaClient,
} from ".prisma/client-postgresql/wasm";
import { databaseProviderFromUrl, type DatabaseProvider } from "@/lib/database-url";
import { resolveCloudflareConnectionString } from "@/lib/cloudflare-connection";

type AppPrismaClient = SQLitePrismaClient;

const globalForPrisma = globalThis as unknown as {
  prisma?: AppPrismaClient;
  prismaProvider?: string;
  prismaConnectionString?: string;
};

// Workers may not share one sock — a pg connection created in one request
// cannot perform I/O for another, so clients are cached per request context.
const perRequestClients = new WeakMap<object, AppPrismaClient>();

// Cloudflare deployments resolve the PostgreSQL source from the request env:
// the Hyperdrive binding (production) or the DATABASE_URL Worker secret
// (MVP/staging direct TCP). Keyed off the wrangler env vars.
function isCloudflareDeployTarget(): boolean {
  const target = (process.env.CODIP_DEPLOY_TARGET ?? "").trim();
  return target === "production" || target === "staging";
}

function getCloudflareRequestContext(): { env: Record<string, unknown>; ctx: object } | null {
  try {
    const context = getCloudflareContext();
    return { env: context.env as Record<string, unknown>, ctx: context.ctx as object };
  } catch {
    return null;
  }
}

function getCloudflareConnectionString(env: Record<string, unknown>): string | null {
  return resolveCloudflareConnectionString(env, {
    bindingName: process.env.CODIP_HYPERDRIVE_BINDING,
    processEnv: process.env,
  });
}

function resolveNodeConnection(): { provider: DatabaseProvider; connectionString: string } {
  const envUrl = process.env.DATABASE_URL ?? "";
  return { provider: databaseProviderFromUrl(envUrl), connectionString: envUrl };
}

function createNodePrismaClient(provider: DatabaseProvider, connectionString: string): AppPrismaClient {
  if (provider === "postgresql") {
    const adapter = new PrismaPg({ connectionString });
    return new PostgreSQLNodePrismaClient({ adapter }) as unknown as AppPrismaClient;
  }
  return new SQLitePrismaClient();
}

function createWorkersPrismaClient(connectionString: string): AppPrismaClient {
  // maxUses: 1 — a pooled pg connection must not be reused across requests on
  // Workers. Hyperdrive (production) or the Neon pooled endpoint (MVP) does the
  // real pooling at the edge, so this is cheap.
  const adapter = new PrismaPg({ connectionString, maxUses: 1 });
  return new PostgreSQLWasmPrismaClient({ adapter }) as unknown as AppPrismaClient;
}

// Resolution is lazy because `getCloudflareContext()` may only be called
// synchronously inside a request on Workers — never at module top level
// (module evaluation also happens during `next build` page-data collection,
// where no Cloudflare context exists at all).
function getPrisma(): AppPrismaClient {
  if (isCloudflareDeployTarget()) {
    const context = getCloudflareRequestContext();
    if (context) {
      const cached = perRequestClients.get(context.ctx);
      if (cached) {
        return cached;
      }
      const connectionString = getCloudflareConnectionString(context.env);
      if (!connectionString) {
        throw new Error(
          "[db] no PostgreSQL connection available: Hyperdrive binding and DATABASE_URL (Worker secret / process.env) are both unavailable",
        );
      }
      const client = createWorkersPrismaClient(connectionString);
      perRequestClients.set(context.ctx, client);
      return client;
    }
    // No request context (e.g. Node-side tooling running with the deploy-target
    // env vars set): fall through to the Node resolution below — but only when
    // a real DATABASE_URL exists. Otherwise a missing context on Workers would
    // silently degrade into an empty SQLite client.
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "[db] Cloudflare deploy target detected but no request context and no DATABASE_URL fallback available",
      );
    }
  }

  const { provider, connectionString } = resolveNodeConnection();
  if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaProvider === provider &&
    globalForPrisma.prismaConnectionString === connectionString
  ) {
    return globalForPrisma.prisma;
  }
  const client = createNodePrismaClient(provider, connectionString);
  globalForPrisma.prisma = client;
  globalForPrisma.prismaProvider = provider;
  globalForPrisma.prismaConnectionString = connectionString;
  return client;
}

// Sql helper objects (Prisma.sql / join / empty) fail `instanceof` checks when
// they cross entry copies — a wasm-entry Sql handed to the node-entry client
// (or vice versa) is silently treated as a plain parameter and the query
// breaks. Raw-SQL call sites must therefore take the helper namespace from the
// same entry family as the active client, via this selector.
export function getPostgreSQLPrismaHelpers(): typeof PostgreSQLNodePrisma {
  if (isCloudflareDeployTarget() && getCloudflareRequestContext() !== null) {
    return PostgreSQLWasmPrisma as unknown as typeof PostgreSQLNodePrisma;
  }
  return PostgreSQLNodePrisma;
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
