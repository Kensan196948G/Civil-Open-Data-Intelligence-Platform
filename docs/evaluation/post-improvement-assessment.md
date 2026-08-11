# 改善後再評価（Post-Improvement Assessment）

> 2026-08-12 更新（第3サイクル・完了）｜ 改善PR: **#137 マージ済み**（#126〜#129・#132〜#134・#90）／ #131/#135/#136 は包含・クローズ推奨
> main: `7f72626`（PR #137） ｜ 単体テスト: 64ファイル 720件 pass ｜ 本番: Worker `codip-production`（継続稼働・smoke green）

> 2026-08-11 更新 ｜ 改善PR: #114（Phase 0基盤） + #116-#121（Phase 0〜1継続改善）
> main: `132c7ba`（PR #121 merge） ｜ 単体テスト: 59ファイル 498件 pass ｜ 本番: Worker `codip-production` Version `71fdfb11`

---

## 1. 実施した改善

### Phase 0（2026-08-10完了・PR #114）

| # | 改善 | 内容 | 証跡 |
| --- | --- | --- | --- |
| 1 | 地形画面のクライアントクラッシュ修正 | `event.currentTarget` をstate更新関数内で読む非安全パターンを修正 | `src/components/terrain/TerrainWorkspace.tsx` |
| 2 | 統合後新画面のE2E 16件 | /terrain /weather /decisions /sites /reports の回帰テスト追加（CI e2e pass） | `tests/e2e/integrated-screens.spec.ts` |
| 3 | 監視アラートRunbook | GitHub/Cloudflare/Neon通知設定手順・月次試験・エスカレーション基準 | `docs/runbooks/alerts-and-notifications.md` |
| 4 | 運用文書更新 | README・docs/13・リリースチェックリスト・運用台帳の最新化 | README / docs/13 / docs/16 |
| 5 | 評価書一式作成 | 18軸採点・競合分析・代替率・改善計画 | `docs/evaluation/` |
| 6 | /reports未コミット修正 | `.gitignore` の `reports/`→`/reports/` へ修正、画面＋APIをコミット | `.gitignore` / `src/app/reports/` / `src/app/api/v1/reports/` |
| 7 | 本番デプロイ＋スモーク | main `3ec5e8f`→Version `d1528b5d`、Production Smoke success | run 31325075110 |

### Phase 0〜1継続（2026-08-10〜11完了・PR #116-#121）

| # | 改善 | 内容 | 証跡 |
| --- | --- | --- | --- |
| 8 | PWA実装 | manifest.webmanifest + Service Worker + クライアント登録＋E2Eテスト | PR #120, `src/app/manifest.ts`, `public/sw.js`, `src/components/PwaRegister.tsx`, `tests/e2e/pwa.spec.ts` |
| 9 | Cloudflare Access proxy認証注入 | ミドルウェアで `cf-access-authenticated-user-email`→JWT検証→`X-ODIP-User` ヘッダー注入、ユニットテスト4件 | PR #120, `src/lib/proxy-auth-inject.ts`, `src/middleware.ts`, `tests/unit/proxy-auth-inject.test.ts` |
| 10 | JMA XML収集エンジン | Atomフィード441件パース・気象防災情報XML 6種抽出（地震・津波・火山・気象・防災）、非空間データの標準レコード化マッピング設計 | PR #120, `scripts/ingestion/ingestion-engine.js`, `tests/unit/ingestion-xml.test.ts` |
| 11 | 公式JSONコネクタ5種追加 | 気象庁地震/津波JSON・GSI住所検索・Open-Meteo大気質/週間予報（参考）を本番62ソースへ追加、5ジョブ success（run 31334100744） | PR #117, `prisma/seed-data.ts`, `tests/unit/seed-data.test.ts` |
| 12 | production-target-env修正 | `CODIP_DISABLE_TOKEN_AUTH` 環境変数をproduction-target-envジョブに渡すよう修正（Access環境と整合） | PR #118, `.github/workflows/ci.yml` |
| 13 | RTO実測・証跡化 | Worker rollback 4秒 / 復旧デプロイ 25秒。切戻し後・復旧後の両方でProduction Smoke success（run 31341608599 / 31341677558） | PR #121, `docs/16-release-readiness-checklist.md` |
| 14 | 監視アラートポリシー作成 | Cloudflare `CODIP Worker Error Alert` 作成＋テスト送信済み。GitHub/Neon通知は手順書どおり設定待ち | PR #119 |
| 15 | 本番運用証跡の統合 | production-target-env success（run 31333706566）、Alert policy証跡、全gateのRECALC結果 | PR #119/#121 |

