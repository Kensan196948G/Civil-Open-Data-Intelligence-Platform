# 🗻 Civil-Terrain-Slope-Risk-Viewer 機能インベントリ・移行台帳

## 1️⃣ 概要

| 項目 | 内容 |
| --- | --- |
| 📦 リポジトリ | Kensan196948G/Civil-Terrain-Slope-Risk-Viewer (private) |
| 🎯 目的 | 公開地形データから工事候補地の標高・傾斜・地形分類を可視化するWebシステム |
| 🧱 技術 | pnpm monorepo: `apps/api` (Cloudflare Workers), `apps/web` (Vite+React+MapLibre), `packages/{domain,geo,adapters,db,ui}` |
| ✅ テスト | Vitest 単体 + Playwright E2E (地形・断面・確認支援タブ) |
| 📌 HEAD | `b595125b02d937244c6d1e1d2488fe8d248811fb` (55 commits, tags v0.1.0/v0.2.0) |

## 2️⃣ 機能一覧と移行分類

| # | 機能 | 状態 | 移行分類 | 中核での実装 |
| --- | --- | --- | --- | --- |
| T-01 | 地点検索 (住所・地名・緯度経度) | 実装済み | 🔵 再設計統合 | `/terrain` 検索欄 (`src/components/terrain/site-search.ts`) |
| T-02 | MapLibre 地図 (GSI標準/淡色/写真) | 実装済み | 🟢 そのまま移植 | `src/components/terrain/MapView.tsx` |
| T-03 | GSI 傾斜量図・陰影起伏レイヤー | 実装済み | 🟢 そのまま移植 | `src/components/terrain/layers.ts` |
| T-04 | 単点標高 API (`/elevation`) | 実装済み | 🟢 そのまま移植 | `/api/v1/terrain/elevation` |
| T-05 | GSI DEM タイル取得 (DEM1A/5A/5B/5C/10B) | 実装済み | 🟢 そのまま移植 | `src/lib/terrain/adapters/gsi-dem.ts` |
| T-06 | PNG 標高復号 (RGB→m, 欠損sentinel) | 実装済み | 🟢 そのまま移植 | `src/lib/terrain/geo/{png-codec,dem-decode}.ts` |
| T-07 | Horn法 3x3 傾斜計算 | 実装済み | 🟢 そのまま移植 | `src/lib/terrain/geo/slope.ts` |
| T-08 | 傾斜グリッド統計 (平均/最大/急傾斜比) | 実装済み | 🟢 そのまま移植 | `src/lib/terrain/geo/grid-analysis.ts` |
| T-09 | TPI 地形分類 (尾根/斜面/谷/平坦) | 実装済み | 🟢 そのまま移植 | 同上 |
| T-10 | 断面分析 (30m〜20km, 欠損は補間しない) | 実装済み | 🟢 そのまま移植 | `src/lib/terrain/section-service.ts` + `/api/v1/terrain/section` |
| T-11 | 根拠付き確認カード (ルール評価・総合危険度なし) | 実装済み | 🟢 そのまま移植 | `src/lib/terrain/confirm-cards.ts` + `/api/v1/terrain/confirm` |
| T-12 | 品質・欠損表示 (グレード/欠損率/被覆) | 実装済み | 🟢 そのまま移植 | `QualityPanel` + API品質応答 |
| T-13 | 共有URL (視点・レイヤー・地点・タブ) | 実装済み | 🔵 再設計統合 | `/terrain` 出力タブ (hash状態) |
| T-14 | CSV/JSON/Markdown レポート出力 | 未完成 (準備中ボタン) | 🟠 未完成を完成統合 | `/api/v1/terrain/export` 実装済み |
| T-15 | 案件保存 (analysis_runs / Neon) | 未実装 (Issue #42) | 🟠 未完成を完成統合 | 中核 `StandardRecord` + 監査ログで代替予定 |
| T-16 | Cloudflare Access JWT + RBAC | 未実装 (Issue #43) | 🟣 重複統合・置換 | 中核 `admin-auth` (proxy/token/session) が同等以上 |
| T-17 | 公開データレイヤー追加 (土砂災害警戒等) | 未実装 (Issue #44) | 🟣 重複統合・置換 | 中核 データソース台帳・`/api/v1/layers` が既存 |
| T-18 | OpenAPI x-status と ADR | 未実装 (Issue #45) | 🔵 再設計統合 | 中核 `docs/04-api-design.md` + OpenAPI route |
| T-19 | バンドル分割 (MapLibre code split) | 未実装 (Issue #46) | 🟣 重複統合・置換 | Next.js 自動code split + 動的import方針 |
| T-20 | デモモード (サンプル地点ワンクリック) | 未実装 (Issue #47) | 🟠 未完成を完成統合 | `/terrain` 検索のランドマーク一覧で代替 |

## 3️⃣ DB スキーマ (統合元)

`packages/db/migrations/0001_init.sql` に analysis_runs / config_versions 等が
設計されていた (統合元では実運用未接続)。中核では Prisma モデルへ統合する。

| テーブル (設計) | 主な列 | 中核での扱い |
| --- | --- | --- |
| `analysis_runs` | id, point, payload, status | 🟣 中核 `IngestionRun` / 監査ログで代替 |
| `config_versions` | rule_json | 🔵 コード内ルール定義 + 監査スナップショット |

## 4️⃣ API 一覧 (統合元)

| method | path | 中核での対応 |
| --- | --- | --- |
| GET | `/api/v1/health/live`, `/api/v1/health/ready` | 🟣 `/api/health`, `/api/ready` が既存 |
| GET | `/api/v1/elevation?lat&lon` | 🟢 `/api/v1/terrain/elevation` |

エラー体系: Problem Details (RFC 9457)、`INVALID_INPUT` / `NO_COVERAGE` /
`UPSTREAM_UNAVAILABLE` / `INTERNAL_ERROR` 等 → 中核の v1 エラー形式
`{error:{code,message}}` へ写像済み。

## 5️⃣ セキュリティ

- 🔒 取得先は GSI ホスト allowlist + https のみ (SSRF-safe by construction)
- 🔒 DNS rebinding 対策: 統合元はホスト名allowlist (Sprint 0 指摘 #14 未対応)。
  中核移植では `gsi-fetch.ts` が Node 実行時に `assertSafeUrl` (解決IP再検査) を追加
- 🔒 Unknown is not Safe: 欠損・取得失敗を低リスクへ丸めない

## 6️⃣ 文書・テスト

- 📚 docs 12本 (アーキテクチャ/データ設計/画面設計/テスト品質/運用障害対応 等)
- 🧪 単体: geo 62件 + domain 18件 + adapters 24件 + analysis 12件 (中核へ移植済み 114件)
- 🧪 E2E: Playwright (地形・断面・確認支援タブ)

## 7️⃣ 外部データソース

| ソース | URL | 利用条件 |
| --- | --- | --- |
| GSI 標準/淡色/写真タイル | `https://cyberjapandata.gsi.go.jp/xyz/...` | 国土地理院 地理院タイル利用規約 |
| GSI 傾斜量図/陰影起伏図 | 同上 | 同上 |
| GSI 標高タイル DEM1A/5A/5B/5C/10B | 同上 | 同上 (出典表記必須) |

## 8️⃣ 統合結果サマリ

- ✅ 地形解析コア (T-01〜T-14) は中核へ移植・単体テスト 114件成功
- ⏳ 案件保存 (T-15) は StandardRecord/監査ログ統合を継続
- 🔴 廃止候補: なし (全機能を中核へ集約)
