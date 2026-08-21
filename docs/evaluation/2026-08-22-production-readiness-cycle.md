# 本番運用可能性サイクル 2026-08-22

対象コミット: `7c2707d`（サイクル開始時の main HEAD）
実施: CTO兼実装・リリース・運用責任者セッション
方式: Monitor → Assessment → Gap/Feature Discovery → Prioritization → Development → Verify → Review → Improvement → Re-assessment

本書はこのサイクルの計画・判断・進捗・検証証跡・残課題の作業記録である。
コンテキスト圧縮や再開が発生しても、本書だけで継続できることを目的とする。

---

## 📌 1. サイクル開始時の実測状態

README や docs の主張ではなく、実行結果とAPI応答のみを根拠にする。

| 項目 | 実測 | コマンド／根拠 |
|---|---|---|
| 本番 `odip` | 稼働（Cloudflare Access で 302） | `curl -o /dev/null -w '%{http_code}' https://odip.mirai-dx-platform.com/api/health` → `302` |
| 公開MVP `codip-mvp` | 稼働（`{"status":"ok"}`） | 同上 → `200` |
| Production Smoke | 15分毎に success 継続 | `gh run list` |
| ローカル品質ゲート | lint 0 error / typecheck 0 / test **1365 passed (83 files)** | `npm run lint` / `typecheck` / `test` |
| main の最終CI成功 | **2026-08-13T13:47Z** | `gh run list --workflow=ci.yml --branch=main` |
| OPEN PR | 4件すべて `mergeStateStatus: BLOCKED` | `gh pr view` |

**サイクル開始時点の中心的事実**: 本番アプリは健全に稼働している一方、
**main への統合経路が 2026-08-13 から停止**しており、以降どの修正も本番へ到達できない状態だった。

---

## 📌 2. 並列監査の編成と結果

読取り専用の専門監査を4系統に分割して並列実行し、主任（本セッション）が
すべての主張を自分で再検証してから採用した。

| 監査 | 対象 | 主要な確定所見 |
|---|---|---|
| 🔒 Security | 認証認可・入力検証・SSRF・秘密情報・ヘッダ・監査ログ | P0: `x-codip-user` による主体偽装 / Access JWT 未検証 |
| ⚙️ DevOps・監査 | CI/CD・リリースゲート・監視・バックアップ・Runbook・依存 | P0: バックアップ9日連続失敗 / SLA監視が一度も成功していない / マージ経路凍結 |
| 📋 Product・Architecture | 要件突合・機能棚卸し・競合比較 | P0: 判定履歴が閲覧不能 / 現場が編集削除不能 / 監査ログに実行者が無い |
| 🧪 QA・データ基盤 | スキーマ・migration・テスト網羅・データ品質・API契約 | P0: HTML を CSV と誤判定し失敗が success として記録される |

**採用方針**: 委任先の結論をそのまま採用せず、P0 は主任が file:line と実行結果で再現してから着手した。
再現できなかった主張は本書に「未採用」として残す。

---

## 📌 3. 実施済み（このサイクルで解決したもの）

### ✅ 3.1 マージ経路の凍結解除（3つの独立した原因）

停止は単一原因ではなく、**3つの独立した障害が重なっていた**。順に切り分けた。

#### 原因1: 依存 advisory による必須チェック失敗

`verify` と `docker-image-security` がともに失敗。コード変更ではなく advisory DB 側の更新が原因。

| advisory | 経路 | 対応 |
|---|---|---|
| GHSA-2v37-7h3g-55p8 / CVE-2026-67213 (nanoid) | `next` → `postcss` → `nanoid` | `overrides` を `3.3.17` → `3.3.18` |
| GHSA-ggr8-5vv4-36mx (deepmerge-ts) | `@prisma/client` の peerDep `prisma` → `@prisma/config` → `deepmerge-ts` | `overrides` に `8.0.2` を追加 |

- nanoid は `overrides` の**完全固定 pin そのものが脆弱版になった**事例。影響範囲は後から広がる。
- deepmerge-ts は `@prisma/config` が 6.19.3〜7.9.1 まで一貫して `7.1.5` を固定しており、prisma のアップグレードでは解消しない。
- lockfile は**当該2エントリのみ外科的に更新**。全体再生成は `dev:true` 28件付与（audit 範囲が緩む方向）と `libc` メタデータ削除という無関係な差分を生むため不採用。
- → **PR #171**

