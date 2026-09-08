const { loadPrismaClient } = require("./prisma-client-loader");
const { groupByOfficialUrlKey } = require("../lib/official-url");

const PrismaClient = loadPrismaClient();
const prisma = new PrismaClient();

async function main() {
  // 生文字列の GROUP BY では scheme 違いの重複を検出できない (Issue #192)。
  // 「http:// と https:// が別行として両立している」ことこそが検出したい事象なので、
  // 正規化キーで突き合わせる。data_sources は数十〜数百件の台帳であり、
  // 全件読み出して JS 側で判定してよい規模。
  const rows = await prisma.dataSource.findMany({
    select: { id: true, officialUrl: true },
    orderBy: { officialUrl: "asc" },
  });

  const duplicates = [...groupByOfficialUrlKey(rows).entries()].filter(([, group]) => group.length > 1);

  if (duplicates.length > 0) {
    console.error("Duplicate officialUrl values found (scheme/末尾スラッシュの違いを正規化して判定):");
    for (const [key, group] of duplicates) {
      console.error(`- ${key} (${group.length})`);
      for (const row of group) {
        console.error(`    ${row.id}  ${row.officialUrl}`);
      }
    }
    process.exit(1);
  }

  console.log(`OK: no duplicate officialUrl values found (${rows.length} sources checked)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
