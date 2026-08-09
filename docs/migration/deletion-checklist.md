# 🗑️ 統合元リポジトリ削除判定チェックリスト

削除対象:
- Kensan196948G/Civil-Terrain-Slope-Risk-Viewer
- Kensan196948G/wmcdss

| # | 必須条件 | 状態 | 証跡 |
| --- | --- | --- | --- |
| 1 | 全機能の移行台帳が100%判定・実施済み | ⏳ 台帳作成済み (inventory-terrain.md / inventory-wmcdss.md)。実施判定はPR完了時に100%へ更新 | docs/migration/ |
| 2 | 必要なコード・データ・文書・設定例・ライセンス・出典表記を移管済み | ✅ 地形/気象/海象/判定/レポートを中核へ移植。出典表記をUI・APIに反映 | 本PR |
| 3 | Git履歴・最終commit SHA・Issue・PR・リリースを保存済み | ✅ bundle + JSON 一式 (preservation/) | docs/migration/preservation/ |
| 4 | 中核のCI・ビルド・主要テスト・E2E・データ移行・バックアップ・復旧検証が成功 | ⏳ ローカル検証済み。CI全ジョブgreen待ち | PR CI |
| 5 | 旧URL・Actions・Webhook・デプロイ・外部参照・利用者依存がゼロ | ⏳ 中核内の参照ゼロは確認中。外部依存はGitHub検索で最終確認 | rg / gh search |
| 6 | 中核単独で主要機能を再現でき、ロールバック手順を検証済み | ⏳ runbooks/rollback.md + Neon restore drill 実績を再確認 | docs/runbooks/ |
| 7 | 統合報告書とリポジトリ別削除判定チェックリストが完成 | ✅ 本ファイル + integration-report.md | docs/migration/ |
| 8 | 削除直前に対象名を再確認 | ⏳ 削除実行直前に gh repo view で確認 | gh コマンド出力 |

## 🚦 判定ルール

- 全項目 ✅ になるまで削除しない
- 削除は `gh repo delete Kensan196948G/Civil-Terrain-Slope-Risk-Viewer --yes` /
  `gh repo delete Kensan196948G/wmcdss --yes` で実行し、中核は削除しない
- 権限・保護規則・認証不足で削除できない場合は迂回せず、削除可能な状態まで
  整えて未実行理由と必要操作を報告する
