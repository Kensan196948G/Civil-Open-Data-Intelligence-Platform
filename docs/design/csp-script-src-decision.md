# CSP `script-src 'unsafe-inline'` 除去可否の裁定記録 (T-F2)

- 測定日: 2026-08-11
- 対象: `next.config.ts` の `script-src` / `style-src`、`src/middleware.ts`
- 裁定: **不成立（保留 + 条件付き解除）**。CSP は変更しない
- 測定環境: Node v25.2.1 / Next.js 15.5.22 / production build (`npm run build` → `npm run start`)

## 0. 結論の要約

`script-src` の `'unsafe-inline'` は、アプリコードでもサードパーティでもなく
**Next.js / React 自身の RSC ペイロード配信機構**が要求している。

nonce 方式は**動的ルート 9 本では完全に機能したが、静的ルート 8 本を完全に破壊する**（全スクリプトが
ブロックされ、ページが機能しなくなる）。この差は Next.js の設計上の制約であり、公式ドキュメントでも
明記されている。静的ルートを救う代替（`experimental.sri`）も実測したが、inline script を
一切カバーしないため成立しない。

ギャップを埋める手段は存在するが、いずれも本タスクの停止条件または所有権境界を超えるため、
**実装せず CTO 判断へ差し戻す**（§6）。

## 1. `'unsafe-inline'` を要求している主体（実測）

### 1-1. アプリ側の要因は存在しない

| 調査項目 | 実測値 |
| --- | ---: |
| `next/script` の使用 | **0** |
| `dangerouslySetInnerHTML` | **0** |
| サードパーティスクリプト（解析・タグマネージャ等） | **0** |
| CSS-in-JS ライブラリ | **なし** |

### 1-2. 実際の要因は Next.js / React の RSC ペイロード

production ビルドの SSR HTML を実測した結果、**全ページ**が以下の inline script を持つ。

| inline script | 本数 | 役割 |
| --- | ---: | --- |
| `(self.__next_f=self.__next_f\|\|[]).push([0])` | 1 | flight ペイロード受信バッファの初期化 |
| `self.__next_f.push([1,"…"])` | 3〜5 | RSC flight ペイロード本体（サーバーコンポーネントの描画結果） |

例: `/sites` は inline 6 本、`/map` は inline 6 本。

さらに Suspense / エラー経路では React 19 のランタイム inline script が 3 本追加される
（`$RB=[];$RV=function(a){…}`、`requestAnimationFrame(function(){$RT=performance.now()})`、
アイコン再配置スクリプト）。

**flight ペイロードはページ内容そのもの**であるため、内容が変わればスクリプト本体も変わる。
これが静的なハッシュ列挙を難しくしている根本原因である。

### 1-3. 自前の inline script は 1 箇所のみ

`src/components/AuditLogPanel.tsx:76` の PDF エクスポートが、`blob:` URL で開く印刷用ドキュメントへ
`<script>window.addEventListener('load',function(){window.print();});</script>` を埋め込んでいる。

CSP3 では `blob:` / `data:` ドキュメントは**生成元のポリシーを継承**するため、この inline script も
親ページの `script-src` に支配される。`'unsafe-inline'` を外す場合は、この 1 箇所も併せて
書き換えが必要になる（クライアントコンポーネントから nonce を取得する経路がないため）。

## 2. 案A: nonce 方式 — 動的ルートは成功、静的ルートで不成立

`src/middleware.ts` で per-request nonce を発行し、`NextResponse.next({ request: { headers } })` で
リクエストヘッダへ `Content-Security-Policy` を載せる公式手順を実装して実測した（実験コードは commit していない）。

適用ポリシー: `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'`

### 2-1. ビルドは通り、ルート構成も変わらない

```
✓ Compiled successfully in 26.0s   (EXIT=0)
ルート構成: 静的 8 / 動的 9 — nonce 導入前と同一
```

### 2-2. 動的ルート: 完全に機能した

| ルート | nonce 付きスクリプト / 全スクリプト | 未署名 |
| --- | ---: | ---: |
| `/settings` | 13 / 13 | 0 |
| `/audit` | 12 / 12 | 0 |
| `/logs` | 12 / 12 | 0 |
| `/tags` | 13 / 13 | 0 |

inline・外部を問わず全スクリプトにレスポンスヘッダと一致する nonce が付与された。

### 2-3. 静的ルート: 完全に破壊される

