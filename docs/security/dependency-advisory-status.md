# 依存advisory対応状況

最終更新: 2026-08-11

`npm audit` が検出する advisory の対応状況と、allowlist に残す判断の根拠を記録する。
CI ゲートの実体は次の2段構成であり、本ドキュメントはその判断材料を提供する。

| ゲート | コマンド | allowlist | 方針 |
| --- | --- | --- | --- |
| 本番グラフ | `npm audit --audit-level=moderate --omit=dev` (`.github/workflows/ci.yml`) | 参照しない | ゼロ寛容。moderate以上を1件も許容しない |
| 全グラフ | `node scripts/tools/check-dependency-audit.js` | 参照する | moderate以上は allowlist 記載＋期限内のみ通過 |

allowlist は `scripts/tools/check-dependency-audit.js` の `ALLOWLIST` が唯一の正本である。
期限切れエントリは、対象 advisory が検出されていなくてもゲートを FAIL させる（受容が無期限に生き延びないため）。

## 現況サマリ (2026-08-11 時点)

| 項目 | 結果 |
| --- | --- |
| 本番グラフ (`--omit=dev`) | 脆弱性 0 件 |
| 全グラフ (dev込み) | 脆弱性 0 件 |
| 有効な allowlist エントリ | 1件 (GHSA-mh99-v99m-4gvg) |

## 解消済み advisory

### GHSA-5p4m-2wfm-xmqj — js-yaml (Issue #108)

- 内容: `!!omap` 解決時の Quadratic CPU 消費 (CVE-2026-59870, CVSS 7.5, CWE-407)
- 影響範囲: `js-yaml >=4.0.0 <4.3.1`
- 依存経路: devDependencies (eslint / `@eslint/eslintrc` 経由)
- **対応: allowlist ではなく実アップグレードで解消 (2026-08-11)**
  - 当初 allowlist へ登録した際の理由は「修正が semver-major にしか存在せず現 pin では解消不可」であったが、
    その後 **4.3.1 が patch リリースとして公開**され、前提が失効した。
  - `@eslint/eslintrc` の要求は `js-yaml ^4.1.0` のため、4.3.1 は既存 range 内。
    `package-lock.json` の当該エントリのみを 4.3.1 へ更新し、`package.json` は変更していない。
  - `npm ci` で再現性を確認済み（全グラフ 0 件）。
- allowlist エントリは削除済み。再燃した場合は `unallowlisted` として即 FAIL させる意図であり、
  退役エントリを「念のため」残すことはしない（残置は検知能力を落とすため）。

### GHSA-2v37-7h3g-55p8 — nanoid (Issue #108)

- 内容: `size=0` の特殊呼び出しでのみ影響。postcss は hash 生成 (size>0) に使用
- 依存経路: devDependencies (postcss 経由)
- 対応: 依存更新により advisory 自体が検出されなくなったため、allowlist エントリを削除 (2026-08-11)

## 有効な allowlist エントリ

### GHSA-mh99-v99m-4gvg — brace-expansion (Issue #82)

| 項目 | 内容 |
| --- | --- |
| severity | high |
| scope | devDependencies (eslint / `@opennextjs` build chain) |
| 本番非同梱の根拠 | lint / build 時ツールチェーンのみ。Cloudflare Worker バンドルへ同梱されない |
| tracking | Issue #82 |
| owner | Kensan196948G |
| 再評価期限 | 2026-09-30 |

補足: 2026-08-11 時点の実測では、インストール済み `brace-expansion` は 1.1.18 / 2.1.4 / 5.0.9 で、
`npm audit` は本 advisory を**検出していない**。エントリは (a) 依存解決の揺り戻しに対する保険、
(b) `tests/unit/dependency-audit-gate.test.ts` がゲート挙動の fixture として参照している、
の2点から期限まで維持する。

## Issue #82: eslint 10 系移行の可否判定

**判定: 保留（今回スコープでは移行しない）**

### 根拠

| 対象 | 現行 | 最新 | 評価 |
| --- | --- | --- | --- |
| `eslint` | ^9.39.5 | 10.8.1 | 10系は安定リリース済み |
| `eslint-config-next` | ^15.5.20 | 16.3.0 | **15.x 安定版の peer は `eslint ^7.23.0 \|\| ^8.0.0 \|\| ^9.0.0`** |
| `next` | ^15.5.22 | 16.3.0 | 15系は backport tag (15.5.23) で保守中 |
| `@opennextjs/cloudflare` | ^1.20.2 | 1.20.2 | 最新に追随済み。対応待ちなし |

1. **eslint 10 単独での移行は不可能。** `eslint-config-next` の 15.x 系は安定版がすべて
   peer に `eslint ^7.23.0 || ^8.0.0 || ^9.0.0` を宣言しており、eslint 10 は range 外。
   15.6.0 系は canary のみで安定版が存在しない。
2. eslint 10 を受け入れるのは `eslint-config-next` 16.x (peer `eslint >=9.0.0`) 以降。
   ただし `eslint-config-next` 16.x は Next 16 系に対応するものであり、採用は **Next 15 → 16 のメジャー移行**とセットになる。
3. **移行の当初動機であった brace-expansion advisory は既に解消している**（上記のとおり現在は未検出）。
   セキュリティ上の緊急性は現時点で存在しない。
4. `@opennextjs/cloudflare` は最新であり、これを理由とする移行制約はない。

### 解除条件（次に再評価する契機）

いずれかが成立した時点で再判定する。

- Next 15 → 16 のメジャー移行を独立した課題として計画・着手するとき
- `eslint-config-next` 15.x 系に eslint 10 を peer 許容する安定版が出たとき
- brace-expansion advisory が再燃し、かつ 15.x 系の依存 range 内に修正版が存在しないとき
- 上記いずれも無いまま **2026-09-30**（allowlist 期限）に到達したとき

### 今回実施しないこと

- `eslint` / `eslint-config-next` / `next` の semver-major 更新
  （Next 16 移行は画面・API・ビルド全体へ影響するため、独立した PR と判断で扱う）

## 参照

- ゲート実装: `scripts/tools/check-dependency-audit.js`
- ゲート挙動テスト: `tests/unit/dependency-audit-gate.test.ts`
- CI 定義: `.github/workflows/ci.yml`
