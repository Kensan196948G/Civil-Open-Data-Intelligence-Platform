# フォント配信方式と CSP 許可ホストの裁定記録 (Issue #36)

- 測定日: 2026-08-11
- 対象: `src/app/layout.tsx` のフォント読み込み、`next.config.ts` の `style-src` / `font-src`
- 裁定: **案C（現状維持・保留継続）**
- 契機: CodeRabbit (PR #30) の「外部依存最小化」指摘

## 1. 現状

デザイン正本 `docs/design/civil-open-data-intelligence-platform.dc.html` が
`font-family:'IBM Plex Sans JP',system-ui,…` と `var(--mono)` = `IBM Plex Mono` を指定している。
実装はこれに合わせ、正本と同じ `<link rel="stylesheet">` 方式で Google Fonts から取得している。

CSP の該当箇所（`next.config.ts`）:

```
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
font-src  'self' https://fonts.gstatic.com
```

コードベースでの実使用ウェイト（`src/` 全体の grep 実測）:

| ウェイト | Tailwind クラス | 出現箇所 |
| --- | --- | ---: |
| 400 | `font-normal` / body 既定 | 4 + 既定 |
| 500 | `font-medium` | 29 |
| 600 | `font-semibold` / `font-weight: 600` | 84 + 5 |
| 700 | `font-bold` / `font-weight: 700` | 3 + 1 |

`var(--mono)` (IBM Plex Mono) は 10 箇所で使用。**4 ウェイトすべてが実使用中**である。

## 2. 案A: `next/font/google` へ移行 — 不成立（2 つの独立した理由）

### 2-1. ビルド不能（実測・再現）

`src/app/layout.tsx` を `IBM_Plex_Sans_JP` / `IBM_Plex_Mono` の `next/font/google` 版へ書き換え、
`npm run build` を実行した結果:

```
An error occurred in `next/font`.
RangeError: WebAssembly.Instance(): Out of memory:
  Cannot allocate Wasm memory for new instance
    at nextFontGoogleFontLoader (next/dist/compiled/@next/font/dist/google/loader.js:104)
> Build failed because of webpack errors
```

- 実行環境: Node **v25.2.1** / npm 11.6.2 / Next.js 15.5.22
- 終了コード: 1（同一ツリーのベースライン `npm run build` は終了コード 0 = PASS）
- 原因: 当該開発機の仮想メモリ上限。`ulimit -v` = soft **20,000,000 KB**、`ulimit -Hv` = **20,000,000 KB**。
  soft と hard が同値のため、シェルからの引き上げは不可（`ulimit -v unlimited` は失敗）。
  V8 の WebAssembly インスタンスは 1 個あたり大きなガード領域を予約するため、
  `next/font` が複数フォントを並列ロードする段階で仮想アドレス空間を使い切る。

これは `next.config.ts` の `config.output.hashFunction = "sha256"` ワークアラウンドおよび
`src/app/icon.svg` を `public/icon.svg` へ退避している既存対処と**同一の根本原因**である。

> 注: 制約は開発機固有であり、CI ランナーでは成立する可能性がある。ただし本項の制約が
> 解消されても 2-2 が独立に案Aを否定するため、裁定は変わらない。

### 2-2. `next/font` は日本語グリフを取得できない（設計上の制約）

`next/font/google` は Google Fonts の **named subset** しか取得できない。
同梱メタデータ（`next/dist/compiled/@next/font/dist/google/font-data.json`）の実測値:

| フォント | 利用可能な subsets |
| --- | --- |
| IBM Plex Sans JP | `cyrillic`, `latin`, `latin-ext` |
| IBM Plex Mono | `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`, `vietnamese` |

**`japanese` subset が存在しない。** Google は CJK フォントを名前付きサブセットではなく、
名前のない多数の `unicode-range` チャンクとして CSS API 経由でのみ配信するためである。

これは当該 2 ファミリー固有の欠落ではなく `next/font/google` の構造的制約である。
`font-data.json` 収録 **1862 ファミリー全件**を走査した結果、`subsets` に `japanese` を含むものは
**0 件**であった（`Noto Sans JP` ですら `["cyrillic","latin","latin-ext","vietnamese"]`）。
subset 名の語彙自体にも `japanese` / `chinese` / `korean` は存在せず、CJK 関連は
`kana-extended`（仮名拡張ブロック。本文用ではない）のみである。
したがって**別の日本語フォントへ差し替えても案Aは成立しない。**

したがって案Aを採用すると日本語グリフは self-host されず、本文の大半が
`system-ui` / `Hiragino Kaku Gothic ProN` / `Meiryo` へフォールバックする。
本アプリの UI テキストはほぼ全て日本語であり、デザイン正本からの明確な乖離となる。

## 3. 案B: woff2 を `public/fonts/` へ取り込み `@font-face` 化 — 不成立（サイズ超過）

Google Fonts CSS（Chrome 相当 UA で取得）を解析し、全 woff2 の `Content-Length` を実測した。

CSS 自体: 467,341 B（gzip 122,186 B）、`@font-face` ブロック **507 個**、woff2 URL **507 個（重複なし）**。

| ファミリー / ウェイト | ファイル数 | 実測サイズ |
| --- | ---: | ---: |
| IBM Plex Sans JP 400 | 123 | 1.371 MB |
| IBM Plex Sans JP 500 | 123 | 1.393 MB |
| IBM Plex Sans JP 600 | 123 | 1.400 MB |
| IBM Plex Sans JP 700 | 123 | 1.394 MB |
| IBM Plex Mono 400 | 5 | 0.047 MB |
| IBM Plex Mono 500 | 5 | 0.047 MB |
| IBM Plex Mono 600 | 5 | 0.051 MB |
| **合計** | **507** | **5.70 MB** |

うち非 CJK（`latin` / `latin-ext` / `cyrillic` / `vietnamese`）は 26 ファイル・236.1 KB のみ。
残る **481 ファイル・約 5.47 MB が日本語の `unicode-range` チャンク**である。

### 上限（リポジトリ追加バイナリ 2 MB）に対する評価

| 構成 | サイズ | 判定 |
| --- | ---: | --- |
| 全ウェイト self-host（デザイン完全維持） | 5.70 MB | ❌ 上限の 285% |
| Sans JP を 400+600 の 2 ウェイトへ削減 + Mono 400 | 2.82 MB | ❌ 上限の 141%。かつ `font-medium` 29 箇所と `font-bold` 3 箇所が失われる |
| Sans JP 1 ウェイト + Mono 1 ウェイト | 1.42 MB | ⚠️ 上限内だが、太字指定 116 箇所が全て synthetic bold になり CJK 字形が潰れる |
| 非 CJK サブセットのみ self-host | 0.24 MB | ⚠️ 上限内だが日本語が全てフォールバック（案 2-2 と同じ乖離） |

### 使用字形への静的サブセット化が採れない理由

本アプリは行政オープンデータ（地名・河川名・事業者名・工種名など）を動的に表示する。
表示される字形の集合はビルド時に確定せず、固定グリフセットへサブセット化すると
未収録文字が豆腐（`□`）になる。地名には常用外漢字が現れるため（例: 塩竈、廿日市）、
静的サブセット化は安全でない。

Google の CSS 方式ではブラウザが `unicode-range` を評価して**実際に必要なチャンクだけ**を
取得するため、実効転送量は数百 KB 程度に収まる。self-host ではこの遅延取得の恩恵を得るために
全 507 ファイルを配置する必要があり、これがサイズ超過の直接原因である。

## 4. 裁定: 案C（現状維持）

案A・案Bとも実測で不成立のため、CSP の許可ホストは変更しない。
**CSP を緩める変更は行っていない（許可ホストの追加はゼロ）。**

現状の残存リスクと緩和:

| リスク | 現状の緩和策 |
| --- | --- |
| Google Fonts CDN 不達 | `globals.css` の font stack が `system-ui` / `Hiragino Kaku Gothic ProN` / `Meiryo` へフォールバック。`display=swap` により FOIT なし |
| 外部ホストへの IP 送出（プライバシー） | 未緩和。残課題として記録 |
| `style-src` に外部ホストが 1 つ存在 | 未緩和。下記 5 を参照 |

## 5. CTO 判断待ちの部分的代替案（未実装）

`style-src` からのみ `fonts.googleapis.com` を除去する案（woff2 は引き続き `fonts.gstatic.com`）:

- 手法: Google Fonts CSS の内容を自前 CSS として同梱し、`@font-face` の `src` は gstatic の URL を指す
- リポジトリ追加バイナリ: **0 B**（CSS 467 KB / gzip 122 KB のテキストのみ）
- 効果: `style-src` の外部ホストが 0 になる（外部スタイルシートは任意のスタイル注入が可能で、
  フォントバイナリより攻撃面が広いため、除去の価値は `font-src` より高い）
- 残る許可ホスト: `font-src https://fonts.gstatic.com`
- 副作用:
  - gstatic の woff2 URL はバージョン番号入り（`/s/ibmplexsansjp/vNN/…`）で、
    フォント更新時に手動追随が必要。追随漏れは 404 → フォールバック表示になる
  - 467 KB の CSS が初期表示の critical path に入る（現状は UA に応じて Google が最適化した CSS を返す）

外部依存の「半減」と保守追随コストのトレードオフであり、Issue #36 の目標
（両ホストの除去）は満たさないため、本タスクの範囲では実装していない。

## 6. 再評価の条件

次のいずれかが成立した時点で本裁定を再評価する。

1. IBM Plex Sans JP の可変フォント（1 ファイルで複数ウェイト）が Google Fonts で提供される
2. リポジトリ追加バイナリの上限が 6 MB 以上へ引き上げられる（デザイン完全維持での self-host が可能になる）
3. ビルド時動的サブセット化の仕組みを導入し、表示字形の集合を確定できるようになる
4. `next/font/google` が CJK の `unicode-range` チャンク配信に対応する
