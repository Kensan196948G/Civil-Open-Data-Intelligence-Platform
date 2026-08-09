# 📊 改善前総合評価（Baseline Assessment）

> 🗓️ 作成: 2026-08-10 ｜ 📍 対象: Civil Open Data Intelligence Platform（CODIP）  
> 🌐 本番: https://odip.mirai-dx-platform.com（Cloudflare Access保護）｜ 🗄️ DB正本: Neon PostgreSQL/PostGIS  
> 📦 main commit: `2c6e73f`（PR #113 マージ済み）｜ 🧪 単体テスト: 56ファイル 486件 pass

---

## 1. 評価対象と前提

| 項目 | 内容 |
| --- | --- |
| プロジェクト名 | Civil Open Data Intelligence Platform（CODIP） |
| GitHubリポジトリ | `Kensan196948G/Civil-Open-Data-Intelligence-Platform` |
| 稼働中URL | `https://odip.mirai-dx-platform.com`（Cloudflare Access + Service Auth） |
| 統合元 | Civil-Terrain-Slope-Risk-Viewer（削除済み）／ wmcdss（削除済み） |
| 利用前提 | 従業員約600名・IT/DX部門7名・公共工事80%・民間20% |
| 利用者 | 現場・本社・経営層・協力会社 |
| 評価方法 | リポジトリのコード・文書・テスト・CI実績・本番監視実績・Web公式情報の精査に基づく。確認できない項目は「未確認・証拠不足」と明記 |

---

## 2. プロジェクト概要

CODIPは、国・自治体・公的機関が公開する土木建設向けデータ（行政、気象、海象、河川、防災、地形、標高、傾斜、地質、道路、価格・物価、法令、BIM/CIM、都市計画、許認可、統計、研究、論文、特許等）を、台帳化・定期収集・クレンジング・品質監視・空間分析・AI推薦・後続APIへ統合する共通データ基盤である。

2026-08-09に統合元2リポジトリ（地形・傾斜リスク可視化、気象海象判断支援WMCDSS）を完全吸収し、現在は「データ基盤＋地形分析＋気象海象判断支援＋現場管理＋レポート」が一体で本番稼働している。

### 2.1 利用者と業務課題

| 利用者 | 業務課題 | CODIPの提供価値 |
| --- | --- | --- |
| 現場技術者 | 気象・海象・地形・防災情報の確認に複数サイトを巡回 | 現場周辺データの横断検索・地形分析・施工可否の確認支援 |
| 本社設計・積算 | 公開データの所在・更新・利用条件の調査コスト | データソース台帳56件＋品質スコア＋出典・ライセンス管理 |
| 経営層 | 判断の属人化・データ重複投資 | 共通データハブによる再利用率向上・監査証跡 |
| 協力会社 | 現場情報の共有・気象条件の共通認識 | 共有URL・判定レポート・CSV/Markdown出力 |
| IT/DX部門（7名） | 少人数での継続運用 | 自動定期収集・自動監視・Runbook・CI/CDによる省力運用 |

### 2.2 完成段階・運用段階

| 区分 | 状態 | 根拠 |
| --- | --- | --- |
| 完成段階 | MVP→本番初期運用（Release Ready相当） | `docs/16-release-readiness-checklist.md` 再判定GO、PR #109/#111/#112/#113 マージ済み |
| 運用段階 | 本番稼働中・運用仕上げ段階 | Worker `codip-production` Version `57b17ee1-1703-437d-bddb-63d068adf9c5`、Production Smoke 15分毎成功（run 31322616071 等）、Neon日次バックアップ成功 |
| データ段階 | 実データ収集開始（20ジョブ→継続拡張中） | 7件dead_letter（無効化）・2件retrying・13ジョブ継続の実績あり（運用台帳） |

---

## 3. 18軸採点（各100点・改善前ベースライン）

