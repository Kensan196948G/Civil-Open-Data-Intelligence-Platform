#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const docsApi = fs.readFileSync(path.join(root, "docs/04-api-design.md"), "utf8");
const openapi = fs.readFileSync(path.join(root, "src/app/api/openapi/route.ts"), "utf8");
const v1Response = fs.readFileSync(path.join(root, "src/lib/v1-response.ts"), "utf8");
const recordsRoute = fs.readFileSync(path.join(root, "src/app/api/v1/records/search/route.ts"), "utf8");
const layersRoute = fs.readFileSync(path.join(root, "src/app/api/v1/layers/route.ts"), "utf8");
const pointRoute = fs.readFileSync(path.join(root, "src/app/api/v1/records/point/route.ts"), "utf8");
const featuresRoute = fs.readFileSync(path.join(root, "src/app/api/v1/layers/[id]/features/route.ts"), "utf8");

const errors = [];

if (/"warnings"\s*:\s*\[\s*"/.test(docsApi)) {
  errors.push("docs/04-api-design.md contains legacy string-array warnings");
}

for (const token of ["catalog_only", "not_standardized", "standard_records_not_ingested"]) {
  if (!docsApi.includes(token)) errors.push(`docs/04-api-design.md missing ${token}`);
}

for (const token of ["catalog_metadata_only", "decision_not_supported"]) {
  if (!docsApi.includes(token)) errors.push(`docs/04-api-design.md missing warning code ${token}`);
}

if (!openapi.includes("V1Warning") || !openapi.includes("V1StandardRecord")) {
  errors.push("OpenAPI missing v1 warning or standard record schema");
}

if (!v1Response.includes("catalog_metadata_only")) {
  errors.push("v1 response helper missing catalog_metadata_only warning code");
}

if (!recordsRoute.includes("catalogMetadataWarning")) {
  errors.push("/api/v1/records/search missing catalog metadata warning helper");
}

if (!layersRoute.includes("catalogMetadataWarning") && !layersRoute.includes("catalog_metadata_only")) {
  errors.push("/api/v1/layers missing catalog metadata warning helper");
}

if (!pointRoute.includes("standard_records_not_ingested")) {
  errors.push("/api/v1/records/point missing standard_records_not_ingested reason");
}

if (!featuresRoute.includes("not_standardized")) {
  errors.push("/api/v1/layers/{id}/features missing not_standardized warning");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[doc-api-contract][error] ${error}`);
  process.exit(1);
}

console.log("[doc-api-contract] OK");
