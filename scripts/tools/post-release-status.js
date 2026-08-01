#!/usr/bin/env node

const dns = require("node:dns/promises");

const DEFAULT_PRODUCTION_URL = "https://odip.mirai-dx-platform.com";
const DEFAULT_PREVIEW_URL = "http://192.168.0.185:3100";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_MS = 5_000;

const PREVIEW_PATHS = ["/", "/api/health", "/api/ready", "/api/openapi"];
const PRODUCTION_PATHS = ["/api/health", "/api/ready"];

function parseArgs(argv) {
  const args = {
    productionUrl: process.env.CODIP_PRODUCTION_URL || DEFAULT_PRODUCTION_URL,
    previewUrl: process.env.CODIP_PREVIEW_URL || DEFAULT_PREVIEW_URL,
    strictProduction: false,
    allowPreviewDown: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxResponseMs: Number.parseInt(process.env.CODIP_MAX_RESPONSE_MS || "", 10) || DEFAULT_MAX_RESPONSE_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--production-url") {
      args.productionUrl = argv[++index] ?? "";
    } else if (arg === "--preview-url") {
      args.previewUrl = argv[++index] ?? "";
    } else if (arg === "--strict-production") {
      args.strictProduction = true;
    } else if (arg === "--allow-preview-down") {
      args.allowPreviewDown = true;
    } else if (arg === "--timeout-ms") {
      const value = Number.parseInt(argv[++index] ?? "", 10);
      if (Number.isFinite(value) && value > 0) args.timeoutMs = value;
    } else if (arg === "--max-response-ms") {
      const value = Number.parseInt(argv[++index] ?? "", 10);
      if (Number.isFinite(value) && value > 0) args.maxResponseMs = value;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/tools/post-release-status.js [options]",
    "",
    "Options:",
    "  --production-url <url>    Production URL to check. Defaults to odip.mirai-dx-platform.com.",
    "  --preview-url <url>       Shared preview URL to check. Defaults to http://192.168.0.185:3100.",
    "  --strict-production       Fail when production DNS or read-only health probes are not ready.",
    "  --allow-preview-down      Do not fail the command when the shared preview is unavailable.",
    "  --timeout-ms <ms>         Per-request timeout. Default: 10000.",
    "  --max-response-ms <ms>    Mark probes slower than this as not ready. Default: 5000.",
  ].join("\n");
}