| # | 評価軸 | 点数 | 総合判定 | 主な根拠 |
| --- | --- | --- | --- | --- |
| 1 | 業務適合性 | 70 | 条件付き適合 | 地形・気象海象・判定・現場・レポートが一体稼働。一方、600名規模の多職種RBAC、通知、モバイル、M365/SharePoint連携が未実装 |
| 2 | 機能完成度 | 72 | 良好 | 統合機能（検索、MapLibre/GSI DEM、Horn/TPI、AMeDAS、閾値判定、50年確率波、CSV/JSON/Markdown出力）実装済み。PDF/Excel出力、PWA/オフライン、通知は未実装 |
| 3 | UI/UX | 68 | 良好 | ダッシュボード・サイドバー・新画面（/terrain /weather /decisions /sites /reports）が統一UI。ユーザーテスト・デザインシステムの証跡なし、モバイル最適化は一部のみ |
| 4 | アクセシビリティ | 62 | 要強化 | スキップリンク・ラベル・role=status・管理操作disabledはE2E検証済み。axe等の自動スキャン、新画面のアクセシビリティE2E、コントラスト検証は未実施 |
| 5 | データ品質 | 68 | 良好 | クレンジング・dedupe・欠損チェック・デッドレター・スキーマドリフト検出・品質スコア実装済み。実データ50〜100種への展開・品質SLAは未達 |
| 6 | AI有効性 | 40 | 低い | `/api/v1/recommendations` はルールベース推薦＋根拠URL付きで安全。LLM/RAG・説明可能AI・利用量制御・誤判定責任分界の実装は未導入（AIガバナンス文書はあり） |
| 7 | 設計 | 78 | 良好 | Next.js+Prisma+PostGIS+Cloudflareの明確なレイヤ分割、ADR・OpenAPI・リネージュ・スキーマ契約。モノリス内にUI/API/ETL同居、イベント基盤なし |
| 8 | コード品質 | 78 | 良好 | lint/typecheck 0件、単体テスト486件、TODO/FIXME 0件、依存allowlist管理。大型コンポーネント（WeatherWorkspace等）のコンポーネントテスト不足 |
| 9 | 性能・拡張性 | 55 | 要強化 | レート制限・ETag/キャッシュ・Hyperdrive実装。ロードテスト・P95実測・大規模データ時の性能検証は未実施 |
| 10 | セキュリティ | 80 | 良好 | Cloudflare Access、管理トークン/HttpOnly Cookie、CSRF、SSRF、レート制限、gitleaks、CodeQL、Trivy、SHA固定。実ターゲットproduction env検証（GitHub Actions）はSecrets未設定のため未実行、脆弱性診断（ペネトレーションテスト）証跡なし |
| 11 | 可用性・バックアップ | 72 | 良好 | Production Smoke 15分毎成功、Neon PITR 24h＋日次AES256 pg_dump＋restore drill実施。RTO未実測、単一リージョン構成 |
| 12 | 監視・障害対応 | 55 | 要強化 | Smoke・Workers Logs・運用台帳・incident runbookあり。アラート通知先・通知テスト・オンコール未設定、検知〜初動SLOの実運用未確立 |
| 13 | テスト | 70 | 良好 | 単体486件・E2E 11 spec・PostGIS互換・Docker preview・release smoke。統合後新画面（/terrain /weather /decisions /sites /reports）のE2E、ロードテスト、ファジング未実施 |
| 14 | CI/CD・リリース | 80 | 良好 | CI 7ジョブ＋CodeQL＋定期収集＋Smoke、actionlint、release gate、SBOM/provenance。production-target-envは手動ジョブのSecrets未設定、デプロイはOpenNextラッパー依存の手動操作 |
| 15 | 運用保守性 | 62 | 要強化 | Runbook一式・運用台帳・復元ドリルあり。通知未設定・Secret有効期限不明・定期棚卸しは台帳管理のみで自動化されず |
| 16 | 文書 | 75 | 良好 | docs/01〜16・ADR・Runbook・移行報告書・削除チェックリスト整備。README・docs/13に旧記述（2026-08-01障害中、staging未完）が残存 |
| 17 | 費用対効果 | 70 | 良好 | Cloudflare無料枠＋Neon主体で低コスト。正式なTCO・効果測定・予算上限管理は未整備 |
| 18 | 競合代替性 | 55 | 部分代替 | 公開データ基盤×地形×気象海象の組み合わせは独自。ANDPAD/現場クラウドOne等の施工管理ワークフロー、モバイル、書類決裁、CKAN/ArcGIS Hubのカタログ生態系は代替不可 |

**📊 18軸平均: 67.1 / 100**

---

## 4. 総合判定

### 🟡 条件付き利用可（Conditional Production Use）

**本番稼働・監視・バックアップ・主要機能は確立済みであり、データ調査・地形分析・気象海象判定支援の限定的利用（パイロット運用）は可能。**

ただし、以下を解除条件として本格展開（全社600名・協力会社利用）へ進めてはならない。

