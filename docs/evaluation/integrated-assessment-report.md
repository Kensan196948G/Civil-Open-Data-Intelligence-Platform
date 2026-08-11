# 統合評価・改善報告書（Integrated Assessment & Improvement Report）

> 2026-08-12 最終更新（第3サイクル） ｜ 対象: Civil Open Data Intelligence Platform（CODIP）
> 本番: https://odip.mirai-dx-platform.com（Worker `codip-production` 継続稼働 / main `7f72626` = PR #137 merged）
> 関連文書: [改善前評価](pre-improvement-assessment.md) / [競合分析](competitive-analysis.md) / [代替率](replacement-rate.md) / [改善計画](improvement-plan.md) / [改善後再評価](post-improvement-assessment.md)

---

## 1. 総括

CODIPは**本番稼働中の公開データ統合・地形分析・気象海象判断支援基盤**であり、総合判定は **「条件付き利用可」**。18軸平均は **67.1 → 69.6 → 72.7 → 73.3点（累計 +6.2）**、加重代替率は **47.25% → 48.1% → 51.35% → 52.25%** へ改善した。

第3サイクル（2026-08-12）では、QA監査が検出した**「証跡ゲートの自己認証」系列の重大欠陥7件（#126〜#129・#132〜#134）とsmoke失敗通知（#90）**を実装・検証し、**PR #137としてマージ完了（main `7f72626`）**とした。CodeRabbitレビュー16件にも対応し、全スレッド解決後にマージした。

- Neon PITR保持期間をNeon APIから実測し、自己申告値での通過を不可能化（#126）
- 復旧訓練・pg_dumpの「success既定値」を削除し、未指定はfail-closed化（#127）
- 本番証跡8変数に形式要件をピン留めし、`ok`2文字での通過を不可能化（#128）
- 本番CSP検査を部分文字列一致からディレクティブ単位突合せへ（#129）
- CodeQLを失敗可能なゲートへ復元（#132）、Actions SHA検査を6/6ファイルへ（#133）
- 監査契約に実挙動テストを追加（#134）
- production smoke失敗時のincident Issue自動起票・連続失敗P1昇格（#90）
- CodeQLはGHAS非対応プラン（private・personal account）のためSARIFアップロード不可を実測し、`upload: never`＋SARIF artifact方式でゲート成立（ADR 0003）
- **Neon PITR復旧訓練を実施**（data_sources=62・PG 17.10・PostGIS 3.5・約14分）し、証跡Variablesを形式検証済み値で登録

---

## 2. 改善前後比較

| 指標 | 初期(8/10) | 1st(8/10) | 2nd(8/11) | 3rd(8/12) | 累計変化 |
| --- | --- | --- | --- | --- | --- |
| **18軸平均** | 67.1 / 100 | 69.6 / 100 | 72.7 / 100 | **73.3 / 100** | **+6.2** |
| 総合判定 | 条件付き利用可 | 条件付き利用可（改善） | 条件付き利用可（大幅改善） | **条件付き利用可（証跡ゲート是正済み）** | -- |
| **加重代替率** | 47.25% | 48.1% | 51.35% | **52.25%** | **+5.0pt** |
| セキュリティ | 80 | 80 | 83 | 86 | +6 |
| 監視・障害対応 | 55 | 60 | 67 | 72 | +17 |
| テスト | 70 | 80 | 83 | 86 | +16 |
| 文書 | 75 | 84 | 86 | 88 | +13 |
| 運用保守性 | 62 | 65 | 70 | 73 | +11 |

### 本番導入可否

**条件付き利用可（パイロット運用は可。全社600名展開は条件付き）**

- **可能**: データ調査・地形分析・気象海象判定支援・現場PWA利用・後続API連携
- **条件**: 全社展開には通知先/当番設定（P0）・RBAC・PDF/Excel出力・実データ50種・ロードテストが必要
- **第3サイクルの位置付け**: 監視・バックアップ・復旧の**証跡が検証可能になった**。実運用の受信テストと復旧訓練の実施は人間承認待ち

---

## 3. 最大の強み5件

1. **土木建設向け公開データ基盤が本番稼働**（62台帳・定期収集・品質監視・リネージュ・後続API・PostGIS空間評価）
2. **地形分析＋気象海象判定が同一UIで一体**（DEM/Horn/TPI/断面、AMeDAS/波浪/50年確率波/go・caution・stop）
3. **「人による最終判断」前提の安全設計**（自動断定しない・監査スナップショット・fail-closed・proxy認証多層防御）
4. **多層CI/CDとテスト資産**（単体715件＋E2E 30件＋PostGIS/Docker/CodeQL/Trivy/SBOM、証跡ゲートは変異検査付き）
5. **低コスト・少人数運用＋実証済み復旧力**（Cloudflare＋Neon＋GitHub Actions、RTO切戻し4秒/復旧25秒、日次暗号化backup）

---

## 4. 重大な弱み5件

