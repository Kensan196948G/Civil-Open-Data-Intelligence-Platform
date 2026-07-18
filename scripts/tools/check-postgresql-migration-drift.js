#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("[postgresql-drift][error] DATABASE_URL is required");
  process.exit(2);
}

const result = spawnSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-url",
    databaseUrl,
    "--to-schema-datamodel",
    "prisma/postgresql/schema.prisma",
    "--exit-code",
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  },
);

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.status === 0) {
  process.stdout.write(output);
  console.log("[postgresql-drift] OK");
  process.exit(0);
}

const normalized = output
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const allowedPostgisIndexDiff =
  result.status === 2 &&
  normalized.some((line) => line === "[*] Changed the `standard_records` table") &&
  normalized.some((line) => line === "[-] Removed index on columns (geometry)") &&
  normalized.filter((line) => /^\[[*+-]\]|^[-+]\]/.test(line)).length === 2;

if (allowedPostgisIndexDiff) {
  process.stdout.write(output);
  console.log(
    "[postgresql-drift] OK: ignored Prisma diff for PostGIS GiST geometry index; db:pg:check-postgis-ddl verifies it explicitly",
  );
  process.exit(0);
}

process.stderr.write(output);
console.error("[postgresql-drift][error] unexpected PostgreSQL schema drift");
process.exit(result.status ?? 1);
