import { describe, expect, it, vi } from "vitest";

import { resolveCloudflareConnectionString } from "../../src/lib/cloudflare-connection";

describe("resolveCloudflareConnectionString", () => {
  it("prefers the Hyperdrive binding connectionString", () => {
    const result = resolveCloudflareConnectionString(
      { HYPERDRIVE: { connectionString: "postgresql://via-hyperdrive/db" }, DATABASE_URL: "postgresql://secret/db" },
      { processEnv: { DATABASE_URL: "postgresql://process/db" } },
    );
    expect(result).toBe("postgresql://via-hyperdrive/db");
  });

  it("honors a custom binding name (CODIP_HYPERDRIVE_BINDING)", () => {
    const result = resolveCloudflareConnectionString(
      { CUSTOM_POOL: { connectionString: "postgresql://custom/db" }, HYPERDRIVE: { connectionString: "postgresql://default/db" } },
      { bindingName: "CUSTOM_POOL" },
    );
    expect(result).toBe("postgresql://custom/db");
  });

  it("falls back to the DATABASE_URL Worker secret when no Hyperdrive binding exists", () => {
    const result = resolveCloudflareConnectionString(
      { DATABASE_URL: "postgresql://secret/db" },
      { processEnv: {} },
    );
    expect(result).toBe("postgresql://secret/db");
  });

  it("falls back to process.env.DATABASE_URL for Node-side tooling", () => {
    const result = resolveCloudflareConnectionString(
      {},
      { processEnv: { DATABASE_URL: "postgresql://process/db" } },
    );
    expect(result).toBe("postgresql://process/db");
  });

  it("returns null and logs when no connection source is available", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = resolveCloudflareConnectionString({}, { processEnv: {} });
      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("no PostgreSQL connection available"));
    } finally {
      errorSpy.mockRestore();
    }
  });
});
