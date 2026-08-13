# レポート出力方式の設計判断（Excel / PDF）

- 状態: Accepted（2026-08-12）
- 関連: docs/14-roadmap.md（PDF/Excel出力 Phase 1）、src/lib/report-export.ts、/api/v1/reports

## 1. Excel: 実 OOXML (.xlsx) を採用

`format=xlsx` は **OOXML .xlsx** を生成する。ZIPコンテナに `fflate`（Workers互換・
圧縮実装のみ・~15KB）を使用し、`[Content_Types].xml` / rels / workbook / worksheet /
styles の最小構成を組み立てる。

- 数値セルは数値型、文字列セルは inlineStr（XMLエスケープ済み）
- ヘッダー行は太字スタイル
- Excel / LibreOffice / Numbers でネイティブに開ける
- 依存は fflate 1つのみで、Cloudflare Workers のバンドル制約（3MiB gzip）内

代替として SpreadsheetML 2003 XML（依存なし）を試用していたが、Excel が XML
エディタで開く等の環境依存があるため、本格化に伴い OOXML へ置き換えた。

## 2. PDF: 印刷用HTML（ブラウザ印刷→PDF）を公式経路とする

サーバー側PDF生成ライブラリ（pdfkit / pdf-lib 等）は採用しない。

| 観点 | 判定 |
| --- | --- |
| 日本語フォント埋め込み | 標準14フォントに日本語は無く、CJKフォント（woff2/ttf 数MB）の埋め込みが必要。Workersバンドル3MiB制約と衝突 |
| ランタイム互換 | pdfkitはNode API依存でWorkers不可。pdf-libは可だがCJKフォント問題は同じ |
| レイアウト品質 | ブラウザ印刷は既存UIのCSS（ページ番号・表のヘッダー繰返し・署名欄）をそのまま帳票化できる |
| 実運用 | 利用者はブラウザの「印刷→PDFに保存」で帳票を生成。専用ライブラリ不要・保守コスト最小 |

`format=pdf` は印刷最適化HTML（A4 @page・thead繰返し・改ページ制御・署名欄・
フッター）を返し、画面の印刷ボタンからPDF保存する。

### 再評価トリガー

- 大量・自動のPDF生成（バッチ帳票、メール添付）が必要になった場合
- WorkersでCJKフォントを効率的に配信・埋め込む方式（例: フォントsubset化基盤）が
  整備された場合
- その際は別Issueでサーバー側PDF基盤を設計する（本決定を更新）

## 3. 検証

- `tests/unit/report-export.test.ts`: xlsxをunzipしてOOXMLパーツ・エスケープ・
  数値セルを検証。printHtmlはA4・thead・署名・フッターを検証
- CI: `npm test` / lint / typecheck / build / Cloudflare bundle artifact check
