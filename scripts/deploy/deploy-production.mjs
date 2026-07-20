#!/usr/bin/env node
// CODIP production deploy pipeline (Cloudflare Workers + Neon).
//
// Secrets-safe by design:
// - Neon connection URIs are fetched via the Neon API and stay in-process;
//   they are passed to child processes through env only.
// - Worker secrets are piped to `wrangler secret put` via stdin.
// - Nothing secret is printed; child output is limited to tools that already
//   redact secret values (validate-env, wrangler).
//
// Required env: NEON_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// Flags:
//   --with-secrets   also set Worker secrets (CODIP_TRUST_PROXY_SECRET,
//                    CODIP_ADMIN_EMAILS). CODIP_ADMIN_EMAILS must be provided
//                    via env when this flag is used. CODIP_TRUST_PROXY_SECRET
//                    is generated in-process (64 hex chars) unless provided.
//                    NOTE: re-running rotates the proxy secret; once Cloudflare
//                    Access header injection is configured, rotate both sides
//                    together.
//   --skip-deploy    run checks + DNS/secrets only, skip `cf:deploy:production`.
//   --wrangler-direct  run the same release gates individually, then deploy with
//                    `wrangler deploy --env production` instead of the OpenNext
//                    wrapper. Needed on hosts where workerd cannot start
//                    (the wrapper boots miniflare just to read env; workerd's V8
//                    sandbox requires a large virtual address space reservation
//                    and fails under a hard `ulimit -v`). Equivalent for this
//                    project: no R2/KV incremental-cache bindings exist, so the
//                    wrapper adds no cache-population step over plain wrangler.
//
// Usage: source ~/.bashrc && node scripts/deploy/deploy-production.mjs --with-secrets

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  WORKER_ROUTE_PLACEHOLDER_CONTENT,
  WORKER_ROUTE_PLACEHOLDER_TYPE,
  planWorkerRouteDnsRecord,
} from "./cloudflare-dns-record-policy.mjs";

const NEON_API = "https://console.neon.tech/api/v2";
const CF_API = "https://api.cloudflare.com/client/v4";

// Stable, non-secret resource identifiers (docs/runbooks/cloudflare-production.md)
const NEON_PROJECT_ID = process.env.CODIP_NEON_PROJECT_ID?.trim() || "falling-dawn-93620497";
const PRODUCTION_HOST = "civilopendata.mirai-dx-platform.com";
const PRODUCTION_ZONE = "mirai-dx-platform.com";
const BASE_URL = `https://${PRODUCTION_HOST}`;

const withSecrets = process.argv.includes("--with-secrets");
const skipDeploy = process.argv.includes("--skip-deploy");
const wranglerDirect = process.argv.includes("--wrangler-direct");

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[deploy-production] missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

