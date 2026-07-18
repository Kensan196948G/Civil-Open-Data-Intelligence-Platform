# 📰 CODIP リリースノート

Civil Open Data Intelligence Platform (CODIP) の利用者向けリリースノートです。開発者向けの検証証跡は [16-release-readiness-checklist.md](16-release-readiness-checklist.md) を参照してください。

---

## 🚀 2026-07-18 リリース (デザイン刷新 + リリース基盤)

2026-07-18 に 7 本の PR を main へ反映し、UI を全面刷新するとともにリリース準備基盤を整えました。現在は **社内 LAN 限定の systemd 配信** で稼働しています (Cloudflare Workers + Neon への本番化は人間承認待ちで未実施)。

### 📦 このリリースに含まれる変更

| PR | 区分 | 変更点 |
| --- | --- | --- |
| [#17](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/pull/17) | 🚦 基盤 | リリース準備チェックと PostGIS を対象とした CI を整備 |
| [#30](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/pull/30) | 🎨 UI | WebUI デザインを 100% 適用。250px 固定サイドバー、IBM Plex フォント、監査ログ画面の新設 |
| [#37](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/pull/37) | 🎨 品質 | TtlCache 導入、アクセシビリティ改善、404 ページ整備 |
| [#38](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/pull/38) | 🧪 テスト | モバイル viewport の E2E を追加 (CI で 34 テスト) |
| [#39](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/pull/39) | 🎨 UI | favicon を追加 |
| [#40](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/pull/40) | 🎨 UI | 設定画面に API キー設定パネルを追加 |
| [#41](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/pull/41) | 🗺️ 地図 | 地図を OpenStreetMap タイル + 標高シミュレーションで表示 |

### ✨ 利用者から見た主な改善点

- 🧭 **情報設計の刷新**: 250px 固定サイドバーで主要画面への導線を統一しました。
- 🔤 **可読性の向上**: 本文フォントに IBM Plex を採用しました。
- 🧾 **監査ログ画面の新設**: 管理操作の証跡を画面で確認できるようになりました。
- 🔑 **API キー設定パネル**: 設定画面から API キー関連の設定を扱えるようになりました。
- ♿ **アクセシビリティ**: フォーカス視認性やラベル対応などを改善し、404 ページを整備しました。
- 📱 **モバイル対応の検証**: モバイル画面幅の E2E を CI に追加し、レスポンシブ挙動を自動検証します。

### ⚠️ 意図的な差分 (設計判断)

| 項目 | 内容 | 理由 |
| --- | --- | --- |
| 🗺️ 地図の標高 | 標高は **シミュレーション値** で描画します | モックデザインと完全一致させることを人間判断で優先しました。国土地理院からの実標高取得 API はサーバー側に残置しており、実データ標高への切替は本番化フェーズで扱います |
| 🗺️ 地図タイル | OpenStreetMap (OSM) を使用します | 現行 UI のデザイン方針に合わせています |

### 📌 既知の制約

- 🖥️ **配信は社内 LAN のみ**: 現在は systemd user unit `codip-webui.service` により `http://192.168.0.185:3100/` で LAN 内配信しています。外部公開はしていません。
- ☁️ **Cloudflare / Neon は未構築**: 本番インフラ (Cloudflare Workers + Neon PostgreSQL/PostGIS) の実リソースは未作成で、CODIP はまだ本番デプロイされていません。本番化はすべて人間の承認・実行が前提です。
- 🐳 **Docker 廃止は移行中**: 従来の Docker 配信は廃止方針で、systemd 配信へ移行中です ([Issue #35](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/issues/35))。
- 🔌 **Workers ランタイム互換は未対応**: Cloudflare Workers では `node:dns` の一部 API が未実装のため、Workers 本番切替には別途対応が必要です ([Issue #18](https://github.com/Kensan196948G/Civil-Open-Data-Intelligence-Platform/issues/18))。
- 📊 **標準レコード本体は preview 段階**: ローカル SQLite preview は台帳中心で、標準レコード本体と原本保存の本格運用は次フェーズです。

### 🔗 関連ドキュメント

- 📋 [リリース直前チェックリスト](16-release-readiness-checklist.md)
- ☁️ [Cloudflare / Neon staging runbook](runbooks/cloudflare-neon-staging.md)
- ↩️ [障害時の切り戻し手順](runbooks/rollback.md)
