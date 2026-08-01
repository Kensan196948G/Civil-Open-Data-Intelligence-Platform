import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => {
  const nodeHelpers = { entry: "node" };
  const wasmHelpers = { entry: "wasm" };
  const nodeClients: object[] = [];
  const wasmClients: object[] = [];
  const sqliteClients: object[] = [];

  const getCloudflareContext = vi.fn();
  const PrismaPg = vi.fn(function PrismaPg(config: unknown) {
    return { config };
  });
  const SQLitePrismaClient = vi.fn(function SQLitePrismaClient() {
    const client = { runtime: "sqlite", $queryRaw: vi.fn() };
    sqliteClients.push(client);
    return client;
  });
  const PostgreSQLNodePrismaClient = vi.fn(function PostgreSQLNodePrismaClient(options: unknown) {
    const client = { runtime: "node", options, $queryRaw: vi.fn() };
    nodeClients.push(client);
    return client;
  });
  const PostgreSQLWasmPrismaClient = vi.fn(function PostgreSQLWasmPrismaClient(options: unknown) {
    const client = { runtime: "wasm", options, $queryRaw: vi.fn() };
    wasmClients.push(client);
    return client;
  });

  return {
    getCloudflareContext,
    PrismaPg,
    SQLitePrismaClient,
    PostgreSQLNodePrismaClient,
    PostgreSQLWasmPrismaClient,
    nodeHelpers,
    wasmHelpers,
    nodeClients,
    wasmClients,
    sqliteClients,
  };
});

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: runtimeMocks.getCloudflareContext,
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: runtimeMocks.PrismaPg,
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: runtimeMocks.SQLitePrismaClient,
}));

vi.mock(".prisma/client-postgresql", () => ({
  Prisma: runtimeMocks.nodeHelpers,
  PrismaClient: runtimeMocks.PostgreSQLNodePrismaClient,
}));

vi.mock(".prisma/client-postgresql/wasm", () => ({
  Prisma: runtimeMocks.wasmHelpers,
  PrismaClient: runtimeMocks.PostgreSQLWasmPrismaClient,
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDeployTarget = process.env.CODIP_DEPLOY_TARGET;
const originalHyperdriveBinding = process.env.CODIP_HYPERDRIVE_BINDING;

function resetGlobalPrismaCache() {
  const globalCache = globalThis as unknown as {
    prisma?: unknown;
    prismaProvider?: unknown;
    prismaConnectionString?: unknown;
  };
  delete globalCache.prisma;
  delete globalCache.prismaProvider;
  delete globalCache.prismaConnectionString;
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  runtimeMocks.nodeClients.length = 0;
  runtimeMocks.wasmClients.length = 0;
  runtimeMocks.sqliteClients.length = 0;
  resetGlobalPrismaCache();
  delete process.env.DATABASE_URL;
  delete process.env.CODIP_DEPLOY_TARGET;
  delete process.env.CODIP_HYPERDRIVE_BINDING;
});

afterEach(() => {
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("CODIP_DEPLOY_TARGET", originalDeployTarget);
  restoreEnv("CODIP_HYPERDRIVE_BINDING", originalHyperdriveBinding);
  resetGlobalPrismaCache();
});

describe("database runtime selection", () => {
  it("keeps Cloudflare context and Prisma client resolution lazy at module import", async () => {
    await import("@/lib/db");

    expect(runtimeMocks.getCloudflareContext).not.toHaveBeenCalled();
    expect(runtimeMocks.PrismaPg).not.toHaveBeenCalled();
    expect(runtimeMocks.SQLitePrismaClient).not.toHaveBeenCalled();
    expect(runtimeMocks.PostgreSQLNodePrismaClient).not.toHaveBeenCalled();
    expect(runtimeMocks.PostgreSQLWasmPrismaClient).not.toHaveBeenCalled();
  });

  it("uses one wasm client per production request context with Hyperdrive", async () => {
    process.env.CODIP_DEPLOY_TARGET = "production";
    const requestContext = {};
    runtimeMocks.getCloudflareContext.mockReturnValue({
      env: { HYPERDRIVE: { connectionString: "postgresql://hyperdrive.internal/codip" } },
      ctx: requestContext,
    });
    const { getPostgreSQLPrismaHelpers, prisma } = await import("@/lib/db");

    void prisma.$queryRaw;
    void prisma.$queryRaw;

    expect(runtimeMocks.PrismaPg).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.PrismaPg).toHaveBeenCalledWith({
      connectionString: "postgresql://hyperdrive.internal/codip",
      maxUses: 1,
    });
    expect(runtimeMocks.PostgreSQLWasmPrismaClient).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.PostgreSQLNodePrismaClient).not.toHaveBeenCalled();
    expect(runtimeMocks.SQLitePrismaClient).not.toHaveBeenCalled();
    expect(getPostgreSQLPrismaHelpers()).toBe(runtimeMocks.wasmHelpers);
  });

  it("does not reuse a wasm client across production request contexts", async () => {
    process.env.CODIP_DEPLOY_TARGET = "production";
    const firstContext = {};
    const secondContext = {};
    runtimeMocks.getCloudflareContext
      .mockReturnValueOnce({
        env: { HYPERDRIVE: { connectionString: "postgresql://hyperdrive.internal/codip" } },
        ctx: firstContext,
      })
      .mockReturnValueOnce({
        env: { HYPERDRIVE: { connectionString: "postgresql://hyperdrive.internal/codip" } },
        ctx: secondContext,
      });
    const { prisma } = await import("@/lib/db");

    void prisma.$queryRaw;
    void prisma.$queryRaw;

    expect(runtimeMocks.PrismaPg).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.PostgreSQLWasmPrismaClient).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.wasmClients[0]).not.toBe(runtimeMocks.wasmClients[1]);
  });

  it("fails closed when a production request has neither Hyperdrive nor DATABASE_URL", async () => {
    process.env.CODIP_DEPLOY_TARGET = "production";
    runtimeMocks.getCloudflareContext.mockReturnValue({ env: {}, ctx: {} });
    const { prisma } = await import("@/lib/db");

    expect(() => Reflect.get(prisma, "$queryRaw")).toThrow(
      "no PostgreSQL connection available: Hyperdrive binding is missing and DATABASE_URL is not set",
    );
    expect(runtimeMocks.PrismaPg).not.toHaveBeenCalled();
    expect(runtimeMocks.PostgreSQLWasmPrismaClient).not.toHaveBeenCalled();
    expect(runtimeMocks.SQLitePrismaClient).not.toHaveBeenCalled();
  });

  it("uses the node PostgreSQL client and matching helpers outside Cloudflare", async () => {
    process.env.DATABASE_URL = "postgresql://localhost/codip";
    const { getPostgreSQLPrismaHelpers, prisma } = await import("@/lib/db");

    void prisma.$queryRaw;

    expect(runtimeMocks.getCloudflareContext).not.toHaveBeenCalled();
    expect(runtimeMocks.PrismaPg).toHaveBeenCalledWith({
      connectionString: "postgresql://localhost/codip",
    });
    expect(runtimeMocks.PostgreSQLNodePrismaClient).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.PostgreSQLWasmPrismaClient).not.toHaveBeenCalled();
    expect(runtimeMocks.SQLitePrismaClient).not.toHaveBeenCalled();
    expect(getPostgreSQLPrismaHelpers()).toBe(runtimeMocks.nodeHelpers);
  });
});
