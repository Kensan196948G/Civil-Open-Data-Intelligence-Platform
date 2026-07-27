#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const TARGETS = new Map([
  ["staging", { wranglerEnv: "preview", host: null, zone: null }],
  [
    "production",
    {
      wranglerEnv: "production",
      host: "odip.mirai-dx-platform.com",
      zone: "mirai-dx-platform.com",
    },
  ],
]);

const PLACEHOLDER_RE = /REPLACE_WITH|placeholder|change[-_]?this|example/i;

function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function readWrangler(root) {
  const wranglerPath = path.join(root, "wrangler.jsonc");
  const text = fs.readFileSync(wranglerPath, "utf8");
  return JSON.parse(stripJsonComments(text));
}

function fail(errors, message) {
  errors.push(message);
}

function validateHyperdrive(errors, envName, hyperdrive) {
  if (!Array.isArray(hyperdrive) || hyperdrive.length === 0) {
    fail(errors, `${envName}.hyperdrive must contain the target binding`);
    return;
  }

  for (const binding of hyperdrive) {
    if (!binding?.binding) fail(errors, `${envName}.hyperdrive has an entry without binding`);
    if (!binding?.id) {
      fail(errors, `${envName}.hyperdrive.${binding?.binding ?? "<unknown>"} id is missing`);
    } else if (PLACEHOLDER_RE.test(binding.id)) {
      fail(errors, `${envName}.hyperdrive.${binding.binding} id is still a placeholder`);
    }
  }
}

function validateTarget(root, targetName) {
  const target = TARGETS.get(targetName);
  if (!target) throw new Error(`Unknown target: ${targetName}`);

  const wrangler = readWrangler(root);
  const envConfig = wrangler.env?.[target.wranglerEnv];
  const errors = [];

  if (!envConfig) fail(errors, `wrangler env.${target.wranglerEnv} is missing`);

  validateHyperdrive(errors, `env.${target.wranglerEnv}`, envConfig?.hyperdrive);

  if (targetName === "production") {
    if (envConfig?.workers_dev !== false) fail(errors, "env.production.workers_dev must be false");

    // Accept either binding mechanism for the production hostname:
    // - Custom Domain (`custom_domain: true`, requires the account-level Workers
    //   Custom Domains API scope), or
    // - zone route (`zone_name` + `<host>/*` pattern + proxied DNS record; the
    //   mechanism currently in use — see docs/runbooks/cloudflare-production.md §1.1).
    const route = envConfig?.routes?.find(
      (item) => item?.pattern === target.host || item?.pattern === `${target.host}/*`,
    );
    if (!route) {
      fail(errors, `env.production.routes must include ${target.host}`);
    } else if (route.custom_domain !== true && route.zone_name !== target.zone) {
      fail(
        errors,
        `env.production route ${target.host} must set custom_domain=true or zone_name=${target.zone}`,
      );
    }

    if (envConfig?.vars?.CODIP_BASE_URL !== `https://${target.host}`) {
      fail(errors, `env.production.vars.CODIP_BASE_URL must be https://${target.host}`);
    }
  }

  return errors;
}

function parseTarget(argv) {
  const envIndex = argv.indexOf("--env");
  if (envIndex >= 0) return argv[envIndex + 1] ?? "";
  return process.env.CODIP_DEPLOY_TARGET || "production";
}

function main() {
  const targetName = parseTarget(process.argv.slice(2));
  const errors = validateTarget(process.cwd(), targetName);

  if (errors.length > 0) {
    for (const error of errors) console.error(`[production-placeholders][error] ${error}`);
    process.exit(1);
  }

  console.log(`[production-placeholders] OK (${targetName})`);
}

if (require.main === module) main();

module.exports = { validateTarget };