### Phase 0 セキュリティ証跡ゲート改善（2026-08-12・PR #137 マージ済み）

QA監査（`docs/security/evidence-gate-audit.md`）が検出した「証跡ゲートの自己認証・検知不能」系列7件を実装・検証した。

| # | Issue | 内容 | 検証 |
| --- | --- | --- | --- |
| 16 | #126 | Neon PITR保持期間をNeon API `GET /projects/{id}` の `history_retention_seconds` から**実測**。実測失敗・API key未設定はfail-closed。check側は実測値のみ判定 | モックAPIテスト3件（閾値以上PASS / 未満FAIL / API失敗fail-closed） |
| 17 | #127 | `pgDumpStatus` / `restoreDrillStatus` のハードコード既定値`success`を削除し未指定は非ゼロ終了。`--restore-drill-status` / `--restore-drill-record` をworkflow必須化。記録様式 `docs/runbooks/restore-drill-record.md` を新設 | 既定値なし→非ゼロ終了 / failure→FAIL / success→PASS をテスト |
| 18 | #128 | 本番証跡8変数に形式要件（ISO日付・連絡先形式・cron・owner形式・drill結果語彙）を検査側 `EVIDENCE_FORMATS` へピン留め。`ok`2文字では通過不可 | 形式不正FAILテスト・`docs/security/production-evidence-format.md` |
| 19 | #129 | 本番スモークのCSP検査を部分文字列一致からディレクティブ単位突合せへ。E2Eと本番スモークが同一契約 `scripts/tools/csp-contract.js` を参照 | 変異検査（script-src削除・CSP全除去・connect-src削除でFAIL）をユニットテストで証明 |
| 20 | #132 | CodeQL `analyze` の `continue-on-error: true` を削除し、失敗可能なゲートへ復元。不在を契約で固定 | `check-github-actions-contract.js` が復活を検知 |
| 21 | #133 | Actions SHAピン検査の対象を `readdirSync(".github/workflows")` 導出へ変更（4→6ファイル）。0件はfail-closed | 実測: 6ファイル・35 action refs全てSHA固定 |
| 22 | #134 | 監査契約ゲートに実挙動テストを追加（監査INSERT失敗→503、transaction rollback経路）。`evidence-gate-audit.md` #22を🟡へ再評価 | 失敗系2件＋砂場変異検査 |
| 23 | #90 | production smoke失敗時にincident Issueを自動起票（連続失敗P1昇格・重複防止・label冪等作成）。外部通知Secretは追加しない | workflow契約テスト9件・CI pass |
| 24 | docs | `docs/security/evidence-gate-audit.md`（26ゲート棚卸し）・`docs/runbooks/restore-drill-record.md`・`docs/security/production-evidence-format.md`・監視runbook整合 | drift契約テスト |

---

## 2. 改善後18軸採点（第2・第3サイクル再評価）

| # | 評価軸 | 初期 | 1st | 2nd | 3rd | 累計変化 | 理由（3rd） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 業務適合性 | 70 | 70 | 72 | 73 | +3 | incident Issue自動起票で運用フローが閉じた。業務機能の変更はなし |
| 2 | 機能完成度 | 72 | 72 | 74 | 75 | +3 | 障害通知（incident Issue）を追加。UI機能の追加はなし |
| 3 | UI/UX | 68 | 69 | 71 | 71 | +3 | 変更なし |
| 4 | アクセシビリティ | 62 | 65 | 67 | 67 | +5 | 変更なし（axe導入はPhase 1） |
| 5 | データ品質 | 68 | 68 | 69 | 70 | +2 | PITR保持を実測判定化し、バックアップ証跡の信頼性が向上 |
| 6 | AI有効性 | 40 | 42 | 42 | 42 | +2 | 変更なし（ルールベース推薦のみ） |
| 7 | 設計 | 78 | 78 | 79 | 81 | +3 | CSP契約の正本一元化、証跡形式要件を検査側へピン留め、fail-closed deploy |
| 8 | コード品質 | 78 | 82 | 83 | 85 | +7 | 変異検査付きゲート、lint/typecheck 0、テスト715件 |
| 9 | 性能・拡張性 | 55 | 55 | 55 | 55 | — | ロードテスト未実施 |
| 10 | セキュリティ | 80 | 80 | 83 | 86 | +6 | 証跡ゲート実測化（#126/#127/#128/#129）、CodeQL失敗可能化（#132）、SHA検査6/6（#133）、監査実測（#134） |
| 11 | 可用性・バックアップ | 72 | 75 | 78 | 80 | +8 | PITR実測ゲート＋restore drill記録様式＋**実訓練実施済み（2026-08-12）** |
| 12 | 監視・障害対応 | 55 | 60 | 67 | 72 | +17 | smoke失敗→incident Issue自動起票・連続失敗P1昇格。受信テストは未実施 |
| 13 | テスト | 70 | 80 | 83 | 86 | +16 | 単体715件、CSP契約変異検査、console error検知、監査失敗系2件 |
| 14 | CI/CD・リリース | 80 | 82 | 84 | 86 | +6 | workflow pin検査6/6、CodeQLゲート復元、production-target-env success |
| 15 | 運用保守性 | 62 | 65 | 70 | 73 | +11 | incident経路・restore drill様式・通知テスト記録様式。当番設定は人間作業 |
| 16 | 文書 | 75 | 84 | 86 | 88 | +13 | evidence-gate-audit・production-evidence-format・restore-drill-record追加 |
| 17 | 費用対効果 | 70 | 70 | 72 | 72 | +2 | 変更なし（低コスト構成を維持） |
| 18 | 競合代替性 | 55 | 55 | 57 | 58 | +3 | 監視・運用成熟度が向上。業務機能の代替範囲は不変 |
| **平均** | — | **67.1** | **69.6** | **72.7** | **73.3** | **+6.2** | — |

