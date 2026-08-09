# 🏗️ 統合評価・改善報告書（Integrated Assessment & Improvement Report）

> 🗓️ 2026-08-10 ｜ 対象: Civil Open Data Intelligence Platform（CODIP）  
> 🌐 本番: https://odip.mirai-dx-platform.com（Worker Version `d1528b5d-b5e6-47e9-aa4b-1070868161f6` / main `3ec5e8f`）  
> 📚 関連文書: [改善前評価](pre-improvement-assessment.md) / [競合分析](competitive-analysis.md) / [代替率](replacement-rate.md) / [改善計画](improvement-plan.md) / [改善後再評価](post-improvement-assessment.md)

---

## 1. 総括

CODIPは**本番稼働中の公開データ統合・地形分析・気象海象判断支援基盤**であり、総合判定は **「条件付き利用可」**。18軸平均は **67.1 → 69.6点（+2.5）**、加重代替率は **47.25% → 48.1%** へ改善した。

本評価サイクルでは、評価だけで終わらず以下の重大問題を**実装・修正・本番反映**した。

- 🚨 **/reports機能（画面＋API）がgitignoreの `reports/` パターンにより未コミット**で、CI・本番で404になっていた問題を発見・修正（本番へ反映済み）
- 🐛 **地形画面のレイヤー切替クラッシュ**（`event.currentTarget` をstate更新関数内で読む非安全パターン）を修正
- 🧪 **統合後新画面のE2E回帰テスト16件**を追加しCI pass
- 🔔 **監視アラート通知の設定手順書**を作成（実行は通知先承認待ちのP0）
- 📄 **README・運用台帳・リリースチェックリストの最新化**（バックアップ失敗1回の記録を含む）

---

## 2. 改善前後比較

| 指標 | 改善前 | 改善後 | 変化 |
| --- | --- | --- | --- |
| 18軸平均 | 67.1 / 100 | 69.6 / 100 | +2.5 |
| 総合判定 | 条件付き利用可 | 条件付き利用可（改善） | — |
| 加重代替率 | 47.25% | 48.1% | +0.85pt |
| 機能完成度 | 72 | 72 | —（機能追加はPhase 1〜2） |
| テスト | 70 | 80 | +10（新画面E2E 16件） |
| 文書 | 75 | 84 | +9（評価書・Runbook・台帳） |
| コード品質 | 78 | 82 | +4（クラッシュ修正・未コミット発見） |
| 本番稼働 | Worker `57b17ee1`（/reports欠落） | Worker `d1528b5d`（/reports・クラッシュ修正反映） | ✅ |

### 本番導入可否

**🟡 限定的本番利用（パイロット）は可。全社600名展開は条件付き。**

- ✅ 可能: データ調査・地形分析・気象海象判定支援をパイロット部門で利用
- 🔴 不可のまま: 全社展開・協力会社展開（通知・RBAC・モバイル未実装、アラート通知未設定）

---

## 3. 最大の強み5件

1. 🏗️ **土木建設向け公開データ基盤が本番稼働**（56台帳・定期収集・品質監視・リネージュ・後続API）
2. ⛰️🌦️ **地形分析＋気象海象判定が同一UIで一体**（DEM/Horn/TPI/断面、AMeDAS/波浪/50年確率波/go・caution・stop）
3. 🛡️ **「人による最終判断」前提の安全設計**（自動断定しない・監査スナップショット・fail-closed）
4. 🚦 **多層CI/CDとテスト資産**（486単体＋E2E 30件＋PostGIS/Docker/CodeQL/Trivy/SBOM）
5. 💰 **低コスト・少人数運用**（Cloudflare＋Neon＋GitHub Actions、Runbook・運用台帳整備）

---

## 4. 重大な弱み5件

