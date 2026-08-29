# Cloudflare MVP Review Environment Runbook

`codip-mvp.mirai-dx-platform.com` を **MVP公開・関係者レビュー用** の環境として有効化する手順である。
本番（`odip.mirai-dx-platform.com`）と同じ Cloudflare 基盤だが、**本番 Worker / route / secret / Hyperdrive / Neon production branch には一切触れない**。

> ⚠️ **実態との整合（2026-08-29 実測・Deep Debug Round 2/4）**
> 本ドキュメントの旧記述は「Workers Custom Domains + Neon mvp branch」方式だったが、
> **現行の公開経路は Cloudflare Tunnel + ローカル next start（SQLite）** である。
> 詳細は §0.1 を参照。Worker `codip-mvp` はデプロイされているが公開 target は無い
> （`wrangler deploy --env mvp` は "No targets deployed" と報告し、カスタムドメイン
> は account の Custom Domains 一覧に存在しない。Round 2 実測）。

## 0. MVP target

| 項目 | 値 |
| --- | --- |
| Zone | `mirai-dx-platform.com` |
| FQDN | `codip-mvp.mirai-dx-platform.com` |
| URL | `https://codip-mvp.mirai-dx-platform.com` |
| **現行公開経路** | **Cloudflare Tunnel（`codip-mvp-cloudflared.service`, tunnel `0b3721de-…`）→ `http://localhost:18801`（`codip-mvp.service` = `next start -p 18801`、SQLite `file:./dev.db`）** |
| Worker | `codip-mvp`（`wrangler.jsonc` の `env.mvp`）— デプロイ済みだが公開 target なし |
| DB | **ローカル SQLite `dev.db`**（旧方式の Neon branch `mvp-20260813` は現在未使用） |
| 認証 | `CODIP_ENV_MODE=preview` / `CODIP_TRUST_PROXY_AUTH=false` / 管理トークン（`CODIP_ADMIN_TOKEN`）でセッション開始。ウォッチリストはデモ識別子 `demo.engineer@example.com`（seed 済み RBAC + ウォッチリスト） |
| データ | `prisma/seed.ts`（SQLite）のデモデータ |

### 0.1 現行公開経路の実体（2026-08-29 実測）

```text
codip-mvp.mirai-dx-platform.com
  └─ DNS: CNAME → 0b3721de-…cfargotunnel.com（proxied）
       └─ Cloudflare Tunnel（systemd: codip-mvp-cloudflared.service）
            └─ ingress: http://localhost:18801
                 └─ systemd: codip-mvp.service（next start -p 18801、SQLite dev.db）
```

- トンネル設定: `~/.cloudflared/codip-mvp-config.yml`（hostname → localhost:18801）
- アプリの更新手順:
  1. `git pull` で main を更新
  2. `npm run build`（**cf:build 実行後は .next/BUILD_ID が消えるため必ず再実行する**。
     cf:build → next start は "Could not find a production build" で起動失敗する。Round 4 実測）
  3. `sudo systemctl restart codip-mvp.service`（要 root）
- 参考: production smoke の `--preview-url http://192.168.0.185:3100` はこの LAN 上の
  preview を指す（GitHub ランナーからは到達不能のため `--allow-preview-down` で許容）。

## 1. Stop conditions

- `wrangler.jsonc` の `env.mvp` に `hyperdrive` が空配列で明示されており、top-level のプレースホルダー ID を継承しないこと。
- `CODIP_DEPLOY_TARGET=staging` / `CODIP_BASE_URL=https://codip-mvp.mirai-dx-platform.com` / Neon が `mvp-20260813` branch であること。
- DNS レコードが既存で、かつ proxied AAAA `100::` でない場合はブロック（`planWorkerRouteDnsRecord`）。
- 本番 `odip` の DNS / route / Worker / secret / Hyperdrive、Neon production branch を変更するコマンドを含まないこと。

## 1.1 Routing permission decision

zone route の登録には Cloudflare API token に **Zone > Workers Routes > Edit**
スコープが必要である。2026-08-13 の初回デプロイでは token がこのスコープを持たず、
`wrangler deploy --env mvp` の route 登録だけが `Authentication error [code: 10000]`
で失敗した（Worker アップロードと DNS 作成は成功。本番リソースは無変更）。

一方で同 token には **Workers Custom Domains** スコープがあり、カスタムドメイン
`codip-mvp.mirai-dx-platform.com` の Worker 紐付けは成功した。以降はカスタム
ドメイン方式を正とし（`deploy-mvp.mjs` の `ensureCustomDomain` が冪等登録）、
zone route は使用しない。

- 再デプロイ: `node scripts/deploy/deploy-mvp.mjs --with-secrets`（冪等。
  Worker 更新 / DNS 確認 / secrets 登録まで1コマンドで完結する）
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

- Worker: 直前 version へ戻す。**worker 名は `--name` で渡す**
  （`wrangler rollback` の位置引数は version-id であり、worker 名を置くと
  「その ID の version が無い」で失敗する）

  ```bash
  npx wrangler deployments list --name codip --env mvp     # 戻し先の version-id を確認
  npx wrangler rollback --name codip --env mvp             # 最新の1つ前へ
  npx wrangler rollback <VERSION_ID> --name codip --env mvp
  ```
- DB: Neon Console で `mvp-20260813` を削除し再作成（`scripts/deploy/deploy-mvp.mjs` を再実行）
- 公開停止: Cloudflare で `codip-mvp` の route / DNS record を削除
- 本番への影響なし（target が完全に分離）

## 5. Evidence

| 項目 | 記録 |
| --- | --- |
| サブドメイン決定 | `codip-mvp`（既存命名 `civil-terrain-api-mvp` / `ccid-mvp-staging` に整合。ユーザー指示「MVP用サブドメイン＋規定ドメイン」の仮定として採用） |
| Hostname conflict | 作成時点で DNS / Worker route / 既存 Worker 名の衝突なし |
| DNS | proxied AAAA `100::`（カスタムドメイン紐付け時に Cloudflare が自動作成。deploy-mvp.mjs が冪等確認） |
| Worker | `codip-mvp`（`wrangler deploy --env mvp`） |
| Neon | branch `mvp-20260813`（main から copy-on-write、production main 不変） |
| Migration / seed | `prisma migrate reset --force` → `migrate deploy` → `db:pg:seed`（架空ダミーデータ保持） |
| Smoke | `release:smoke --read-only --base-url https://codip-mvp.mirai-dx-platform.com` |
