#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const pgSchema = fs.readFileSync(path.join(root, "prisma/postgresql/schema.prisma"), "utf8");
const route = fs.readFileSync(path.join(root, "src/app/api/v1/records/search/route.ts"), "utf8");
const standardRecords = fs.readFileSync(path.join(root, "src/lib/standard-records.ts"), "utf8");
const openapi = fs.readFileSync(path.join(root, "src/app/api/openapi/route.ts"), "utf8");

const requiredFields = [
  "recordId",
  "sourceId",
  "sourceRecordId",
  "category",
  "title",
  "geometry",
  "retrievedAt",
  "sourceUrl",
  "licenseId",
  "qualityStatus",
  "properties",
];

const errors = [];

if (!/model\s+StandardRecord\s+\{/.test(pgSchema)) {
  errors.push("PostgreSQL schema is missing model StandardRecord");
}

for (const field of requiredFields) {
  if (!pgSchema.includes(field) && field !== "recordId" && field !== "sourceId") {
    errors.push(`PostgreSQL StandardRecord schema is missing ${field}`);
  }
  if (!route.includes(`${field}:`)) {
    errors.push(`/api/v1/records/search does not set ${field}`);
  }
}

if (!openapi.includes("V1StandardRecord")) {
  errors.push("OpenAPI is missing V1StandardRecord schema");
}

if (!openapi.includes('$ref: "#/components/schemas/V1StandardRecord"')) {
  errors.push("OpenAPI V1RecordsSearchResponse does not reference V1StandardRecord");
}

const spatialRoutes =
  fs.readFileSync(path.join(root, "src/app/api/v1/records/point/route.ts"), "utf8") +
  fs.readFileSync(path.join(root, "src/app/api/v1/layers/[id]/features/route.ts"), "utf8");
const layersRoute = fs.readFileSync(path.join(root, "src/app/api/v1/layers/route.ts"), "utf8");

for (const token of [
  "isPostgreSqlRuntime",
  "$queryRaw<",
  "ST_DWithin",
  "geometry::geography",
  "ST_AsGeoJSON",
  "SECRET_PROPERTY_KEY",
]) {
  if (!standardRecords.includes(token)) {
    errors.push(`src/lib/standard-records.ts missing ${token}`);
  }
}

if (standardRecords.includes("$queryRawUnsafe")) {
  errors.push("src/lib/standard-records.ts must not use $queryRawUnsafe");
}

if (!route.includes("findStandardRecordsForSearch")) {
  errors.push("/api/v1/records/search does not use standard_records read helper");
}

if (!spatialRoutes.includes("findStandardRecordsForPoint")) {
  errors.push("/api/v1/records/point does not use standard_records point helper");
}

if (!spatialRoutes.includes("findStandardFeaturesForLayer")) {
  errors.push("/api/v1/layers/{id}/features does not use standard_records feature helper");
}

if (!layersRoute.includes("findStandardLayers")) {
  errors.push("/api/v1/layers does not use standard_records layer helper");
}

for (const token of ["not_standardized", "catalog_metadata_only", "standard_records_not_ingested"]) {
  if (![route, spatialRoutes, layersRoute].some((text) => text.includes(token))) {
    errors.push(`v1 routes are missing fallback contract token ${token}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[v1-standard-record-contract][error] ${error}`);
  process.exit(1);
}

console.log("[v1-standard-record-contract] OK");
