#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const errors = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function requireText(label, source, needle) {
  if (!source.includes(needle)) errors.push(`${label} missing ${needle}`);
}

const adr = read("docs/adr/0002-audit-log-guarantee.md");
const docsIndex = read("docs/README.md");
const operations = read("docs/13-deployment-and-operations.md");
const releaseNotes = read("docs/release-notes.md");
const packageJson = read("package.json");
const releaseGate = read("scripts/tools/release-gate.js");
const audit = read("src/lib/audit.ts");
const auditEventsClient = read("src/lib/audit-events-client.ts");
const auditEventsRoute = read("src/app/api/admin/audit-events/route.ts");

for (const token of [
  "短時間で完結するサーバー側mutation",
  "同一Prisma transaction",
  "外部fetch完了後、DB保存と監査を同一transaction",
  "`/api/admin/audit-events` の同期POST",
  "監査INSERT失敗時は 503",
  "管理セッション開始・終了",
  "ベストエフォート `recordAudit()`",
  "outbox方式へ移行",
  "tests/unit/audit-transaction-routes.test.ts",
  "scripts/tools/check-audit-contract.js",
]) {
  requireText("ADR 0002", adr, token);
}

if (!docsIndex.includes("0002-audit-log-guarantee.md")) {
  console.warn("[audit-contract][warn] docs index does not list ADR 0002");
}
requireText("operations docs", operations, "監査ログ記録保証");
requireText("operations docs", operations, "ADR 0002");
requireText("operations docs", operations, "audit_record_failed");
requireText("operations docs", operations, "outbox + retry + alert");
requireText("release notes", releaseNotes, "Issue #46 監査記録の原子性");
requireText("package.json", packageJson, "release:check-audit-contract");
requireText("release gate", releaseGate, "audit log guarantee contract");
requireText("release gate", releaseGate, "release:check-audit-contract");
requireText("audit helper", audit, "docs/adr/0002-audit-log-guarantee.md");
requireText("audit helper", audit, "同一Prisma transaction");
requireText("audit events client", auditEventsClient, "監査INSERT失敗時は 503");
requireText("audit events client", auditEventsClient, "docs/adr/0002-audit-log-guarantee.md");
requireText("audit events route", auditEventsRoute, "audit_record_failed");

if (errors.length > 0) {
  for (const error of errors) console.error(`[audit-contract][error] ${error}`);
  process.exit(1);
}

console.log("[audit-contract] OK");