1. 🔴 **監視アラート通知先未設定**（検知しても人が気づかない。手順書化済み・実行待ち）
2. 🔴 **RBAC未実装**（600名展開時の権限分離・監査が不足）
3. 🔴 **モバイル/PWA・オフライン未対応**（現場主力デバイスで利用不可）
4. 🔴 **実データ収集20ジョブ規模**（目標50種に未達。データ価値が限定的）
5. 🔴 **RTO未実測・production-target-env実行不可**（復旧の実証と実ターゲットCI検証が未確立）

---

## 5. 実装済み改善（本サイクル）

| # | 改善 | 検証 |
| --- | --- | --- |
| 1 | /reports未コミット修正（.gitignore `reports/`→`/reports/`、画面＋APIをコミット） | CI build/E2E pass、本番デプロイ済み |
| 2 | 地形画面クラッシュ修正（event値の事前取得） | E2E pass（run 31324701074） |
| 3 | 統合後新画面E2E 16件（/terrain /weather /decisions /sites /reports） | CI e2e pass |
| 4 | 監視アラートRunbook（GitHub/Cloudflare/Neon手順・試験・エスカレーション） | 文書レビュー |
| 5 | 改善前評価・競合分析・代替率・改善計画 | 文書レビュー |
| 6 | README・docs/13・リリースチェックリスト・運用台帳の最新化 | リンク・記載整合 |
| 7 | 本番デプロイ（main `3ec5e8f` → Version `d1528b5d`）＋Production Smoke success | run 31325075110（health 200 / ready 200 db=ok） |

---

## 6. 最優先改善10件（次サイクル）

| 優先 | 改善 | 時期 | 備考 |
| --- | --- | --- | --- |
| P0-1 | 🔔 監視アラート通知先設定＋通知テスト | 今すぐ | 人間承認が必要（通知先・Webhook） |
| P0-2 | 🔐 GitHub Actions production環境へのSecrets登録 | 今すぐ | human kensan操作 |
| P0-3 | 📏 RTO実測ドリル（Worker切戻し＋Neon復元） | 今すぐ | 実測値を台帳へ |
| P1-1 | 📱 PWA/モバイル対応 | 3か月 | 現場利用の前提 |
| P1-2 | 🔔 通知・ウォッチリスト | 3か月 | 更新遅延・スキーマ変更・閾値超過 |
| P1-3 | 🔐 RBAC基本実装 | 3か月 | ロール別アクセス制御 |
| P1-4 | 🧾 PDF/Excelレポート出力 | 3か月 | 帳票実務接続 |
| P1-5 | 📊 実データ収集50種 | 3か月 | 利用規約確認と並行 |
| P1-6 | ⚡ ロードテスト（P95実測） | 3か月 | 600名規模の性能根拠 |
| P1-7 | ♿ アクセシビリティ自動スキャン（axe） | 3か月 | 公共工事要件への適合証跡 |

---

## 7. 追加推奨機能10件

1. 📱 PWAインストール＋現場オフラインモード
2. 🔔 プッシュ通知（警報・閾値超過・判定変更）
3. 📄 判定根拠レポートPDF（署名欄・出典明記）
4. 🗂️ 写真・資料管理（現場記録）
5. 💬 現場掲示板・コメント（最小コミュニケーション）
6. 🧭 DCAT-AP-JP/OGC API Features等の標準規格連携
7. 🤖 根拠引用付き自然文検索（RAG）
8. 🔍 データ品質異常のAI検知（更新停止・急変）
9. 🔄 既存SaaS（ANDPAD/現場クラウドOne/SharePoint）連携
10. 🏥 四半期DR訓練の定期化

---

## 8. commit・PR・CI・デプロイ状況

