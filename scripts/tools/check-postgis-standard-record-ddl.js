#!/usr/bin/env node

const { isPostgreSqlDatabase, loadPrismaClient } = require("./prisma-client-loader");

async function main() {
  if (!isPostgreSqlDatabase()) {
    console.error("[postgis-ddl][error] DATABASE_URL must point to PostgreSQL/PostGIS");
    process.exit(2);
  }

  const PrismaClient = loadPrismaClient();
  const prisma = new PrismaClient();

  try {
    const postgis = await prisma.$queryRaw`SELECT postgis_version() AS version`;
    const geom = await prisma.$queryRaw`
      SELECT srid, type
      FROM geometry_columns
      WHERE f_table_name = 'standard_records' AND f_geometry_column = 'geometry'
    `;
    const indexes = await prisma.$queryRaw`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'standard_records'
    `;
    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'standard_records'
    `;

    const errors = [];
    if (!postgis?.[0]?.version) errors.push("PostGIS extension is missing");
    if (Number(geom?.[0]?.srid) !== 4326 || geom?.[0]?.type !== "GEOMETRY") {
      errors.push(`standard_records.geometry mismatch: ${JSON.stringify(geom?.[0] ?? null)}`);
    }
    if (!indexes.some((index) => /USING gist .*geometry/i.test(index.indexdef))) {
      errors.push("standard_records geometry GIST index is missing");
    }
    const properties = columns.find((column) => column.column_name === "properties");
    if (properties?.data_type !== "jsonb" || !String(properties?.column_default ?? "").includes("'{}'::jsonb")) {
      errors.push("standard_records.properties must be jsonb with '{}'::jsonb default");
    }

    if (errors.length > 0) {
      for (const error of errors) console.error(`[postgis-ddl][error] ${error}`);
      process.exit(1);
    }

    console.log("[postgis-ddl] OK");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
