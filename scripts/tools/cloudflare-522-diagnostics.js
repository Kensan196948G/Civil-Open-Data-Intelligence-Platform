#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_PRODUCTION_URL = "https://civilopendata.mirai-dx-platform.com";
const DEFAULT_WORKER_NAME = "codip";
const DEFAULT_ENV = "production";
const DEFAULT_ZONE = "mirai-dx-platform.com";

function parseArgs(argv) {
  const args = {
    productionUrl: process.env.CODIP_PRODUCTION_URL || DEFAULT_PRODUCTION_URL,
    workerName: process.env.CODIP_WORKER_NAME || DEFAULT_WORKER_NAME,
    envName: process.env.CODIP_DEPLOY_ENV || DEFAULT_ENV,
    executeWrangler: false,
    cwd: process.cwd(),
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--production-url") {
      args.productionUrl = argv[++index] ?? "";
    } else if (arg === "--worker-name") {
      args.workerName = argv[++index] ?? "";
    } else if (arg === "--env") {
      args.envName = argv[++index] ?? "";
    } else if (arg === "--execute-wrangler") {
      args.executeWrangler = true;
    } else if (arg === "--cwd") {
      args.cwd = argv[++index] ?? process.cwd();
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
}

function usage() {
  return [
    "Usage: node scripts/tools/cloudflare-522-diagnostics.js [options]",
    "",
    "Options:",
    "  --production-url <url>   Production URL. Defaults to civilopendata.mirai-dx-platform.com.",
    "  --worker-name <name>     Worker name. Default: codip.",
    "  --env <name>             Wrangler environment. Default: production.",
    "  --execute-wrangler       Run read-only Wrangler deployments status/list checks.",
    "  --cwd <path>             Project root for wrangler.jsonc and Wrangler execution.",
    "",
    "The command never changes DNS, routes, Access, Secrets, billing, or Neon data.",
  ].join("\n");
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function stripJsonComments(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
        output += current;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }

    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }

    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += current;
  }

  return output;
}

function readWranglerConfig(root) {
  const filePath = path.join(root, "wrangler.jsonc");
  const source = fs.readFileSync(filePath, "utf8");
  return JSON.parse(stripJsonComments(source));
}

function getEnvConfig(wrangler, envName) {
  return envName === "production" || envName === "preview"
    ? (wrangler.env && wrangler.env[envName]) || {}
    : wrangler;
}

function routeMatches(route, hostname) {
  return route?.pattern === hostname || route?.pattern === `${hostname}/*`;
}

function hasPlaceholder(value) {
  return typeof value === "string" && /REPLACE_WITH|placeholder/i.test(value);
}

function localWranglerAssessment(wrangler, args) {
  const host = parseUrl(args.productionUrl)?.hostname || "";
  const envConfig = getEnvConfig(wrangler, args.envName);
  const route = (envConfig.routes || []).find((candidate) => routeMatches(candidate, host));
  const hyperdrive = (envConfig.hyperdrive || [])[0];
  const observability = envConfig.observability || wrangler.observability || {};

  return {
    host,
    route,
    routeConfigured: Boolean(route),
    zoneName: route?.zone_name || "",
    zoneMatches: (route?.zone_name || DEFAULT_ZONE) === DEFAULT_ZONE,
    workersDevDisabled: envConfig.workers_dev === false,
    observabilityEnabled: observability.enabled === true,
    hyperdriveBinding: hyperdrive?.binding || "",
    hyperdriveIdResolved: Boolean(hyperdrive?.id) && !hasPlaceholder(hyperdrive.id),
  };
}

function wranglerCommand(args, subcommand) {
  return [
    "node",
    "node_modules/wrangler/bin/wrangler.js",
    ...subcommand,
    "--name",
    args.workerName,
    "--env",
    args.envName,
    "--json",
  ];
}

function commandForDisplay(command) {
  return command.join(" ");
}

function runWranglerReadOnly(args, runner = spawnSync) {
  const wranglerBin = path.join(args.cwd, "node_modules", "wrangler", "bin", "wrangler.js");
  const checks = [
    { label: "deployments status", command: ["deployments", "status"] },
    { label: "deployments list", command: ["deployments", "list"] },
  ];

  return checks.map((check) => {
    const result = runner(process.execPath, [wranglerBin, ...check.command, "--name", args.workerName, "--env", args.envName, "--json"], {
      cwd: args.cwd,
      env: process.env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });

    return {
      label: check.label,
      ok: result.status === 0,
      status: result.status,
      stdout: String(result.stdout || "").slice(0, 4000),
      stderr: String(result.stderr || "").slice(0, 4000),
    };
  });
}

function renderBoolean(value) {
  return value ? "OK" : "ATTENTION";
}

