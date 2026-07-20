import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PRODUCTION_URL,
  parseArgs,
  stripJsonComments,
  localWranglerAssessment,
  buildReport,
  renderReport,
} = require("../../scripts/tools/cloudflare-522-diagnostics.js") as {
  DEFAULT_PRODUCTION_URL: string;
  parseArgs: (argv: string[]) => {
    productionUrl: string;
    workerName: string;
    envName: string;
    executeWrangler: boolean;
    cwd: string;
  };
  stripJsonComments: (source: string) => string;
  localWranglerAssessment: (
    wrangler: unknown,
    args: { productionUrl: string; envName: string },
  ) => {
    routeConfigured: boolean;
    zoneMatches: boolean;
    workersDevDisabled: boolean;
    observabilityEnabled: boolean;
    hyperdriveBinding: string;
    hyperdriveIdResolved: boolean;
  };
  buildReport: (
    args: ReturnType<typeof parseArgs>,
    deps?: { wranglerConfig?: unknown; runner?: unknown },
  ) => {
    ok: boolean;
    wranglerResults: { label: string; ok: boolean }[];
    statusCommand: string[];
    listCommand: string[];
    tailCommand: string[];
  };
  renderReport: (report: unknown) => string;
};

const wranglerConfig = {
  name: "codip",
  env: {
    production: {
      workers_dev: false,
      routes: [{ pattern: "civilopendata.mirai-dx-platform.com/*", zone_name: "mirai-dx-platform.com" }],
      observability: { enabled: true },
      hyperdrive: [{ binding: "HYPERDRIVE", id: "1da7b81807374ec190addf146717d275" }],
    },
  },
};

describe("cloudflare-522-diagnostics", () => {
  it("defaults to checklist mode without external calls", () => {
    const args = parseArgs([]);

    expect(args.productionUrl).toBe(DEFAULT_PRODUCTION_URL);
    expect(args.workerName).toBe("codip");
    expect(args.envName).toBe("production");
    expect(args.executeWrangler).toBe(false);
  });

  it("parses JSONC comments without corrupting URL strings", () => {
    const parsed = JSON.parse(stripJsonComments('{ "url": "https://example.com/a//b", /* x */ "ok": true // y\n }'));

    expect(parsed).toEqual({ url: "https://example.com/a//b", ok: true });
  });

  it("accepts the current production route and Hyperdrive contract", () => {
    const assessment = localWranglerAssessment(wranglerConfig, parseArgs([]));

    expect(assessment.routeConfigured).toBe(true);
    expect(assessment.zoneMatches).toBe(true);
    expect(assessment.workersDevDisabled).toBe(true);
    expect(assessment.observabilityEnabled).toBe(true);
    expect(assessment.hyperdriveBinding).toBe("HYPERDRIVE");
    expect(assessment.hyperdriveIdResolved).toBe(true);
  });

  it("flags unresolved production Hyperdrive placeholders", () => {
    const assessment = localWranglerAssessment(
      {
        env: {
          production: {
            workers_dev: false,
            routes: [{ pattern: "civilopendata.mirai-dx-platform.com/*", zone_name: "mirai-dx-platform.com" }],
            observability: { enabled: true },
            hyperdrive: [{ binding: "HYPERDRIVE", id: "REPLACE_WITH_PRODUCTION_HYPERDRIVE_ID" }],
          },
        },
      },
      parseArgs([]),
    );

    expect(assessment.hyperdriveIdResolved).toBe(false);
  });

  it("renders safe manual evidence commands in checklist mode", () => {
    const report = buildReport(parseArgs([]), { wranglerConfig });
    const text = renderReport(report);

    expect(report.ok).toBe(true);
    expect(text).toContain("External calls: none");
    expect(text).toContain("deployments status");
    expect(text).toContain("deployments list");
    expect(text).toContain("tail codip --env production --status error");
    expect(text).not.toMatch(/CLOUDFLARE_API_TOKEN|password|secret value/i);
  });

  it("executes only read-only deployment commands when explicitly requested", () => {
    const runner = vi.fn(() => ({ status: 0, stdout: '{"ok":true}', stderr: "" }));
    const report = buildReport(parseArgs(["--execute-wrangler"]), { wranglerConfig, runner });

    expect(report.ok).toBe(true);
    expect(report.wranglerResults.map((result) => result.label)).toEqual(["deployments status", "deployments list"]);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0][1]).toContain("deployments");
    expect(runner.mock.calls[0][1]).toContain("status");
    expect(runner.mock.calls[1][1]).toContain("list");
    expect(runner.mock.calls.flat().join(" ")).not.toMatch(/deploy\s|secret|dns|delete|rollback/i);
  });
});
