# 🚀 段階的本番デプロイ計画（2026-08 サイクル）

最終更新: 2026-08-21T16:12Z (UTC) = 2026-08-22 01:12 JST

**B-1（マージ権限）解除後にそのまま実行できる手順書。** 前提はすべて実測で確認済みで、
出典を併記する。実測していない項目は「未実測」と明記し、達成を主張しない。

---

## 📌 0. なぜ段階的にするのか

本番は **2026-08-09T23:20:56Z** の version `fc732a4a` で止まっており、
その後 main へ **28 commits** がマージされている。本サイクルの **12 PR** が
その上へ積まれるため、1回のデプロイで 40 commit 相当が一度に反映される。

一度に出すと、異常が出たときに**どの変更が原因か切り分けられない**。
段階を分け、各段で判定してから次へ進む。

---

## 📌 1. 事前に確認済みの前提（実測）

| 前提 | 実測結果 | 出典 |
| --- | --- | --- |
| 本番 Worker の現行 version | `fc732a4a-5352-4b8a-9bb0-ab7db5a43c0f`（2026-08-09T23:20:56Z） | Cloudflare API `workers/scripts/codip-production/deployments` |
| 本番 Neon への到達性 | ✅ project `falling-dawn-93620497` / branch `main` | `deploy-production.mjs --skip-deploy` |
| 本番 schema の状態 | ✅ **8 migrations すべて適用済み・up to date** | 同上（`prisma migrate status`） |
| 本番の稼働状態 | ✅ 24時間で 151 requests / **errors 0** | GraphQL Analytics `workersInvocationsAdaptive` |
| health / ready | ✅ `odip` = 302（Access 境界）/ `codip-mvp` = 200 `db=ok` | curl |

### 🎯 最重要: **デプロイ時に migration は不要**

本番 DB は既に目標 schema に達している。稼働コードより新しい migration が2件あるが、
**どちらも適用済み**である。

| migration | 状態 | 破壊的 DDL |
| --- | --- | ---: |
| `20260812130000_add_rbac_roles` | 本番DBへ適用済み（稼働コードより新しい） | **0**（CREATE TABLE 2 / INDEX 2 / UNIQUE 2 のみ） |
| `20260812150000_add_watchlist` | 本番DBへ適用済み（稼働コードより新しい） | **0**（CREATE TABLE 1 / INDEX 1 / UNIQUE 1 のみ） |

つまり現状は **「新しいスキーマ + 古いコード」** であり、これは安全な向きである
（追加のみなので、古いコードは新しいテーブルを単に使わない）。
デプロイはコードを DB に追いつかせる操作であって、DB を動かす操作ではない。

**本サイクルの 12 PR は migration を1件も追加していない**（全ブランチで実測 0 件）。

---

## 📌 2. デプロイ範囲

12 PR が触る本番ランタイム（`src/`）は 14 ファイル。`scripts/` の2件はデプロイ対象外
（CI とデプロイ経路のツール）。

| 区分 | ファイル |
| --- | --- |
| 認可 | `src/lib/rbac.ts`, `src/lib/admin-auth.ts`, `src/lib/proxy-auth-inject.ts` |
| 入力検証 | `src/lib/query-params.ts`（新規）, `observations/{weather,marine}`, `terrain/runs`, `assessments/geometry`, `layers/[id]/features` |
| 資源有界化 | `analysis/{wave50,historical}`, `sources/[id]/lineage` |
| 検索 | `src/lib/standard-records.ts` |
| 契約 | `src/app/api/openapi/route.ts` |

---

## 📌 3. 段階

各段は「実行 → 判定 → 次へ」。判定が NG なら §5 の rollback へ。

### Stage 0: マージ（B-1 解除後）

スタック順にマージする。逆順にすると差分が壊れる。

```bash
# 1) 依存 → 2) 独立系 → 3) 入力検証チェーン
gh pr merge 171 --squash --delete-branch
for pr in 172 173 175 176 180 181; do gh pr merge $pr --squash --delete-branch; done
for pr in 174 177 178 179 182; do gh pr merge $pr --squash --delete-branch; done
```

各マージ後に main の CI が緑であることを確認する。

```bash
gh run list --workflow=ci.yml --branch=main --limit 1
```

### Stage 1: デプロイ対象 commit の固定と検証

```bash
git fetch origin main
git checkout main && git pull --ff-only
git rev-parse HEAD          # ← この値を記録する（デプロイ対象 commit）
```

`deploy-production.mjs` が自動で次を検証する（PR #182 で追加）。
**手で確認する必要はないが、失敗したら止まる。**

1. 作業ツリーがクリーン
2. `HEAD` == `origin/main`
3. リモート main 実体 == `HEAD`
4. その commit の CI check-run が全ページ success

### Stage 2: 読取り専用 preflight

```bash
node scripts/deploy/deploy-production.mjs --skip-deploy
```

