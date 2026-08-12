# 運用自動化ツール

> 2026-08-12 追加 ｜ 少人数運用（IT/DX 7名）向けの読み取り/ドライラン安全な運用ツール群

## 1. CKANハーベスト（`npm run ingest:harvest-ckan`）

BODIK / JIG 等のCKANカタログからデータセットを台帳（data_sources）へ取り込む。

```bash
# ドライラン（書き込みなし）
DATABASE_URL=postgres://... npm run ingest:harvest-ckan -- \
  --catalog-url https://data.bodik.jp --rows 20 --dry-run

# 反映（本番DBへの書き込みは人間判断で実行）
DATABASE_URL=postgres://... npm run ingest:harvest-ckan -- \
  --catalog-url https://data.bodik.jp --rows 20
```

- 接続先は `data.bodik.jp` / `ckan.odp.jig.jp` の https のみ（SSRFガード）
- JSON/CSV/GeoJSON/XML リソースを優先し、https 以外はスキップ
- `officialUrl` で重複を判定し upsert（既存は更新、新規は作成）
- 2026-08-12 実測: BODIK 10件のドライランで雨量・河川水位・ダム等のCSV候補を確認

## 2. データ品質SLA監視（`npm run ops:sla-monitor`）

有効な収集ジョブの鮮度を提供元別に監視する。

```bash
DATABASE_URL=postgres://... npm run ops:sla-monitor -- --strict
```

- 許容鮮度: `realtime=6h` / `10min=1h` / `hourly=4h` / `daily=30h` / `weekly=8d` / `monthly=35d` / `yearly=400d`
- `irregular` はSLA対象外（not-tracked）
- `--strict` 時、停滞・未実行ジョブが1件でもあれば終了コード1

## 3. ロール割当の定期棚卸し（`npm run ops:review-roles`）

期限付きロール割当の失効・期限間近を検出する（月次点検向け）。

```bash
DATABASE_URL=postgres://... npm run ops:review-roles -- --strict --expiring-days 14
```

- `--strict` 時、期限切れまたは7日以内に期限が来る割当があれば終了コード1
- 本番の実ユーザー割当は `/settings` のロール管理UIまたは `/api/admin/roles` で実施

## 4. e-Stat API（キー登録後に有効化）

`prisma/seed-data.ts` に e-Stat 統計表データ（国勢調査）エントリを追加済み。
`requiresApiKey: true` / `apiKeyEnvName: ESTAT_APP_ID` のため、ジョブ自動生成対象外。

1. 人間が e-Stat API キー（ESTAT_APP_ID）を取得し、GitHub Actions Secret / 環境へ登録
2. キー付き環境で `seed-jobs --enable` または個別ジョブ作成
3. 収集・品質監視で実測確認

## 5. ウォッチリスト（通知基盤）

`/api/v1/watchlist`（GET/POST）・`/api/v1/watchlist/{id}`（DELETE）で、
`site` / `dataSource` / `ingestionJob` を個人単位で登録できる（engineer以上・RBAC連動）。

```bash
curl -X POST https://<host>/api/v1/watchlist \
  -H "Content-Type: application/json" \
  -d '{"targetType":"dataSource","targetId":"<dataSourceId>"}'
```

日次ダイジェストは `.github/workflows/sla-monitor.yml`（21:05 JST）が生成し、
`data-watch-digest` Issue を自動更新する。手動確認:

```bash
DATABASE_URL=postgres://... npm run ops:notification-check
```

通知対象: 更新遅延（SLA鮮度超過）・ジョブ失敗（lastStatus=failed / retry上限到達）・
現場の直近判定が caution/stop。

## 6. 河川水位XML・水文水質CSV（確認中）

2026-08-12 時点では `river.go.jp` 関連URLのHTTP 200はHTMLページのみで、
構造的データ（XML/CSV）エンドポイントを確認できていない。**エンドポイント検証後に追加**する。

## 7. 本番負荷シナリオ（承認後）

`scripts/load/k6-production-scenario.js`（read-only・Access service token対応）を
承認後に **5→10→20 VU** の順で段階実行する。本番SLO（P95 5秒・エラー率1%未満）を確認する。