function renderWranglerResult(result) {
  const body = result.ok ? result.stdout.trim() : result.stderr.trim() || result.stdout.trim();
  return [
    `### ${result.label}`,
    "",
    `- State: ${result.ok ? "OK" : `ATTENTION (exit=${result.status ?? "unknown"})`}`,
    "",
    "```text",
    body || "(no output)",
    "```",
  ].join("\n");
}

function buildReport(args, deps = {}) {
  const wrangler = deps.wranglerConfig || readWranglerConfig(args.cwd);
  const assessment = localWranglerAssessment(wrangler, args);
  const statusCommand = wranglerCommand(args, ["deployments", "status"]);
  const listCommand = wranglerCommand(args, ["deployments", "list"]);
  const tailCommand = [
    "node",
    "node_modules/wrangler/bin/wrangler.js",
    "tail",
    args.workerName,
    "--env",
    args.envName,
    "--status",
    "error",
  ];
  const wranglerResults = args.executeWrangler ? runWranglerReadOnly(args, deps.runner) : [];

  return {
    checkedAt: new Date().toISOString(),
    args,
    assessment,
    statusCommand,
    listCommand,
    tailCommand,
    wranglerResults,
    ok:
      assessment.routeConfigured &&
      assessment.zoneMatches &&
      assessment.workersDevDisabled &&
      assessment.observabilityEnabled &&
      assessment.hyperdriveIdResolved &&
      (!args.executeWrangler || wranglerResults.every((result) => result.ok)),
  };
}

function renderReport(report) {
  const a = report.assessment;
  const lines = [
    "# Cloudflare 522 Route Diagnostics",
    "",
    `- Checked at: ${report.checkedAt}`,
    `- Production URL: \`${report.args.productionUrl}\``,
    `- Worker: \`${report.args.workerName}\``,
    `- Wrangler env: \`${report.args.envName}\``,
    `- External calls: ${report.args.executeWrangler ? "read-only Wrangler deployments status/list executed" : "none (checklist mode)"}`,
    "",
    "## Local Wrangler Contract",
    "",
    "| Check | State | Detail |",
    "| --- | --- | --- |",
    `| Route configured | ${renderBoolean(a.routeConfigured)} | \`${a.route?.pattern || "(missing)"}\` |`,
    `| Zone route | ${renderBoolean(a.zoneMatches)} | \`${a.zoneName || "(missing zone_name)"}\` |`,
    `| workers_dev disabled | ${renderBoolean(a.workersDevDisabled)} | expected \`false\` for production |`,
    `| Observability enabled | ${renderBoolean(a.observabilityEnabled)} | Workers logs/traces evidence should be available |`,
    `| Hyperdrive binding | ${renderBoolean(Boolean(a.hyperdriveBinding))} | \`${a.hyperdriveBinding || "(missing)"}\` |`,
    `| Hyperdrive ID resolved | ${renderBoolean(a.hyperdriveIdResolved)} | placeholder must not remain in production |`,
    "",
    "## Read-only Wrangler Commands",
    "",
    "| Purpose | Command |",
    "| --- | --- |",
    `| Active deployment status | \`${commandForDisplay(report.statusCommand)}\` |`,
    `| Recent deployments | \`${commandForDisplay(report.listCommand)}\` |`,
    `| Error log stream (manual; stop after reproducing one request) | \`${commandForDisplay(report.tailCommand)}\` |`,
    "",
    "## Dashboard Evidence To Capture",
    "",
    "| Evidence | Expected |",
    "| --- | --- |",
    "| Workers & Pages > codip > Deployments | latest production deployment is active and matches the intended release commit |",
    "| Workers & Pages > codip > Settings > Domains & Routes | `civilopendata.mirai-dx-platform.com/*` is attached to the production Worker route |",
    "| DNS record | `civilopendata` is proxied and intentionally configured as the Worker route placeholder, not an unintended origin |",
    "| Workers Logs / Traces | a request to `/api/health` reaches Worker `codip`; if no invocation appears, traffic is not routed to the Worker |",
    "| Hyperdrive binding | production binding `HYPERDRIVE` points to the approved Neon target |",
  ];

  if (report.wranglerResults.length > 0) {
    lines.push("", "## Wrangler Execution Result", "");
    for (const result of report.wranglerResults) {
      lines.push(renderWranglerResult(result), "");
    }
  }

  lines.push(
    "",
    "## CTO Decision",
    "",
    `- Diagnosis ready: ${report.ok ? "yes" : "no"}`,
    "- Do not change DNS, Access, Secrets, billing, or Neon data from this diagnostic command.",
    "- If production remains 522 and no Worker invocation appears in logs, prioritize route/DNS binding recovery before application changes.",
    "",
  );

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const report = buildReport(args);
  console.log(renderReport(report));
  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[cloudflare-522-diagnostics][error] ${error?.message || error}`);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_PRODUCTION_URL,
  parseArgs,
  stripJsonComments,
  localWranglerAssessment,
  buildReport,
  renderReport,
  runWranglerReadOnly,
};