**判定**: exit 0 かつ `Database schema is up to date!` が出ること。
DNS 変更・migration・seed・deploy・secrets には到達しない。

### Stage 3: 本番デプロイ

```bash
node scripts/deploy/deploy-production.mjs
```

**判定**: exit 0。新しい version ID を記録する。

```bash
npx wrangler deployments list --name codip --env production
```

### Stage 4: スモークとエラー率（デプロイ直後）

本番は Access 配下のため、**ローカル smoke では判定できない**
（`post-release-status.js:24-25` は Access ヘッダーを Secrets からしか付けない）。
GitHub Actions の認証つき probe を dispatch し、**その run の成否**で判定する。

```bash
BEFORE=$(gh run list --workflow=production-smoke.yml --event=workflow_dispatch \
  --limit 1 --json databaseId -q '.[0].databaseId // 0')
gh workflow run production-smoke.yml
RUN_ID=""
for _ in $(seq 1 30); do
  sleep 4
  C=$(gh run list --workflow=production-smoke.yml --event=workflow_dispatch \
    --limit 1 --json databaseId -q '.[0].databaseId // 0')
  if [ "$C" != "$BEFORE" ] && [ "$C" != "0" ]; then RUN_ID="$C"; break; fi
done
[ -n "$RUN_ID" ] || { echo "run を特定できなかった" >&2; exit 1; }
gh run watch "$RUN_ID" --exit-status
```

**判定基準**（`incident-response.md` §7 の SLO と同一）:

| 項目 | 合格 |
| --- | --- |
| probe | 成功（`/api/health` `/api/ready`） |
| `checks.database` | `ok` |
| `responseTimeMs` | ≤ 5000ms |

### Stage 5: エラー率の確認（デプロイ後 30 分・2 時間）

デプロイ前のベースラインは **151 requests / errors 0（24h）** である。

Cloudflare GraphQL Analytics で `workersInvocationsAdaptive` を引き、
`scriptName=codip-production` の `sum.errors` を確認する。

**判定**: errors が 0 のまま、または増加が Access 由来の 4xx に説明できること。
`sum.errors` が増えていたら Stage 6 へ。

### Stage 6: 初期安定化監視（デプロイ後 24 時間）

`production-smoke.yml` は 15 分毎に自動で回る。**追加の作業は要らないが、
連続失敗が 2 回以上になると incident Issue が P1 で自動起票される**
（`production-smoke.yml:81-224`）。24 時間、Issue が立たないことを確認する。

```bash
gh issue list --label production-smoke --state open
gh run list --workflow=production-smoke.yml --event=schedule --limit 10 \
  --json createdAt,status,conclusion -q '.[] | "\(.createdAt) \(.status) \(.conclusion)"'
```

---

## 📌 4. 各段の停止条件

| 段 | 止める条件 |
| --- | --- |
| Stage 0 | main の CI が緑にならない |
| Stage 1 | 素性ゲートが失敗（未マージ・作業ツリー汚れ・CI 未緑） |
| Stage 2 | preflight が exit≠0、または schema が up to date でない |
| Stage 3 | deploy が exit≠0 |
| Stage 4 | probe run が失敗、`db` が `ok` でない、5000ms 超 |
| Stage 5 | `sum.errors` が増加し、Access 由来と説明できない |
| Stage 6 | incident Issue が起票される |

---

## 📌 5. Rollback

**migration の巻き戻しは不要である**（本デプロイは DB を変更しない）。
コードのみを戻せばよい。実測 RTO は **4秒**（`operations-ledger.md` §5、2026-08-10 ドリル）。

```bash
npx wrangler deployments list --name codip --env production   # 戻し先 version-id を確認
npx wrangler rollback fc732a4a-5352-4b8a-9bb0-ab7db5a43c0f \
  --name codip --env production --message "incident: <Issue番号> による切り戻し"
```

> ⚠️ 戻し先 `fc732a4a` は 2026-08-09 の version である。戻すと本サイクルの修正も
> 28 commits 分の修正も同時に消える。**部分的な切り戻しはできない**ため、
> 段階を分けて出す意味がここにある。

戻した後は Stage 4 と同じ手順で確認する。詳細は
[`rollback.md`](rollback.md) §2、判断フローは同 §1。

---

## 📌 6. この計画が扱わないもの

将来の作業を実施済みとして書かないため、範囲外を明記する。

| 項目 | 状態 | 必要なこと |
| --- | --- | --- |
| バックアップ復旧 | ❌ 2026-08-13 から失敗中 | Secrets 登録（人間決裁・PR #144） |
| `pg_restore` 型の復元訓練 | ❌ 一度も未実施 | 暗号化 dump の復号可否が未検証 |
| アラート試験（人間の受信確認） | ❌ 未実施 | 外部通知先が未設定 |
| `codip-mvp` の監視 | ❌ smoke の probe 対象外 | probe 対象への追加判断 |
| エラー率 SLO の閾値 | ❌ 未定義 | 定常時ベースラインの測定 |
