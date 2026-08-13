#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

// Windows only. The command line is parsed twice, by two different parsers:
//
//   1. cmd.exe, because shell: true makes Node run `cmd /d /s /c "<line>"`
//   2. the child process's CRT, following CommandLineToArgvW rules
//
// Layer 2 is what this function quotes for. There a backslash is a
// metacharacter *only* when it precedes a quote:
//   2n backslashes + '"'   -> n backslashes, quote toggles
//   2n+1 backslashes + '"' -> n backslashes, literal '"'
//   backslashes not followed by '"' -> literal, no doubling
// So escaping every backslash would corrupt ordinary paths (C:\a\b), while
// escaping none lets a trailing backslash consume the closing quote and let the
// rest of the line run unquoted. Double only the runs that reach a quote or the
// end of the token — this is the ArgvQuote algorithm.
//
// Layer 1 is mostly handled by the surrounding double quotes: cmd.exe does not
// interpret & | < > ^ inside them. Two characters survive quoting and cannot be
// escaped reliably on a cmd command line:
//   %  — %VAR% is expanded inside double quotes as well
//   !  — expanded too when DelayedExpansion is enabled in the registry
// Emitting a token whose value we cannot vouch for would be the same class of
// defect this function exists to fix, so those fail closed instead.
const CMD_EXPANDS_INSIDE_QUOTES = /[%!]/;

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  if (CMD_EXPANDS_INSIDE_QUOTES.test(value)) {
    // The value is deliberately not included: it may carry a secret, and the
    // character class alone identifies the problem.
    throw new Error("[release-gate] cannot safely quote an argument containing '%' or '!' for cmd.exe");
  }
  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  return `"${escaped}"`;
}

function run(name, command, args, options = {}) {
  console.log(`\n[release-gate] ${name}`);
  const isWindows = process.platform === "win32";
  const result = spawnSync(isWindows ? [command, ...args].map(quoteShellArg).join(" ") : command, isWindows ? [] : args, {
    stdio: "inherit",
    shell: isWindows,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0) {
    if (result.error) console.error(`[release-gate] ${result.error.message}`);
    console.error(`[release-gate] FAILED: ${name}`);
    process.exit(result.status ?? 1);
  }
}

function main() {
  const includeE2e = process.argv.includes("--include-e2e");
  const sqliteEnv = { DATABASE_URL: "file:./dev.db" };

  run("dependency audit", "npm", ["audit", "--audit-level=moderate"]);
  run("sqlite migration preflight", "npm", ["run", "db:migrate"], {
    env: sqliteEnv,
  });
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
  run("audit log guarantee contract", "npm", ["run", "release:check-audit-contract"]);
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
  run("typecheck", "npm", ["run", "typecheck"]);
  run("unit tests", "npm", ["run", "test"]);
  run("production build", "npm", ["run", "build"], { env: sqliteEnv });

  if (includeE2e) {
    run("playwright e2e", "npm", ["run", "test:e2e"], { env: sqliteEnv });
  } else {
    console.log("\n[release-gate] Skipping Playwright E2E. Use --include-e2e in a browser-capable environment.");
  }

  console.log("\n[release-gate] OK");
}

if (require.main === module) {
  main();
}

module.exports = { quoteShellArg };