function step(title) {
  console.log(`\n=== [deploy-production] ${title} ===`);
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
  const branch = branches.find((b) => b.default) ?? branches[0];
  if (!branch) throw new Error("Neon project has no branches");

  const { databases } = await neonGet(
    apiKey,
    `/projects/${NEON_PROJECT_ID}/branches/${branch.id}/databases`,
  );
  const database = databases[0];
  if (!database) throw new Error("Neon default branch has no databases");

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
    console.error(`[deploy-production] command failed (exit=${result.status}): ${command} ${args.filter((a) => !a.includes("://")).join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

async function ensureDnsRecord(token) {
  const zones = await cfRequest(token, "GET", `/zones?name=${PRODUCTION_ZONE}`);
  const zone = zones[0];
  if (!zone) throw new Error(`zone ${PRODUCTION_ZONE} not found`);

  const records = await cfRequest(
    token,
    "GET",
    `/zones/${zone.id}/dns_records?name=${PRODUCTION_HOST}`,
  );
  const plan = planWorkerRouteDnsRecord(records, PRODUCTION_HOST);
  if (plan.action === "reuse") {
    console.log(`[deploy-production] ${plan.message}`);
    return;
  }
  if (plan.action === "block") {
    throw new Error(`${plan.message}. Stop before deploy; verify DNS/route ownership in Cloudflare.`);
  }

  // Proxied placeholder origin (100::) for hostnames served entirely by a
  // Worker route. If a different record already exists, stop above.
  await cfRequest(token, "POST", `/zones/${zone.id}/dns_records`, {
    type: WORKER_ROUTE_PLACEHOLDER_TYPE,
    name: PRODUCTION_HOST,
    content: WORKER_ROUTE_PLACEHOLDER_CONTENT,
    proxied: true,
    comment: "CODIP Worker route target (managed via scripts/deploy/deploy-production.mjs)",
  });
  console.log(`[deploy-production] created proxied AAAA record for ${PRODUCTION_HOST}`);
}

async function main() {
  const neonKey = requiredEnv("NEON_API_KEY");
  const cfToken = requiredEnv("CLOUDFLARE_API_TOKEN");
  requiredEnv("CLOUDFLARE_ACCOUNT_ID");

  step("resolve Neon connection targets (in-process)");
  const neon = await resolveNeonUris(neonKey);
  console.log(`[deploy-production] Neon project=${NEON_PROJECT_ID} branch=${neon.branchName}`);

  step("prisma migrate status (read-only gate)");
  run("npx", ["prisma", "migrate", "status", "--schema", "prisma/postgresql/schema.prisma"], {
    DATABASE_URL: neon.directUri,
  });

  // Resolved once: also fed to the validate-env gate inside cf:deploy:production.
  // (When --with-secrets is not passed, the generated value is used for gate
  // validation only and the Worker keeps its previously stored secret.)
  const adminEmails = withSecrets || !skipDeploy ? requiredEnv("CODIP_ADMIN_EMAILS") : "";
  const proxySecret =
    process.env.CODIP_TRUST_PROXY_SECRET?.trim() || randomBytes(32).toString("hex");

  step("ensure DNS record (zone route target)");
  await ensureDnsRecord(cfToken);

  if (skipDeploy) {
    console.log("[deploy-production] --skip-deploy: stopping before cf:deploy:production");
    return;
  }

  step(
    wranglerDirect
      ? "release gates + wrangler deploy --env production (workerd-free path)"
      : "cf:deploy:production (validate-env -> evidence -> placeholders -> build -> artifact check -> deploy)",
  );
  const evidenceDefaults = {
    CODIP_CLOUDFLARE_ACCESS_EVIDENCE:
      "Cloudflare Access未設定 (ユーザー手動設定を予定)。管理系はCODIP_TRUST_PROXY_SECRET必須のfail-closed全拒否で公開。Access設定後にsecret rotationを実施",
    CODIP_MONITORING_CONTACTS: "GitHub owner Kensan196948G (repo issues / registered email)",
    CODIP_CLOUDFLARE_ALERT_POLICY:
      "初期リリースはWorkers observability (wrangler.jsonc enabled=true) のみ。専用alert policyは未設定でIssue #63系で追跡",
    CODIP_CLOUDFLARE_LOGS_EVIDENCE:
      "Workers observability enabled=true。query_worker_observability (MCP) で照会可能",
    CODIP_NEON_MONITORING_EVIDENCE:
      "Neon console monitoring + MCP list_slow_queries。history retention 24h (Issue #63で拡張検討)",
    CODIP_SMOKE_MONITORING_SCHEDULE:
      "release:post-release-status をリリース直後 + 月-土の自律セッションで実行",
    CODIP_ROLLBACK_OWNER:
      "human: kensan (AIによる自動rollback禁止 — docs/runbooks/rollback.md)",
    CODIP_BACKUP_RESTORE_EVIDENCE:
      "Neon backup branch backup-prerelease-v0.1.0-20260720 (br-shiny-pond-afwbww1h, LSN 0/24D2000)",
    CODIP_NEON_BRANCH: `production (default branch of ${NEON_PROJECT_ID})`,
  };
  const evidenceEnv = Object.fromEntries(
    Object.entries(evidenceDefaults).map(([key, fallback]) => [
      key,
      process.env[key]?.trim() || fallback,
    ]),
  );

  const deployEnv = {
    ...evidenceEnv,
    CODIP_DEPLOY_TARGET: "production",
    CODIP_ENV_MODE: "production",
    CODIP_BASE_URL: BASE_URL,
    CODIP_HYPERDRIVE_BINDING: "HYPERDRIVE",
    CODIP_TRUST_PROXY_AUTH: "true",
    CODIP_TRUST_PROXY_HEADERS: "true",
    CODIP_DISABLE_TOKEN_AUTH: "true",
    CODIP_TRUST_PROXY_SECRET: proxySecret,
    CODIP_ADMIN_EMAILS: adminEmails,
    DATABASE_URL: neon.pooledUri,
    CODIP_MIGRATION_DATABASE_URL: neon.directUri,
    // Local-emulation placeholder only: the OpenNext wrapper boots miniflare to
    // read env before deploying and requires this var for the Hyperdrive
    // binding. Never used by the deployed Worker.
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
      "postgresql://codip:codip@localhost:5432/codip",
  };

  if (wranglerDirect) {
    // Same gate chain as cf:deploy:production, then plain wrangler deploy.
    run("npm", ["run", "release:validate-env:production-target"], deployEnv);
    run("npm", ["run", "release:production-evidence", "--", "--strict"], deployEnv);
    run("npm", ["run", "release:check-production-placeholders", "--", "--env", "production"], deployEnv);
    run("npm", ["run", "cf:build"], deployEnv);
    run("npm", ["run", "release:check-cloudflare-build-artifact"], deployEnv);
    run("npx", ["wrangler", "deploy", "--env", "production"], deployEnv);
  } else {
    run("npm", ["run", "cf:deploy:production"], deployEnv);
  }

  if (withSecrets) {
    // After the first deploy so the Worker exists (`wrangler secret put` cannot
    // target a missing Worker non-interactively). Until secrets land, admin
    // surfaces stay fail-closed; each secret put releases a new version.
    step("set Worker secrets (values never printed)");
    run(
      "npx",
      ["wrangler", "secret", "put", "CODIP_TRUST_PROXY_SECRET", "--env", "production"],
      {},
      { input: proxySecret },
    );
    run(
      "npx",
      ["wrangler", "secret", "put", "CODIP_ADMIN_EMAILS", "--env", "production"],
      {},
      { input: adminEmails },
    );
  }

  console.log("\n[deploy-production] done. Next: release:smoke --read-only against production.");
}

main().catch((error) => {
  console.error(`[deploy-production] ${error.message}`);
  process.exit(1);
});
