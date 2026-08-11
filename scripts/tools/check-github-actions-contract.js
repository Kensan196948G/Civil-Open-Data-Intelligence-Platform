#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
function readNormalized(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

const WORKFLOW_DIR = ".github/workflows";

/**
 * 全ワークフローに掛かる検査 (SHA ピン・禁止パターン) の対象は、ディレクトリを
 * 実際に読んで導出する。ハードコード列挙だと workflow を1つ足した日に検査対象が
 * 増えず、追加分だけが無検査のまま緑で通る (Issue #133)。
 */
function listWorkflowFiles() {
  return fs
    .readdirSync(path.join(root, WORKFLOW_DIR), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => `${WORKFLOW_DIR}/${entry.name}`)
    .sort();
}

const workflowFiles = listWorkflowFiles();

// 走査対象が空のときに「対象が無いので合格」とすると、ディレクトリの改名やパス誤りが
// 「検査していない」ではなく「検査して合格した」として現れる。0 件は合格ではない。
if (workflowFiles.length === 0) {
  console.error(`[github-actions-contract][error] no workflow files found under ${WORKFLOW_DIR}`);
  process.exit(1);
}

const workflowSources = new Map(workflowFiles.map((file) => [file, readNormalized(file)]));

const errors = [];

/** 内容検査が名指しするファイル。消えていれば空文字ではなく error として現れる。 */
function workflowSource(relativePath) {
  const source = workflowSources.get(relativePath);
  if (source === undefined) {
    errors.push(`expected workflow file is missing: ${relativePath}`);
    return "";
  }
  return source;
}

const ci = workflowSource(".github/workflows/ci.yml");
const codeql = workflowSource(".github/workflows/codeql.yml");
const neonBackup = workflowSource(".github/workflows/neon-backup.yml");
const productionSmoke = workflowSource(".github/workflows/production-smoke.yml");
const packageJson = readNormalized("package.json");

function requireText(label, source, needle) {
  if (!source.includes(needle)) {
    errors.push(`${label} missing ${needle}`);
  }
}

function requireJobBlock(source, jobName) {
  const match = source.match(new RegExp(`\\n  ${jobName}:\\n[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:\\n|\\n?$)`));
  if (!match) {
    errors.push(`CI workflow missing ${jobName} job`);
    return "";
  }
  return match[0];
}

const nodePreviewJob = requireJobBlock(ci, "node-preview");

requireText("CI workflow", ci, "permissions:\n  contents: read");
requireText("CI workflow", ci, "pull-requests: read");
requireText("CI workflow", ci, "workflow_dispatch:");
requireText("CI workflow", ci, "production-target-env:");
requireText("CI workflow", ci, "npm run release:validate-env:production-target");
requireText("CI workflow", ci, "npm run release:check-audit-contract");
requireText("CI workflow", ci, "npm run typecheck");
requireText("CI workflow", ci, "npm run cf:build");
requireText("CI workflow", ci, "npm run release:check-cloudflare-build-artifact");
requireText("CI workflow", ci, "CODIP_CLOUDFLARE_ACCESS_EVIDENCE");
requireText("CI workflow", ci, "CODIP_CLOUDFLARE_ALERT_POLICY");
requireText("CI workflow", ci, "CODIP_NEON_MONITORING_EVIDENCE");
requireText("CI workflow", ci, "CODIP_BACKUP_RESTORE_EVIDENCE");
requireText("CI workflow", ci, "npm run db:pg:check-postgis-ddl");
requireText("CI workflow", ci, "npm run db:pg:check-drift");
requireText("CI workflow", ci, "npm run release:smoke -- --read-only");
requireText("CI workflow", ci, "--expect-standard-records");
requireText("CI workflow", ci, "--expect-seed-standard-record");
requireText("CI workflow", ci, "Lint GitHub Actions workflows");
requireText("CI workflow", ci, "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz");
requireText("CI workflow", ci, "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8");
requireText("CI workflow", ci, "sha256sum -c -");
requireText("CI workflow", ci, "./actionlint -color");
requireText("CI workflow", ci, "docker-image-security:");
requireText("CI workflow", ci, "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25");
requireText("CI workflow", ci, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
requireText("CI workflow", ci, "fetch-depth: 0");
requireText("CI workflow", ci, "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
requireText("CI workflow", ci, "gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7");
requireText("CI workflow", ci, "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
requireText("Neon backup workflow", neonBackup, "name: Neon Backup");
requireText("Neon backup workflow", neonBackup, "schedule:");
requireText("Neon backup workflow", neonBackup, "workflow_dispatch:");
requireText("Neon backup workflow", neonBackup, "permissions:\n  contents: read");
requireText("Neon backup workflow", neonBackup, "persist-credentials: false");
requireText("Neon backup workflow", neonBackup, "secrets.CODIP_NEON_PGDUMP_DATABASE_URL");
requireText("Neon backup workflow", neonBackup, "secrets.CODIP_NEON_BACKUP_ENCRYPTION_PASSPHRASE");
requireText("Neon backup workflow", neonBackup, "::add-mask::$NEON_DATABASE_URL");
requireText("Neon backup workflow", neonBackup, "::add-mask::$CODIP_BACKUP_ENCRYPTION_PASSPHRASE");
requireText("Neon backup workflow", neonBackup, "pg_dump --format=custom --no-owner --no-privileges --file");
requireText("Neon backup workflow", neonBackup, "gpg --batch --yes --pinentry-mode loopback");
requireText("Neon backup workflow", neonBackup, "shred -u \"$dump_path\" || rm -f \"$dump_path\"");
requireText("Neon backup workflow", neonBackup, "release:create-neon-backup-evidence");
requireText("Neon backup workflow", neonBackup, "release:check-neon-backup-evidence");
requireText("Neon backup workflow", neonBackup, "github-actions-artifact://");
requireText("Neon backup workflow", neonBackup, "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
requireText("Neon backup workflow", neonBackup, "retention-days: 14");
if (neonBackup.includes("pull_request:")) {
  errors.push("Neon backup workflow must not run on pull_request");
}
requireText("Production smoke workflow", productionSmoke, "name: Production Smoke");
requireText("Production smoke workflow", productionSmoke, "schedule:");
requireText("Production smoke workflow", productionSmoke, "workflow_dispatch:");
requireText("Production smoke workflow", productionSmoke, "permissions:\n  contents: read");
requireText("Production smoke workflow", productionSmoke, "--strict-production");
requireText("Production smoke workflow", productionSmoke, "--allow-preview-down");
requireText("Production smoke workflow", productionSmoke, "https://odip.mirai-dx-platform.com");
requireText("Production smoke workflow", productionSmoke, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
requireText("Production smoke workflow", productionSmoke, "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
requireText("Production smoke workflow", productionSmoke, "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
requireText("Production smoke workflow", productionSmoke, "retention-days: 14");
requireText("Production smoke workflow", productionSmoke, "timeout-minutes: 5");
requireText("Production smoke workflow", productionSmoke, "persist-credentials: false");
requireText("Production smoke workflow", productionSmoke, 'cron: "7,22,37,52 * * * *"');
requireText("Production smoke workflow", productionSmoke, "cancel-in-progress: false");
requireText("Production smoke workflow", productionSmoke, "continue-on-error: true");
requireText("Production smoke workflow", productionSmoke, "if: always()");
requireText("Production smoke workflow", productionSmoke, "if: steps.production-status.outcome == 'failure'");
requireText("Neon backup workflow", neonBackup, "CODIP_NEON_BRANCH: main");
requireText("Neon backup workflow", neonBackup, "vars.CODIP_NEON_PGDUMP_HOST");
requireText("Neon backup workflow", neonBackup, "--endpoint-host");
if (productionSmoke.includes("pull_request:")) {
  errors.push("Production smoke workflow must not run on pull_request");
}
requireText("node-preview job", nodePreviewJob, "persist-credentials: false");
requireText("node-preview job", nodePreviewJob, "Prepare SQLite preview database");
requireText("node-preview job", nodePreviewJob, "npm run db:generate");
requireText("node-preview job", nodePreviewJob, "npx prisma migrate deploy");
requireText("node-preview job", nodePreviewJob, "npx prisma db seed");
requireText("node-preview job", nodePreviewJob, "Build production app");
requireText("node-preview job", nodePreviewJob, "npm run build");
requireText("node-preview job", nodePreviewJob, "Direct Node preview release smoke");
requireText("node-preview job", nodePreviewJob, "npm run start:checked -- --hostname 127.0.0.1 --port 3110");
requireText("node-preview job", nodePreviewJob, "http://127.0.0.1:3110/api/ready");
requireText("node-preview job", nodePreviewJob, "npm run release:smoke -- --base-url http://127.0.0.1:3110");
requireText("CodeQL workflow", codeql, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
requireText("CodeQL workflow", codeql, "github/codeql-action/init@1ad29ea4a422cce9a242a9fae469541dcd08addc");
requireText("CodeQL workflow", codeql, "github/codeql-action/analyze@1ad29ea4a422cce9a242a9fae469541dcd08addc");
// analyze は最終 step なので、落ちても実行すべき後続が無い。continue-on-error を付けると
// security scan が必ず success になり、「CI必須チェックが全て success (security scan含む)」を
// 満たしたと主張できなくなる (Issue #132)。復活を検知するため、不在側を契約にする。
if (codeql.includes("continue-on-error")) {
  errors.push("CodeQL workflow must not use continue-on-error: a security scan that cannot fail is not a gate");
}
requireText("package.json", packageJson, "\"typecheck\": \"npm run db:generate && tsc --noEmit\"");

const forbiddenPatterns = [
  "pull_request_target:",
  "docker/scout-action",
  "aquasecurity/trivy-action@v0.31",
  "aquasecurity/trivy-action@v0.32",
  "aquasecurity/trivy-action@v0.33",
];

for (const pattern of forbiddenPatterns) {
  for (const [file, source] of workflowSources) {
    if (source.includes(pattern)) {
      errors.push(`${file} must not contain ${pattern}`);
    }
  }
}

const actionRefs = [...workflowSources].flatMap(([file, source]) =>
  [...source.matchAll(/uses:\s+[^@\s]+\/[^@\s]+@([^\s#]+)/g)].map((match) => ({
    file,
    ref: match[1],
  })),
);

// 参照が1件も採れないなら、正規表現が実体に追随できていないか workflow が空である。
// どちらも「ピンが正しい」ではないので、0 件を合格にしない。
if (actionRefs.length === 0) {
  errors.push(`no action refs found in ${workflowFiles.length} workflow file(s): pin check inspected nothing`);
}

const unpinnedActions = actionRefs
  .filter(({ ref }) => !/^[0-9a-f]{40}$/i.test(ref))
  .map(({ file, ref }) => `${file}@${ref}`);

if (unpinnedActions.length > 0) {
  errors.push(`workflows have non-SHA action refs: ${unpinnedActions.join(", ")}`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[github-actions-contract][error] ${error}`);
  process.exit(1);
}

// 何件を見たうえでの OK かをログに残す。件数が落ちたことをログ差分で気付けるようにする。
console.log(
  `[github-actions-contract] OK (${workflowFiles.length} workflow files, ${actionRefs.length} action refs pinned)`,
);