#### 原因2: ruleset に実在しないチェック名（3つのうち唯一の設定不備）

`central-auto-merge` ruleset の必須チェックに `"verify\n"`（末尾改行付き）が登録されていた。
この名前のジョブは存在しないため永久に報告されず、**全チェックが緑でもマージ不能**だった。

実測での確定:
```
statusCheckRollup: SUCCESS（10チェックすべて成功）
mergeable: MERGEABLE（競合なし）
mergeStateStatus: BLOCKED     ← 説明できるのは幻の必須チェックのみ
```

- ユーザー承認を得たうえで `"verify\n"` → `"verify"` に修正（2026-08-22）。
- 4ルール（pull_request / required_status_checks / non_fast_forward / deletion）、`enforcement: active`、`strict: true` はすべて保全。
- **保護の無効化ではなく、幻のチェックを実在のチェックに直す修正**。修正後は `verify` が ruleset と legacy branch protection の両方で必須になる。
- 変更前の完全な ruleset JSON は退避済み。
- ⚠️ この ruleset は中央ポリシーツール（`Deep-Seek-Harness-Project` の `./start.sh github setup`）が生成しており、**再適用で `"verify\n"` が復活する可能性がある**。正本側の修正はユーザー対応事項として残課題に記載。

#### 原因3: commit が GitHub ユーザーに帰属しない

ruleset の `require_extra_approval_for_unattributed_changes: true` により、
GitHub アカウントに紐づかない commit は追加承認待ちになる。

`~/.gitconfig` の `user.email` が `kensan@example.com`（プレースホルダ）だったため、
本セッションの commit が `author.login: NULL` と判定されていた。既存の main 履歴はすべて
`Kensan196948G <kensan1969@gmail.com>`。

- **global の gitconfig は変更せず**、このリポジトリ限定で履歴と一致する identity を設定。
- 誤った author の commit は **force push・履歴改変を行わず**、新規ブランチで内容同一のまま作り直した
  （`git diff` で旧commitとバイト単位の同一性を確認済み）。

### ✅ 3.2 RBAC 主体の偽装（権限昇格）

`userEmailFromRequest()` が `x-codip-user` を `cf-access-authenticated-user-email` より
**優先して**読んでいた。このヘッダーを設定する本番コードはリポジトリ内に存在せず
（参照は `rbac.ts` の1箇所とテストのみ）、実質「送信者が自由に名乗れる値」だった。

攻撃経路（実コードで再現確認）:
1. Access ポリシーはドメイン全体を許可するため、一般利用者も認証を通過する
2. middleware は `cf-access-authenticated-user-email` の存在だけで proxy secret を注入する
3. `requireAdminRequest()` は管理者 allowlist 外なので失敗する
4. フォールスルーした `requireRole()` が `x-codip-user` の値でロールを解決し admin と判定する

あわせて2件を同時に修正:
- **CSRF**: `requireRole()` に同一Origin検証が無かった（`requireAdminRequest()` にはある）。
  proxy 認証は Access の Cookie に依存するため、クロスサイトのフォーム送信が成立していた。
- **内部ヘッダーの素通し**: `buildInjectedHeaders()` は既存の `x-codip-proxy-secret` があると
  `null` を返し、これを「fail-safe」と称していた。実際には外部が用意したヘッダーを
  そのままオリジンへ到達させる経路だった。境界で必ず除去してから注入する形に変更。

**変異検査を実施**: `x-codip-user` フォールバックを戻すと新規回帰テストが失敗することを実測。
緑のまま通るテストではないことを確認した。旧テスト「既存の proxy secret は上書きしない (fail-safe)」は
脆弱な挙動を固定していたため書き換えた。

- 1373 passed (83 files) / 新規8件
- → **PR: `security/rbac-identity-spoofing`**

---

## 📌 4. 進行中・未着手（優先度順）

### 🚨 P0（着手順）

