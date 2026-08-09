# 🗑️ 統合元リポジトリ削除判定チェックリスト

削除対象:
- Kensan196948G/Civil-Terrain-Slope-Risk-Viewer
- Kensan196948G/wmcdss

| # | 必須条件 | 状態 | 証跡 |
| --- | --- | --- | --- |
| 1 | 全機能の移行台帳が100%判定・実施済み | ✅ 全機能を移行分類で判定し、主要機能を中核へ実装・統合 | docs/migration/inventory-*.md |
| 2 | 必要なコード・データ・文書・設定例・ライセンス・出典表記を移管済み | ✅ 地形/気象/海象/判定/レポート/DBスキーマ/文書を移管。出典表記をUI・APIに反映 | PR #109 (main 234e46e) |
| 3 | Git履歴・最終commit SHA・Issue・PR・リリースを保存済み | ✅ bundle + JSON 一式 (preservation/) | docs/migration/preservation/ |
| 4 | 中核のCI・ビルド・主要テスト・E2E・データ移行・バックアップ・復旧検証が成功 | ✅ main CI全green (verify/e2e/node-preview/postgresql-compat/docker-preview/docker-image-security/docker-supply-chain/CodeQL)。Neon backup 2026-08-07/08 success、data-ingestion success | run 31314661054 / 31271930146 |
| 5 | 旧URL・Actions・Webhook・デプロイ・外部参照・利用者依存がゼロ | ✅ 統合元2件のhooks=0/environments=0。DX-Project-Portfolio-Atlas の参照を中核へ更新 (PR #70 merged)。残る `wmcdss` はAtlas内部のプロジェクトID (URL参照ではない) | gh api / PR #70 |
| 6 | 中核単独で主要機能を再現でき、ロールバック手順を検証済み | ✅ ローカル検証 + main CI で再現。ロールバック手順は docs/runbooks/rollback.md + Neon restore drill (2026-08-04) | docs/runbooks/rollback.md |
| 7 | 統合報告書とリポジトリ別削除判定チェックリストが完成 | ✅ 本ファイル + integration-report.md | docs/migration/ |
| 8 | 削除直前に対象名を再確認 | ✅ 削除実行直前に `gh repo view` で両リポジトリの名前・ブランチを確認 | 2026-08-09 実行ログ |

## 🚦 判定ルール

- 全項目 ✅ になるまで削除しない
- 削除は `gh repo delete Kensan196948G/Civil-Terrain-Slope-Risk-Viewer --yes` /
  `gh repo delete Kensan196948G/wmcdss --yes` で **2026-08-09 に実行済み** (API 404 で削除を確認)。中核は削除しない
- 権限・保護規則・認証不足で削除できない場合は迂回せず、削除可能な状態まで
  整えて未実行理由と必要操作を報告する
