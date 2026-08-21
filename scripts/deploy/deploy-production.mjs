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
//   --allow-dirty-deploy  skip the working-tree / origin-main provenance checks.
//                    Use only for a deliberate out-of-band deploy; the override is logged.
//   --skip-ci-check  skip the CI-green gate for the deploy commit. Same caveat.
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
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  WORKER_ROUTE_PLACEHOLDER_CONTENT,
  WORKER_ROUTE_PLACEHOLDER_TYPE,
  planWorkerRouteDnsRecord,
} from "./cloudflare-dns-record-policy.mjs";

const NEON_API = "https://console.neon.tech/api/v2";
const CF_API = "https://api.cloudflare.com/client/v4";

// Stable, non-secret resource identifiers (docs/runbooks/cloudflare-production.md)
const NEON_PROJECT_ID = process.env.CODIP_NEON_PROJECT_ID?.trim() || "falling-dawn-93620497";
const PRODUCTION_HOST = "odip.mirai-dx-platform.com";
const PRODUCTION_ZONE = "mirai-dx-platform.com";
const BASE_URL = `https://${PRODUCTION_HOST}`;

const withSecrets = process.argv.includes("--with-secrets");
const skipDeploy = process.argv.includes("--skip-deploy");
const wranglerDirect = process.argv.includes("--wrangler-direct");
// この2つは呼び出し時に読む。モジュール読込時に固定すると、上書き経路を
// 実行させて確かめるテストが書けない（フラグを立てても既に評価済みになる）。
// 本番の挙動は同じ（スクリプトは1回しか走らない）。
const allowDirtyDeploy = () => process.argv.includes("--allow-dirty-deploy");
const skipCiCheck = () => process.argv.includes("--skip-ci-check");

/**
 * Any string map, not specifically `process.env`.
 *
 * Without this annotation TypeScript infers the parameter type from the
 * `= process.env` default, i.e. `NodeJS.ProcessEnv` — which this project's
 * Next.js types augment with a *required* NODE_ENV. Callers that pass a plain
 * object (the fail-closed tests) would then be rejected for a property these
 * functions never read.
 *
 * @typedef {Record<string, string | undefined>} EnvMap
 */

/**
 * @param {EnvMap} env
 * @param {string} name
 */
function envValue(env, name) {
  return env[name]?.trim() ?? "";
}

// Throws instead of calling process.exit so the fail-closed behaviour can be
// tested. Every call site is inside main(), which is wrapped by the catch at
// the bottom of this file, so the operator still sees
// `[deploy-production] missing required env: X` and an exit code of 1.
/**
 * @param {string} name
 * @param {EnvMap} [env]
 */
function requiredEnv(name, env = process.env) {
  const value = envValue(env, name);
  if (!value) throw new Error(`missing required env: ${name}`);
  return value;
}

// --- Production evidence variables (fail-closed) ---------------------------
//
// These eight values are claims about the real world: who is on call, which
// alert policy exists, when the last restore drill ran. Nothing in this repo
// can derive them, and production-evidence-report.js turns them directly into
// the ✅/❌ rows of the release evidence report.
//
// This script used to carry a default for each one, so an operator who set
// nothing still got a full set of ✅ rows. The default for
// CODIP_CLOUDFLARE_ACCESS_EVIDENCE literally read "Cloudflare Access未設定"
// while the gate it fed reported success — the gate was inverted. An evidence
// gate whose value comes from the actor it audits gives no assurance; one that
// supplies the value to itself is worse, because it manufactures an audit
// record that looks correct.
//
// So: no defaults. An unset variable stops the deploy. The values belong in
// GitHub Repository Variables (docs/runbooks/cloudflare-production.md); their
// required shape is pinned in production-evidence-report.js (EVIDENCE_FORMATS)
// and documented in docs/security/production-evidence-format.md.
export const EVIDENCE_ENV_KEYS = Object.freeze([
  "CODIP_CLOUDFLARE_ACCESS_EVIDENCE",
  "CODIP_MONITORING_CONTACTS",
  "CODIP_CLOUDFLARE_ALERT_POLICY",
  "CODIP_CLOUDFLARE_LOGS_EVIDENCE",
  "CODIP_NEON_MONITORING_EVIDENCE",
  "CODIP_SMOKE_MONITORING_SCHEDULE",
  "CODIP_ROLLBACK_OWNER",
  "CODIP_BACKUP_RESTORE_EVIDENCE",
]);

