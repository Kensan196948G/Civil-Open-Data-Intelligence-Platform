#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const runbookPath = path.join(root, "docs/runbooks/cloudflare-neon-staging.md");
const runbook = fs.existsSync(runbookPath) ? fs.readFileSync(runbookPath, "utf8") : "";
const docs13 = fs.readFileSync(path.join(root, "docs/13-deployment-and-operations.md"), "utf8");
const docs16 = fs.readFileSync(path.join(root, "docs/16-release-readiness-checklist.md"), "utf8");
const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
const wrangler = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
const accessVars = fs.readFileSync(path.join(root, "infra/cloudflare/terraform.tfvars.example"), "utf8");
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
requireText("wrangler.jsonc", wrangler, "civilopendata.mirai-dx-platform.com");
requireText("wrangler.jsonc", wrangler, "\"custom_domain\": true");
requireText("wrangler.jsonc", wrangler, "\"workers_dev\": false");
requireText("infra/cloudflare terraform vars", accessVars, "application_domain     = \"civilopendata.mirai-dx-platform.com\"");

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
  "GHCR image digest",
  "rollback owner",
]) {
  requireText("cloudflare-neon-staging runbook", runbook, token);
}

requireText("docs/13", docs13, "docker-supply-chain");
requireText("docs/13", docs13, "release:validate-env:production-target");
requireText("docs/13", docs13, "SBOM");
requireText("docs/13", docs13, "provenance");
requireText("docs/16", docs16, "release:validate-env:production-target");
requireText("docs/16", docs16, "release:production-evidence");
requireText("docs/16", docs16, "release:check-production-placeholders");
requireText("docs/16", docs16, "image digest");
requireText("docs/16", docs16, "Neon branch");
requireText("package.json", packageJson, "release:validate-env:production-target");
requireText("package.json", packageJson, "release:production-evidence");
requireText("package.json", packageJson, "release:check-production-placeholders");
requireText("package.json", packageJson, "@prisma/adapter-pg");
requireText("package.json", packageJson, "@opennextjs/cloudflare");
requireText("postgresql schema", pgSchema, "provider        = \"prisma-client-js\"");
requireText("db loader", dbLoader, "PrismaPg");
requireText("db loader", dbLoader, "getCloudflareContext");
requireText("db loader", dbLoader, "connectionString");

if (errors.length > 0) {
  for (const error of errors) console.error(`[cloudflare-neon-contract][error] ${error}`);
  process.exit(1);
}

console.log("[cloudflare-neon-contract] OK");