| ルート | nonce 付きスクリプト / 全スクリプト | `strict-dynamic` 下での挙動 |
| --- | ---: | --- |
| `/sites` | **0 / 16** | 全 16 本がブロック |
| `/terrain` | **0 / 16** | 全 16 本がブロック |
| `/map` | **0 / 15** | 全 15 本がブロック |
| `/weather` | **0 / 16** | 全 16 本がブロック |

`'strict-dynamic'` はホストソース（`'self'`）を無効化するため、nonce が付かない静的ページでは
**外部チャンクも inline も全てブロックされ、ページが完全に機能しなくなる**。

原因は Next.js の設計そのものである（公式ドキュメント
`docs/01-app/02-guides/content-security-policy.mdx`）:

> When Content Security Policy (CSP) nonces are used, all pages in your Next.js application must be
> dynamically rendered. This means static optimization and Incremental Static Regeneration (ISR) are
> disabled. Partial Prerendering (PPR) is also incompatible with nonce-based CSP because static shell
> scripts cannot access the nonce.
>
> Static pages are generated at build time, where no request or response headers exist, preventing
> nonce injection.

**リクエストが存在しない時点で生成された HTML に、リクエスト固有の値を書き込むことはできない。**

### 2-4. Cloudflare Workers 上でも同じ破壊が起きる（ローカル固有ではない）

既存の `.open-next` ビルド成果物を実測した:

| 確認項目 | 実測値 |
| --- | --- |
| `.open-next/assets` 内の HTML ファイル数 | **0**（`BUILD_ID` / `_next/static` / `icon.svg` / `leaflet` / `sw.js` のみ） |
| プリレンダリング済みページ HTML の配信元 | `.open-next/server-functions`（= Worker 経由） |
| `.open-next/middleware/` | 独立バンドルとして存在 |

静的ページの HTML も ASSETS バインディングではなく Worker から返るため、**middleware は静的ページに対しても実行される**。
すなわち 2-3 の破壊は本番でもそのまま再現する。ローカル環境固有の事象ではない。

### 2-5. 併発する追加要件: `worker-src`

`'strict-dynamic'` を入れると `worker-src` → `child-src` → `script-src` のフォールバック連鎖により
Service Worker の登録が `script-src` に支配され、`'self'` が無効化されているためブロックされる。
`src/components/PwaRegister.tsx` の `/sw.js` 登録（PWA 機能）が停止する。

将来 nonce 方式を採る場合は **`worker-src 'self'` の明示追加が必須**である。

## 3. 案B: `experimental.sri`（hash 方式）— inline を一切カバーせず不成立

公式ドキュメントが nonce の代替として「静的生成を維持したまま strict CSP を強制できる」と説明している
`experimental.sri` を実測した。

設定: `experimental: { sri: { algorithm: "sha256" } }`（ビルド EXIT=0、静的生成は維持された）

`/sites` の SSR HTML 実測:

| 区分 | 本数 | `integrity` 付与 | `nonce` 付与 |
| --- | ---: | ---: | ---: |
| 外部スクリプト（`<script src>`） | 10 | **5** | 0 |
| inline スクリプト | 6 | **0** | 0 |

`/map`（外部 9 / inline 6）、`/terrain`（外部 10 / inline 6）も同傾向。

**2 つの独立した理由で不成立である。**

1. **inline を全くカバーしない。** SRI マニフェストは `compilation.getAssets()`、すなわち webpack が
   出力した**ファイル**のみをハッシュ化する。inline script は HTML 文字列の一部でありアセットではないため、
   原理的にマニフェストへ載らない。RSC flight ペイロード 6 本はそのまま残り、`'unsafe-inline'` を要求し続ける。
2. **外部スクリプトも半分しかカバーしない。** `integrity` が付いたのはブートストラップ系
   （`webpack`, `main-app`, `polyfills` 等）5 本のみで、ルート固有チャンク
   （`app/layout`, `app/page`, `app/sites/page`, `9664`, `2758`）5 本には付かない。
   したがって `script-src` から `'self'` を外すこともできない。

## 4. `style-src 'unsafe-inline'` の見立て