// Reports every missing key at once. This is a manually run deploy; failing one
// variable per attempt would cost the operator eight round trips.
/**
 * @param {EnvMap} [env]
 * @returns {Record<string, string>}
 */
export function resolveEvidenceEnv(env = process.env) {
  const missing = EVIDENCE_ENV_KEYS.filter((key) => !envValue(env, key));
  if (missing.length > 0) {
    throw new Error(
      `missing required production evidence env: ${missing.join(", ")}\n` +
        "  These are attestations about monitoring, rollback and restore posture.\n" +
        "  This script must not supply them: a value it invents would be recorded\n" +
        "  as verified evidence in the release report.\n" +
        "  Set them as GitHub Repository Variables or in the deploy shell.\n" +
        "  Required shape: docs/security/production-evidence-format.md\n" +
        "  Registration:   docs/runbooks/cloudflare-production.md",
    );
  }
  return Object.fromEntries(EVIDENCE_ENV_KEYS.map((key) => [key, requiredEnv(key, env)]));
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

// Exported so the wiring itself can be executed, not just described. A test
// that only exercises resolveEvidenceEnv() proves the function is fail-closed
// while saying nothing about whether main() still calls it: replacing the line
// below with `const evidenceEnv = {}` left the whole suite green (T-B12).
/** 素性検証で外部 CLI を叩くときの上限。ネットワーク停止で deploy が無限待機しないため。 */
const PROBE_TIMEOUT_MS = 60_000;

/**
 * 素性検証用の外部コマンド実行。**タイムアウトは fail-closed** にする。
 *
 * `git fetch` / `git ls-remote` / `gh api` はいずれもネットワークを触る。
 * 時間制限なしで spawnSync すると、上流が無応答のとき deploy が黙って止まり続ける。
 * 「応答が無い」は「検証に通った」ではないので、必ず例外にする。
 */
function runProbe(command, args) {
  const r = spawnSync(command, args, {
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  if (r.error) {
    const code = r.error.code === "ETIMEDOUT" ? `timed out after ${PROBE_TIMEOUT_MS}ms` : r.error.code;
    throw new Error(`${command} ${args.join(" ")} failed: ${code}`);
  }
  // timeout で kill された場合 status は null になる。0 以外と同様に失敗として扱う。
  if (r.status !== 0) {
    const why = r.status === null ? `killed by ${r.signal ?? "signal"}` : `exit=${r.status}`;
    throw new Error(`${command} ${args.join(" ")} failed (${why}): ${(r.stderr || "").trim()}`);
  }
  return r;
}

/**
 * デプロイ対象 commit の素性を検証する。
 *
 * これが無いと、このスクリプトは**ローカル作業ツリーの内容をそのまま本番へ出す**。
 * 未コミット・未 push・未マージ・CI 未通過のコードが本番へ到達しうる状態であり、
 * 「main の確定 commit と検証済み commit の一致を確認し、その固定 commit から
 * デプロイする」という運用条件を機械的に担保できていなかった。
 *
 * 検証するのは次の4点。いずれも fail-closed。
 *   1. 作業ツリーがクリーン（未コミット変更が無い）
 *   2. HEAD が origin/main と一致（マージ済みの確定 commit である）
 *   3. HEAD がリモートに存在する（push 済みで、あとから追跡できる）
 *   4. その commit の CI が success（検証済みである）
 *
 * `--allow-dirty-deploy` で 1〜3 を、`--skip-ci-check` で 4 を明示的に外せる。
 * 外した事実は必ず標準出力へ残す（黙って緩めない）。
 */
function verifyCommitProvenance() {
  step("verify deploy commit provenance (git + CI)");

  // raw=true は porcelain 用。全体を trim すると1行目の先頭スペース
  // （`git status --porcelain` の XY フィールド）が消え、パスの先頭を削ってしまう。
  const git = (args, { raw = false } = {}) => {
    const r = runProbe("git", args);
    const out = r.stdout || "";
    return raw ? out.replace(/\n$/, "") : out.trim();
  };

  const head = git(["rev-parse", "HEAD"]);

  if (allowDirtyDeploy()) {
    console.warn(
      `[deploy-production] ⚠️ --allow-dirty-deploy: skipping working-tree / origin-main checks (HEAD=${head})`,
    );
  } else {
    const dirty = git(["status", "--porcelain"], { raw: true });
    if (dirty) {
      // porcelain v1 は「XY<space>path」。X/Y は staged/unstaged の状態で、
      // 片方が空白のこともある。固定長 slice はパスの先頭を削るため使わない。
      const files = dirty
        .split("\n")
        .map((line) => line.replace(/^.{2} /, ""))
        .join(", ");
      throw new Error(
        `working tree is not clean; refusing to deploy uncommitted state. Files: ${files}. ` +
          "Commit or stash first, or pass --allow-dirty-deploy to override.",
      );
    }

    git(["fetch", "origin", "main", "--quiet"]);
    const originMain = git(["rev-parse", "origin/main"]);
    if (head !== originMain) {
      throw new Error(
        `HEAD (${head}) does not match origin/main (${originMain}); refusing to deploy an unmerged commit. ` +
          "Merge first, or pass --allow-dirty-deploy to override.",
      );
    }

    // push 済みであることの確認。origin/main と一致していれば満たされるが、
    // ローカル ref が古い可能性を排除するためリモートへ直接問い合わせる。
    const remoteMain = git(["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0];
    if (remoteMain !== head) {
      throw new Error(
        `remote main (${remoteMain}) does not match HEAD (${head}); local origin/main ref is stale. ` +
          "Run `git fetch origin main` and re-check.",
      );
    }
  }

  if (skipCiCheck()) {
    console.warn("[deploy-production] ⚠️ --skip-ci-check: deploying without confirming CI success");
    return head;
  }

  // CI 結果は GitHub を単一の真実として引く。gh が無い / 認証されていない場合は
  // 「確認できなかった」であって「成功した」ではないため、停止する。
  // --paginate + per_page=100 で全ページを見る。既定の30件だけを見ると、
  // 2ページ目以降の failure を取りこぼして「CI 失敗 commit をデプロイ」できてしまう。
  let gh;
  try {
    gh = runProbe("gh", [
      "api",
      "--paginate",
      `repos/{owner}/{repo}/commits/${head}/check-runs?per_page=100`,
      "--jq",
      '.check_runs[] | "\(.name)=\(.conclusion)"',
    ]);
  } catch (error) {
    throw new Error(
      `could not read CI results for ${head} via gh (${error.message}). ` +
        "Fix gh auth, or pass --skip-ci-check to deploy without this gate.",
    );
  }
  const runs = (gh.stdout || "").trim().split("\n").filter(Boolean);
  if (runs.length === 0) {
    throw new Error(`no CI check-runs found for ${head}; refusing to deploy an unverified commit.`);
  }
  // skipped は GitHub の必須チェックでも成功として扱われるため、ここでも許容する。
  const bad = runs.filter((line) => {
    const conclusion = line.split("=").pop();
    return conclusion !== "success" && conclusion !== "skipped" && conclusion !== "neutral";
  });
  if (bad.length > 0) {
    throw new Error(`CI is not green for ${head}: ${bad.join(", ")}`);
  }
  console.log(`[deploy-production] commit ${head} verified: clean tree, == origin/main, ${runs.length} CI checks green`);
  return head;
}

export async function main() {
  // --skip-deploy は DNS 変更・migration・seed・deploy・secrets のいずれにも
  // 到達せず return する読取り専用の preflight である（下の skipDeploy 分岐が
  // ensureDnsRecord() より前にある）。何もデプロイしないので素性ゲートは課さない。
  // ここで止めると、接続先・権限・migration 状態を事前に確かめる手段が失われる。
  // 証跡ゲート（resolveEvidenceEnv）が --skip-deploy を免除しているのと同じ理由。
  // 既存の skipDeploy はモジュール読込時に固定される。ゲートの免除判定は
  // 呼び出し時に読み直す（既存定数の評価タイミングは変えない。他の分岐が依存しているため）。
  const readOnlyPreflight = skipDeploy || process.argv.includes("--skip-deploy");
  if (!readOnlyPreflight) {
    const deployCommit = verifyCommitProvenance();
    console.log(`[deploy-production] deploying fixed commit ${deployCommit}`);
  } else {
    console.log("[deploy-production] --skip-deploy: read-only preflight (provenance gate not applied)");
  }

  const neonKey = requiredEnv("NEON_API_KEY");
  const cfToken = requiredEnv("CLOUDFLARE_API_TOKEN");
  requiredEnv("CLOUDFLARE_ACCOUNT_ID");

  // Checked before any remote call or mutation (Neon reads, DNS record
  // creation): a deploy that cannot produce its evidence must stop before it
  // leaves half-applied state, not after. --skip-deploy is a dry run that
  // returns before cf:deploy:production and produces no evidence report, so it
  // needs no evidence values -- but it must also not mutate DNS, so the
  // skipDeploy return below happens before ensureDnsRecord().
  const evidenceEnv = skipDeploy ? {} : resolveEvidenceEnv();

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

  if (skipDeploy) {
    console.log(
      "[deploy-production] --skip-deploy: stopping before DNS mutation and cf:deploy:production",
    );
    return;
  }

  step("ensure DNS record (zone route target)");
  await ensureDnsRecord(cfToken);

  step(
    wranglerDirect
      ? "release gates + wrangler deploy --env production (workerd-free path)"
      : "cf:deploy:production (validate-env -> evidence -> placeholders -> build -> artifact check -> deploy)",
  );
  const deployEnv = {
    ...evidenceEnv,
    // Measured, not declared: resolveNeonUris() already asked the Neon API
    // which branch is the default one. The former default asserted
    // "production (default branch of <project>)" without checking, so a
    // renamed or re-pointed default branch would have been reported as
    // production regardless of the truth.
    CODIP_NEON_BRANCH: neon.branchName,
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
    // OPEN_NEXT_DEPLOY=true is the OpenNext wrapper's own re-entry flag: it stops
    // `wrangler deploy` from delegating back to `opennextjs-cloudflare deploy`
    // (which boots miniflare/workerd and cannot start under this host's hard
    // `ulimit -v`). The pre-built .open-next/worker.js is deployed as-is.
    run("npx", ["wrangler", "deploy", "--env", "production"], {
      ...deployEnv,
      OPEN_NEXT_DEPLOY: "true",
    });
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

// Only run when this file is the entrypoint. tests/unit/deploy-production-evidence.test.ts
// imports resolveEvidenceEnv and main from here to prove the fail-closed
// behaviour and its wiring; without the guard, importing the module would start
// a real production deploy.
function invokedAsScript() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // realpath because Node resolves module URLs through symlinks, so a bare
    // pathToFileURL(argv[1]) would not match import.meta.url via a symlinked bin.
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  main().catch((error) => {
    console.error(`[deploy-production] ${error.message}`);
    process.exit(1);
  });
}