> 第3サイクルの点数は統合ブランチ（main `7f72626` = PR #137 マージ後）で実測したテスト720件・lint/typecheck 0・契約ゲート全pass・復旧訓練成功に基づく。

---

## 3. 改善後の総合判定

### 条件付き利用可（Conditional Production Use）— 大幅改善（第3サイクル）

**2026-08-12時点**: 初期評価 67.1 → 1st 69.6 → 2nd 72.7 → **3rd 73.3点（累計 +6.2点）**

**可能**: データ調査・地形分析・気象海象判定支援・現場PWA利用（パイロット部門）、後続API経由のシステム連携
**条件付き**: 全社600名・協力会社展開には「通知先設定（P0）」「RBAC」「PDF/Excel出力」「実データ50種」「ロードテスト」が必要
**運用可能**: 監視（15分毎smoke + Alert policy + incident Issue自動起票）・バックアップ（日次AES256 pg_dump + PITR実測ゲート）・復旧（RTO 4秒/25秒実証済み）

第3サイクルでは**「証跡ゲートが自己認証している」系列の重大欠陥7件（#126〜#129・#132〜#134）を実装・検証済み**とした。これらは攻撃可能性より監査証跡の信頼性の問題だが、「復旧訓練ゼロでも常にグリーン」「本番CSP緩和を検知しない」「CodeQLが構造的に失敗しない」状態を放置すると、本番運用の意思決定が虚偽の証跡に基づくため重大と評価する。

---

## 4. 改善後の代替率

| カテゴリ | 加重 | 初期 | 1st | 2nd | 3rd | 加重点(3rd) |
| --- | --- | --- | --- | --- | --- | --- |
| 主要業務フロー | 35% | 30% | 30% | 33% | 33% | 11.55 |
| 必須機能 | 25% | 45% | 45% | 48% | 48% | 12.0 |
| UX | 15% | 55% | 57% | 60% | 60% | 9.0 |
| データ連携 | 10% | 75% | 75% | 78% | 79% | 7.9 |
| セキュリティ・監査 | 10% | 70% | 72% | 76% | 82% | 8.2 |
| 運用保守性 | 5% | 55% | 62% | 68% | 72% | 3.6 |
| **合計** | 100% | **47.25%** | **48.1%** | **51.35%** | **52.25%** | — |

> 加重代替率 52.25%（累計 +5.0ポイント）。第3サイクルはセキュリティ・監査（76%→82%）と運用保守性（68%→72%）の寄与。80%到達にはPhase 2（モバイル本格化・通知・RBAC・PDF/Excel・50種・ロードテスト）が必要。

> ⚠️ 2nd時点の代替率 51.35% は上記の内訳（11.55+12.0+9.0+7.8+7.6+3.4）と整合しており、再計算でも一致することを確認済み。

---

## 5. 残存リスク（重要度順）

