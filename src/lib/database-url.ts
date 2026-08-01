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

type DatabaseRuntimeOptions = {
  databaseUrl?: string;
  deployTarget?: string;
};

export function isPostgreSqlRuntime({
  databaseUrl = process.env.DATABASE_URL ?? "",
  deployTarget = process.env.CODIP_DEPLOY_TARGET ?? "",
}: DatabaseRuntimeOptions = {}): boolean {
  const normalizedUrl = databaseUrl.trim();
  if (normalizedUrl !== "") return isPostgreSqlDatabase(normalizedUrl);
  const normalizedTarget = deployTarget.trim().toLowerCase();
  return normalizedTarget === "production" || normalizedTarget === "staging";
}
