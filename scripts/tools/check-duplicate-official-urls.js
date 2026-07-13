const { loadPrismaClient } = require("./prisma-client-loader");

const PrismaClient = loadPrismaClient();
const prisma = new PrismaClient();

async function main() {
  const duplicates = await prisma.$queryRaw`
    SELECT "officialUrl", COUNT(*) AS count
    FROM "data_sources"
    GROUP BY "officialUrl"
    HAVING COUNT(*) > 1
  `;

  if (duplicates.length > 0) {
    console.error("Duplicate officialUrl values found. Resolve these before applying the unique index migration:");
    for (const row of duplicates) {
      console.error(`- ${row.officialUrl} (${row.count})`);
    }
    process.exit(1);
  }

  console.log("OK: no duplicate officialUrl values found");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
