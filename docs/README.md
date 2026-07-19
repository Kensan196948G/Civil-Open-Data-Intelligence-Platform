# CODIP 開発ドキュメント一覧

Civil Open Data Intelligence Platform（CODIP）は、土木建設関連の公開データを台帳化し、取得確認、検索、地図表示、後続API契約まで扱う共通データ基盤です。現行MVPは台帳と確認基盤が中心で、原本保存と標準レコード本体の本格運用は次フェーズで扱います。

この `docs/` フォルダは、非エンジニアの事業理解から、開発者の実装・運用・テストまでをつなぐ正本ドキュメント群です。

## 主要ドキュメント

| 区分 | ファイル | 用途 |
| --- | --- | --- |
| 要件 | [01-requirements-definition.md](01-requirements-definition.md) | 目的、対象利用者、MVP、成功条件 |
| 詳細仕様 | [02-detailed-design-specification.md](02-detailed-design-specification.md) | 画面、機能、データ、処理、非機能の詳細 |
| アーキテクチャ | [03-system-architecture.md](03-system-architecture.md) | 現行MVP構成と将来構成 |
| API | [04-api-design.md](04-api-design.md) | 管理API、検索API、後続システム向けAPI |
| データモデル | [05-data-model-and-database.md](05-data-model-and-database.md) | 共通データモデル、Prisma、PostGIS移行 |
| 取込 | [06-data-ingestion-and-connectors.md](06-data-ingestion-and-connectors.md) | コネクタ、取得、原本保存、ログ |
| 地理空間 | [07-geospatial-design.md](07-geospatial-design.md) | 地図、座標系、範囲検索、レイヤー |
| 品質 | [08-data-quality-policy.md](08-data-quality-policy.md) | 品質軸、スコア、利用推奨表示 |
| セキュリティ | [09-security-and-compliance.md](09-security-and-compliance.md) | 秘密情報、ログ、公開データ利用条件 |
| AI統制 | [10-ai-governance.md](10-ai-governance.md) | AI支援の範囲、禁止事項、承認フロー |
| 開発 | [11-development-guide.md](11-development-guide.md) | ローカル開発、ブランチ、実装ルール |
| テスト | [12-test-plan.md](12-test-plan.md) | 単体、E2E、品質、回帰テスト |
| 運用 | [13-deployment-and-operations.md](13-deployment-and-operations.md) | デプロイ、監視、障害対応 |
| 計画 | [14-roadmap.md](14-roadmap.md) | フェーズ0から5までの開発計画 |
| 用語 | [15-glossary.md](15-glossary.md) | 用語と略語 |
| リリース | [16-release-readiness-checklist.md](16-release-readiness-checklist.md) | デプロイ直前のテスト、監視、セキュリティ、運用確認 |
| リリース履歴 | [release-notes.md](release-notes.md) | リリース後確認、安定化履歴、残課題 |

## Runbook

| ファイル | 用途 |
| --- | --- |
| [runbooks/database-deployment.md](runbooks/database-deployment.md) | SQLite preview運用、バックアップ、PostgreSQL/PostGIS移行前チェック |
| [runbooks/cloudflare-production.md](runbooks/cloudflare-production.md) | `civilopendata.mirai-dx-platform.com` 本番化、DNS/Access/Secrets/Hyperdrive/証跡ゲート |
| [runbooks/cloudflare-neon-staging.md](runbooks/cloudflare-neon-staging.md) | Cloudflare/Neon stagingのmigration、smoke、rollback、証跡 |
| [runbooks/monitoring.md](runbooks/monitoring.md) | 監視・アラート・リリース後確認の初動手順 |
| [runbooks/rollback.md](runbooks/rollback.md) | 障害時の切り戻し手順 (判断フロー、Workers、GHCR、Neon PITR、Prisma、SQLite、復旧後検証) |

## テンプレート

| ファイル | 用途 |
| --- | --- |
| [templates/data-source-register-template.md](templates/data-source-register-template.md) | 新しい公開データソースを調査・登録するためのテンプレート |

## ADR

| ファイル | 判断内容 |
| --- | --- |
| [adr/0001-repository-and-product-scope.md](adr/0001-repository-and-product-scope.md) | Global Civil API CatalogをCODIPの台帳モジュールとして吸収する判断 |
| [adr/0002-audit-log-guarantee.md](adr/0002-audit-log-guarantee.md) | 監査ログ記録保証を同一transaction / 同期API / 将来outbox条件に分ける判断 |
