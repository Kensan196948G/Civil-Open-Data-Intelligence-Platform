# 🌦️ wmcdss 機能インベントリ・移行台帳

## 1️⃣ 概要

| 項目 | 内容 |
| --- | --- |
| 📦 リポジトリ | Kensan196948G/wmcdss (private) |
| 🎯 目的 | Weather-Marine Construction DSS — 現場気象海象 自動集計・施工判断支援システム |
| 🧱 技術 | FastAPI + SQLAlchemy(asyncpg) + PostgreSQL + Vite/React + systemd/Docker |
| ✅ テスト | backend 29 pytest + frontend 23 vitest + ETL 1 (合計53) |
| 📌 HEAD | `b08792166571a5d958a47fda8e07f331c13786b2` (179 commits, tagなし) |

## 2️⃣ 機能一覧と移行分類

| # | 機能 | 状態 | 移行分類 | 中核での実装計画 |
| --- | --- | --- | --- | --- |
| W-01 | 現場管理 (一覧/登録/詳細) | 実装済み | 🔵 再設計統合 | Prisma `ConstructionSite` + `/api/v1/sites` + `/sites` UI |
| W-02 | 全国地図 (40件・エリアフィルター) | 実装済み | 🔵 再設計統合 | `/sites` UI (Leaflet/MapLibre + 台帳リンク) |
| W-03 | AMeDAS 気象データ収集 (10分毎) | 実装済み | 🔵 再設計統合 | `scripts/ingestion/weather-jma.js` + `WeatherObservation` |
| W-04 | 波浪・潮位・海流 (JMA wave/Open-Meteo Marine) | 実装済み | 🔵 再設計統合 | `scripts/ingestion/marine-openmeteo.js` + `MarineObservation` |
| W-05 | 取りこぼし再取得 (現在→前3hブロック) | 実装済み | 🔵 再設計統合 | 同上 (fetch fallback) |
| W-06 | 欠測検知 (QCフラグ・sentinel・ETL status) | 実装済み | 🔵 再設計統合 | 観測取り込み時のQC + `AuditLog` + `/api/v1/etl/status` |
| W-07 | 閾値管理 (site別/global, 有効期間) | 実装済み | 🔵 再設計統合 | Prisma `WeatherThreshold` + `/api/v1/thresholds` |
| W-08 | 施工可否判定 (go/caution/stop, 欠測はfail-closed) | 実装済み | 🔵 再設計統合 | `src/lib/decision/engine.ts` + `/api/v1/decisions` |
| W-09 | コンクリート打設支援 (気温/降雨/風) | 実装済み | 🟢 そのまま移植 | `/decisions` UI + 既定閾値シード |
| W-10 | 海上作業支援 (波高/風速/潜水/輸送) | 実装済み | 🟢 そのまま移植 | 同上 |
| W-11 | 週間予報表示 | 実装済み (UI) | 🟣 重複統合・置換 | 中核 `connectors/jma-xml.ts` を活用 |
| W-12 | 風配図 | 実装済み (UI) | 🔵 再設計統合 | `/weather` UI の風配チャート |
| W-13 | 履歴分析 (月次統計) | 実装済み | 🔵 再設計統合 | `/api/v1/analysis/historical` |
| W-14 | 50年確率波 (Gumbel/Weibull, 年最大) | 実装済み | 🟢 そのまま移植 | `src/lib/analysis/return-period.ts` + `/api/v1/analysis/wave50` |
| W-15 | レポート (daily/weekly/monthly/decision/marine/annual, CSV/Excel) | 実装済み | 🔵 再設計統合 | `/api/v1/reports` (CSV/Markdown) + `/reports` UI |
| W-16 | 監査ログ (actor/action/detail, 判定再構成) | 実装済み | 🟣 重複統合・置換 | 中核 `AuditLog` + `/api/admin/audit-events` |
| W-17 | 認証 (bcrypt JWT / M365 ROPC / APIキー) | 実装済み | 🟣 重複統合・置換 | 中核 `admin-auth` (token/proxy/session) を採用 |
| W-18 | レート制限・セキュリティヘッダー | 実装済み | 🟣 重複統合・置換 | 中核 `rate-limit` + 既存ヘッダー方針 |
| W-19 | AI支援 (Anthropic + ルールベースfallback) | 実装済み | 🔵 再設計統合 | 中核 `recommendations` と統合 (LLM APIキーはenv管理) |
| W-20 | ETLジョブ管理 (手動実行/status) | 実装済み | 🔵 再設計統合 | `/api/v1/etl/*` + `scripts/ingestion` |
| W-21 | Prometheus メトリクス | 実装済み | 🟣 重複統合・置換 | 中核 `/api/health` 等の運用監視で代替 |
| W-22 | バックアップ (pg_dump) | 実装済み | 🟣 重複統合・置換 | 中核 `neon-backup` workflow が既存 |

