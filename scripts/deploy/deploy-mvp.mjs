#!/usr/bin/env node
// CODIP MVP review environment deploy pipeline (Cloudflare Workers + Neon).
//
// Target: https://codip-mvp.mirai-dx-platform.com (worker `codip-mvp`, zone route)
// DB:     Neon branch `mvp-20260813` (copy-on-write; production `main` is never
//         touched). The Worker connects via the `DATABASE_URL` secret using the
//         Prisma pg driver over direct TCP (nodejs_compat) because the account
//         token has no Hyperdrive-create scope.
//
// Secrets-safe by design:
// - Neon connection URIs are fetched via the Neon API and stay in-process.
// - Worker secrets are piped to `wrangler secret put` via stdin, never printed.
// - A generated admin token is written to `.mvp-admin-token.txt` (gitignored)
//   so the operator can share it out-of-band; the value is never logged.
//
// Required env: NEON_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// Flags:
//   --with-secrets  set Worker secrets (DATABASE_URL, CODIP_ADMIN_TOKEN).
//   --skip-deploy   read-only preflight (Neon resolve + migrate status); stops
//                   before DNS mutation, migrations, seed, deploy and secrets.
//
// Usage: source ~/.bashrc && node scripts/deploy/deploy-mvp.mjs --with-secrets

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  WORKER_ROUTE_PLACEHOLDER_CONTENT,
  WORKER_ROUTE_PLACEHOLDER_TYPE,
  planWorkerRouteDnsRecord,
} from "./cloudflare-dns-record-policy.mjs";

const NEON_API = "https://console.neon.tech/api/v2";
const CF_API = "https://api.cloudflare.com/client/v4";

// Stable, non-secret resource identifiers (docs/runbooks/cloudflare-mvp.md)
const NEON_PROJECT_ID = process.env.CODIP_NEON_PROJECT_ID?.trim() || "falling-dawn-93620497";
const MVP_NEON_BRANCH = process.env.CODIP_MVP_NEON_BRANCH?.trim() || "mvp-20260813";
const MVP_HOST = "codip-mvp.mirai-dx-platform.com";
const MVP_ZONE = "mirai-dx-platform.com";
const MVP_ZONE_ID = "e375e651e49a40801a305b89e297bff0";
const MVP_BASE_URL = `https://${MVP_HOST}`;
const MVP_DEMO_EMAIL = "demo.engineer@example.com";
const MVP_ADMIN_TOKEN_FILE = ".mvp-admin-token.txt";

const withSecrets = process.argv.includes("--with-secrets");
const skipDeploy = process.argv.includes("--skip-deploy");

/**
 * @param {string} name
 * @param {Record<string, string | undefined>} [env]
 */
function requiredEnv(name, env = process.env) {
  const value = env[name]?.trim() ?? "";
  if (!value) throw new Error(`missing required env: ${name}`);
  return value;
}

