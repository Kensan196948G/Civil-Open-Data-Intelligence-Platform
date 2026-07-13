#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

function run(name, command, args, options = {}) {
  console.log(`\n[release-gate] ${name}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0) {
    console.error(`[release-gate] FAILED: ${name}`);
    process.exit(result.status ?? 1);
  }
}

function main() {
  const includeE2e = process.argv.includes("--include-e2e");
  const sqliteEnv = { DATABASE_URL: "file:./dev.db" };

  run("dependency audit", "npm", ["audit", "--audit-level=moderate"]);
  run("duplicate officialUrl preflight", "npm", ["run", "db:check-duplicates"], {
    env: sqliteEnv,
  });
  run("standard record release policy", "npm", ["run", "db:check-standard-record-policy"], {
    env: sqliteEnv,
  });
  run("v1 standard record contract", "npm", ["run", "release:check-v1-contract"]);
  run("docs and API contract", "npm", ["run", "release:check-doc-api-contract"]);
  run("openapi route coverage", "npm", ["run", "release:check-openapi-coverage"]);
  run("docker release contract", "npm", ["run", "release:check-docker-contract"]);
  run("cloudflare neon contract", "npm", ["run", "release:check-cloudflare-contract"]);
  run("github actions contract", "npm", ["run", "release:check-github-actions-contract"]);
  run("operational prune dry-run", "npm", ["run", "db:prune", "--", "--dry-run"], {
    env: sqliteEnv,
  });
  run("schema parity", "npm", ["run", "db:compare-schemas"]);
  run("postgresql schema validate", "npm", ["run", "db:pg:validate"]);
  run("postgresql client generate", "npm", ["run", "db:pg:generate"]);
  run("local env contract", "npm", ["run", "release:validate-env:local"], {
    env: { ...sqliteEnv, CODIP_ENV_MODE: "local" },
  });
  run("preview env contract", "npm", ["run", "release:validate-env:preview"], {
    env: {
      ...sqliteEnv,
      CODIP_ENV_MODE: "preview",
      CODIP_ADMIN_TOKEN: "preview-admin-token-123456789012345",
      CODIP_ACCEPT_SQLITE_PREVIEW: "true",
    },
  });
  run("production env shape contract (synthetic)", "npm", ["run", "release:validate-env:production"], {
    env: {
      CODIP_ENV_MODE: "production",
      DATABASE_URL:
        "postgresql://codip:codip-production-password@example.com:5432/codip?sslmode=require",
      CODIP_ADMIN_TOKEN: "production-admin-token-123456789012345",
    },
  });
  run("lint", "npm", ["run", "lint"]);
  run("typecheck", "npx", ["tsc", "--noEmit"]);
  run("unit tests", "npm", ["run", "test"]);
  run("production build", "npm", ["run", "build"], { env: sqliteEnv });

  if (includeE2e) {
    run("playwright e2e", "npm", ["run", "test:e2e"], { env: sqliteEnv });
  } else {
    console.log("\n[release-gate] Skipping Playwright E2E. Use --include-e2e in a browser-capable environment.");
  }

  console.log("\n[release-gate] OK");
}

main();
