#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function readWrangler(root) {
  const wranglerPath = path.join(root, "wrangler.jsonc");
  const text = fs.readFileSync(wranglerPath, "utf8");
  return JSON.parse(stripJsonComments(text));
}

function fileExists(root, relativePath) {
  const fullPath = path.join(root, relativePath);
  return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
}

function directoryExists(root, relativePath) {
  const fullPath = path.join(root, relativePath);
  return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
}

function validateBuildArtifact(root) {
  const wrangler = readWrangler(root);
  const errors = [];
  const postgresqlPrismaWasm = ".open-next/server-functions/default/node_modules/.prisma/client-postgresql/query_engine_bg.wasm";
  const sqlitePrismaWasm = ".open-next/server-functions/default/node_modules/.prisma/client/query_engine_bg.wasm";

  if (!wrangler.main) {
    errors.push("wrangler.jsonc main is missing");
  } else if (!fileExists(root, wrangler.main)) {
    errors.push(`Cloudflare Worker entrypoint is missing: ${wrangler.main}`);
  }

  const assetsDirectory = wrangler.assets?.directory;
  if (!assetsDirectory) {
    errors.push("wrangler.jsonc assets.directory is missing");
  } else if (!directoryExists(root, assetsDirectory)) {
    errors.push(`Cloudflare static assets directory is missing: ${assetsDirectory}`);
  }

  if (!fileExists(root, postgresqlPrismaWasm)) {
    errors.push(`Cloudflare PostgreSQL Prisma wasm is missing: ${postgresqlPrismaWasm}`);
  }
  if (fileExists(root, sqlitePrismaWasm)) {
    errors.push(`Cloudflare bundle contains the unused SQLite Prisma wasm: ${sqlitePrismaWasm}`);
  }

  return errors;
}

function main() {
  const errors = validateBuildArtifact(process.cwd());

  if (errors.length > 0) {
    for (const error of errors) console.error(`[cloudflare-build-artifact][error] ${error}`);
    console.error("[cloudflare-build-artifact] Run `npm run cf:build` before deploy validation.");
    process.exit(1);
  }

  console.log("[cloudflare-build-artifact] OK");
}

if (require.main === module) main();

module.exports = { validateBuildArtifact };
