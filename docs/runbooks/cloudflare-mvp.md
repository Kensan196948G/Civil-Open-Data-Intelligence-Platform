# Cloudflare MVP Review Environment Runbook

`codip-mvp.mirai-dx-platform.com` を **MVP公開・関係者レビュー用** のCloudflare Workers + Neon環境として有効化する手順である。
本番（`odip.mirai-dx-platform.com`）と同じ zone route + proxied AAAA 方式だが、**本番 Worker / route / secret / Hyperdrive / Neon production branch には一切触れない**。

## 0. MVP target

| 項目 | 値 |
| --- | --- |
| Zone | `mirai-dx-platform.com` |
| FQDN | `codip-mvp.mirai-dx-platform.com` |
| URL | `https://codip-mvp.mirai-dx-platform.com` |
| Worker | `codip-mvp`（`wrangler.jsonc` の `env.mvp`） |
| Routing | Zone route（`codip-mvp.mirai-dx-platform.com/*`）+ proxied AAAA `100::`、`workers_dev=false` |
| DB | Neon branch `mvp-20260813`（project `falling-dawn-93620497` の main から copy-on-write。**production main は不変**） |
| 接続方式 | Hyperdrive 不使用。Worker secret `DATABASE_URL`（Neon pooled URI）を Prisma の `@prisma/adapter-pg`（pg ドライバ）で Worker から直接 TCP 接続（`nodejs_compat` + Prisma >= 6.15） |
| 認証 | `CODIP_ENV_MODE=preview` / `CODIP_TRUST_PROXY_AUTH=false` / 管理トークン（`CODIP_ADMIN_TOKEN`）でセッション開始。ウォッチリストはデモ識別子 `demo.engineer@example.com`（seed 済み RBAC + ウォッチリスト） |
| データ | `prisma migrate reset --force`（mvp branch のみ）後に `db:pg:seed` を投入した架空ダミーデータ。本番データをコピーしたまま公開しない |

## 1. Stop conditions

- `wrangler.jsonc` の `env.mvp` に `hyperdrive` が空配列で明示されており、top-level のプレースホルダー ID を継承しないこと。
- `CODIP_DEPLOY_TARGET=staging` / `CODIP_BASE_URL=https://codip-mvp.mirai-dx-platform.com` / Neon が `mvp-20260813` branch であること。
- DNS レコードが既存で、かつ proxied AAAA `100::` でない場合はブロック（`planWorkerRouteDnsRecord`）。
- 本番 `odip` の DNS / route / Worker / secret / Hyperdrive、Neon production branch を変更するコマンドを含まないこと。

## 1.1 Route permission gate

zone route の登録には Cloudflare API token に **Zone > Workers Routes > Edit**
スコープが必要である。2026-08-13 の初回デプロイでは token がこのスコープを持たず、
`wrangler deploy --env mvp` の route 登録だけが `Authentication error [code: 10000]`
で失敗した（Worker アップロードと DNS 作成は成功。本番リソースは無変更）。

- 解除条件: 人間が Cloudflare Dashboard で token に Workers Routes:Edit を付与する
  （または同等スコープの token を `CLOUDFLARE_API_TOKEN` へ設定する）
- 付与後の再開: `node scripts/deploy/deploy-mvp.mjs --with-secrets`（冪等。
  Worker 更新 / DNS 再作成 / secrets 登録まで1コマンドで完結する）
- 検証: `npm run release:smoke -- --read-only --base-url https://codip-mvp.mirai-dx-platform.com`

## 2. Deploy

```bash
source ~/.bashrc
# 初回のみ（mvp branch を本番データから切り離してクリーンなダミーデータにする）
DATABASE_URL="<Neon mvp-20260813 direct URI>" \
  npx prisma migrate reset --force --schema prisma/postgresql/schema.prisma

# 標準経路: migrate status -> migrate deploy -> seed -> DNS -> ゲート -> deploy -> secrets
node scripts/deploy/deploy-mvp.mjs --with-secrets
```

- Neon URI は API から in-process で解決し、画面・ログに出力しない。
- 管理者トークンは未指定なら 64 hex で自動生成し、Worker secret へ登録のうえ `.mvp-admin-token.txt`（gitignore 対象）へ保存する。レビュー関係者へは out-of-band で共有する。
- `--skip-deploy` は read-only preflight（Neon 解決 + `migrate status`）のみ実行し、DNS / migration / seed / deploy / secret を一切変更しない。

## 3. Verification

```bash
npm run release:smoke -- --read-only --base-url https://codip-mvp.mirai-dx-platform.com
```

レビュー導線の確認:

1. `/` `/sites` `/sources` `/map` `/weather` `/terrain` `/reports` が HTTP 200 で表示されること
2. `/api/health` 200 / `/api/ready` 200（`status=ready` `db=ok`）
3. `/api/dashboard` と `/api/sources` にダミーデータが返ること
4. 管理トークンでログイン（ウォッチリスト画面の AdminTokenPanel）後、`/watchlist` で `demo.engineer@example.com` の seed エントリが表示され、追加・有効/無効切替・削除が動くこと
5. `/api/v1/watchlist` は未認証 401、`Origin` 不一致の書き込みが 403 になること

## 4. Rollback

- Worker: `npx wrangler rollback codip-mvp --env mvp`（直前 version へ）
- DB: Neon Console で `mvp-20260813` を削除し再作成（`scripts/deploy/deploy-mvp.mjs` を再実行）
- 公開停止: Cloudflare で `codip-mvp` の route / DNS record を削除
- 本番への影響なし（target が完全に分離）

## 5. Evidence

| 項目 | 記録 |
| --- | --- |
| サブドメイン決定 | `codip-mvp`（既存命名 `civil-terrain-api-mvp` / `ccid-mvp-staging` に整合。ユーザー指示「MVP用サブドメイン＋規定ドメイン」の仮定として採用） |
| Hostname conflict | 作成時点で DNS / Worker route / 既存 Worker 名の衝突なし |
| DNS | proxied AAAA `100::`（`deploy-mvp.mjs` が冪等作成） |
| DNS 状態 | 初回デプロイ時に作成→route 未作成のため一時削除済み（公開停止）。route 権限付与後の再デプロイで再作成 |
| Worker | `codip-mvp`（`wrangler deploy --env mvp`） |
| Neon | branch `mvp-20260813`（main から copy-on-write、production main 不変） |
| Migration / seed | `prisma migrate reset --force` → `migrate deploy` → `db:pg:seed`（架空ダミーデータ保持） |
| Smoke | `release:smoke --read-only --base-url https://codip-mvp.mirai-dx-platform.com` |
