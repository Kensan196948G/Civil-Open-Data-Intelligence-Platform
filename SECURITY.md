# Security Policy

## 対象

このリポジトリは、公開データを扱う土木建設向けデータ基盤です。APIキー、接続文字列、認証ヘッダー、社内情報、個別案件情報をコミットしないでください。

## 報告方法

脆弱性や秘密情報混入を見つけた場合は、GitHub Issueで公開せず、リポジトリ管理者へ非公開経路で連絡してください。

## 管理API

本番・共有プレビュー環境では、次のいずれかを必須にしてください。

- `CODIP_ADMIN_TOKEN` を設定し、管理操作時に `x-codip-admin-token` を送信する
- `CODIP_TRUST_PROXY_AUTH=true`、`CODIP_TRUST_PROXY_SECRET`、`CODIP_ADMIN_EMAILS` または `CODIP_ADMIN_EMAIL_DOMAINS` を設定し、Cloudflare Access等で入口を保護したうえで、プロキシ側から `x-codip-proxy-secret` を付与する

ブラウザ管理画面では、管理トークンをlocalStorageへ保存せず、署名済みHttpOnly Cookieの管理セッションを利用します。

ローカル開発で無認証の管理操作を許可する場合は `CODIP_ALLOW_INSECURE_ADMIN=true` を明示してください。共有プレビュー・本番では使用禁止です。

取得ログとサンプルレスポンス本文は管理者のみ閲覧可能にしてください。APIキー必須データソースのサンプル本文はDBへ保存しません。

## CSRF対策

管理操作の認証方式ごとに、CSRF対策の要否を分けています。

| 認証方式 | CSRF対策 | 理由 |
| --- | --- | --- |
| `x-codip-admin-token` ヘッダー / Bearerトークン | 適用しない | クロスサイトの通常フォーム送信・ナビゲーションはカスタムヘッダーを付与できないため、トークンヘッダー自体がCSRF耐性を持つ |
| 管理セッションCookie (HMAC署名済みstatelessセッション) | 適用する | Cookieはブラウザが自動送信するため、Origin/Refererを検証しないと偽サイトからの変更操作を防げない |
| Cloudflare Access配下のproxy認証 (`x-codip-proxy-secret`) | 適用する | secret自体を知っていても、セッションと同様ブラウザ経由の状態変更にはOrigin確認を要求する |

実装:

- Cookie/proxy認証で状態変更 (GET/HEAD/OPTIONS以外) を行う場合、`requireAdminRequest()` がOrigin/Refererを検証し、リクエストURLのoriginまたは `CODIP_ALLOWED_ORIGINS` allowlistに一致しない限り `403 csrf_check_failed` を返す (`src/lib/admin-auth.ts`)
- 管理セッションの発行・破棄 (`POST`/`DELETE /api/admin/session`) はHTTPメソッドに関わらず常に同一Origin必須 (`rejectCrossOriginBrowserRequest()`)
- セッションCookieは `SameSite=Strict` + `HttpOnly` + (HTTPS環境では) `__Host-` prefixで発行し、Origin検証と多層防御を構成する
- セッション自体はHMAC署名 (`timingSafeEqual` 比較) を用いたstatelessトークンであり、サーバー側セッションストアを持たない

## レート制限方針

アプリ内レート制限 (`src/lib/rate-limit.ts`) はプロセスローカルの `Map` で管理する、意図的にシンプルな実装です。

- **単一プロセス限定**: プロセス再起動でリセットされ、複数インスタンス間で状態を共有しない
- **`CODIP_TRUST_PROXY_HEADERS=true` が前提**: 未設定の場合、クライアント識別子は全リクエスト共通の `"local"` に落ちるため、実質的に「サーバー全体で1クライアント」としてしか機能しない。Cloudflare Access配下など、信頼できるプロキシが `cf-connecting-ip` を必ず付与する構成でのみ意味を持つ
- **採用方針**: 複数インスタンス本番運用では、アプリ内レート制限をセキュリティ境界として信頼せず、Cloudflare WAF/Rate Limiting Rulesを正とする。endpoint別の目安値は `docs/13-deployment-and-operations.md` §3.1を参照。アプリ内制限は、Cloudflare側が未設定のstaging/開発環境における最小限のフェイルセーフと位置づける
- 管理セッション発行 (`POST /api/admin/session`) はブルートフォース対策として個別に `5 req/60s` を適用する (`src/app/api/admin/session/route.ts`)

## 禁止事項

- APIキーや認証ヘッダーのログ出力
- `.env` のコミット
- 出典不明データを公式データとして扱うこと
- AI生成データを人の確認なしに確定情報として扱うこと
