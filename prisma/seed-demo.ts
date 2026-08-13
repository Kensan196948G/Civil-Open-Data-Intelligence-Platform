/**
 * デモ識別子用 seed の共有定義（SQLite / PostgreSQL の両 seed から使う）。
 *
 * デモ seed は「明示 opt-in（CODIP_DEMO_IDENTITY=true）」かつ「非本番」の
 * 両方が揃ったときだけ実行する。本番では既知メールアドレスへの有効な
 * ロール割当・ウォッチリストを作成しない（validate-env の拒否だけでは
 * 既存レコードを防げないため、seed 側でも遮断する）。
 */

export const DEMO_ROLE_ASSIGNMENTS = [
  { userEmail: "demo.engineer@example.com", role: "engineer" },
  { userEmail: "demo.steward@example.com", role: "data-steward" },
] as const;

export const DEMO_WATCH_EMAIL = "demo.engineer@example.com";

export function shouldSeedDemoData(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV !== "production" &&
    (env.CODIP_DEMO_IDENTITY ?? "").trim().toLowerCase() === "true"
  );
}
