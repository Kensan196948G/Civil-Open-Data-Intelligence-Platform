#!/usr/bin/env node
"use strict";

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../../node_modules/.prisma/client-postgresql");
const weatherJma = require("./weather-jma.js");
const marineOpenMeteo = require("./marine-openmeteo.js");

async function main() {
  const connectionString = (process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    console.error("[weather-ingestion] missing DATABASE_URL (CODIP_INGESTION_DATABASE_URL)");
    process.exit(1);
  }
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  try {
    const jma = await weatherJma.runOnce(prisma);
    const marine = await marineOpenMeteo.runOnce(prisma);
    console.log(`[weather-ingestion] jma_written=${jma.written} marine_written=${marine.written}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[weather-ingestion] ${error?.message || error}`);
  process.exit(1);
});
