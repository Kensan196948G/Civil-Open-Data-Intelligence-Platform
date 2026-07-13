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

## 禁止事項

- APIキーや認証ヘッダーのログ出力
- `.env` のコミット
- 出典不明データを公式データとして扱うこと
- AI生成データを人の確認なしに確定情報として扱うこと