1. **監視アラート通知先・受信テスト未実施**（incident Issue自動起票は実装済み。メール/Teams/当番の設定と受信確認は人間作業）
2. **RBAC未実装**（600名展開時の権限分離・監査が不足。Access proxy認証は稼働）
3. **PDF/Excel出力未実装**（帳票提出・共有に必須の形式がない。CSV/Markdown出力のみ）
4. **実データ収集20ジョブ規模**（目標50種に未達。コネクタ追加で拡張中）
5. **ロードテスト未実施**（600名規模同時利用時のP95が不明。性能目標の根拠不足）

---

## 5. 実装済み改善（全サイクル・24件）

| # | 改善 | 検証 |
| --- | --- | --- |
| 1 | /reports未コミット修正（`.gitignore` `reports/`→`/reports/`） | CI build/E2E pass、本番デプロイ済み |
| 2 | 地形画面クラッシュ修正（event値の事前取得） | E2E pass（run 31324701074） |
| 3 | 統合後新画面E2E 16件 | CI e2e pass |
| 4 | 監視アラートRunbook（手順・試験・エスカレーション） | 文書レビュー |
| 5 | 改善前評価・競合分析・代替率・改善計画 | 文書レビュー（`docs/evaluation/`） |
| 6 | README・運用台帳・リリースチェックリスト最新化 | リンク・記載整合 |
| 7 | PWA実装（manifest + Service Worker + 登録 + E2E） | `tests/e2e/pwa.spec.ts` pass、PR #120 |
| 8 | Access proxy認証注入（ミドルウェア + unit test 4件） | `tests/unit/proxy-auth-inject.test.ts` pass |
| 9 | JMA XML収集エンジン（Atom 441件 + 6種抽出） | `tests/unit/ingestion-xml.test.ts` pass |
| 10 | 公式JSONコネクタ5種追加 | `tests/unit/seed-data.test.ts` pass |
| 11 | production-target-env修正 | workflow_dispatch run 31333706566 success |
| 12 | RTO実測（rollback 4秒 / 復旧デプロイ 25秒） | 両smoke success |
| 13 | Alert policy作成＋テスト送信 | Cloudflare通知テスト受信確認 |
| 14 | 本番デプロイ＋Production Smoke | run 31325075110（health 200 / ready 200 db=ok） |
| 15 | **#126** Neon PITR実測ゲート | モックAPIテスト3件＋check実測値のみ判定 |
| 16 | **#127** restore drill / pg_dump status fail-closed化 | 既定値なし→非ゼロ終了テスト |
| 17 | **#128** 本番証跡8変数の形式検証 | 形式不正FAILテスト |
| 18 | **#129** CSPディレクティブ単位契約 | 変異検査（削除・全除去・connect-src削除でFAIL） |
| 19 | **#132** CodeQLゲート復元 | 不在側を契約で固定 |
| 20 | **#133** Actions SHA検査 6/6ファイル | 実測6ファイル・35 refs |
| 21 | **#134** 監査実挙動テスト | 失敗系2件＋砂場変異 |
| 22 | **#90** smoke失敗→incident Issue自動起票 | workflow契約テスト9件 |
| 23 | 証跡ゲート監査書（26ゲート棚卸し） | drift契約テスト |
| 24 | restore drill記録様式・通知テスト記録様式 | 契約テスト |

---

## 6. 最優先改善10件（次サイクル）

| 優先 | 改善 | 時期 | 備考 |
| --- | --- | --- | --- |
| P0-1 | 統合セキュリティPR（`claudeos/backend`）のマージ承認 | 今すぐ | #126〜#129・#132〜#134・#90を包含 |
| P0-2 | 通知先/当番設定＋incident Issue watcher＋受信テスト | 今すぐ | 人間操作 |
| P0-3 | 復旧訓練の実施と記録（restore-drill-record.md） | 今すぐ | 本番Neon操作は人間承認 |
| P0-4 | `CODIP_NEON_API_KEY`・production evidence 8変数の登録 | 今すぐ | Secret/Variablesは人間操作 |
| P1-1 | RBAC基本実装（ロール別アクセス制御） | 3か月 | Access proxy認証は稼働済み |
| P1-2 | PDF/Excelレポート出力 | 3か月 | 帳票実務接続 |
| P1-3 | 実データ収集50種展開 | 3か月 | 利用規約確認と並行 |
| P1-4 | ロードテスト（k6、P95実測） | 3か月 | 600名規模の性能根拠 |
| P1-5 | アクセシビリティ自動スキャン（axe-core） | 3か月 | 公共工事要件への適合証跡 |
| P1-6 | PWAオフライン戦略本格実装 | 3か月 | 設計書 `docs/design/pwa-mobile-design.md` 準拠 |

---

## 7. 追加推奨機能10件

1. PWAインストール＋現場オフラインモード（設計済み・Phase 1で本格化）
2. プッシュ通知（警報・閾値超過・判定変更）
3. 判定根拠レポートPDF（署名欄・出典明記）
4. 現場スナップ写真付き観測メモ
5. 類似現場の条件比較画面
6. 根拠引用付き自然文検索（RAG）
7. DCAT-AP-JP/OGC API Features等の標準規格連携
8. データ品質異常のAI検知（更新停止・急変・欠測パターン）
9. 既存SaaS（ANDPAD/現場クラウドOne/SharePoint）連携
10. 四半期DR訓練の定期化