## 3️⃣ DB スキーマ (統合元)

| テーブル | 主な列 | 中核での対応 |
| --- | --- | --- |
| `sites` | code(unique), name, kind(land/marine/both), lat, lon, jma_station_id, wave_grid_lat/lon, address, note | 🟢 `ConstructionSite` |
| `thresholds` | site_id(FK NULL=global), work_type, metric, op, value, severity(warn/stop), active_from/to | 🟢 `WeatherThreshold` |
| `weather_observations` | site_id, observed_at, 気温/湿度/気圧/雨/風/風速/日照, fetched_at, data_version, source; unique(site_id, observed_at, data_version) | 🟢 `WeatherObservation` |
| `marine_observations` | site_id, observed_at, 有義波高/周期/波向/潮位/海流, data_version, source | 🟢 `MarineObservation` |
| `decisions` | site_id, work_type, window_start/end, status(go/caution/stop), reason, inputs JSONB, thresholds_snapshot JSONB, generated_by/at | 🟢 `DecisionRecord` |
| `audit_log` | occurred_at, actor, action, target_type/id, detail JSONB | 🟣 中核 `AuditLog` |

## 4️⃣ API 一覧 (統合元 → 中核)

| method | path | 中核での対応 |
| --- | --- | --- |
| GET/POST | `/api/v1/sites` | 🟢 `/api/v1/sites` |
| GET | `/api/v1/sites/{id}` | 🟢 同上 |
| GET/POST | `/api/v1/thresholds` | 🟢 `/api/v1/thresholds` |
| PATCH/DELETE | `/api/v1/thresholds/{id}` | 🟢 同上 |
| GET/POST | `/api/v1/observations/weather[/latest]` | 🟢 `/api/v1/observations/weather` |
| GET/POST | `/api/v1/observations/marine[/latest]` | 🟢 `/api/v1/observations/marine` |
| POST | `/api/v1/decisions` | 🟢 `/api/v1/decisions` |
| GET | `/api/v1/observations/historical` | 🟢 `/api/v1/analysis/historical` |
| GET | `/api/v1/analysis/wave50` | 🟢 同上 |
| POST | `/api/v1/reports` | 🟢 `/api/v1/reports` |
| POST/GET | `/api/v1/etl/run/{id}`, `/api/v1/etl/status` | 🟢 `/api/v1/etl/*` |
| GET | `/api/v1/audit` | 🟣 中核 `/api/admin/audit-events` |
| POST/GET | `/api/v1/ai/*` | 🔵 中核 `recommendations` へ統合 |
| GET | `/healthz`, `/readyz`, `/metrics` | 🟣 中核 `/api/health`, `/api/ready` |

## 5️⃣ 判定エンジン (最重要ロジック)

- 🧭 `evaluate()`: 全ルールを評価し最悪ケースで go/caution/stop を決定
- 🚫 **Fail-closed**: 評価できなかったルールが1件でもあれば go にしない
- 📋 監査再構成: `matched_rules` / `unevaluated_rules` / `out_of_effect_rules` /
  `evaluated_count` をスナップショット保存
- 🗓️ 有効期間は判定対象の施工時間帯 (JST暦日) と重なり判定
- ⚠️ 欠測は caution まで引き上げ (stop にはしない) — 現場の無視・無効化を防ぐ設計

## 6️⃣ ETL・統計

- 📡 AMeDAS: `https://www.jma.go.jp/bosai/amedas/data/point/{station}/{YYYYMMDD}_{H}.json`
  (3時間ブロック、QCフラグ0=有効、前ブロックへfallback)
- 🌊 Open-Meteo Marine: `https://marine-api.open-meteo.com/v1/marine`
  (参考情報として保存、判定からは除外)
- 📊 50年確率波: Gumbel (モーメント法) / Weibull (Gringorten plotting position)
- 📈 集計: daily/monthly/annual (pandas) → TS へ移植

## 7️⃣ 文書・CI/CD

- 📚 docs 10本 (ARCHITECTURE/AUTH-DESIGN/IT-STAFF/PLAN/SECURITY/STATUS/TECH-STACK/TECHNICAL/WINDOWS11)
- ⚙️ `.github/workflows/ci.yml` + dependabot (pip/npm/github-actions)
- 🐳 docker-compose (dev/production) + deploy/systemd (service + 2 timer)

## 8️⃣ 統合結果サマリ

- ⏳ Prisma モデル・判定エンジン・API・UI・ETL の中核移植を実施中
- 🔴 廃止候補: FastAPI/uvicorn/システムd 単独実行基盤 (中核の Next.js/Workers/Neon へ統合のため)