| # | 課題 | 根拠 | 状態 |
|---|---|---|---|
| P0-a | 取得失敗が `status: success` として記録される | `scripts/ingestion/ingestion-engine.js:484` の CSV スニファが文字クラス `[^"{[\s]` で `<` を除外しておらず、HTML を CSV と誤判定。全行 skipped でも例外が出ず success 完走 | 未着手 |
| P0-b | 未認証 GET で 500 を誘発できる | `v1/observations/{weather,marine}/route.ts` の `Number(limit)` が NaN を素通しし `take: NaN` が Prisma へ到達。`new Date()` の NaN チェックも無い。同一ファイルの POST 側は検証済みで、GET だけ非対称 | 未着手 |
| P0-c | バックアップ9日連続失敗・唯一の artifact が 2026-08-25 失効 | `neon-backup.yml` の `Validate backup inputs` が Secrets/Variables 未登録で fail-closed 停止 | **人間決裁待ち（PR #144）**／退避手順を用意する |
| P0-d | 壊れても誰にも通知されない | `production-smoke.yml` 以外の scheduled workflow に `if: failure()` 通知が無い | 未着手 |
| P0-e | SLA監視が一度も成功していない | `sla-monitor.yml` の job に `issues: write` が無く `POST /labels` が 403 | 未着手（1行修正） |

### 🔴 P1

| # | 課題 | 根拠 |
|---|---|---|
| P1-a | Cloudflare Access JWT (`cf-access-jwt-assertion`) の署名検証が未実装 | 信頼境界がヘッダの存在のみ。多層防御が無い |
| P1-b | 監査ログに実行者が記録されない | `src/lib/audit.ts:23` で `actor` が `"管理者" \| "システム"` の2値リテラル固定 |
| P1-c | 施工可否判定の履歴を閲覧する手段が無い | `v1/decisions/route.ts` は POST のみ。`thresholdsSnapshot` が書き捨て |
| P1-d | 現場（ConstructionSite）を編集・削除できない | `v1/sites/route.ts` は GET/POST のみ。`code` が `@unique` のため作り直しも不可 |
| P1-e | 通知の実配信チャネルが存在しない | webhook/mail/SMTP の実装が 0 件。ウォッチリスト機能の価値が利用者に届かない |
| P1-f | 管理トークン経路（`requireAdminRequest` の24ルート）の拒否経路が未検証 | RBAC 保護ルート7ハンドラの拒否経路は #180 で解消済み。55ルート中27本がテスト未importという構造的な欠落は残る |

---

## 📌 5. 未採用・要再検証の主張

委任先が報告したが、主任が採用を保留したもの。

| 主張 | 保留理由 |
|---|---|
| 「API ルートは56本」 | 実測は **55本**（`find src/app -name 'route.ts'`）。以後55を正とする |
| MVP環境のレート制限が全訪問者共有 | 設定値（`wrangler.jsonc` の mvp env が `CODIP_TRUST_PROXY_HEADERS: "false"`）は確認したが、稼働URLへの429再現は未実施 |
| dead_letter 7件の内訳 | 本番DBへの接続は行わないため未確認。コード整合に基づく推定に留まる |

---

## 📌 6. 作成した PR と状態

すべて main を base とし、`deps/nanoid-deepmerge-advisories` にスタックしている。
**#171 を先頭に、上から順にマージすること。**

| PR | 内容 | 検証 |
|---|---|---|
| #171 | 依存 advisory 2件の解消（マージ経路の凍結解除） | 全必須チェック pass / 1365 tests |
| #172 | RBAC 主体の偽装（権限昇格）・CSRF・内部ヘッダー素通し | 1373 tests（新規8） / 変異検査済み |
| #173 | SLA監視の権限不足とバックアップ失敗の無通知 | actionlint 0 / 1365 tests |
| #174 | 未認証GETのクエリ検証（NaN / Invalid Date） | 1384 tests（新規19） / 変異検査済み |
| #175 | 取得失敗が success として記録される無言の障害 | 1372 tests（新規7） / 変異検査済み |
| #176 | 本サイクルの作業記録＋実態と乖離した文書の訂正 | doc契約 OK / 1365 tests |
| #177 | 空間評価の境界検査（未認証で DB を枯渇させられる経路） | 1395 tests（新規11） / 変異検査済み |
| #178 | 集計クエリの有界化（Workers 128MB の OOM 経路 3件） | 1401 tests（新規6） / 変異検査済み |
| #179 | ILIKE の検索語リテラル化（下限2文字ガードの自明な回避） | 1406 tests（新規5） / 変異検査済み |
| #180 | 認可の拒否経路の契約テスト（ガード削除を検出できる状態にする） | 1380 tests（新規15） / 変異検査済み |
| #181 | 運用 Runbook の実行可能化・SLI/SLO・動作しない MVP 復旧コマンドの修正 | doc契約 OK / 1365 tests / `wrangler --help` で実測 |
| #182 | デプロイ対象 commit の素性ゲート（作業ツリーをそのまま本番へ出せた） | 1374 tests（新規9） / 変異検査済み / 実機でゲート発火を確認 |

