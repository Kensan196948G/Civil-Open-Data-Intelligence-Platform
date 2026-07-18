# セキュリティ・コンプライアンス設計

## 1. 基本方針

CODIPは公開データを扱うが、APIキー、接続情報、取得ログ、運用情報を持つため、通常のWebアプリと同等のセキュリティ管理を行う。

## 2. 秘密情報

| 情報 | 保存方針 |
| --- | --- |
| APIキー | DB保存禁止。環境変数に保存 |
| 認証ヘッダー | ログ出力禁止 |
| 接続文字列 | 環境変数に保存 |
| 個別トークン | 画面表示禁止 |
| APIキー環境変数名 | 台帳に保存可 |

## 2.1 管理操作の保護

本番・共有プレビュー環境では、登録、編集、削除、接続確認、サンプル取得、品質再計算を保護する。

| 設定 | 内容 |
| --- | --- |
| `CODIP_ADMIN_TOKEN` | 変更系APIで要求する32文字以上の管理トークン |
| `__Host-codip_admin_session` | HTTPSで利用する署名済みHttpOnly Cookie |
| `codip_admin_session` | HTTPローカル検証で利用する署名済みHttpOnly Cookie |
| `CODIP_ALLOWED_ORIGINS` | プロキシ等で追加許可する管理セッション用Origin |
| `x-codip-admin-token` | APIクライアントが送信するヘッダー |
| `CODIP_ALLOW_INSECURE_ADMIN` | ローカル開発でのみ管理操作を無認証許可する明示フラグ |
| `CODIP_ALLOW_INSECURE_LOCAL_COOKIES` | ローカルHTTP検証でのみ管理CookieのSecure強制を解除する明示フラグ |
| `CODIP_TRUST_PROXY_AUTH` | Cloudflare Access等の認証済みプロキシヘッダーを信頼する場合のみ `true` |
| `CODIP_TRUST_PROXY_HEADERS` | 信頼済みプロキシ配下でのみ、Forwarded系IP/host/protoヘッダーを使う |
| `CODIP_TRUST_PROXY_SECRET` | プロキシが `x-codip-proxy-secret` として付与する共有シークレット |
| `CODIP_ADMIN_EMAILS` | プロキシ認証時に管理者として扱うメールアドレス |
| `CODIP_ADMIN_EMAIL_DOMAINS` | プロキシ認証時に管理者として扱うメールドメイン |

ローカル開発でも、`CODIP_ALLOW_INSECURE_ADMIN=true` を明示した場合に限り管理操作を無認証許可する。共有プレビュー・本番では絶対に `true` にしない。

`cf-access-authenticated-user-email` のようなプロキシ由来ヘッダーは、オリジンへ直接到達できる構成では偽装可能である。共有プレビュー・本番では、オリジンをCloudflare経由に限定し、さらに `x-codip-proxy-secret` と管理者メールallowlistを照合する。

ブラウザUIでは `CODIP_ADMIN_TOKEN` をlocalStorageへ保存しない。設定画面でトークンを入力すると、サーバーが `CODIP_ADMIN_TOKEN` と定数時間比較で照合し、トークン値そのものではなく発行時刻・期限・nonceを署名したHttpOnly Cookieを発行する。HTTPSでは `__Host-` prefix付きCookieを使う。HTTPローカル検証でブラウザ保存が必要な場合だけ `CODIP_ALLOW_INSECURE_LOCAL_COOKIES=true` を明示し、通常Cookieへ切り替える。管理セッション開始は `5 req/min` に制限する。クライアント識別は `CODIP_TRUST_PROXY_HEADERS=true` のときのみForwarded系ヘッダー由来のIP単位となり、未設定時は信頼できる識別子が得られないため**インスタンス全体で共有する単一バケット**として動作する (ヘッダー偽装によるバイパスを拒否するfail-safe設計の副作用。Cloudflare経由の本番構成では `wrangler.jsonc` が全環境で `true` を設定済み)。

Cookie認証で `POST`、`PUT`、`PATCH`、`DELETE` の管理操作を行う場合は、`Origin` または `Referer` がリクエストURL、または `CODIP_ALLOWED_ORIGINS` に一致することを必須にする。APIクライアント互換のため、`x-codip-admin-token` と `Authorization: Bearer` は引き続き利用できる。

`/api/admin/session` によるブラウザ向け管理セッション開始・終了でも、`Origin` または `Referer` の欠落を拒否する。非ブラウザの管理API利用では、セッションCookieではなく `x-codip-admin-token` または `Authorization: Bearer` を使う。

## 2.2 ログ・サンプルレスポンスの保護

取得ログ、エラー内容、サンプルレスポンス本文は公開データであっても運用情報や一時URLを含む可能性があるため、管理者のみ閲覧可能にする。

| 対象 | 方針 |
| --- | --- |
| 取得ログAPI | 管理認証必須 |
| データソース詳細APIのログ・サンプル | 管理認証時のみ含める |
| 画面の取得ログ一覧 | 管理者確認時のみ表示 |
| APIキー必須データソースのサンプル本文 | DB保存しない |

## 2.3 乱用対策