`style-src` の `'unsafe-inline'` は **nonce では代替できず、`'unsafe-hashes'` でも代替できない。**
nonce は `<style>` 要素と外部スタイルシートにしか適用できず、`style=""` 属性には原理的に効かないためである。
実測では `src/` 全体に `style={{…}}` が 24 箇所（14 ファイル）あり、うち 2 箇所
（`MapView.tsx:452` / `:459`）は react-leaflet の `<GeoJSON style=>` パスオプションで DOM 属性ではないため、
実質 **22 箇所が DOM inline style**、SSR HTML には **1 ページあたり `style=""` 属性が 12 個**出力される
（`<style>` 要素は 0）。理論上の代替は `'unsafe-hashes'` + 各値の個別ハッシュ列挙だが、
`src/app/tags/page.tsx:43` が `backgroundColor: tag.color ?? "#94a3b8"` という **DB 由来のユーザー定義色**を
使っており、取りうる値の集合がビルド時に確定しないためハッシュ列挙も成立しない。
なお Leaflet が実行時にペイン位置を `element.style.transform = …` で設定する経路は CSSOM 操作であり
CSP の管轄外（`style-src` は markup の `style=""` 属性と `<style>` 要素のみを対象とする）なので、
これは阻害要因ではない。結論として `style-src` の `'unsafe-inline'` は現状維持とする。

## 5. 検証状況

| 検証 | 結果 |
| --- | --- |
| `npm run build`（nonce 実験・SRI 実験・ベースライン） | **PASS**（いずれも EXIT=0） |
| SSR HTML のヘッダ／スクリプト実測 | **PASS**（本文の全数値は実測値） |
| ブラウザ実機での 3 画面動作確認 | **NOT RUN** |
| CI による CSP 回帰検知 | **不可（ギャップ）** |

- ブラウザ実機検証が **NOT RUN** の理由: 当該開発機では chrome-devtools が
  `Protocol error (Target.setDiscoverTargets): Target closed`、playwright が
  `process did exit: signal=SIGTRAP` で起動できない（既知の環境制約）。
- CI についても、E2E spec は 13 本存在するが **CSP ヘッダを検証するテストが 0 本、
  console エラーを検査するテストが 0 本**である。したがって CSP を変更しても、
  静的ページが白画面化する類の回帰を CI は自動検出できない。
  これは CSP 変更を安全に行うための前提が未整備であることを意味する（§6 の解除条件 4）。

**本裁定では CSP を一切変更していない。許可ホストの追加も緩和もゼロである。**

## 6. 実装しなかった選択肢と、その理由

| 案 | 内容 | 見送り理由 |
| --- | --- | --- |
| A' | 静的 7 ページを `connection()` 等で動的化し、全面 nonce 化 | 変更対象が `middleware.ts` + `AuditLogPanel.tsx` + 静的ページ 7 本 ≈ **実装ファイル 9 個**となり、本タスクの停止条件（`next.config.ts` 以外で 5 ファイル超）を超過。加えて Workers 上でのエッジ静的配信を失い、レイテンシと Worker 実行コストが増える。**CTO 判断が必要** |
| B' | ビルド後に静的 HTML の inline script を走査して sha256 を CSP へ注入するパイプライン | `scripts/` および `package.json` の変更が必要。両者は backend / CTO 所有のため、frontend 単独では実施不可 |
| C' | 動的ルート 9 本だけ nonce 化し、静的 8 本は `'unsafe-inline'` を残す（実装 1 ファイルで収まる） | **セキュリティ上の理由で却下。** same-origin である以上、弱いポリシーが残る 8 ルートのいずれかで XSS が成立すれば、cookie・localStorage の読み出しや API 呼び出しを通じて**オリジン全体が侵害される**。ルート単位の部分適用ではオリジンを保護できず、構成の複雑さと将来の踏み外し（新規ページを弱い側へ追加してしまう）に見合わない |

## 7. 再評価・解除の条件

次のいずれかが成立した時点で本裁定を再評価する。

1. Next.js が inline script のハッシュをビルド時に出力し CSP へ供給する機構を提供する
   （`experimental.sri` の inline 対応、または同等機能）
2. 静的 7 ページの動的化について CTO 承認が得られ、Workers 上での静的配信喪失
   （レイテンシ・実行コスト）が許容範囲と判断される
3. ビルド後ハッシュ注入パイプラインを `scripts/` へ追加する承認が得られる
4. CI に **CSP ヘッダ検証**と **console エラー検査**を含む E2E が追加され、
   ブラウザ実機検証の代替手段が成立する（`tests/` は QA 所有のため QA タスクとして起票が必要）
5. Next.js が PPR + nonce の組み合わせに対応する

なお解除時には、**`worker-src 'self'` の明示追加**（§2-5）と
**`AuditLogPanel.tsx` の blob inline script の除去**（§1-3）が併せて必要になる。