---

## 8. commit・PR・CI・デプロイ状況

| 項目 | 状況（2026-08-12） |
| --- | --- |
| main head | `7f72626`（PR #137 merge） |
| 統合セキュリティ改善 | **マージ済み**（PR #137） |
| オープンPR | #130（dependabot）/ #141（Phase-1準備: RBAC設計・Excel/PDF・データソース5件）/ #138（評価文書）。#131/#135/#136は包含済み |
| 単体テスト | 64ファイル 720件 pass（統合ブランチ実測） |
| E2E | 30 spec pass（CI実績）＋CSP/console error契約追加 |
| lint / typecheck | 0 errors / 0 errors（統合ブランチ） |
| 契約ゲート | github-actions-contract: 6 workflow・35 action refs SHA固定 |
| CodeQL | **PASS**（`upload: never` + SARIF artifact方式・ADR 0003）。GHAS非対応プランのためSecurity tab連携は不可 |
| 本番Worker | `codip-production` 継続稼働（Version `71fdfb11`） |
| 本番スモーク | 15分毎 success（直近run全緑） |
| 日次バックアップ | AES256 pg_dump success（14日保持）＋PITR実測ゲート化（PR待ち） |
| production-target-env | workflow_dispatch success（run 31333706566） |
| 監視Alert policy | `CODIP Worker Error Alert` 作成＋テスト送信済み |

---

## 9. 残課題

| 区分 | 内容 | 担当 |
| --- | --- | --- |
| 承認 | サブセットPR #131/#135/#136のクローズ（#137に包含済み） | human |
| 運用 | アラート通知先・当番設定・受信テスト（incident Issue watcher含む） | human kensan＋DevOps |
| 運用 | 復旧訓練の定期化（次回2026-11-11） | DevOps |
| Secret | `CODIP_NEON_API_KEY`・production環境Secretsの登録（証跡8変数は登録済み） | human kensan |
| 機能 | RBAC・PDF/Excel出力未実装 | Phase 1 |
| データ | 実データ50種・台帳500件未達 | データ運用 |
| 性能 | ロードテスト未実施（P95実測なし） | DevOps |
| 品質 | axeアクセシビリティ自動スキャン未導入 | QA |
| セキュリティ | 侵入テスト証跡なし・Secret有効期限未確認 | Security |
| 環境 | Cloudflare staging Hyperdrive権限不足（code 10000） | human kensan |

---

## 10. 投資判断

### 条件付き継続（Continue with conditions）

**理由**:

- 本番稼働・監視・バックアップ・CI/CD・主要機能が実証済みで、競合にない独自領域（公開データ×地形×気象海象）を持つ
- 少人数（IT/DX 7名）で継続運用できる構成と文書が整っている
- 第3サイクルで「証跡ゲートの自己認証」系列の重大欠陥を是正し、監査・復旧・CSPの検知能力が実証された
- 一方、全社600名展開には通知先設定・RBAC・PDF/Excel出力・実データ拡充・ロードテストが必要
- 投資中止・方向転換の判断材料は現時点でない

---

## 11. Phase 0〜4ロードマップ

| Phase | 状況 | 期間 | 内容 | 完了条件 |
| --- | --- | --- | --- | --- |
| **Phase 0**: 重大問題・セキュリティ | **実装・検証完了** | 2026-08-10〜12 | PWA・proxy-auth・RTO実測・Alert policy・証跡ゲート7件是正・incident Issue | マージ承認・Secrets設定・受信テスト・実訓練の4点 |
| Phase 1: 中核業務完成 | 次 | 3か月 | RBAC・PDF/Excel・PWA本格化・実データ50種・ロードテスト・axe | パイロット部門での実業務利用 |
| Phase 2: 競合製品80%代替 | -- | 6〜12か月 | 現場コミュニケーション・写真管理・標準規格連携・SaaS連携・APIキー管理 | 代替率65〜70% |
| Phase 3: AI・モバイル・外部連携 | -- | 12〜18か月 | RAG検索・AI異常検知・コネクタ自動生成・DR定期化 | 引用付きAI支援・精度評価 |
| Phase 4: 90%代替・本番最適化 | -- | 18〜24か月 | PLATEAU 3D Tiles・マルチテナント・経営ダッシュボード | 代替率80〜90%・全社展開 |

---

## 12. 次に着手すべき具体的作業

1. ~~統合セキュリティPR~~ → **完了（#137 merged）**
2. ~~復旧訓練・証跡Variables~~ → **完了（2026-08-12）**
3. **Phase-1準備PR #141のマージ**（RBAC設計・Excel/PDFプロトタイプ・公式ソース5件）
4. **アラート通知先・当番の決定と設定**（incident Issue watcher、受信テスト）-- `docs/runbooks/alerts-and-notifications.md` 準拠
5. **RBAC実装**（`docs/design/rbac-design.md` の段階計画に従いスキーマ→ミドルウェア→管理UI）
6. **PDF/Excelの本格化**（OOXML .xlsx・サーバー側PDF生成の技術選定）
7. **実データ50種コネクタ追加の継続**（利用規約確認→収集→品質監視）
