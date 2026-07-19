#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
function readNormalized(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

const ci = readNormalized(".github/workflows/ci.yml");
const codeql = readNormalized(".github/workflows/codeql.yml");
const packageJson = readNormalized("package.json");

const errors = [];

function requireText(label, source, needle) {
  if (!source.includes(needle)) {
    errors.push(`${label} missing ${needle}`);
  }
}

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
requireText("CI workflow", ci, "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0");
requireText("CI workflow", ci, "fetch-depth: 0");
requireText("CI workflow", ci, "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
requireText("CI workflow", ci, "gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7");
requireText("CI workflow", ci, "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
requireText("CodeQL workflow", codeql, "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0");
requireText("CodeQL workflow", codeql, "github/codeql-action/init@1ad29ea4a422cce9a242a9fae469541dcd08addc");
requireText("CodeQL workflow", codeql, "github/codeql-action/analyze@1ad29ea4a422cce9a242a9fae469541dcd08addc");
requireText("CodeQL workflow", codeql, "continue-on-error: true");
requireText("package.json", packageJson, "\"typecheck\": \"npm run db:generate && tsc --noEmit\"");

const forbiddenPatterns = [
  "pull_request_target:",
  "docker/scout-action",
  "aquasecurity/trivy-action@v0.31",
  "aquasecurity/trivy-action@v0.32",
  "aquasecurity/trivy-action@v0.33",
];

for (const pattern of forbiddenPatterns) {
  if (ci.includes(pattern) || codeql.includes(pattern)) {
    errors.push(`GitHub workflows must not contain ${pattern}`);
  }
}

const unpinnedActions = [
  ...`${ci}\n${codeql}`.matchAll(/uses:\s+[^@\s]+\/[^@\s]+@([^\s#]+)/g),
]
  .map((match) => match[1])
  .filter((ref) => !/^[0-9a-f]{40}$/i.test(ref));

if (unpinnedActions.length > 0) {
  errors.push(`CI workflow has non-SHA action refs: ${unpinnedActions.join(", ")}`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[github-actions-contract][error] ${error}`);
  process.exit(1);
}

console.log("[github-actions-contract] OK");