| リスク | 影響度 | 状態 | 対応 |
| --- | --- | --- | --- |
| 監視アラート通知先・受信テスト | 重大 | incident Issue自動起票は**マージ済み**。メール/Teams/当番の受信確認は人間作業 | P0・人間承認 |
| 復旧訓練の定期化 | 中 | **初回訓練は実施・記録済み**（2026-08-12）。次回は2026-11-11 | 四半期ルーチン |
| CodeQLアラート管理UI | 中 | ローカル解析＋SARIF artifact方式でゲート成立。Security tabはGHAS導入時（ADR 0003） | 将来判断 |
| RBAC未実装 | 高 | 計画済み。Access proxy認証は稼働 | Phase 1（3か月） |
| PDF/Excel出力未実装 | 高 | CSV/Markdown出力のみ。帳票実務には不十分 | Phase 1（3か月） |
| 実データ収集20ジョブ規模 | 高 | 50種目標に未達。XML/公式JSONコネクタ追加で拡張中 | Phase 1で50種 |
| ロードテスト未実施 | 高 | P95 5秒目標が未計測。600名同時利用時の性能不明 | Phase 1 |
| Neon PITR 24h境界 | 高 | 実測ゲートで監視は確立。24h→7日への延長は課金影響のため人間承認事項 | 人間承認 |
| アクセシビリティ自動スキャン未導入 | 中 | axe未導入。公共工事の適合証跡不足 | Phase 1 |
| 運用コスト管理未整備 | 中 | Cloudflare/Neon使用量の月次確認未自動化 | 運用台帳 |
| LLM/RAG未導入 | 中 | ルールベース推薦のみ。AIガバナンス文書は整備済み | Phase 2 |
| 地図3D・PLATEAU未連携 | 中 | 2D地図・標高・傾斜・断面は実装済み。3D Tiles未対応 | Phase 2 |

**解決済み**（初期評価からの改善）:

- ~~証跡ゲートの自己認証（#126/#127/#128/#129）~~ → 実測化・fail-closed化・形式検証化・**マージ済み（#137）**
- ~~CodeQLが構造的に失敗しない（#132）~~ → `continue-on-error` 除去＋不在側を契約で固定
- ~~Actions SHA検査が4/6ファイル（#133）~~ → ディレクトリ導出で6/6・0件fail-closed
- ~~監査契約が実挙動を検証しない（#134）~~ → 監査INSERT失敗系2件の実測テスト追加
- ~~smoke失敗通知経路なし（#90）~~ → incident Issue自動起票・連続失敗P1昇格（PR待ち）
- ~~production-target-env実行不可~~ → PR #118で修正、run 31333706566 success
- ~~RTO未実測~~ → PR #121で実測（切戻し4秒/復旧デプロイ25秒）
- ~~統合後新画面のE2E未カバー~~ → PR #114で16件追加
- ~~PWA/モバイル未対応~~ → PR #120でmanifest+SW+登録実装（タスク1〜2）
- ~~README旧記述残存~~ → PR #119/#121で最新化済み

---

## 6. 次アクション

**P0（人間操作・承認待ち）**:

1. ~~統合セキュリティPRのマージ~~ → **完了（#137 merged、main `7f72626`）**。サブセット #131/#135/#136 はクローズ推奨
2. ~~復旧訓練~~ → **完了（2026-08-12、`restore-drill-record.md` 記録・Variables反映済み）**
3. ~~production evidence 8変数~~ → **完了（形式検証済み値で登録・strict検証✅）**
4. 通知先メールアドレス/当番の設定と受信テスト（incident Issueのwatcher設定含む）— 人間操作
5. `CODIP_NEON_API_KEY`（read-only）のGitHub Actions Secret登録 — 人間判断（認証情報投入）
6. GitHub Actions production environmentへのSecrets最終登録確認 — 人間操作

**Phase 1（次サイクル・3か月以内）**:

7. RBAC基本実装（閲覧者/技術者/データ管理者/監査/API利用者）
8. PDF/Excelレポート出力（判定根拠・地形分析帳票）
9. 実データ収集50種展開＋ETLチューニング
10. ロードテスト（k6、P95計測）
11. アクセシビリティ自動スキャン（axe-core CI導入）
12. PWAオフライン戦略本格実装（キャッシュ戦略・バックグラウンド同期）
13. 通知・ウォッチリスト（データ更新遅延・API停止・スキーマ変更）

**ロードマップ**:

- Phase 0（重大問題・セキュリティ）: **完了（2026-08-12、PR #137 merged）。残りは通知受信テスト・Secret登録の人間操作**
- Phase 1（中核業務完成）: 2026-08〜10
- Phase 2（競合製品80%代替）: 2026-10〜2027-01
- Phase 3（AI・モバイル・外部連携）: 2027-01〜04
- Phase 4（90%代替・本番最適化）: 2027-04以降