// Exported so the fail-closed wiring can be executed, not just described
// (mirrors scripts/deploy/deploy-production.mjs resolveEvidenceEnv).
/**
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveMvpEnv(env = process.env) {
  // Reports every missing key at once (fail-closed): a deploy that cannot
  // produce its credentials must stop before any Neon/Cloudflare call.
  const missing = ["NEON_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter(
    (key) => !(env[key]?.trim() ?? ""),
  );
  if (missing.length > 0) {
    throw new Error(`missing required env: ${missing.join(", ")}`);
  }
  return {
    neonApiKey: requiredEnv("NEON_API_KEY", env),
    cfToken: requiredEnv("CLOUDFLARE_API_TOKEN", env),
    accountId: requiredEnv("CLOUDFLARE_ACCOUNT_ID", env),
  };
}

function step(title) {
  console.log(`\n=== [deploy-mvp] ${title} ===`);
}

async function neonGet(apiKey, path) {
  const res = await fetch(`${NEON_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Neon API ${path.split("?")[0]} failed: HTTP ${res.status}`);
  return res.json();
}

async function cfRequest(token, method, path, body) {
  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!json?.success) {
    const codes = (json?.errors ?? []).map((e) => e.code).join(",") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API ${method} ${path} failed: ${codes}`);
  }
  return json.result;
}

function withSslMode(uri) {
  const parsed = new URL(uri);
  if (!parsed.searchParams.get("sslmode")) parsed.searchParams.set("sslmode", "require");
  return parsed.toString();
}

async function resolveNeonUris(apiKey) {
  const { branches } = await neonGet(apiKey, `/projects/${NEON_PROJECT_ID}/branches`);
  const branch = branches.find((b) => b.name === MVP_NEON_BRANCH);
  if (!branch) {
    throw new Error(
      `Neon branch "${MVP_NEON_BRANCH}" not found in project ${NEON_PROJECT_ID}. ` +
        `Create it first from the project default branch (copy-on-write); production is never used.`,
    );
  }

  const { databases } = await neonGet(
    apiKey,
    `/projects/${NEON_PROJECT_ID}/branches/${branch.id}/databases`,
  );
  const database = databases[0];
  if (!database) throw new Error(`Neon branch "${MVP_NEON_BRANCH}" has no databases`);

  const uriFor = async (pooled) => {
    const query = new URLSearchParams({
      branch_id: branch.id,
      database_name: database.name,
      role_name: database.owner_name,
      pooled: String(pooled),
    });
    const { uri } = await neonGet(apiKey, `/projects/${NEON_PROJECT_ID}/connection_uri?${query}`);
    return withSslMode(uri);
  };

  return {
    branchName: branch.name,
    pooledUri: await uriFor(true),
    directUri: await uriFor(false),
  };
}

function run(command, args, extraEnv, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.input ? ["pipe", "inherit", "inherit"] : "inherit",
    input: options.input,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(
      `[deploy-mvp] command failed (exit=${result.status}): ${command} ${args
        .filter((a) => !a.includes("://"))
        .join(" ")}`,
    );
    process.exit(result.status ?? 1);
  }
}

async function ensureDnsRecord(token) {
  const zones = await cfRequest(token, "GET", `/zones?name=${MVP_ZONE}`);
  const zone = zones[0];
  if (!zone) throw new Error(`zone ${MVP_ZONE} not found`);

  const records = await cfRequest(
    token,
    "GET",
    `/zones/${zone.id}/dns_records?name=${MVP_HOST}`,
  );
  const plan = planWorkerRouteDnsRecord(records, MVP_HOST);
  if (plan.action === "reuse") {
    console.log(`[deploy-mvp] ${plan.message}`);
    return;
  }
  if (plan.action === "block") {
    throw new Error(
      `${plan.message}. Stop before deploy; verify DNS/route ownership in Cloudflare.`,
    );
  }

  await cfRequest(token, "POST", `/zones/${zone.id}/dns_records`, {
    type: WORKER_ROUTE_PLACEHOLDER_TYPE,
    name: MVP_HOST,
    content: WORKER_ROUTE_PLACEHOLDER_CONTENT,
    proxied: true,
    comment: "CODIP MVP review target (managed via scripts/deploy/deploy-mvp.mjs)",
  });
  console.log(`[deploy-mvp] created proxied AAAA record for ${MVP_HOST}`);
}

/**
 * Workers Custom Domains で MVP host を Worker `codip-mvp` へ紐付ける（冪等）。
 *
 * zone route は現行 token に Workers Routes:Edit スコープが無いため使わない
 * (2026-08-13 実測 code 10000)。同一 token の Workers Domains スコープで
 * カスタムドメインを登録する。既に紐付いていれば何もしない。
 */
async function ensureCustomDomain(token, accountId) {
  const domains = await cfRequest(token, "GET", `/accounts/${accountId}/workers/domains`);
  const existing = domains.find((d) => d.hostname === MVP_HOST);
  if (existing) {
    console.log(`[deploy-mvp] reuse Workers custom domain ${MVP_HOST} (${existing.id})`);
    return;
  }
  await cfRequest(token, "PUT", `/accounts/${accountId}/workers/domains`, {
    hostname: MVP_HOST,
    service: "codip-mvp",
    environment: "production",
    zone_id: MVP_ZONE_ID,
  });
  console.log(`[deploy-mvp] attached Workers custom domain ${MVP_HOST}`);
}