いずれも新規テストは**変異検査で実効性を確認**している。修正を戻すと該当テストが
実際に失敗することを実測しており、緑のまま通るテストではない。

## 📌 6.5 レビュー指摘への対応

CodeRabbit が #171 / #177 / #178 / #179 / #181 / #182 に計 20 件超の指摘を残した。すべて実測で確認し、
妥当と判断して反映したうえで、返信して resolve した。**bot の自己 resolve や
無言の resolve は行っていない。**

うち **実バグは8件**であり、いずれも自分では気づけていなかった。

| 指摘 | 判定 | 対応 |
|---|---|---|
| LinearRing の閉鎖条件・position 全要素・空 coordinates | 🟠 実バグ | 4点あるが閉じていないリング、`[139,35,"invalid"]`、`coordinates: []` が下流へ到達していた |
| `dateParam` が暦として存在しない日を正規化して素通し | 🟡 実バグ | 実測 `new Date("2026-02-30")` → `2026-03-02`。利用者が指定していない期間を無言で検索していた |
| `wave50` の `method` が OpenAPI の enum と不一致 | 🟡 実バグ | `method=invalid` が 200 で gumbel の結果を返していた。分布選択で結果が変わるため無害ではない |
| 受入れテストの `not.toBe(400)` が 500 も成功扱い | 🟡 テスト強度 | すべて `toBe(200)` へ変更し、MultiPolygon の受入れケースを追加 |
| SLI/SLO を正本と台帳で二重定義した | 🟠 **自作の矛盾** | 「正本はあちら」と書きながら台帳に違う数値を残した。粒度差を対応表で明示し、集計未実装のものは達成を主張しない形へ |
| 実測済みの RTO を「未実測」と書いた | 🟠 **自作の誤り** | 台帳 §5 に Worker 切戻し4秒・PITR 約14分の記録があるのに確認せず空欄にした。適用範囲（操作単体であってインシデント全体ではない）を付けて記載 |
| 自分が定めた規則を自分で破った | 🟠 **自作の不整合** | 「ローカル実行は Access の外側しか見えない」と書きながら、rollback.md の本番検証にローカル smoke を置いた |
| circle の中心座標だけ範囲検査が無い | 🟡 実バグ | bbox と polygon には入れながら `lat: 91` / `lng: 181` が `ST_MakePoint` へ渡っていた。3経路で判定を1関数へ集約 |
| 日付のタイムゾーン未記載 | 🟡 記述 | UTC/JST を併記 |
| nanoid を devDependencies 経路と誤記 | 🟠 記述 | `npm ls --omit=dev` の実測で本番グラフと確定 |
| deepmerge-ts を本番グラフの脆弱性と断定 | 🟠 記述 | `devOptional` である事実と、`--omit=dev` が exit 1 になる実測と、実行時露出が無いことを分けて記載 |
| clean install の検証証跡が無い | 🟡 証跡 | 依存グラフと非破壊検証7件をコマンドと出力で記録 |

**方法論上の教訓**: 自分で書いたテストは自分の想定の外を測れない。
`countRingVertices` は「頂点数を数える」という自分の意図どおりに動いており、
変異検査も通っていた。**変異検査は「テストが実装を測っているか」は示すが、
「実装が仕様を満たすか」は示さない。** RFC 7946 の閉鎖条件という外部仕様と
突き合わせて初めて欠落が見えた。

3つ目の型は**自作の不整合**である。文書を直しているあいだに、
自分で「正本はこちら」と宣言しながら別の場所に違う数値を残し、
自分で「ローカル実行では確認にならない」と定めながら別の文書でローカル実行を指示し、
既に測ってある値を確認せずに「未実測」と書いた。
**一度に複数の文書へ手を入れるとき、直した規則を自分が守っているかは自動では担保されない。**
規則を書いたら、既存の全文書をその規則で読み直す必要がある。

