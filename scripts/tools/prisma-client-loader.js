function isPostgreSqlDatabase(databaseUrl = process.env.DATABASE_URL ?? "") {
  const normalized = databaseUrl.trim().toLowerCase();
  return normalized.startsWith("postgresql://") || normalized.startsWith("postgres://");
}

function loadPrismaClient() {
  if (isPostgreSqlDatabase()) {
    return require("../../node_modules/.prisma/client-postgresql").PrismaClient;
  }
  return require("@prisma/client").PrismaClient;
}

module.exports = {
  isPostgreSqlDatabase,
  loadPrismaClient,
};
