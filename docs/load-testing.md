# ロードテスト（k6）

> 2026-08-12 初回実施 ｜ 対象: ローカル Node preview（SQLite）。**本番には実行しない**

## 1. 目的とSLO

600名規模の利用を想定し、主要公開APIの応答性能とエラー率を実測する。
判定基準は `docs/runbooks/monitoring.md` §1.1.2 の暫定SLO:

| 指標 | 目標 | 2026-08-12 実測（10 VU / 70秒） |
| --- | --- | --- |
| P95 応答時間 | 5秒以内 | **31.7 ms** |
| エラー率（HTTP） | 1%未満 | **0.00%** |
| チェック失敗率 | 1%未満 | **0.00%** |
| 総リクエスト | - | 5,328（75.6 req/s） |

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
  本番（Cloudflare + Hyperdrive + Neon）ではネットワーク・DB負荷が加わるため、
  デプロイ後の本番スモーク（`release:post-release-status`）と併せて継続監視する。
- 単一IPで20 VUのburstを行うと429が大量発生するのは**レート制限の正常動作**であり、
  障害ではない（初回測定で確認）。
- 600名同時利用相当（100 VU以上）の測定は、本番同等環境（PostgreSQL + Workers）で
  実施することを次サイクルの課題とする（現状はpreviewのSQLiteがボトルネックになり得る）。

## 4. 残課題

- PostgreSQL/PostGIS previewでの負荷測定（SQLiteとの比較）
- 本番同等環境（Workers + Hyperdrive + Neon）での100 VU測定
- 管理系API・書き込み系APIの負荷測定（認証付きシナリオ）