function status(ok, warningText = "warning") {
  return ok ? "OK" : warningText;
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hostForDisplay(value) {
  const parsed = parseUrl(value);
  return parsed?.hostname || "";
}

async function resolveHost(hostname, resolver = dns) {
  const result = { hostname, a: [], aaaa: [], ok: false, error: "" };
  if (!hostname) {
    result.error = "missing hostname";
    return result;
  }

  const [a, aaaa] = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
  if (a.status === "fulfilled") result.a = a.value;
  if (aaaa.status === "fulfilled") result.aaaa = aaaa.value;
  result.ok = result.a.length > 0 || result.aaaa.length > 0;

  if (!result.ok && typeof resolver.lookup === "function") {
    try {
      const records = await resolver.lookup(hostname, { all: true });
      for (const record of records) {
        if (record.family === 4) result.a.push(record.address);
        if (record.family === 6) result.aaaa.push(record.address);
      }
      result.ok = result.a.length > 0 || result.aaaa.length > 0;
      if (result.ok) result.error = "";
    } catch {
      // Keep the resolve4/resolve6 error below; lookup is only a monitoring fallback.
    }
  }

  if (!result.ok) {
    const errors = [a, aaaa]
      .filter((item) => item.status === "rejected")
      .map((item) => item.reason?.code || item.reason?.message || "resolve failed");
    result.error = [...new Set(errors)].join(", ") || "no address records";
  }

  return result;
}

async function fetchWithTimeout(url, { fetcher = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "application/json,text/html;q=0.8,*/*;q=0.5" },
    });
    const responseTimeMs = Date.now() - startedAt;
    const body = await response.text().catch(() => "");
    const headers = Object.fromEntries(
      ["server", "cf-ray", "cf-cache-status", "content-type"]
        .map((name) => [name, response.headers.get(name)])
        .filter(([, value]) => Boolean(value)),
    );
    return {
      url,
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      responseTimeMs,
      state: `${response.status}`,
      bodyPreview: body.slice(0, 4096),
      headers,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      responseTimeMs: Date.now() - startedAt,
      state: error?.name === "AbortError" ? "timeout" : error?.code || error?.message || "request failed",
      bodyPreview: "",
      headers: {},
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(baseUrl, pathname) {
  const parsed = parseUrl(baseUrl);
  if (!parsed) return "";
  parsed.pathname = pathname;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function inspectProbe(pathname, result, maxResponseMs) {
  const json = parseJsonObject(result.bodyPreview || "");
  const databaseState = json?.checks && typeof json.checks === "object" ? json.checks.database : undefined;
  const readyState = pathname === "/api/ready" && json ? json.status : undefined;
  const hasReadyPayload = pathname === "/api/ready" && json && ("status" in json || "checks" in json);
  const readyPayloadOk = !hasReadyPayload || (readyState === "ready" && databaseState === "ok");
  const responseTimeOk = result.responseTimeMs <= (maxResponseMs || DEFAULT_MAX_RESPONSE_MS);
  const ok = result.ok && responseTimeOk && readyPayloadOk;
  const details = [];
  details.push(`${result.responseTimeMs}ms`);
  if (readyState !== undefined) details.push(`status=${readyState}`);
  if (databaseState !== undefined) details.push(`db=${databaseState}`);
  if (!responseTimeOk) details.push(`slow>${maxResponseMs}ms`);
  return {
    ...result,
    ok,
    responseTimeOk,
    readyPayloadOk,
    readyState,
    databaseState,
    state: `${result.state}; ${details.join("; ")}`,
  };
}

function isCloudflareEdgeResponse(probe) {
  const server = String(probe.headers?.server ?? "").toLowerCase();
  return server.includes("cloudflare") || Boolean(probe.headers?.["cf-ray"]);
}

function diagnoseProductionIssue(report) {
  if (report.productionConnected) {
    return [["Production route", "OK", "DNS and read-only probes are healthy."]];
  }

  const probes = report.productionProbes || [];
  const statuses = [...new Set(probes.map((probe) => probe.status).filter(Boolean))];
  const has522 = probes.some((probe) => probe.status === 522);
  const edgeResponses = probes.filter(isCloudflareEdgeResponse);

  if (has522 && edgeResponses.length > 0) {
    return [
      [
        "Cloudflare edge reached",
        "ATTENTION",
        "Responses include Cloudflare edge headers; DNS reaches Cloudflare, but requests time out before the application responds.",
      ],
      [
        "Likely next check",
        "ATTENTION",
        "Verify the production Worker route is deployed and attached to odip.mirai-dx-platform.com/* before the proxied 100:: placeholder is treated as an origin.",
      ],
      [
        "Safe commands",
        "ACTION",
        "Use approved Cloudflare credentials: wrangler deployments list --env production; wrangler tail codip --env production --status error; confirm the zone route and DNS record in the dashboard.",
      ],
    ];
  }

  if (has522) {
    return [
      [
        "HTTP 522",
        "ATTENTION",
        "Cloudflare returned 522. Check origin/Worker route health and collect cf-ray/error details from Cloudflare logs.",
      ],
    ];
  }

  if (statuses.length > 0) {
    return [
      [
        "Production probe status",
        "ATTENTION",
        `Production returned ${statuses.join(", ")}. Check route, Access policy, Worker logs, and /api/ready payload.`,
      ],
    ];
  }

  return [
    [
      "Production connectivity",
      "ATTENTION",
      "No production HTTP response was received. Check DNS propagation, proxy status, and network reachability.",
    ],
  ];
}

async function probeUrl(baseUrl, paths, options) {
  const parsed = parseUrl(baseUrl);
  if (!parsed) {
    return [{ url: baseUrl, path: "", ok: false, state: "invalid url" }];
  }

  const rows = [];
  for (const pathname of paths) {
    const url = buildUrl(baseUrl, pathname);
    const result = await fetchWithTimeout(url, options);
    rows.push({ path: pathname, ...inspectProbe(pathname, result, options.maxResponseMs) });
  }
  return rows;
}

function renderAddressList(values) {
  if (!values.length) return "none";
  return values.slice(0, 6).join(", ");
}

function renderResponseTime(value) {
  return typeof value === "number" ? `${value}ms` : "n/a";
}

function escapeMarkdownTable(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
}

function renderReport(report) {
  const lines = [
    "# Post-release Runtime Status",
    "",
    `- Checked at: ${report.checkedAt}`,
    `- Production URL: \`${report.productionUrl}\``,
    `- Preview URL: \`${report.previewUrl}\``,
    `- Max response time: ${report.maxResponseMs}ms`,
    `- Overall: ${report.ready ? "OK" : "ATTENTION"}`,
    "",
    "## Production DNS",
    "",
    "| Hostname | A | AAAA | State |",
    "| --- | --- | --- | --- |",
    `| \`${report.productionDns.hostname}\` | ${renderAddressList(report.productionDns.a)} | ${renderAddressList(
      report.productionDns.aaaa,
    )} | ${report.productionDns.ok ? "resolved" : `unresolved (${report.productionDns.error})`} |`,
    "",
    "## Production Read-only Probes",
    "",
    "| Path | Response | State |",
    "| --- | ---: | --- |",
    ...report.productionProbes.map((probe) => `| \`${escapeMarkdownTable(probe.path || probe.url)}\` | ${renderResponseTime(probe.responseTimeMs)} | ${status(probe.ok, "not ready")} (${escapeMarkdownTable(probe.state)}) |`),
    "",
    "## Production Route Diagnosis",
    "",
    "| Check | State | Detail |",
    "| --- | --- | --- |",
    ...report.productionDiagnosis.map(([check, state, detail]) => `| ${escapeMarkdownTable(check)} | ${escapeMarkdownTable(state)} | ${escapeMarkdownTable(detail)} |`),
    "",
    "## Shared Preview Probes",
    "",
    "| Path | Response | State |",
    "| --- | ---: | --- |",
    ...report.previewProbes.map((probe) => `| \`${escapeMarkdownTable(probe.path || probe.url)}\` | ${renderResponseTime(probe.responseTimeMs)} | ${status(probe.ok, "not ready")} (${escapeMarkdownTable(probe.state)}) |`),
    "",
    "## CTO Decision",
    "",
    `- Production connected: ${report.productionConnected ? "yes" : "no"}`,
    `- Preview healthy: ${report.previewHealthy ? "yes" : "no"}`,
    `- Strict production mode: ${report.strictProduction ? "yes" : "no"}`,
    `- Decision: ${report.ready ? "continue operation / evidence collection" : report.decision}`,
    "",
  ];

  return lines.join("\n");
}

async function buildReport(args, deps = {}) {
  const productionHost = hostForDisplay(args.productionUrl);
  const productionDns = await resolveHost(productionHost, deps.resolver);
  const productionProbes = productionHost
    ? await probeUrl(args.productionUrl, PRODUCTION_PATHS, {
        fetcher: deps.fetcher,
        timeoutMs: args.timeoutMs,
        maxResponseMs: args.maxResponseMs,
      })
    : [{ path: "(skipped)", ok: false, responseTimeMs: null, status: 0, state: "missing production hostname" }];
  const previewProbes = await probeUrl(args.previewUrl, PREVIEW_PATHS, {
    fetcher: deps.fetcher,
    timeoutMs: args.timeoutMs,
    maxResponseMs: args.maxResponseMs,
  });

  const productionProbesHealthy = productionProbes.every((probe) => probe.ok);
  const productionHasHttpResponse = productionProbes.some((probe) => typeof probe.status === "number" && probe.status > 0);
  const productionConnected = productionDns.ok && productionProbesHealthy;
  const productionEndpointUnhealthy = productionHasHttpResponse && !productionProbesHealthy;
  const previewHealthy = previewProbes.every((probe) => probe.ok);
  const ready =
    (args.strictProduction ? productionConnected : !productionEndpointUnhealthy) &&
    (args.allowPreviewDown || previewHealthy);
  const decision = args.strictProduction
    ? "hold production cutover until DNS/custom domain and health probes are ready"
    : productionEndpointUnhealthy
      ? "investigate production route/origin health before declaring cutover healthy"
    : "production is not connected yet; continue preview monitoring and keep DNS changes gated";

  const report = {
    checkedAt: new Date().toISOString(),
    productionUrl: args.productionUrl,
    previewUrl: args.previewUrl,
    maxResponseMs: args.maxResponseMs,
    strictProduction: args.strictProduction,
    productionDns,
    productionProbes,
    previewProbes,
    productionConnected,
    productionEndpointUnhealthy,
    previewHealthy,
    ready,
    decision,
  };
  report.productionDiagnosis = diagnoseProductionIssue(report);
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const report = await buildReport(args);
  console.log(renderReport(report));
  if (!report.ready) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[post-release-status][error] ${error?.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_PREVIEW_URL,
  DEFAULT_PRODUCTION_URL,
  parseArgs,
  resolveHost,
  fetchWithTimeout,
  buildReport,
  renderReport,
  inspectProbe,
  diagnoseProductionIssue,
  escapeMarkdownTable,
};