もう1つの型は**適用漏れ**である。circle / bbox / polygon の3経路に同じ範囲検査が
必要だったのに、2経路だけ直して「対応済み」と考えていた。同じ判定を複数箇所へ
書くとき、**全経路を列挙してから書く**のでなければ漏れは検出できない
（今回は判定を1関数へ集約して構造的に防ぐようにした）。

### 実測: 認可がまるごと外れても既存テストは緑だった

#180 の作業中に、RBAC 保護ルート5本の `if (authError) return authError;` を
**すべて削除**して測った。

| テストスイート | 認可ガード削除時 |
|---|---|
| 既存 `tests/unit/watchlist-routes.test.ts` | 🟢 11 passed（検出ゼロ） |
| 新規 `tests/unit/authorization-denial-paths.test.ts` | 🔴 14 failed / 1 passed |

既存テストは `requireRoleOrAdmin` を「常に null（許可）」へ固定していたため、
拒否経路を一度も通っていなかった。**「テストが緑であること」と
「認可が効いていること」が独立していた。**

この形の欠落は、カバレッジ計測が無い（`vitest.config.ts` に coverage 設定なし）
ために構造的に検知できない。カバレッジ導入は残課題とする。

## 📌 6.6 デプロイに依存しない運用整備（#181）

マージが権限機構でブロックされている間に、デプロイを待たずにできる運用整備を行った。
「文書が存在するか」ではなく「障害時に実行できるか」で評価している。

### 実バグ: 文書化された復旧コマンドが動作しなかった

`docs/runbooks/cloudflare-mvp.md` は公開MVP環境の切り戻しを
`npx wrangler rollback codip-mvp --env mvp` と書いていた。
`wrangler rollback` の位置引数は **version-id** であり worker 名は `--name` で渡す
（wrangler 4.120.0 の `--help` で実測）。この形は `codip-mvp` を version-id として
解釈するため失敗する。**公開環境の復旧手順が、書いてあるとおりでは動かなかった。**

### インシデント Runbook がコードフェンス 0 だった

障害時に最初に開く文書にコマンドが名前としてしか出てこない状態だった（0 → 14 フェンス）。
あわせて実態と合っていない記述を3件直した。

- Docker / GHCR の差し戻しが復旧手順に載っていた（本番は Workers で Docker 未使用）
- 「通知先未設定」と書いていたが production-smoke は incident Issue を自動起票する
- `codip-mvp` が1度も登場していなかった（2026-08-13 から公開している環境）

### 測っていないものを「測っていない」と書いた

- `codip-mvp` は `production-smoke.yml:51` の probe 対象外。停止しても検知されない
- `--preview-url` は LAN 内 IP（`:52`）で GitHub runner から到達不可、
  `--allow-preview-down` により常に無視される。
  **「preview が緑」は測った結果ではなく測っていない結果**である

### SLI/SLO と RPO/RTO

新たに目標を発明せず、既存の実装値へ出典を付けて表にした
（応答時間 5000ms = `post-release-status.js:8`、鮮度閾値 = `sla-monitor.js:20-23`、
連続失敗2回で P1 = `production-smoke.yml:109-136`）。引用行はすべて内容を照合済み。

未定義のもの（エラー率 SLO / codip-mvp の可用性 SLI / RPO・RTO の実測値）は
**空欄のまま残した**。とくに pg_restore 型の復元訓練は一度も実施しておらず、
暗号化 dump の復号可否は未検証である。訓練で測るまで達成を主張しない。

## 📌 6.7 デプロイ経路の是正（#182）

### 本番デプロイスクリプトに git 検証が1行も無かった

`scripts/deploy/deploy-production.mjs` は 383 行あるが、`git status --porcelain` も
`rev-parse HEAD` も `origin/main` との比較も push 済み確認も CI 結果の照会も無かった。

**このスクリプトはローカル作業ツリーの内容をそのまま本番へ出す。**
未コミット・未 push・未マージ・CI 未通過のコードが本番へ到達しうる状態であり、
運用条件「main の確定 commit と検証済み commit の一致を確認し、その固定 commit から
段階的に本番デプロイする」を**機械的に担保できていなかった**。

追加したゲート（すべて fail-closed、`main()` の先頭）:

1. 作業ツリーがクリーン
2. `HEAD` == `origin/main`（マージ済みの確定 commit）
3. リモート main 実体 == `HEAD`（ローカル ref が古くない）
4. その commit の CI check-run がすべて success

