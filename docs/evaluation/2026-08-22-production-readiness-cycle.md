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
| P1-f | 認可の「拒否される」経路がほぼ未検証 | 55ルート中27本がテスト未import。401/403 を実測しているのは3本のみ |

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

いずれも新規テストは**変異検査で実効性を確認**している。修正を戻すと該当テストが
実際に失敗することを実測しており、緑のまま通るテストではない。

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

### 🚫 B-3: バックアップの復旧に Secrets 登録が必要

`neon-backup.yml` の `Validate backup inputs` が必須入力の欠落で fail-closed 停止。
Secrets / Variables の登録は人間の決裁事項（PR #144 が期限超過で滞留）。
現存する唯一の pg_dump artifact は保持期限 14 日で失効し、その後の復旧手段は
Neon PITR の保持窓のみになる。

## 📌 8. 次サイクルの再開ポイント

1. B-1（Claude Code の権限機構）を解除して #171 → #172 → #173 → #174 → #175 → #176 の順にマージする
2. マージ後、各ブランチを main へリベースして依存コミットの重複を解消する
3. main 固定 commit から本番デプロイし、スモーク・ログ・エラー率を確認する
4. 残る P0/P1（Access JWT 検証、監査ログの実行者、判定履歴の閲覧、現場の編集削除、
   通知配信チャネル、認可の拒否経路テスト）へ着手する
5. 中央ポリシーツール側の ruleset 生成を修正する（`verify\n` の混入。正本を直さないと再適用で戻る）