1. 🚨 監視アラート通知先・通知テストの設定（検知しても人が気づかない状態）
2. 🚨 統合後新画面のE2E回帰テスト（本番機能の変更安全網がない状態）
3. ⚠️ RTO実測・復旧手順の実証（DR訓練が2026-11予定のため）
4. ⚠️ RBAC・モバイル/PWA・通知・PDF/Excel等の本格展開機能（現場運用の前提）
5. ⚠️ 実データ収集50種以上・データ品質SLA（現状56台帳のうち実収集20ジョブ）

---

## 5. 強み（15件以上）

| # | 強み | 根拠 |
| --- | --- | --- |
| 1 | 🏗️ 公開データ統合基盤が実装・本番稼働 | 台帳56件・定期収集30分/10分・クレンジング・リネージュ・品質監視（README・docs/06/08） |
| 2 | ⛰️ 地形分析の実データ対応 | 国土地理院DEM・Horn法・TPI・断面・陰影起伏・傾斜量図・確認カード（/terrain、terrain系unit 50件超） |
| 3 | 🌦️ 気象海象判断支援が一体 | AMeDAS・Open-Meteo Marine・週間予報・風配図・50年確率波・go/caution/stop判定（/weather /decisions） |
| 4 | 🔒 安全設計が徹底 | 施工可否・法令適合を自動断定せず「人による最終判断」をUI・AIガバナンス文書に明記（docs/10） |
| 5 | 🗺️ 空間基盤が本番構成 | PostGIS/PostGIS DDL・空間評価API（point/geometry）・Hyperdrive接続・migration drift検査（CI） |
| 6 | 🧪 テスト資産が充実 | 単体486件（56ファイル）、E2E 11 spec、PostGIS互換、Docker preview、release smoke 80checks（docs/12/16） |
| 7 | 🚦 CI/CDが多層 | verify/e2e/postgresql-compat/docker-preview/docker-image-security/docker-supply-chain/node-preview＋CodeQL＋gitleaks＋Trivy＋SBOM/provenance |
| 8 | 📡 本番監視が自動化 | Production Smoke 15分毎 strict read-only probe、Access service token設定、直近run継続成功 |
| 9 | 💾 バックアップ・復旧が確立 | Neon PITR 24h＋日次AES256 pg_dump（保持14日）＋restore drill 2026-08-04実施 |
| 10 | 📖 文書・運用が整備 | docs/01〜16・ADR・Runbook（production/database/monitoring/rollback/incident）・運用台帳・移行報告書 |
| 11 | 🔐 セキュリティ対策が多層 | Cloudflare Access、admin token＋HttpOnly Cookie、CSRF、SSRF、rate limit、proxy secret＋メールallowlist |
| 12 | 📦 サプライチェーン対策 | Actions SHA固定、base image digest固定、Trivy High/Critical 0、npm audit allowlist管理 |
| 13 | 🧬 データ系譜・品質監視が実装 | `/api/v1/sources/{id}/lineage`、デッドレター、スキーマドリフト、件数急変検出（quality-monitor） |
| 14 | 🌐 一次情報優先の設計 | 国土地理院・気象庁・e-Stat等の公式API/タイル中心、出典・利用規約管理（docs/08） |
| 15 | 💰 低コスト構成 | Cloudflare無料枠＋Neon中心。GitHub Actions主体の自動運用でIT/DX 7名でも継続可能 |
| 16 | 🔄 統合が完了し重複排除済み | 統合元2リポジトリ削除済み（404確認）、移行台帳・削除チェックリスト・Git履歴保全（docs/migration） |
| 17 | ✅ 既知制約の正直な記録 | 運用台帳・リリースチェックリストに未実施・未設定を明記し「実施済み」と偽らない運用文化 |

---

## 6. 弱み・リスク（15件以上・影響度付き）