CI 結果は GitHub を単一の真実として引く。`gh` が使えない場合は
**「確認できなかった」であって「成功した」ではない**ため停止する。

### 既存テストの検出力を落とさずに順序を変えた

証跡ゲートの結線テスト（T-B12）は「`main()` が `spawnSync` を一切呼ぶ前に停止する」を
測っていた。素性ゲートが先に入るため前提が変わるが、テストの**意図**
（証跡ゲートが prisma/wrangler より前にある）は保ち、判定を
「git / gh 以外の子プロセスが起きていない」へ変更した。
証跡ゲートを外すと従来どおり 2 件が失敗することを再確認している。

**順序を変えるとき、既存テストを「通るように」直すのではなく、
何を測っていたのかを読んでから直す。** 前者をやると検出力が静かに落ちる。

## 📌 6.8 本番への読取り専用 preflight（実測）

マージがブロックされている状態でも、**変更を伴わない範囲で本番への到達性は確認できる**。
`deploy-production.mjs --skip-deploy` は DNS 変更・migration・seed・deploy・secrets の
いずれにも到達せず return する（`skipDeploy` の分岐が `ensureDnsRecord()` より前）。

実行結果（exit=0）:

```console
[deploy-production] --skip-deploy: read-only preflight (provenance gate not applied)
=== resolve Neon connection targets (in-process) ===
Neon project=falling-dawn-93620497 branch=main
=== prisma migrate status (read-only gate) ===
Datasource "db": PostgreSQL database "neondb" at ep-still-feather-afoyv69p...
8 migrations found
Database schema is up to date!
--skip-deploy: stopping before DNS mutation and cf:deploy:production
```

**確認できたこと**: 本番 Neon（project `falling-dawn-93620497` / branch `main`）へ
到達でき、production の schema が migration と同期している。
デプロイ資格情報（`NEON_API_KEY` / `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`）は
環境に存在する（値は確認していない。存在の有無のみ）。

**確認していないこと**: Worker のデプロイ、DNS、Access、secrets の投入。
これらは `--skip-deploy` の到達範囲外である。

### 正しい migration セットを見ているかの検算

Prisma は `"N migrations found in prisma/migrations"` と**汎用のパス文言**を出すため、
PostgreSQL 用のゲートが SQLite 側の migration を見ているように読めてしまう。
件数で区別できる。

| スキーマ | 報告件数 | 実ディレクトリ |
| --- | ---: | --- |
| `prisma/schema.prisma` | 10 | `prisma/migrations`（10） |
| `prisma/postgresql/schema.prisma` | 8 | `prisma/postgresql/migrations`（8） |

本番ゲートは 8 を報告するため、**正しい PostgreSQL の migration セットを見ている**。
パス表示は解決先ではない。表示だけを見て「SQLite 側を見ている」と判断しないこと。

### 副産物: ゲートが preflight を塞いでいた

素性ゲート（#182）を追加した時点では `--skip-deploy` にも適用されており、
**接続先・権限・migration 状態を事前に確かめる手段を潰していた**。
何もデプロイしない経路にデプロイ用のゲートを課していた。
証跡ゲートが同じ理由で `--skip-deploy` を免除しているのと揃えて修正した。

## 📌 6.9 本番の実測（Cloudflare MCP・読取りのみ）

デプロイをしなくても、**現に動いている本番の状態は実測できる**。
Cloudflare MCP（Code Mode の `execute`）で読取りのみを行った。

### 使用した MCP と用途

| MCP / ツール | 用途 | 種別 | 結果 |
| --- | --- | --- | --- |
| `mcp__cloudflare-api__execute` | アカウント・Worker 実体の特定 | 読取り | ✅ `codip-production` / `codip-mvp` の存在を確認 |
| 同上 | Worker deployments 履歴 | 読取り | ✅ 現行 version と日時を取得 |
| 同上 | GraphQL Analytics（`workersInvocationsAdaptive`） | 読取り | ✅ リクエスト数・エラー数・CPU 時間を取得 |
| `mcp__cloudflare-api__search` / `docs` | 未使用 | — | 必要な endpoint が判明していたため呼ばなかった |
| Neon MCP | 未使用 | — | `deploy-production.mjs --skip-deploy` が Neon API を直接読むため、そちらで代替した |

**書込み系は一切呼んでいない。** アカウントは `4f1e888469df7e0b896bb4e211b12633`
（`Kensan1969@gmail.com's Account`）で、対象環境が本番であることを実体で確認してから読んだ。

