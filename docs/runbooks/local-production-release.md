# ローカル本番リリース Runbook（Issue #231）

`codip-production.service`（`odip.mirai-dx-platform.com` の origin）へのリリース手順。

## 0. なぜこの構成なのか

2026-09-09 まで、本番は**開発の作業ディレクトリから直接 `next start` していた**。

```
WorkingDirectory=/home/kensan/Projects/Mirai-DX-Project/Civil-Open-Data-Intelligence-Platform
ExecStart=... node_modules/.bin/next start -H 0.0.0.0 -p 18810
```

`next start` は起動時のビルドを前提に HTML を組み立てる。稼働中に `.next` が作り直されると、**配信中の HTML が参照する chunk がディスクから消える**。

実測（2026-09-09、是正前）:

```
$ curl -s http://localhost:18810/ | grep -oE '/_next/static/chunks/[a-zA-Z0-9-]+\.js'
/_next/static/chunks/webpack-bbb47d5a02d8da18.js

$ curl -s -o /dev/null -w "%{http_code}" http://localhost:18810/_next/static/chunks/webpack-bbb47d5a02d8da18.js
400
```

HTML が参照する JS が 400 = ブラウザで hydrate しない。開発者が `npm run build` を叩くだけでこうなる。`npm ci`（`node_modules` の作り直し）や `git checkout`（ソースの入れ替え）も同様に直撃する。

そこで**リリース成果物を開発ツリーから隔離**する。

```
~/deploy/codip/
  releases/<short-sha>/   … clone + npm ci + build 済みの完全な木
  current  -> releases/<short-sha>   … 本番が配信しているもの
  previous -> releases/<one-before>  … ロールバック先
```

開発ディレクトリで何をしても本番へ影響しない。ロールバックはリンクの張り替えと再起動だけで、**再ビルドを要しない**。

## 1. 通常のリリース

```bash
scripts/deploy/deploy-local-production.sh              # origin/main を配備
scripts/deploy/deploy-local-production.sh <commit>     # 指定 commit を配備
```

スクリプトが行うこと:

1. `origin` を fetch し、対象 commit を解決する
2. `releases/<short-sha>` へ clone → `npm ci` → `npm run build`（作りかけを `current` にしないよう一時ディレクトリで完成させてから移す）
3. `current` を**原子的に**張り替え、直前を `previous` へ退避する
4. リリース識別子を `~/.config/codip/release.env` へ書く
5. サービスを再起動し、`/api/ready` が通るまで待つ
6. **通らなければ自動的に直前へ切り戻す**
7. 古いリリースを整理する（`current` / `previous` は必ず残す）

## 2. 配信中の commit を確認する

```bash
curl -s http://localhost:18810/api/health
```

```json
{
  "status": "ok",
  "release": { "commit": "4c62f47", "deployedAt": "2026-09-09T01:20:00Z" },
  "checkedAt": "..."
}
```

`"unknown"` が返る場合は `release.env` が未設定。以前は systemd の起動時刻から推測するしかなかった。

```bash
scripts/deploy/deploy-local-production.sh --status
```

## 3. ロールバック

```bash
scripts/deploy/deploy-local-production.sh --rollback
```

`previous` へ張り替えて再起動する。ビルド済みの木がそのまま残っているため数秒で戻る。

## 4. 初回導入（1 回だけ必要な手順）

> ⚠️ **この節の systemd 操作は人間が実施する。** 本番実行構成の変更にあたるため、自動実行の対象外。

### 4.1 リリースを用意する（切替なし）

```bash
scripts/deploy/deploy-local-production.sh --build origin/main
```

### 4.2 環境変数を EnvironmentFile へ分離する

接続文字列を unit へ直書きすると `systemctl cat` / `systemctl show` で露出する（実際に本セッションの調査中、`systemctl --user cat` の出力へ本番 DB パスワードが現れた）。600 のファイルへ移す。

```bash
umask 077
mkdir -p ~/.config/codip
systemctl --user show codip-production.service -p Environment --value \
  | tr ' ' '\n' | grep -E '^[A-Z_]+=' > ~/.config/codip/production.env
chmod 600 ~/.config/codip/production.env
grep -oE '^[A-Z_]+' ~/.config/codip/production.env   # 変数名だけ確認する（値は表示しない）
```

### 4.3 unit を隔離構成へ張り替える

`~/.config/systemd/user/codip-production.service` を次の内容にする。

```ini
[Unit]
Description=CODIP Production (Local Node.js + PostgreSQL, odip.mirai-dx-platform.com)
Documentation=https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/issues/231
After=network.target postgresql.service

[Service]
# 開発の作業ディレクトリではなく、隔離されたリリースを配信する (Issue #231)
WorkingDirectory=%h/deploy/codip/current

# 接続文字列を unit へ直書きしない (systemctl cat / show での露出を防ぐ)
EnvironmentFile=%h/.config/codip/production.env
# 配備中のリリース識別子。/api/health が申告する
EnvironmentFile=-%h/.config/codip/release.env

ExecStart=/home/kensan/.nvm/versions/node/v25.2.1/bin/node node_modules/.bin/next start -H 0.0.0.0 -p 18810
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
chmod 600 ~/.config/systemd/user/codip-production.service
systemctl --user daemon-reload
scripts/deploy/deploy-local-production.sh origin/main   # current を作り、再起動まで行う
```

### 4.4 確認

```bash
systemctl --user is-active codip-production.service          # active
curl -s http://localhost:18810/api/health | jq .release      # commit が出る
systemctl --user cat codip-production.service | grep -c postgresql   # 0 (credential が unit に無い)
```

## 5. 既知の制約

- リリース 1 つあたり約 1.7GB（`node_modules` 1.3GB + `.next` 336MB）。既定で 3 世代保持する（`CODIP_KEEP_RELEASES`）。
- `npm ci` と `npm run build` にネットワークが必要。オフラインでは既存リリースへの切り替え（`--rollback`）のみ可能。
- Cloudflare Tunnel（`codip-production-cloudflared.service`）は本手順の対象外。ポート 18810 を指すだけなので、リリース切替の影響を受けない。

## 6. 関連

- Issue #231（本 Runbook の発端）
- Issue #223（systemd の失敗が無音）
- `docs/runbooks/database-deployment.md`（バックアップ・復元）