| 対象 | 対策 |
| --- | --- |
| `/api/dashboard` | 120 req/min/IP |
| `/api/sources` | 120 req/min/IP、`take` 最大200、`skip` 最大5000、キーワード2文字以上 |
| `/api/map/elevation` | 60 req/min/IP、10分キャッシュ、GSI標高APIのHTTPSホスト・パス完全一致URLのみ取得 |
| `/api/admin/session` | 5 req/min/IP、同一Origin確認 |
| 接続確認 | 12 req/min/IP/source |
| サンプル取得 | 6 req/min/IP/source |
| 制限超過 | `429 rate_limited` と `Retry-After` を返す |

アプリ内レート制限は単一プロセス内の保護であり、共有プレビュー・本番ではCloudflare WAF/Rules等の前段制御と併用する。

直アクセス可能な構成では `cf-connecting-ip`、`x-forwarded-for`、`x-real-ip`、`x-forwarded-host`、`x-forwarded-proto` を信頼しない。Cloudflare等の信頼済みプロキシ経由に限定でき、プロキシ側でヘッダーを上書き・洗浄できる場合のみ `CODIP_TRUST_PROXY_HEADERS=true` を設定する。

## 3. ログ方針

ログに残すもの。

| 項目 | 例 |
| --- | --- |
| データソースID | `src_001` |
| HTTPステータス | `200`, `404` |
| 応答時間 | `1200ms` |
| データサイズ | `1.2MB` |
| エラー種別 | `timeout` |

ログに残さないもの。

| 項目 | 理由 |
| --- | --- |
| APIキー | 秘密情報 |
| Authorizationヘッダー | 秘密情報 |
| Cookie | セッション情報を含む可能性 |
| 個別の社内案件情報 | MVPの対象外 |

URL自体に `user:password@host` 形式の認証情報や `token`、`api_key`、`appId`、`client_secret` 等の秘密系クエリを含めることは禁止する。台帳登録時には http/https の公開URLのみを許可し、`javascript:`、`data:`、`ftp:`、localhost、private IP、内部ドメインを拒否する。既存データをログ・公開API・画面へ返す場合もURL username/password と秘密系クエリを除去・マスクする。

管理者向けの取得ログ、エラー文、サンプルレスポンスも、保存時サニタイズだけに依存しない。APIまたは画面へ返す直前に、URL、Bearer token、秘密系クエリ、秘密系キー値を再マスクし、表示長を制限する。

台帳登録・更新のboolean項目は、boolean値または文字列 `true` / `false` のみ受け付ける。`yes`、`0`、任意文字列を暗黙変換しない。

公開検索APIでは、非公開の運用メモ `note` を検索対象に含めない。ヒット件数や検索結果から内部メモの内容を推測できないようにする。

## 3.1 セキュリティヘッダー

Next.jsの全レスポンスに次のヘッダーを付与する。

| ヘッダー | 目的 |
| --- | --- |
| `Content-Security-Policy` | 外部スクリプト、object、frame埋め込みを抑止 |
| `X-Content-Type-Options` | MIME sniffing抑止 |
| `X-Frame-Options` | クリックジャッキング抑止 |
| `Referrer-Policy` | 外部遷移時の参照元情報を制限 |
| `Permissions-Policy` | カメラ、マイク等の不要なブラウザ機能を無効化 |
| `Strict-Transport-Security` | HTTPS利用時のダウングレード抑止 |

MVPのCSPはNext.jsとLeaflet/地理院タイルを動かすため `unsafe-inline` を一部許容する。本番では `unsafe-eval` を許可しない。release smokeでは `object-src 'none'`、`frame-ancestors 'none'`、地理院許可先、HSTSなど主要値を確認する。Cloudflare本番化時はnonceベースへさらに強化する。

## 3.2 SASTと供給網

| 項目 | 現行方針 |
| --- | --- |
| CodeQL | GitHub Actionsで実行し、2026-07-13時点のPR #17ではworkflow successを確認済み |
| Code scanning gate | リポジトリ側のcode scanning設定差異でCI全体を止めないよう、現行workflowは `continue-on-error` を含む |
| Release前条件 | SASTを必須gateにする場合は、GitHub code scanningを有効化し、alert状態確認または `continue-on-error` 撤廃を判断する |
| Docker scan | `docker-image-security` jobでproduction runner imageをTrivy High/Critical CVE検査にかける |
| SBOM/provenance | PRでは契約検査のみ。`main` push後の `docker-supply-chain` jobでGHCR push、SBOM、provenanceを証跡化する |

## 4. 公開データ利用条件

| 観点 | 管理内容 |
| --- | --- |
| ライセンス | 名称、URL、確認日 |
| 出典表記 | 必要有無、表示文言 |
| 商用利用 | 可、制限あり、不明 |
| 再配布 | 可、制限あり、不明 |
| API制限 | 回数、認証、禁止事項 |

## 5. 判断責任

CODIPは確認支援システムであり、施工可否、安全性、法令適合を断定しない。画面とAPIには、出典、基準日、取得日時、品質状態を含め、人が最終確認できる状態を維持する。
