# ロードテスト（k6）

> 2026-08-12 初回実施 ｜ 対象: ローカル Node preview（SQLite）。**本番には実行しない**

## 1. 目的とSLO

600名規模の利用を想定し、主要公開APIの応答性能とエラー率を実測する。
判定基準は `docs/runbooks/monitoring.md` §1.1.2 の暫定SLO:

| 指標 | 目標 | 2026-08-12 実測 |
| --- | --- | --- |
| P95 応答時間 | 5秒以内 | SQLite 10VU: **31.7 ms** ／ PG 10VU: **74.4 ms** ／ **PG 100VU: 981.6 ms** ／ PG 20VU+書込5VU: 103.3 ms |
| エラー率（HTTP） | 1%未満 | **0.00%**（全シナリオ） |
| チェック失敗率 | 1%未満 | **0.00%**（全シナリオ） |
| 総リクエスト | - | SQLite 5,328 ／ PG 10VU 4,509 ／ PG 100VU 7,847 ／ PG混合 7,003 |

対象エンドポイント: `/api/health` `/api/ready` `/api/sources` `/api/dashboard`
`/api/v1/layers` `/api/openapi` `/api/v1/records/search` `/api/v1/assessments/point`
`/api/v1/recommendations`

## 2. 実施方法

```bash
# ローカル
k6 run scripts/load/k6-scenarios.js --env BASE_URL=http://127.0.0.1:3110 --env MAX_VUS=20

# CI（dispatch専用・本番には触れない）
gh workflow run load-test.yml -f max_vus=20
```

previewは `CODIP_TRUST_PROXY_HEADERS=true` で起動し、k6はVUごとに
`cf-connecting-ip` を変えて**実ユーザー相当のレート制限**を再現する
（単一IPからの集中burstはアプリのレート制限が正しく429を返すため、
性能測定には使わない）。

## 3. 結果の解釈

- **2026-08-12**: P95 31.7ms・エラー0%でSLOを大幅に満たす（SQLite preview・10 VU）。
- **2026-08-12（PostgreSQL/PostGIS preview）**: 10VU P95 74.4ms、**100VU P95 981.6ms**、
  書込+管理API混在（20VU読込+5VU書込）P95 103.3ms・エラー0%。5秒SLOは100VUでも充足。
  本番（Cloudflare + Hyperdrive + Neon）ではネットワーク・DB負荷が加わるため、
  デプロイ後の本番スモーク（`release:post-release-status`）と併せて継続監視する。
- **2026-08-29（CI dispatch 初回完全成功, run 33250938031）**: 読込20VU+書込5VU・**総リクエスト 9,966**。
  - `http_req_failed` **0.00%** / `check_failure_rate` **0.00%**（全11チェック ✓）
  - `http_req_duration` **p(95)=21.7ms**（max 125.8ms）— 5秒SLOを大幅に充足
  - 管理系（`POST /api/v1/sites` 201/409・`GET /api/admin/roles` 200）も成功
  - ※ CI workflow 修正（#197 バインド0.0.0.0 / #198 ADMIN_TOKEN 受け渡し）により
    CI での再現が可能になった。実測は preview（SQLite）のみで本番には実行しない。
- **2026-08-29（CI dispatch 100VU, run 33253670697）**: 読込20VU+書込5VU・**総リクエスト 9,471**。
  - `http_req_failed` **0.00%** / `check_failure_rate` **0.00%**（全11チェック ✓）
  - `http_req_duration` **p(95)=29.54ms**（max 173.8ms）— 5秒SLOを大幅に充足
  - 20VU時（p95=21.7ms）と比較して約8ms増加だが、100VU負荷でも十分高速
  - 全エンドポイント正常応答（/api/health, /api/ready, /api/sources, /api/dashboard, /api/v1/layers, /api/openapi, records/search, assessments/point, recommendations）
- 単一IPで20 VUのburstを行うと429が大量発生するのは**レート制限の正常動作**であり、
  障害ではない（初回測定で確認）。
- 100VU相当の測定は **PostgreSQL/PostGIS preview** で実施済み（P95 981.6ms・SLO内）。
  本番同等環境（Workers + Hyperdrive + Neon）での測定は本番負荷を伴うため、
  承認を得たうえで段階的に実施する。

## 4. 残課題

- ~~PostgreSQL/PostGIS previewでの負荷測定~~ → **実施済み（P95 74.4ms @10VU / 981.6ms @100VU）**
- ~~100VU相当の測定~~ → **実施済み（PG preview）**
- ~~書き込み系・管理系APIの負荷測定~~ → **実施済み（認証付きwriteシナリオ、P95 103.3ms @混合）**
- 本番同等環境（Workers + Hyperdrive + Neon）での測定（承認後・段階実施）