| 項目 | 状況 |
| --- | --- |
| PR #114 | ✅ マージ済み（3コミット: 評価書+E2E+Runbook / 地形クラッシュ修正 / /reports未コミット修正） |
| CI（PR #114） | ✅ verify・e2e・postgresql-compat・docker-preview・docker-image-security・node-preview・CodeQL全pass（run 31324701074） |
| 単体テスト | ✅ 486件 / 56ファイル pass |
| E2E | ✅ 全spec pass（統合後新画面16件含む） |
| 本番デプロイ | ✅ Version `d1528b5d-b5e6-47e9-aa4b-1070868161f6`（main `3ec5e8f`） |
| デプロイ後スモーク | ✅ run 31325075110（/api/health 200・788ms / /api/ready 200 db=ok・1421ms） |
| production-target-env | ⚠️ 未実行（production環境のSecrets未設定） |
| docker-supply-chain | ⏳ mainマージ後に実行（次回CIで確認） |

---

## 9. 残課題

| 区分 | 内容 | 担当 |
| --- | --- | --- |
| 運用 | アラート通知先・通知テスト未設定 | human kensan＋DevOps |
| 運用 | RTO未実測・DR訓練は2026-11予定 | DevOps |
| CI | production-target-envのSecrets未設定 | human kensan |
| 機能 | RBAC・PWA・通知・PDF/Excel未実装 | Phase 1〜2 |
| データ | 実データ50種・台帳500件未達 | データ運用 |
| 性能 | ロードテスト未実施（P95実測なし） | DevOps |
| 環境 | 共有preview（192.168.0.185:3100）がタイムアウト中 | 要復旧または廃止判断 |
| 品質 | axeアクセシビリティ自動スキャン未導入 | QA |
| セキュリティ | 侵入テスト証跡なし・Secret有効期限未確認 | Security |

---

## 10. 投資判断

### ✅ 条件付き継続（Continue with conditions）

理由:
- 本番稼働・監視・バックアップ・CI/CD・主要機能が実証済みで、競合にない独自領域（公開データ×地形×気象海象）を持つ
- 少人数（IT/DX 7名）で継続運用できる構成と文書が整っている
- 一方、全社600名展開には通知・RBAC・モバイル・実データ拡充が必須であり、これらをPhase 0〜1で実施することを条件とする

投資中止・方向転換の判断材料は現時点でない。

---

## 11. Phase 0〜4ロードマップ

| Phase | 期間 | 内容 | 完了条件 |
| --- | --- | --- | --- |
| Phase 0: 重大問題・セキュリティ | 0〜2週間 | アラート通知設定＋通知テスト、production-target-env Secrets、RTO実測、Secret棚卸し | 通知受信確認・実測値記録・Secrets設定 |
| Phase 1: 中核業務完成 | 3か月 | PWA/モバイル、通知・ウォッチリスト、RBAC、PDF/Excel、実データ50種、ロードテスト、axe | パイロット部門での実業務利用・CI維持 |
| Phase 2: 競合製品80%代替 | 6〜12か月 | 現場コミュニケーション、写真・資料管理、標準規格連携、既存SaaS連携、APIキー管理 | 代替率65〜70%・パイロット評価 |
| Phase 3: AI・モバイル・外部連携 | 12〜18か月 | RAG検索、AI異常検知、コネクタ自動生成、DR定期化 | 引用付きAI支援・精度評価・予算制御 |
| Phase 4: 90%代替・本番最適化 | 18〜24か月 | 3D Tiles・時系列、マルチテナント、データ利用申請、経営ダッシュボード | 代替率80〜90%・全社展開 |

---

## 12. 次に着手すべき具体的作業

1. 🔔 **アラート通知先の決定と設定**（メール＋Teams Webhook、通知テスト）— `docs/runbooks/alerts-and-notifications.md` に従う
2. 🔐 **GitHub Actions production環境へSecrets/Variables登録**（`CODIP_DATABASE_URL` 等）→ `workflow_dispatch` で `production-target-env` を実行
3. 📏 **RTO実測ドリル**（Neon branch復元＋Worker rollback手順のタイム計測）
4. 📱 **PWA/モバイル対応の設計着手**（manifest・Service Worker・現場UI）
5. 📊 **実データ50種のコネクタ追加**（利用規約確認→収集→品質監視）