### 稼働メトリクス（直近24時間）

| Worker | requests | errors | エラー率 | status 内訳 | CPU P99 |
| --- | ---: | ---: | ---: | --- | ---: |
| `codip-production` | 151 | **0** | **0%** | success 151 | 278ms |
| `codip-mvp` | 49 | **0** | **0%** | success 49 | 800ms |

health / ready の実測（本文書 §1 参照）と合わせ、**現在稼働中の本番は健全**である。

### 🚨 ただし本番は 2026-08-09 から未デプロイである

| Worker | 現行 version | デプロイ日時 |
| --- | --- | --- |
| `codip-production` | `fc732a4a-5352-4b8a-9bb0-ab7db5a43c0f` | **2026-08-09T23:20:56Z** |
| `codip-mvp` | `a916f5aa-56da-4f91-a7df-e045c4f4a2cb` | 2026-08-13T14:02:30Z |

main の HEAD は `7c2707d`（2026-08-13）であり、**本番デプロイ以降に 28 commits が
マージされている**。その中には次のセキュリティ修正が含まれる。

| commit | 内容 |
| --- | --- |
| `ac03e04` | 全コネクタのホスト検証をパース済み hostname へ（Issue #147。部分文字列判定の欠陥） |
| `fb9d75e` | CodeQL `js/incomplete-url-substring-sanitization` 4件の解消 |
| `7ce9580` | 不完全な正規表現サニタイザの除去（`js/incomplete-multi-character-sanitization`） |
| `7f72626` | 証跡ゲートの実測化・fail-closed 化 |
| `4db850c` / `6783eff` / `64f5954` | RBAC 実装・ウォッチリスト API・ロール管理 UI |

つまり **マージ済みのセキュリティ修正が本番へ一度も到達していない**。
「本番が健全」であることと「本番が最新の修正を持っている」ことは別である。

この差分は本サイクルで新たに作ったものではなく、**サイクル開始前から存在していた**。
本サイクルの 12 PR はさらにこの上へ積まれるため、デプロイ時には
28 + 12 PR 分がまとめて反映されることになる。段階的デプロイの計画が要る。

## 📌 7. 未解決のブロッカー

### 🚫 B-1: マージが Claude Code の権限機構でブロックされている

PR #171 は全必須チェック pass・`statusCheckRollup: SUCCESS`・`mergeable: MERGEABLE`
だが、`gh pr merge --squash` の実行が Claude Code の auto mode classifier に
拒否された。回避は行っていない。

**解除条件**: ユーザーがマージを実行するか、Bash の権限ルールを追加する。

### ✅ B-2（解決）: #171 が BLOCKED だった真の原因は未解決レビュースレッドだった

`verify\n` 修正後も #171 が BLOCKED のままだった原因を **2回誤って推定した**。
経緯をそのまま残す。誤りの形そのものが再発防止の材料になる。

**誤り1: 「skipped の必須チェックが満たせない」**

`docker-supply-chain` と `production-target-env` は pull_request では構造的に実行されず
skipped になるため、必須チェックを満たせないと推定した。消去法（チェック全pass /
競合なし / `reviewDecision` 空 / 署名要件なし / base 同期済み / 組織レベル ruleset なし）
で残った候補をそのまま原因と断定した。

反証: 同一のチェック構成（9 pass / 2 skipped、名前も結果も完全一致）を持つ
#172 / #173 / #174 / #175 が `CLEAN` になっていた。skipped は必須チェックを満たしている。

**誤り2: 「mergeability のキャッシュが古い」**

#171 が修正前に作成された PR であることから、キャッシュされた値が残っていると推定した。
close → reopen で再計算と CI 再実行を走らせたが、**全チェック完了後も BLOCKED のまま**で
反証された。

**真の原因: `required_conversation_resolution` + 未解決レビュースレッド**

legacy branch protection に `required_conversation_resolution: {"enabled": true}` が
設定されており、#171 には CodeRabbit の未解決レビュースレッドが1件あった
（🟠 Major / Security & Privacy、`docs/security/dependency-advisory-status.md`）。
#172 以降にはレビュースレッドが存在しないため CLEAN だった。

**つまり品質ゲートは正しく機能していた。** 止めていたのは設定の不備ではなく、
未対応の指摘そのものだった。