| # | 弱み | 影響度 | 詳細・リスク |
| --- | --- | --- | --- |
| 1 | 🔴 監視アラート通知先が未設定 | 重大 | 15分毎smokeは成功/失敗を記録するが、失敗時に誰へ通知される仕組みがない。障害放置リスク |
| 2 | 🔴 統合後新画面のE2Eが未カバー | 重大 | /terrain /weather /decisions /sites /reports の回帰テストがない。UI変更・API破壊をCIが検出できない |
| 3 | 🔴 RTOが未実測 | 重大 | Worker切戻し60分/DB復元4時間の目標があるが実測・訓練は2026-11予定。復旧手順の実証不足 |
| 4 | 🔴 production-target-envがSecrets未設定で実行不可 | 重大 | 実ターゲットのenv検証・read-only smokeがGitHub Actionsで実行できない。本番検証は手動/wrangler依存 |
| 5 | 🟠 RBACが未実装 | 高 | 閲覧者/データスチュワード/品質承認者等の多職種権限がない。600名展開時の情報管理・監査が不十分 |
| 6 | 🟠 通知・ウォッチリストが未実装 | 高 | データ更新遅延・API停止・スキーマ変更・閾値超過を利用者が受動的にしか確認できない |
| 7 | 🟠 モバイル/PWA・オフライン未対応 | 高 | 現場（通信不安定・タブレット）での利用ができない。現場利用者の主力デバイスに非対応 |
| 8 | 🟠 PDF/Excel出力が未実装 | 高 | 帳票提出・共有に必須な形式がない（CSV/Markdownのみ）。施工管理業務との実務接続が弱い |
| 9 | 🟠 AIがルールベースのみ | 高 | RAG・自然文検索・異常検知・予測がない。時間削減効果が限定的。LLM導入時はプロンプトインジェクション・予算制御・監査の設計が未着手 |
| 10 | 🟠 実データ収集が20ジョブ規模 | 高 | 目標50〜100種・台帳500件に未達。実データでの品質監視・地点横断評価の価値が限定的 |
| 11 | 🟠 ロードテスト・性能実測なし | 高 | P95 5秒目標が未計測。600名規模同時利用時の性能・DB負荷が不明 |
| 12 | 🟡 README・docs/13に旧記述が残存 | 中 | 「2026-08-01時点は障害中」「staging未完」等の過去状態が残り、外部説明時の誤解リスク |
| 13 | 🟡 アクセシビリティ検証が部分 | 中 | 新画面のラベル・キーボード操作・コントラスト・axeスキャン未実施。公共工事のアクセシビリティ要件への適合証跡不足 |
| 14 | 🟡 Secret有効期限・ローテーションが不明 | 中 | Cloudflare/GitHub/Neonトークンの有効期限が「要確認」のまま。棚卸しは台帳管理のみ |
| 15 | 🟡 コスト管理が未整備 | 中 | Cloudflare使用量・Neon容量の月次確認は台帳予定のみ。予算上限・異常コスト検知なし |
| 16 | 🟡 大規模コンポーネントのテスト不足 | 中 | WeatherWorkspace/TerrainWorkspace等のUIロジックをE2Eでしか検証できず、単体コンポーネントテストなし |
| 17 | 🟢 モノリス構成 | 低 | UI/API/ETLが同一Next.jsアプリ。将来的な負荷分離・Worker Cron化は設計済みだが未実施 |
| 18 | 🟢 単一リージョン・単一クラウド | 低 | Cloudflare Workers＋Neon（東京リージョン想定）の単一構成。大規模災害時のDRは未検証 |

---

## 7. 総合リスク評価

| 区分 | 状況 | 判定 |
| --- | --- | --- |
| データ消失 | 日次暗号化dump＋PITR＋復元ドリル済み | 🟢 低 |
| 誤判定 | 判定はルールベース＋「人による最終判断」明示＋監査スナップショット保存 | 🟢 低 |
| 権限逸脱 | Access＋管理トークン＋CSRF＋proxy secret。RBAC細分化は未実装 | 🟡 中 |
| 運用停止 | Smoke自動監視は稼働。通知先未設定で検知→対応の遅延リスク | 🔴 高 |
| セキュリティ侵害 | 多層対策＋SAST。実環境の侵入テスト・依存先の完全監査は未実施 | 🟡 中 |
| 外部依存 | 気象庁・GSI・Open-Meteo等の外部API停止時にfail-closed設計 | 🟡 中 |

---

## 8. 評価の根拠リンク

| 根拠 | 場所 |
| --- | --- |
| 本番稼働状況 | [README](../README.md)「本番稼働状況」、[release-readiness](../16-release-readiness-checklist.md) |
| 統合機能一覧 | [README](../README.md)「統合機能」、[integration-report](../migration/integration-report.md) |
| テスト実績 | [test-plan](../12-test-plan.md)、[release-readiness](../16-release-readiness-checklist.md) |
| 運用・監視・バックアップ | [operations-ledger](../operations/operations-ledger.md)、[monitoring](../runbooks/monitoring.md) |
| セキュリティ設計 | [security-and-compliance](../09-security-and-compliance.md) |
| AIガバナンス | [ai-governance](../10-ai-governance.md) |
| ロードマップ | [roadmap](../14-roadmap.md) |
