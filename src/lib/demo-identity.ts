/**
 * ローカル/preview 環境でウォッチリストUIを操作するためのデモ識別子。
 *
 * ウォッチリストは「個人単位」の機能であるため、本番では Cloudflare Access の
 * 識別ヘッダー（cf-access-authenticated-user-email）を信頼境界検証した上で
 * メールアドレスを解決する（src/lib/rbac.ts の userEmailFromRequest）。
 * ローカル/共有previewでは Access が無いため、そのままでは UI を操作できない。
 *
 * このフォールバックは **明示的な opt-in が 2 つ揃ったときだけ** 有効になる。
 *
 *   - CODIP_DEMO_IDENTITY=true
 *   - CODIP_DEMO_USER_EMAIL=example@example.com
 *
 * どちらか一方でも欠ければ null を返し、既存の挙動（401）へ落ちる。
 * 本番環境ではこれらの変数を設定しないこと（.env.example / README に明記）。
 * さらに、この値を採用するのは「requireRoleOrAdmin() を通った管理認証済み
 * リクエスト」に限るため、未認証者がデモ識別子を名乗ることはできない。
 */
export function demoIdentityEnabled(): boolean {
  return (process.env.CODIP_DEMO_IDENTITY ?? "").trim().toLowerCase() === "true";
}

export function demoUserEmailFromEnv(): string | null {
  if (!demoIdentityEnabled()) return null;
  const email = process.env.CODIP_DEMO_USER_EMAIL?.trim() ?? "";
  if (!email || email.length > 254 || !email.includes("@")) return null;
  return email.toLowerCase();
}
