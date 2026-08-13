/**
 * Cloudflare Worker 側の PostgreSQL 接続文字列解決。
 *
 * - production: Hyperdrive binding（edge 側プール）の connectionString を優先する。
 * - MVP / staging: Hyperdrive config が無い環境では Worker secret `DATABASE_URL`
 *   （string 値として request env に現れる）を使い、Prisma の pg ドライバで
 *   Neon へ直接 TCP 接続する（`nodejs_compat` + Prisma >= 6.15）。
 *
 * db.ts から純粋関数として分離し、Cloudflare runtime を起動せずに
 * 単体テストできるようにしている。接続文字列そのものは返すだけで、
 * このモジュールは値をログ出力しない。
 */

export type CloudflareHyperdriveBinding = { connectionString?: string };

export type CloudflareConnectionOptions = {
  /** Hyperdrive binding 名（未指定時は HYPERDRIVE）。 */
  bindingName?: string;
  /** Node 側フォールバック（process.env 相当）。 */
  processEnv?: Record<string, string | undefined>;
};

export function resolveCloudflareConnectionString(
  env: Record<string, unknown>,
  options: CloudflareConnectionOptions = {},
): string | null {
  const bindingName = (options.bindingName ?? "HYPERDRIVE").trim() || "HYPERDRIVE";
  const binding = env[bindingName] as CloudflareHyperdriveBinding | undefined;
  if (typeof binding?.connectionString === "string" && binding.connectionString.trim()) {
    return binding.connectionString;
  }

  const secretUrl = env.DATABASE_URL;
  if (typeof secretUrl === "string" && secretUrl.trim()) {
    return secretUrl;
  }

  const processUrl = options.processEnv?.DATABASE_URL?.trim() ?? "";
  if (processUrl) {
    return processUrl;
  }

  console.error(
    `[db] no PostgreSQL connection available: binding "${bindingName}" has no connectionString and DATABASE_URL is not set (Worker secret or process.env)`,
  );
  return null;
}
