#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const apiRoot = path.join(root, "src/app/api");
const openapiRoute = fs.readFileSync(path.join(apiRoot, "openapi/route.ts"), "utf8");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() && entry.name === "route.ts" ? [fullPath] : [];
  });
}

function routePath(filePath) {
  const relative = path.relative(path.join(root, "src/app"), filePath).replaceAll(path.sep, "/");
  return `/${relative}`
    .replace(/\/route\.ts$/, "")
    .replace(/\[([^\]]+)\]/g, "{$1}");
}

const routePaths = walk(apiRoot).map(routePath).sort();
const missing = routePaths.filter((candidate) => {
  const quotedPath = JSON.stringify(candidate);
  return !openapiRoute.includes(`${quotedPath}:`);
});

if (missing.length > 0) {
  for (const candidate of missing) {
    console.error(`[openapi-route-coverage][error] Missing OpenAPI path: ${candidate}`);
  }
  process.exit(1);
}

console.log(`[openapi-route-coverage] OK (${routePaths.length} API routes covered)`);
