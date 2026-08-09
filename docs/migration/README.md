# 📋 統合移行台帳 (Migration Ledger)

本ディレクトリは、統合元2リポジトリの機能・資産を中核
`Civil-Open-Data-Intelligence-Platform` へ完全吸収するための調査結果・分類・
実施記録・保全一式を管理する。

| 統合元 | インベントリ | 保全一式 | 削除判定 |
| --- | --- | --- | --- |
| `Civil-Terrain-Slope-Risk-Viewer` | [inventory-terrain.md](inventory-terrain.md) | [preservation/terrain](preservation/terrain/) | 完了後追記 |
| `wmcdss` | [inventory-wmcdss.md](inventory-wmcdss.md) | [preservation/wmcdss](preservation/wmcdss/) | 完了後追記 |

## 📌 移行分類 (Migration Classification)

| 分類 | 定義 |
| --- | --- |
| 🟢 そのまま移植 | 中核と技術スタックが同一で、ロジックを無改変で流用できる |
| 🔵 再設計統合 | 中核のアーキテクチャ (Next.js/Prisma/Workers) へ合わせて再実装 |
| 🟣 重複統合・置換 | 中核の既存機能と重複するため、中核実装へ統合・置換 |
| 🟡 互換性維持移行 | 外部契約 (APIレスポンス・DBスキーマ) を維持しつつ移行 |
| 🟠 未完成を完成統合 | 統合元で未完成の機能を中核実装として完成させる |
| 🔴 廃止候補 | 根拠・影響・代替を記録して廃止を提案 |

## ✅ 実施状況

- 🟢 2026-08-09: 地形解析ライブラリ (Horn法/TPI/断面/DEM復号/確認カード) を
  `src/lib/terrain` へ移植、単体テスト 114件成功
- 🟢 2026-08-09: 地形API 5エンドポイント
  (`/api/v1/terrain/elevation|analysis|section|confirm|export`) 実装
- 🟢 2026-08-09: 地形UI (`/terrain`) 実装 (MapLibre + GSIタイル + 共有URL +
  Markdown/CSV/JSON出力)
- 🟢 2026-08-09: Git bundle + GitHub Issue/PR/Release メタデータ保全完了
- ⏳ 気象・海象 (wmcdss) の Prisma モデル・API・判定エンジン・UI 統合
- ⏳ 統合報告書・削除判定チェックリスト
