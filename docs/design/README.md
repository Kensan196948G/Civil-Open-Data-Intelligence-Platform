# 🎨 WebUI デザイン仕様

## 正本

| 項目 | 値 |
| --- | --- |
| デザイン正本 | [`civil-open-data-intelligence-platform.dc.html`](civil-open-data-intelligence-platform.dc.html) |
| 取得元 | claude.ai/design プロジェクト `43dfd45a-3205-4718-b782-ba32cf93c11c` |
| 取得日 | 2026-07-18 (DesignSync MCP 経由) |
| 位置づけ | **仕様・参照物**。production 実装 (`src/app/`) とは区別する。実装は本ファイルのレイアウト・配色・情報設計・導線を可能な範囲で維持する |

## デザイントークン (実装は `src/app/globals.css` の CSS 変数)

| トークン | 値 | 用途 |
| --- | --- | --- |
| `--accent` | `#E08A2B` | 主アクション・アクティブ表示 (オレンジ) |
| `--accent-d` | `#C9781F` | accent の hover |
| `--bg` | `#EEF1F5` | アプリ背景 |
| `--surface` | `#FFFFFF` | カード面 |
| `--ink` / `--ink-2` | `#1A2433` / `#5A6678` | 本文 / 副文 |
| `--muted` / `--faint` | `#8A97A8` / `#A2AEBC` | 弱い文字 |
| `--line` / `--line-2` | `#E3E8EF` / `#EEF1F5` | 罫線 |
| `--subtle` / `--subtle-2` | `#F2F4F8` / `#F8FAFB` | 淡い面 |
| `--blue` / `--blue-bg` | `#2E5AAC` / `#E9F0FB` | リンク・情報 |
| `--green` / `--green-bg` | `#1F8255` / `#E4F3EC` | 成功 (接続成功) |
| `--amber` / `--amber-bg` | `#B5701A` / `#FDEFE0` | 警告 (要確認) |
| `--red` / `--red-bg` | `#C5392F` / `#FCE9E7` | 失敗・危険 |
| `--purple` / `--purple-bg` | `#6B45B0` / `#EDE7F6` | 補助 |
| `--radius` | `10px` | カード角丸 |
| `--shadow` | `0 1px 2px rgba(16,24,40,.04)` | カード影 |
| フォント | IBM Plex Sans JP / IBM Plex Mono (next/font/google で self-host) | 全体 / コード・数値 |

## 画面構成 (VIEW_META)

| view | 実装ルート | タイトル | サブ |
| --- | --- | --- | --- |
| dashboard | `/` | 🏠 ダッシュボード | 登録データソースの状況を一目で確認 |
| sources | `/sources` | 📚 データソース一覧 | 公開データ・公開APIを検索・絞り込み |
| sourceDetail | `/sources/[id]` | 📄 データソース詳細 | 接続確認・品質評価・取得ログ |
| sourceNew | `/sources/new` | ➕ データソース新規登録 | 公開データ・公開APIを台帳に追加 |
| sourceEdit | `/sources/[id]/edit` | ✏️ データソース編集 | 登録内容を更新 |
| map | `/map` | 🗺️ 地図表示 | OpenStreetMap + 標高シミュレーション (モック完全一致) |
| logs | `/logs` | 🧾 取得ログ一覧 | 接続確認・サンプル取得の実行履歴 |
| audit | `/audit` | 🔍 監査ログ | 操作・イベントの証跡とエクスポート |
| tags | `/tags` | 🏷️ タグ管理 | データソースの分類タグを管理 |
| settings | `/settings` | ⚙️ 設定 | 接続確認の動作設定とセキュリティ制約 |

## シェル構成

- 左サイドバー 250px 固定 (`--side` 白)。ロゴブロック (アクセント色タイル + "Civil Open Data / Intelligence Platform")
- ナビ 3 グループ: 「運用」(ダッシュボード) / 「データ台帳」(データソース・地図) / 「記録・管理」(取得ログ・監査ログ・タグ管理・設定)
- アクティブ項目: 左 3px アクセントバー + `--side-2` (#FDEFE0) 背景。データソース系 (一覧/詳細/新規/編集) は「データソース」をアクティブ表示
- サイドバー下部: 🛰️ アバター + 「オープンデータ基盤 / ローカル環境」 + MVP バッジ
- 上部ヘッダー 62px: view タイトル + サブ / クイック検索 (→ `/sources?q=`) / 「公開データのみ」グリーンバッジ
- main: `padding:22px`、縦 flex gap 16px

## 設計と実装の意図的な差分

| 項目 | 設計 | 実装 | 理由 |
| --- | --- | --- | --- |
| 地図タイル・標高 | OpenStreetMap + シミュレーション値 | **設計と同一 (2026-07-18 人間判断でモック完全一致を採用)**。UI からの実標高 API 呼び出しは廃止し、`/api/map/elevation` はサーバー側 API として残置 | 当初は実機能 (GSI + 実API) を優先していたが、人間が完全一致を選択 |
| 監査ログのデータ | クライアント内デモデータ | `audit_logs` テーブルの実証跡 (登録・更新・削除・タグ・設定変更・ログイン・接続確認・サンプル取得・品質再計算・エクスポート・APIキー)。過去の取得ログは migration で backfill 済み (Issue #44) | デモデータではなく実運用の証跡を正本とする |
| 接続確認・品質再計算 | setTimeout による擬似実行 | 既存の実 API 呼び出しを維持 | 実機能を優先 |
| APIキー保存 (設定画面) | ブラウザ内保存シミュレート | 現行の説明 + セッション開始パネルを維持しつつ設計のスタイルを適用 | セキュリティ方針 (トークンを localStorage に保存しない) を優先 |
