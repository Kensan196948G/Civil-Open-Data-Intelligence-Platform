import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PREVIEW_URL,
  DEFAULT_PRODUCTION_URL,
  buildReport,
  parseArgs,
  renderReport,
  fetchWithTimeout,
} = require("../../scripts/tools/post-release-status.js") as {
  DEFAULT_PREVIEW_URL: string;
  DEFAULT_PRODUCTION_URL: string;
  parseArgs: (argv: string[]) => {
    productionUrl: string;
    previewUrl: string;
    strictProduction: boolean;
    allowPreviewDown: boolean;
    timeoutMs: number;
  };
  buildReport: (
    args: {
      productionUrl: string;
      previewUrl: string;
      strictProduction: boolean;
      allowPreviewDown: boolean;
      timeoutMs: number;
    },
    deps: {
      resolver?: { resolve4: (host: string) => Promise<string[]>; resolve6: (host: string) => Promise<string[]> };
      fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
    },
  ) => Promise<{
    productionConnected: boolean;
    previewHealthy: boolean;
    ready: boolean;
    productionDns: { ok: boolean; error: string };
  }>;
  renderReport: (report: unknown) => string;
  fetchWithTimeout: (
    url: string,
    options: { fetcher: (url: string, init?: RequestInit) => Promise<Response>; timeoutMs: number },
  ) => Promise<{ ok: boolean; status: number; state: string }>;
};

const baseArgs = {
  productionUrl: DEFAULT_PRODUCTION_URL,
  previewUrl: DEFAULT_PREVIEW_URL,
  strictProduction: false,
  allowPreviewDown: false,
  timeoutMs: 1000,
};

function okFetcher() {
  return vi.fn(async () => new Response("{}", { status: 200 }));
}

describe("post-release-status", () => {
  it("defaults to the approved production subdomain and shared preview URL", () => {
    const args = parseArgs([]);

    expect(args.productionUrl).toBe("https://civilopendata.mirai-dx-platform.com");
    expect(args.previewUrl).toBe("http://192.168.0.185:3100");
    expect(args.strictProduction).toBe(false);
  });

  it("keeps non-strict monitoring usable while production DNS is not connected", async () => {
    const report = await buildReport(baseArgs, {
      resolver: {
        resolve4: async () => {
          throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
        },
        resolve6: async () => {
          throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
        },
      },
      fetcher: okFetcher(),
    });

    expect(report.productionDns.ok).toBe(false);
    expect(report.productionConnected).toBe(false);
    expect(report.previewHealthy).toBe(true);
    expect(report.ready).toBe(true);

    const text = renderReport(report);
    expect(text).toContain("civilopendata.mirai-dx-platform.com");
    expect(text).toContain("Production connected: no");
    expect(text).toContain("Preview healthy: yes");
    expect(text).not.toMatch(/token|secret|password/i);
  });

  it("fails readiness in strict production mode when DNS is unresolved", async () => {
    const report = await buildReport(
      { ...baseArgs, strictProduction: true },
      {
        resolver: {
          resolve4: async () => {
            throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
          },
          resolve6: async () => {
            throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
          },
        },
        fetcher: okFetcher(),
      },
    );

    expect(report.ready).toBe(false);
    expect(renderReport(report)).toContain("hold production cutover");
  });

  it("marks production connected only when DNS and read-only probes succeed", async () => {
    const report = await buildReport(
      { ...baseArgs, strictProduction: true },
      {
        resolver: {
          resolve4: async () => ["203.0.113.10"],
          resolve6: async () => [],
        },
        fetcher: okFetcher(),
      },
    );

    expect(report.productionConnected).toBe(true);
    expect(report.previewHealthy).toBe(true);
    expect(report.ready).toBe(true);
    expect(renderReport(report)).toContain("Production connected: yes");
  });

  it("does not treat Access or login redirects as a healthy API response", async () => {
    const result = await fetchWithTimeout("https://civilopendata.mirai-dx-platform.com/api/health", {
      fetcher: async () => new Response("", { status: 302, headers: { location: "https://example.com/login" } }),
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
  });
});
