#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const rootSchema = path.join(process.cwd(), "prisma", "schema.prisma");
const pgSchema = path.join(process.cwd(), "prisma", "postgresql", "schema.prisma");
const requiredModels = [
  "Provider",
  "DataSource",
  "Tag",
  "DataSourceTag",
  "FetchLog",
  "SampleResponse",
  "QualityCheck",
  "RelatedUseCase",
];

const allowedPostgresOnlyFields = new Set(["DataSource.standardRecords"]);

function modelBlocks(schemaText) {
  const blocks = new Map();
  const matches = schemaText.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^}/gm);
  for (const match of matches) {
    blocks.set(match[1], match[2]);
  }
  return blocks;
}

function normalizeFieldLine(line) {
  return line
    .replace(/\s*\/\/.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fields(block) {
  const result = new Map();
  for (const rawLine of block.split(/\r?\n/)) {
    const line = normalizeFieldLine(rawLine);
    if (!line || line.startsWith("@@") || line.startsWith("//")) continue;
    const [name] = line.split(" ");
    result.set(name, line);
  }
  return result;
}

function main() {
  const rootModels = modelBlocks(fs.readFileSync(rootSchema, "utf8"));
  const pgModels = modelBlocks(fs.readFileSync(pgSchema, "utf8"));
  const missing = [];

  for (const model of requiredModels) {
    if (!rootModels.has(model)) {
      missing.push(`SQLite schema missing ${model}`);
      continue;
    }
    if (!pgModels.has(model)) {
      missing.push(`PostgreSQL schema missing ${model}`);
      continue;
    }

    const rootFields = fields(rootModels.get(model));
    const pgFields = fields(pgModels.get(model));
    for (const [name, signature] of rootFields.entries()) {
      const pgSignature = pgFields.get(name);
      if (!pgSignature) {
        missing.push(`PostgreSQL schema missing ${model}.${name}`);
      } else if (pgSignature !== signature) {
        missing.push(`Schema mismatch for ${model}.${name}: SQLite="${signature}" PostgreSQL="${pgSignature}"`);
      }
    }
    for (const name of pgFields.keys()) {
      const fieldKey = `${model}.${name}`;
      if (!rootFields.has(name) && !allowedPostgresOnlyFields.has(fieldKey)) {
        missing.push(`PostgreSQL schema has unexpected field ${fieldKey}`);
      }
    }
  }

  if (!pgModels.has("StandardRecord")) {
    missing.push("PostgreSQL schema missing StandardRecord for PostGIS-backed normalized data");
  }

  if (missing.length > 0) {
    for (const message of missing) console.error(`[prisma-compare][error] ${message}`);
    process.exit(1);
  }

  console.log("[prisma-compare] OK: core model fields match SQLite and PostgreSQL schemas");
}

if (require.main === module) main();
