# 次ステップ10項目の本番ロールアウト手順（人間承認事項）

> 2026-08-12 作成 ｜ 対象: main `64f5954` 以降 ｜ **デプロイ・本番DB書き込み・実ユーザー割当は人間が実行**

## 1. 本番デプロイ（P0・人間操作）

```bash
# 事前確認（read-only）
npm run release:validate-env:production-target
npm run release:production-evidence -- --strict
npm run release:check-production-placeholders -- --env production

# デプロイ（承認後に実行。CLAUDE.md §18: デプロイは人間が手動実行）
npm run cf:deploy:production

# デプロイ後スモーク
npm run release:post-release-status -- --strict-production --max-response-ms 5000
```

完了条件: production smoke成功（health/ready 200）・Workers error 0件・Neon migration up-to-date。

## 2. 実データ収集55ジョブの段階有効化（P0・人間操作）

```bash
# ドライランで対象確認
DATABASE_URL=<本番Pg> npm run ingest:seed-jobs -- --dry-run

# 段階1: 気象庁JSON（リスク低）から有効化
DATABASE_URL=<本番Pg> npm run ingest:seed-jobs -- --enable

# 24時間後にデッドレター・停滞を確認
DATABASE_URL=<本番Pg> npm run ops:sla-monitor -- --strict
```

- 提供元レート制限と `maxRecords` を確認しながら段階的に増やす
- dead_letter 化したジョブは原因（404・スキーマ変化）を確認して無効化 or 修正
- 品質SLA監視を日次CI/scheduled へ組み込む（次のサイクル）

## 3. ロール割当の運用開始（P0・人間操作）

1. `/settings`（または `/api/admin/roles`）で実利用者へ割当
   - 現場技術者 → `engineer`（期限付き推奨）
   - IT/DX担当 → `data-steward` / `admin`
   - 監査担当 → `auditor`（参照のみ）
2. 月次で `npm run ops:review-roles -- --strict` を実行し、期限切れ・期限間近を棚卸し
3. Entra IDグループ連携（Phase 2）まではメール単位で運用し、運用台帳に記録

## 4. 注意事項

- CKANハーベスト・e-Stat・PWAオフライン強化・SLA監視は本PRで実装済み（マージ後）
- 本番へのハーベスト実行は「ドライラン → 少量反映 → 監査」の順で人間が判断する
- 100VU負荷テストは preview で実施済み。本番同等環境での測定は本番負荷を伴うため
  利用時間帯を避けて段階実施する（承認事項）

## 5. 追加（2026-08-12 実装済み）

- **ウォッチリストAPI** `/api/v1/watchlist`（engineer以上・個人単位）と
  日次ダイジェスト（`sla-monitor.yml` が `data-watch-digest` Issue を自動更新）
- **SLA日次監視** `sla-monitor.yml`（21:05 JST・strict失敗で赤・artifact保存）
- **本番負荷シナリオ** `scripts/load/k6-production-scenario.js`（承認後に段階実行）
- 河川水位XML・水文水質CSVは構造的エンドポイント確認後に追加（現時点はHTMLのみ確認）
