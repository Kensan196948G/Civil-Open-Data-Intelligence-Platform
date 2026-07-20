#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const runbookPath = path.join(root, "docs/runbooks/cloudflare-neon-staging.md");
const runbook = fs.existsSync(runbookPath) ? fs.readFileSync(runbookPath, "utf8") : "";
const productionRunbookPath = path.join(root, "docs/runbooks/cloudflare-production.md");
const productionRunbook = fs.existsSync(productionRunbookPath) ? fs.readFileSync(productionRunbookPath, "utf8") : "";
const monitoringRunbook = fs.readFileSync(path.join(root, "docs/runbooks/monitoring.md"), "utf8");
const docs13 = fs.readFileSync(path.join(root, "docs/13-deployment-and-operations.md"), "utf8");
const docs16 = fs.readFileSync(path.join(root, "docs/16-release-readiness-checklist.md"), "utf8");
const rollbackRunbook = fs.readFileSync(path.join(root, "docs/runbooks/rollback.md"), "utf8");
const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
const wrangler = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
const accessVars = fs.readFileSync(path.join(root, "infra/cloudflare/terraform.tfvars.example"), "utf8");
const accessReadme = fs.readFileSync(path.join(root, "infra/cloudflare/README.md"), "utf8");
const dbLoader = fs.readFileSync(path.join(root, "src/lib/db.ts"), "utf8");
const pgSchema = fs.readFileSync(path.join(root, "prisma/postgresql/schema.prisma"), "utf8");

const errors = [];

function requireText(label, source, needle) {
  if (!source.includes(needle)) errors.push(`${label} missing ${needle}`);
}

requireText(".env.example", envExample, "postgresql://user:password@host/db?schema=public&sslmode=require");
requireText(".env.example", envExample, "CODIP_DEPLOY_TARGET");
requireText(".env.example", envExample, "CODIP_HYPERDRIVE_BINDING");
requireText(".env.example", envExample, "CODIP_NEON_BRANCH");
requireText(".env.example", envExample, "CODIP_MIGRATION_DATABASE_URL");
requireText(".env.example", envExample, "civilopendata.mirai-dx-platform.com");
requireText(".env.example", envExample, "CODIP_CLOUDFLARE_ACCESS_EVIDENCE");
requireText(".env.example", envExample, "CODIP_CLOUDFLARE_ALERT_POLICY");
requireText(".env.example", envExample, "CODIP_NEON_MONITORING_EVIDENCE");
requireText(".env.example", envExample, "CODIP_BACKUP_RESTORE_EVIDENCE");
requireText(".env.example", envExample, "CODIP_NEON_BACKUP_EVIDENCE_JSON");
requireText("wrangler.jsonc", wrangler, "civilopendata.mirai-dx-platform.com");
requireText("wrangler.jsonc", wrangler, "\"zone_name\": \"mirai-dx-platform.com\"");
requireText("wrangler.jsonc", wrangler, "\"workers_dev\": false");
requireText("wrangler.jsonc", wrangler, "\"observability\"");
requireText("wrangler.jsonc", wrangler, "\"enabled\": true");
requireText("wrangler.jsonc", wrangler, "\"CODIP_DISABLE_TOKEN_AUTH\": \"true\"");
requireText("infra/cloudflare terraform vars", accessVars, "application_domain     = \"civilopendata.mirai-dx-platform.com\"");
requireText("infra/cloudflare README", accessReadme, "Terraform >= 1.9");

for (const token of [
  "civilopendata.mirai-dx-platform.com",
  "Cloudflare Hyperdrive",
  "CODIP_HYPERDRIVE_BINDING",
  "CODIP_MIGRATION_DATABASE_URL",
  "CODIP_NEON_BRANCH",
  "Cloudflare Access",
  "npx prisma migrate status",
  "npx prisma migrate deploy",
  "npm run db:pg:check-drift",
  "npm run db:pg:check-postgis-ddl",
  "npm run release:smoke",
  "npm run release:production-evidence",
  "CODIP_CLOUDFLARE_ACCESS_EVIDENCE",
  "CODIP_CLOUDFLARE_ALERT_POLICY",
  "CODIP_NEON_MONITORING_EVIDENCE",
  "CODIP_BACKUP_RESTORE_EVIDENCE",
  "CODIP_NEON_BACKUP_EVIDENCE_JSON",
  "release:check-neon-backup-evidence",
  "GHCR image digest",
  "rollback owner",
  "backup / restore",
  "Cloudflare/Neon APIの実在照会ではなく",
  "cloudflare-production.md",
]) {
  requireText("cloudflare-neon-staging runbook", runbook, token);
}