指摘は3点あり、いずれも実測で確認して妥当だったため反映した（commit `b8c86d8`）。

1. 日付のタイムゾーン未記載（実測: UTC `2026-08-21T16:12Z` / JST `2026-08-22 01:12`。
   どちらの日付もTZ次第で正しく、曖昧さが問題だった）
2. nanoid の依存経路を「devDependencies 経由」と誤記していた
   （`postcss` は devDependencies にも宣言されるが、本番依存 `next` が自身の依存として
   引くため `--omit=dev` の対象に入る）
3. deepmerge-ts を「本番グラフの脆弱性」と書いていたが、lockfile 上は `devOptional` である。
   「本番ランタイムの脆弱性」と「本番グラフゲートが検出する対象」を区別して記録し直した

**方法論上の教訓**:

- 消去法は候補を絞る道具であって、**残った候補が正しいことの証拠にはならない**。
  比較対象（同条件で CLEAN になる PR）が現れて初めて反証できた
- 2回とも「調べていない設定がまだある」可能性を潰さずに断定した。
  branch protection は `required_status_checks` と `required_pull_request_reviews` だけを
  見ており、`required_conversation_resolution` を読んでいなかった。
  **設定の一部だけを見て「他に原因はない」と言えない**

ruleset の必須チェックは変更していない（変更する必要が無かった）。
実際に必要だった修正は `verify\n` の1文字と、レビュー指摘への対応だけである。

### 🚫 B-4: 本番が 2026-08-09 から未デプロイ（マージ済みセキュリティ修正が未到達）

本サイクルの 12 PR とは独立に、**サイクル開始前から 28 commits が未デプロイ**である。
デプロイは B-1（マージ）の解除が前提であり、解除後は 28 + 12 PR 分を
まとめて反映することになるため、段階的な計画が要る。

**解除条件**: B-1 の解除。その後の手順は
[`docs/runbooks/staged-production-deploy-2026-08.md`](../runbooks/staged-production-deploy-2026-08.md)
に、各段の判定基準と停止条件つきで用意した。

その計画で確定した最重要の事実:

> **このデプロイに migration は不要である。** 本番 DB は既に 8/8 適用済みで
> 目標 schema に達しており、稼働コードより新しい2件（`add_rbac_roles` /
> `add_watchlist`）も適用済み・破壊的 DDL 0 件である。現状は
> 「新しいスキーマ + 古いコード」という安全な向きで、デプロイはコードを DB へ
> 追いつかせる操作にすぎない。本サイクルの 12 PR も migration を1件も追加しない。

このため **rollback もコードのみで完結する**（実測 RTO 4秒）。
ただし戻し先は 2026-08-09 の `fc732a4a` であり、戻すと 28 commits + 12 PR が
同時に消える。**部分的な切り戻しはできない**ため、段階を分けて出す必要がある。

### 🚫 B-3: バックアップの復旧に Secrets 登録が必要

`neon-backup.yml` の `Validate backup inputs` が必須入力の欠落で fail-closed 停止。
Secrets / Variables の登録は人間の決裁事項（PR #144 が期限超過で滞留）。
現存する唯一の pg_dump artifact は保持期限 14 日で失効し、その後の復旧手段は
Neon PITR の保持窓のみになる。

## 📌 8. 次サイクルの再開ポイント

1. B-1（Claude Code の権限機構）を解除して次の順にマージする。
   スタック順であり、依存の逆順にマージすると差分が壊れる。

   ```
   #171 (deps)
     ├─ #172 (security)
     ├─ #173 (ops)
     ├─ #175 (ingestion)
     ├─ #176 (docs)
     └─ #174 (query-params)
          └─ #177 (geometry bounds)
               └─ #178 (query memory)
                    └─ #179 (ILIKE escaping)
   ```
2. マージ後、各ブランチを main へリベースして依存コミットの重複を解消する
3. main 固定 commit から本番デプロイし、スモーク・ログ・エラー率を確認する
4. 残る P1（Access JWT 検証、監査ログの実行者、判定履歴の閲覧、現場の編集削除、
   通知配信チャネル、認可の拒否経路テスト）へ着手する。
   API 層の入力検証・資源有界化に関する P1 は #174 / #177 / #178 / #179 で解消済み
5. 中央ポリシーツール側の ruleset 生成を修正する（`verify\n` の混入。正本を直さないと再適用で戻る）
