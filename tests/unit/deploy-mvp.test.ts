import { describe, expect, it, vi } from "vitest";

// 子プロセスを起こさないことを観測するための差し替え（deploy-production-evidence.test.ts と同様）。
const spawnSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));

import { main, resolveMvpEnv } from "../../scripts/deploy/deploy-mvp.mjs";

function completeEnv(): Record<string, string> {
  return {
    NEON_API_KEY: "neon-key",
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: "account-id",
  };
}

describe("scripts/deploy/deploy-mvp.mjs", () => {
  it("resolves the required operator credentials when all are present", () => {
    const result = resolveMvpEnv(completeEnv());
    expect(result).toEqual({
      neonApiKey: "neon-key",
      cfToken: "cloudflare-token",
      accountId: "account-id",
    });
  });

  it("reports every missing credential at once (fail-closed)", () => {
    expect(() => resolveMvpEnv({})).toThrow(
      /NEON_API_KEY[\s\S]*CLOUDFLARE_API_TOKEN[\s\S]*CLOUDFLARE_ACCOUNT_ID/,
    );
  });

  it("stops main() before any API call or mutation when credentials are missing", async () => {
    const saved = { ...process.env };
    delete process.env.NEON_API_KEY;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    try {
      await expect(main()).rejects.toThrow("missing required env");
      expect(spawnSyncMock).not.toHaveBeenCalled();
    } finally {
      process.env = saved;
    }
  });
});