export async function main() {
  const { neonApiKey, cfToken, accountId } = resolveMvpEnv();

  step("resolve Neon connection targets (in-process)");
  const neon = await resolveNeonUris(neonApiKey);
  console.log(
    `[deploy-mvp] Neon project=${NEON_PROJECT_ID} branch=${neon.branchName} (production branch untouched)`,
  );

  step("prisma migrate status (read-only gate)");
  run("npx", ["prisma", "migrate", "status", "--schema", "prisma/postgresql/schema.prisma"], {
    DATABASE_URL: neon.directUri,
  });

  if (skipDeploy) {
    console.log(
      "[deploy-mvp] --skip-deploy: stopping before migrations, DNS mutation, seed and deploy",
    );
    return;
  }

  step("prisma migrate deploy + seed (mvp branch only)");
  run("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/postgresql/schema.prisma"], {
    DATABASE_URL: neon.directUri,
  });
  run("npm", ["run", "db:pg:seed"], {
    DATABASE_URL: neon.directUri,
    CODIP_DEMO_IDENTITY: "true",
    CODIP_DEMO_USER_EMAIL: MVP_DEMO_EMAIL,
  });

  step("ensure DNS record (zone route target)");
  await ensureDnsRecord(cfToken);
  await ensureCustomDomain(cfToken, accountId);

  const adminToken = process.env.CODIP_ADMIN_TOKEN?.trim() || randomBytes(32).toString("hex");

  step("release gates + wrangler deploy --env mvp");
  const deployEnv = {
    DATABASE_URL: neon.pooledUri,
    CODIP_ENV_MODE: "preview",
    CODIP_DEPLOY_TARGET: "staging",
    CODIP_BASE_URL: MVP_BASE_URL,
    CODIP_ADMIN_TOKEN: adminToken,
    CODIP_DISABLE_TOKEN_AUTH: "false",
    CODIP_TRUST_PROXY_AUTH: "false",
    CODIP_TRUST_PROXY_HEADERS: "false",
    CODIP_ALLOWED_ORIGINS: MVP_BASE_URL,
    CODIP_DEMO_IDENTITY: "true",
    CODIP_DEMO_USER_EMAIL: MVP_DEMO_EMAIL,
    CODIP_HYPERDRIVE_BINDING: "HYPERDRIVE",
  };

  run("node", ["scripts/tools/validate-env.js", "--mode", "preview"], deployEnv);
  run("npm", ["run", "cf:build"], deployEnv);
  run("npm", ["run", "release:check-cloudflare-build-artifact"], deployEnv);
  // OPEN_NEXT_DEPLOY=true stops the OpenNext wrapper from booting miniflare
  // (this host cannot start workerd under a hard ulimit -v). The pre-built
  // .open-next/worker.js is deployed as-is; no R2/KV bindings exist here.
  run("npx", ["wrangler", "deploy", "--env", "mvp"], {
    ...deployEnv,
    OPEN_NEXT_DEPLOY: "true",
  });

  if (withSecrets) {
    // After the first deploy so the Worker exists. Until the secrets land, DB
    // routes fail closed; each secret put releases a new Worker version.
    step("set Worker secrets (values never printed)");
    run(
      "npx",
      ["wrangler", "secret", "put", "DATABASE_URL", "--env", "mvp"],
      {},
      { input: neon.pooledUri },
    );
    run(
      "npx",
      ["wrangler", "secret", "put", "CODIP_ADMIN_TOKEN", "--env", "mvp"],
      {},
      { input: adminToken },
    );
    writeFileSync(MVP_ADMIN_TOKEN_FILE, `${adminToken}\n`, { mode: 0o600 });
    console.log(
      `[deploy-mvp] admin token saved to ${MVP_ADMIN_TOKEN_FILE} (gitignored). Share it out-of-band with reviewers; never commit it.`,
    );
  }

  console.log(
    `\n[deploy-mvp] done. Next: npm run release:smoke -- --read-only --base-url ${MVP_BASE_URL}`,
  );
}

// Only run when this file is the entrypoint (mirrors deploy-production.mjs).
function invokedAsScript() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  main().catch((error) => {
    console.error(`[deploy-mvp] ${error.message}`);
    process.exit(1);
  });
}
