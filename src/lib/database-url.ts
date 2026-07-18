export type DatabaseProvider = "sqlite" | "postgresql";

export function databaseProviderFromUrl(databaseUrl = process.env.DATABASE_URL ?? ""): DatabaseProvider {
  const normalized = databaseUrl.trim().toLowerCase();
  if (normalized.startsWith("postgresql://") || normalized.startsWith("postgres://")) {
    return "postgresql";
  }
  return "sqlite";
}

export function isPostgreSqlDatabase(databaseUrl = process.env.DATABASE_URL ?? ""): boolean {
  return databaseProviderFromUrl(databaseUrl) === "postgresql";
}
