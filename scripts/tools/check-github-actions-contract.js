#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const codeql = fs.readFileSync(path.join(root, ".github/workflows/codeql.yml"), "utf8");

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
requireText("CI workflow", ci, "npm run cf:build");
requireText("CI workflow", ci, "npm run release:check-cloudflare-build-artifact");
requireText("CI workflow", ci, "CODIP_CLOUDFLARE_ALERT_POLICY");
requireText("CI workflow", ci, "CODIP_NEON_MONITORING_EVIDENCE");
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
requireText("CI workflow", ci, "aquasecurity/trivy-action@a9c7b0f06e461e9d4b4d1711f154ee024b8d7ab8");
requireText("CI workflow", ci, "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5");
requireText("CI workflow", ci, "fetch-depth: 0");
requireText("CI workflow", ci, "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
requireText("CI workflow", ci, "gitleaks/gitleaks-action@dcedce43c6f43de0b836d1fe38946645c9c638dc");
requireText("CI workflow", ci, "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
requireText("CodeQL workflow", codeql, "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5");
requireText("CodeQL workflow", codeql, "github/codeql-action/init@1ad29ea4a422cce9a242a9fae469541dcd08addc");
requireText("CodeQL workflow", codeql, "github/codeql-action/analyze@1ad29ea4a422cce9a242a9fae469541dcd08addc");
requireText("CodeQL workflow", codeql, "continue-on-error: true");

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
