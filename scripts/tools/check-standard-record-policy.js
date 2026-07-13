#!/usr/bin/env node

const { isPostgreSqlDatabase, loadPrismaClient } = require("./prisma-client-loader");

async function main() {
  const PrismaClient = loadPrismaClient();
  const prisma = new PrismaClient();

  try {
    if (isPostgreSqlDatabase()) {
      const count = await prisma.standardRecord.count();
      console.log(
        `[standard-record-policy] OK: PostgreSQL standard_records=${count}; PostGIS-backed /api/v1 read routes are enabled when rows exist`,
      );
      return;
    }

    const tables = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'standard_records'",
    );
    if (Array.isArray(tables) && tables.length > 0) {
      const rows = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS count FROM standard_records");
      const count = Number(rows?.[0]?.count ?? 0);
      if (count > 0 && process.env.CODIP_ALLOW_STANDARD_RECORDS !== "true") {
        console.error(
          `[standard-record-policy][error] SQLite standard_records has ${count} row(s), but SQLite MVP should not carry standardized spatial records.`,
        );
        process.exit(1);
      }
      console.log(`[standard-record-policy] OK: SQLite standard_records table present, rows=${count}`);
      return;
    }

    console.log("[standard-record-policy] OK: SQLite MVP has no standard_records table");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