for (const token of [
  "civilopendata.mirai-dx-platform.com",
  "DNS、Custom Domain、Access、Secrets、Hyperdrive、Neon本番接続を無断で変更しない",
  "scripts/deploy/create-hyperdrive.mjs",
  "release:validate-env:production-target",
  "release:production-evidence -- --strict",
  "release:check-production-placeholders -- --env production",
  "npm run cf:deploy:production",
  "release:smoke -- --read-only",
  "New subdomain / routing gate",
  "Hostname conflict",
  "Cloudflare zone status",
  "Cloudflare API / Neon APIへ接続してCustom Domain",
  "Cloudflare logs / alert policy evidence",
  "Neon monitoring evidence",
  "Backup / restore evidence",
  "Rollback owner / rollback target",
]) {
  requireText("cloudflare-production runbook", productionRunbook, token);
}

requireText("rollback runbook", rollbackRunbook, "docs/runbooks/cloudflare-production.md");
requireText("wrangler.jsonc", wrangler, "docs/runbooks/cloudflare-production.md");
requireText("docs/13", docs13, "docker-supply-chain");
requireText("docs/13", docs13, "docs/runbooks/cloudflare-production.md");
requireText("docs/13", docs13, "release:validate-env:production-target");
requireText("docs/13", docs13, "CODIP_CLOUDFLARE_ACCESS_EVIDENCE");
requireText("docs/13", docs13, "SBOM");
requireText("docs/13", docs13, "provenance");
requireText("docs/16", docs16, "release:validate-env:production-target");
requireText("docs/16", docs16, "release:production-evidence");
requireText("docs/16", docs16, "Access証跡");
requireText("docs/16", docs16, "監視・アラート証跡");
requireText("docs/16", docs16, "バックアップ・リストア証跡");
requireText("docs/16", docs16, "release:check-production-placeholders");
requireText("docs/16", docs16, "release:check-cloudflare-build-artifact");
requireText("docs/16", docs16, "image digest");
requireText("docs/16", docs16, "Neon branch");
requireText("package.json", packageJson, "release:validate-env:production-target");
requireText("package.json", packageJson, "release:production-evidence");
requireText("package.json", packageJson, "release:check-neon-backup-evidence");
requireText("package.json", packageJson, "release:post-release-status");
requireText("package.json", packageJson, "release:cloudflare-522-diagnostics");
requireText("package.json", packageJson, "release:production-evidence -- --strict");
requireText("package.json", packageJson, "release:check-production-placeholders");
requireText("package.json", packageJson, "release:check-cloudflare-build-artifact");
requireText("package.json", packageJson, "cf:deploy:production");
requireText("package.json", packageJson, "--env production");
requireText("package.json", packageJson, "@prisma/adapter-pg");
requireText("package.json", packageJson, "@opennextjs/cloudflare");
requireText("monitoring runbook", monitoringRunbook, "release:post-release-status");
requireText("monitoring runbook", monitoringRunbook, "release:cloudflare-522-diagnostics");
requireText("monitoring runbook", monitoringRunbook, "release:check-neon-backup-evidence");
requireText("monitoring runbook", monitoringRunbook, "civilopendata.mirai-dx-platform.com");
requireText("monitoring runbook", monitoringRunbook, "--strict-production");
requireText("monitoring runbook", monitoringRunbook, "--max-response-ms");
requireText("monitoring runbook", monitoringRunbook, "checks.database=ok");
requireText("cloudflare-production.md", productionRunbook, "release:cloudflare-522-diagnostics");
requireText("postgresql schema", pgSchema, "provider        = \"prisma-client-js\"");
requireText("db loader", dbLoader, "PrismaPg");
requireText("db loader", dbLoader, "getCloudflareContext");
requireText("db loader", dbLoader, "connectionString");

if (errors.length > 0) {
  for (const error of errors) console.error(`[cloudflare-neon-contract][error] ${error}`);
  process.exit(1);
}

console.log("[cloudflare-neon-contract] OK");
