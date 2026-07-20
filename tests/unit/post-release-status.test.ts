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
  inspectProbe,
} = require("../../scripts/tools/post-release-status.js") as {
  DEFAULT_PREVIEW_URL: string;
  DEFAULT_PRODUCTION_URL: string;
  parseArgs: (argv: string[]) => {
    productionUrl: string;
    previewUrl: string;
    strictProduction: boolean;
    allowPreviewDown: boolean;
    timeoutMs: number;
    maxResponseMs: number;
  };
  buildReport: (
    args: {
      productionUrl: string;
      previewUrl: string;
      strictProduction: boolean;
      allowPreviewDown: boolean;
      timeoutMs: number;
      maxResponseMs: number;
    },
    deps: {
      resolver?: { resolve4: (host: string) => Promise<string[]>; resolve6: (host: string) => Promise<string[]> };
      fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
    },
  ) => Promise<{
    productionConnected: boolean;
    productionEndpointUnhealthy: boolean;
    previewHealthy: boolean;
    ready: boolean;
    productionDns: { ok: boolean; error: string };
    productionProbes: { path: string; status: number; ok: boolean; state: string }[];
    productionDiagnosis: string[][];
  }>;
  renderReport: (report: unknown) => string;
  fetchWithTimeout: (
    url: string,
    options: { fetcher: (url: string, init?: RequestInit) => Promise<Response>; timeoutMs: number },
  ) => Promise<{ ok: boolean; status: number; state: string; headers: Record<string, string> }>;
  inspectProbe: (
    pathname: string,
    result: { ok: boolean; status: number; state: string; responseTimeMs: number; bodyPreview: string },
    maxResponseMs: number,
  ) => {
    ok: boolean;
    state: string;
    responseTimeOk: boolean;
    readyPayloadOk: boolean;
    databaseState?: string;
    readyState?: string;
  };
};

const baseArgs = {
  productionUrl: DEFAULT_PRODUCTION_URL,
  previewUrl: DEFAULT_PREVIEW_URL,
  strictProduction: false,
  allowPreviewDown: false,
  timeoutMs: 1000,
  maxResponseMs: 5000,
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
    expect(args.maxResponseMs).toBe(5000);
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
    expect(text).toContain("Max response time: 5000ms");
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

  it("probes and flags production endpoint failures even when local DNS resolution is inconclusive", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("civilopendata.mirai-dx-platform.com")) {
        return new Response("522: Connection timed out", {
          status: 522,
          headers: { server: "cloudflare", "cf-ray": "abc-NRT" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    const report = await buildReport(baseArgs, {
      resolver: {
        resolve4: async () => {
          throw Object.assign(new Error("resolver refused"), { code: "ECONNREFUSED" });
        },
        resolve6: async () => {
          throw Object.assign(new Error("resolver refused"), { code: "ECONNREFUSED" });
        },
      },
      fetcher,
    });

    expect(report.productionDns.ok).toBe(false);
    expect(report.productionProbes).toHaveLength(2);
    expect(report.productionProbes[0].status).toBe(522);
    expect(report.productionConnected).toBe(false);
    expect(report.productionEndpointUnhealthy).toBe(true);
    expect(report.ready).toBe(false);
    const text = renderReport(report);
    expect(text).toContain("investigate production route/origin health");
    expect(text).toContain("Production Route Diagnosis");
    expect(text).toContain("Cloudflare edge reached");
    expect(text).toContain("production Worker route is deployed");
    expect(text).not.toContain("abc-NRT");
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
    expect(result.headers.location).toBeUndefined();
  });

  it("records /api/ready database health when the endpoint returns the standard payload", () => {
    const probe = inspectProbe(
      "/api/ready",
      {
        ok: true,
        status: 200,
        state: "200",
        responseTimeMs: 37,
        bodyPreview: JSON.stringify({ status: "ready", checks: { database: "ok" } }),
      },
      5000,
    );

    expect(probe.ok).toBe(true);
    expect(probe.readyState).toBe("ready");
    expect(probe.databaseState).toBe("ok");
    expect(probe.state).toContain("db=ok");
  });

  it("fails /api/ready when the database check is not ok", () => {
    const probe = inspectProbe(
      "/api/ready",
      {
        ok: true,
        status: 200,
        state: "200",
        responseTimeMs: 37,
        bodyPreview: JSON.stringify({ status: "ready", checks: { database: "degraded" } }),
      },
      5000,
    );

    expect(probe.ok).toBe(false);
    expect(probe.readyPayloadOk).toBe(false);
    expect(probe.state).toContain("db=degraded");
  });

  it("marks slow probes as not ready", () => {
    const probe = inspectProbe(
      "/api/health",
      {
        ok: true,
        status: 200,
        state: "200",
        responseTimeMs: 6001,
        bodyPreview: "{}",
      },
      5000,
    );

    expect(probe.ok).toBe(false);
    expect(probe.responseTimeOk).toBe(false);
    expect(probe.state).toContain("slow>5000ms");
  });
});
