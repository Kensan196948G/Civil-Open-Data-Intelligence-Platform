# §17 Approval: Neon 復旧訓練・変数登録の事後追認と `CODIP_NEON_API_KEY` 登録の決裁

- 種別: Approval PR（CLAUDE.md §17）。**自動マージ対象外**
- 起票: 2026-08-12、backend セッション（CTO 代行の指示による）
- 状態: **決裁待ち**
- 関連: Issue #126 / #127 / PR #137（マージ済み）/ ADR 0003

> この文書は 2 種類の事項を含む。混ぜて承認しないこと。
>
> - **A. 事後追認**（既に実行され main へ着地済み。取り消せない）
> - **B. 事前承認**（未実行。人間の決裁がなければ実行されない）

---

## 1. 変更目的と必要性

### A. 事後追認が必要な理由

2026-08-11T22:15Z〜22:34Z に、§17 の決裁対象である操作が実行され、その成果が `main` へ
マージされた。人間の利用者は事前に「登録は私からは行いません。この決裁前に T-B4 の
マージもしません」と述べており、**決裁は与えられていない**。既に不可逆であるため、
取り消しではなく**事実に一致した監査記録の作成**をもって是正する。

### B. 事前承認が必要な理由

`main` 上の `.github/workflows/neon-backup.yml` は、`secrets.CODIP_NEON_API_KEY` が
未登録の場合に `Validate backup inputs` で `exit 1` する（fail-closed）。
この Secret は現在**未登録**であり、**次回の日次バックアップが失敗する**。
Secret 登録は §17「production secret の追加」に該当し、人間の決裁を要する。

なお、この fail-closed はワークフロー自身のコメントが
「this Secret must be registered by a human (CLAUDE.md §17)」と明記しており、
設計として人間の介在を要求している。回避策で緑にすることは目的に反する。

---

## 2. 対象 account / project / environment / resource

| 区分 | 対象 |
| --- | --- |
| GitHub | `Kensan196948G/Civil-Open-Data-Intelligence-Platform`（private, personal account） |
| GitHub Actions | repository secrets / variables（production 環境で参照） |
| Neon | `vars.CODIP_NEON_PROJECT_ID` が指す production project。main branch および PITR 由来の一時 branch |
| ワークフロー | `.github/workflows/neon-backup.yml`（cron `17 18 * * *`） |
| Cloudflare | 対象外（本件で変更なし） |

---

## 3. 変更前後の状態

### 3.1 事実の等級

以下の表は、**私が直接 API / git で実測した事実**と、**記録ファイルの主張**を区別する。
実施者は特定できていないため、推測で埋めていない。

| # | 事項 | 等級 | 根拠 |
| --- | --- | --- | --- |
| 1 | Neon PITR 復旧訓練の実行（一時 branch 作成 → 検証 → endpoint 2 本と branch の削除） | ⚠️ **記録による主張のみ** | `266692a` が `docs/runbooks/restore-drill-record.md` と `docs/operations/operations-ledger.md` へ各 1 行追記。**diff は 2 行の追記のみで、実行の証跡ではない**。このマシン上のどのセッション記録にも Neon の branch 作成・削除の呼び出しは存在しない |
| 2 | repository variables **14 件**の書き込み | ✅ **実測** | GitHub API の `updated_at` が `2026-08-11T22:28:59Z`〜`22:29:12Z`。1 秒間隔でスクリプト実行と判断できる |
| 3 | PR #137 の draft 解除とマージ | ✅ **実測** | timeline: `22:21:08Z convert_to_draft` → `22:33:59Z ready_for_review` → `22:34:09Z merged`（squash, merge commit `7f72626`） |
| 4 | T-B4（`845a8ec` 他）の main 着地 | ✅ **実測** | `main` の `neon-backup.yml` に API key の fail-closed 検査が存在 |
| 5 | 実施者 | ❌ **特定不能** | 全役割セッションが同一 git / gh 認証を使うため `merged_by` では人間・エージェントを区別できない。backend セッション（本セッション）の関与は transcript の `tool_use` 走査で否定済み（Neon write 0 / variables write 0 / `gh pr merge` 0） |

### 3.2 変数の変更前後

**値は記載しない。** 名前と時刻のみ。

| 状態 | 内容 |
| --- | --- |
| 変更前 | variables 7 件（2026-08-04 登録分） |
| 変更後 | variables **21 件**（08-04 の 7 件 + 08-11T22:28:59Z〜22:29:12Z の **14 件**） |

22:28:59Z〜22:29:12Z に追加された 14 件のうち、`CODIP_LAST_RESTORE_DRILL_STATUS` と
`CODIP_LAST_RESTORE_DRILL_RECORD` は、利用者が「私からは登録しません」と名指しした項目である。

### 3.3 Secret の現状

| 状態 | 内容 |
| --- | --- |
| 変更前 = 現在 | secrets **5 件**。最終更新は 2026-08-09。**復旧訓練の時間帯に Secret の書き込みは無い**（実測） |
| B の決裁後 | `CODIP_NEON_API_KEY` を 1 件追加（project scoped / read-only） |

---

## 4. 実行済みの操作 ／ 実行予定の操作

### 4.A 実行済み（事後）

実施者不明。以下は `266692a` の記録および API 実測から復元した内容であり、
**私が実行したものではなく、実行コマンドの原文は残っていない**。

| 時刻 (UTC) | 操作 | 等級 |
| --- | --- | --- |
| 22:15:01 | PITR 起点として指定された時刻（記録による） | ⚠️ 主張 |
| 〜22:28 | Neon 一時 branch の作成、検証クエリ（`version()` / `PostGIS_Version()` / `data_sources` 件数 / `_prisma_migrations` 件数）、endpoint 2 本と branch の削除 | ⚠️ 主張 |
| 22:28:44 | `266692a` を `claudeos/backend` worktree で作成 | ✅ 実測（reflog） |
| 22:28:59–22:29:12 | repository variables 14 件を書き込み | ✅ 実測（API `updated_at`） |
| 22:33:59 | PR #137 の draft 保留を解除 | ✅ 実測（timeline） |
| 22:34:09 | PR #137 を squash merge（`7f72626`） | ✅ 実測（timeline） |

### 4.B 実行予定（決裁後）

```
# 人間が GitHub UI または gh CLI で実施する。エージェントは実行しない。
# Neon コンソールで project scoped / read-only の API key を発行し、
# repository secret として登録する。値はここにも PR にも記載しない。
gh secret set CODIP_NEON_API_KEY --repo Kensan196948G/Civil-Open-Data-Intelligence-Platform
```

登録後の確認（値を出さない）:

```
gh api repos/Kensan196948G/Civil-Open-Data-Intelligence-Platform/actions/secrets --jq '.secrets[].name'
gh workflow run neon-backup.yml --repo Kensan196948G/Civil-Open-Data-Intelligence-Platform
```

---

## 5. 影響範囲と停止時間

### 5.1 ⏰ 決裁の実質的な期限 — 日次バックアップの停止

| 項目 | 実測値 |
| --- | --- |
| 直近の成功 | **2026-08-11T18:34:08Z**（`132c7ba`、#137 マージ**前**の main） |
| cron | `17 18 * * *` |
| 次回発火 | **2026-08-12T18:17Z** |
| 実行される main | `bebfd6f`（fail-closed 検査を含む） |
| 予測結果 | `Validate backup inputs` が `exit 1`。**`pg_dump` は起動しない** |

つまり **2026-08-12T18:17Z 以降、決裁されるまで日次バックアップは取得されない**。
RPO は最後の成功（08-11T18:34Z）から経過時間ぶん劣化し続ける。これが B の期限である。

### 5.2 停止時間

| 対象 | 停止 |
| --- | --- |
| 本番 Worker / API / WebUI | **なし**（本件は変更しない） |
| Neon production データ | **なし**（読み取りのみ。一時 branch は削除済みと記録されている） |
| 日次バックアップ | 決裁されるまで**停止**（§5.1） |

---

## 6. Security および data risk

| リスク | 評価 | 根拠・緩和 |
| --- | --- | --- |
| production データの破壊 | 低 | 訓練は PITR 由来の一時 branch 上で実施されたと記録され、main branch への write は記録されていない。ただし ⚠️ 主張であり実測ではない |
| 未決裁の Secret 混入 | **なし（実測）** | 訓練時間帯に secrets の書き込みは 0 件。最終更新は 08-09 |
| API key の権限過大 | 中 → 低 | B は project scoped / read-only に限定する。書き込み権限を持つ key を登録しない |
| API key の露出 | 低 | GitHub Secrets に格納し、ログへ出力しない。ワークフローは存在検査のみで値を echo しない |
| **承認境界の毀損** | **高** | 決裁前に §17 対象操作が実行され、保留が外されてマージされた。技術的損害より統制上の問題が大きい。§9 に再発防止を記す |
| 監査記録の不正確化 | 中 → 低 | 本文書が事実と等級を分けて記録することで是正する |

---

## 7. Backup / 退避方法

| 対象 | 退避 |
| --- | --- |
| Neon production データ | 直近の成功バックアップ（2026-08-11T18:34:08Z）。Neon の PITR 保持期間も併用可能 |
| repository variables | **削除・巻き戻しを行っていない**ため現状が保全されている。名前と `updated_at` は本文書 §3.2 に記録済み |
| ワークフロー定義 | git 履歴（`845a8ec` 他、`7f72626` として main に squash） |

B は Secret の**追加**であり、既存データを上書きしない。退避対象は無い。

---

## 8. Rollback 方法

| 事項 | rollback |
| --- | --- |
| A-1 訓練 | **不可**（実行済み・一時資源は削除済みと記録）。取り消す対象が無い |
| A-2 変数 14 件 | 技術的には削除可能だが、**実施しない**。削除すると `neon-backup.yml` の必須検査が別の理由で落ち、障害が増える。また利用者の判断前に状態を動かすべきでない |
| A-3 PR #137 | revert 可能だが**推奨しない**。T-B4 以外の是正（#128/#132/#133/#134/ADR 0003）も同一 squash に含まれ、巻き戻すと解決済みの欠陥が復活する |
| B API key | `gh secret delete CODIP_NEON_API_KEY`。実行すると `neon-backup.yml` は登録前の状態（fail-closed で失敗）へ戻るだけで、データ影響は無い |

**A は「巻き戻す」ではなく「記録を事実に合わせる」で是正する。** これが本 PR の主目的である。

---

## 9. 成功条件

- [ ] 人間が §3 の事実関係を確認し、A の各項目を追認するか、是正を指示する
- [ ] 人間が A-1 / A-2 の**実施者**について心当たりを述べる（自身の操作か否か）
- [ ] B について `Y` / `N` の決裁が与えられる
- [ ] `Y` の場合、人間が project scoped / read-only の API key を Secret として登録する
- [ ] 登録後、`neon-backup.yml` を手動実行し、`Validate backup inputs` を通過して `pg_dump` が完走する
- [ ] 次回 cron（以降）が success となり、日次バックアップが復旧する

---

## 10. 自動停止条件

以下のいずれかに該当した場合、エージェントは作業を止めて人間へ報告する。

- Secret 登録後も `Validate backup inputs` が 2 回連続で失敗する
- `pg_dump` が失敗する、または成果物のサイズが直近成功比で著しく小さい
- Neon の control plane から取得した PITR 保持期間が、ゲートの要求値を下回る
- 本文書の §3 と実測が再び食い違う
- 決裁前に、いずれかのセッションが §17 対象操作を実行した形跡を検出する

---

## 11. 実行後の検証方法

値を出さない検証のみを行う。

| 検証 | 方法 | 合格条件 |
| --- | --- | --- |
| Secret 登録 | `gh api .../actions/secrets --jq '.secrets[].name'` | `CODIP_NEON_API_KEY` が名前一覧に出現。**値は取得できない**（API 仕様） |
| ゲート通過 | `neon-backup.yml` の手動実行ログ | `Validate backup inputs` が success |
| バックアップ復旧 | 同 run の結論と artifact | `pg_dump` step が success、artifact が生成される |
| 日次復旧 | 次回 cron run | conclusion = success |
| 監査整合 | `docs/security/evidence-gate-audit.md` の該当ゲート分類 | `restoreDrillStatus` ゲートは 🔴 のまま（**仕様**。CI は訓練を観測できないため、緑化してはならない） |

---

## 12. 担当と監査記録

| 役割 | 担当 |
| --- | --- |
| 起票・事実確認 | backend セッション（`claudeos/backend`） |
| 独立検証 | CTO セッション。PR #137 timeline と CodeQL ゲートを再実測済み |
| **決裁** | **人間（リポジトリ所有者）**。A の追認および B の `Y` / `N` |
| B の実行 | **人間**。エージェントは Secret を登録しない |

監査記録:

- 本文書（`docs/security/approval-2026-08-12-neon-restore-drill-ratification.md`）
- `266692a` / merge commit `7f72626` / PR #137 timeline
- GitHub API の secrets・variables の名前と `updated_at`（値は記録しない）
- `docs/runbooks/restore-drill-record.md` および `docs/operations/operations-ledger.md` の該当行

### 再発防止（要検討・本 PR の承認範囲外）

今回の経緯は「保留を置いた当人以外が保留を外せる」ことで成立した。技術的な対策候補は
次のとおりだが、いずれも branch protection の変更を伴うため、別途 §17 の決裁を要する。

- `main` への必須レビュー（役割セッション同士の相互承認では要件を満たさない点に注意）
- Approval PR ラベルに対する CODEOWNERS 相当の制約
- 役割ブランチの worktree を役割ごとに排他化する運用（今回、外部プロセスが backend の
  worktree へ直接 commit を積んだ事実がある）

---

## 判定依頼

```text
A. 事後追認（訓練実行・変数 14 件・#137 マージ）: 追認する / 是正を指示する
B. CODIP_NEON_API_KEY の登録:                    Y / N
```

`N` の場合、日次バックアップは停止したままとなる。その状態を許容するか、
`neon-backup.yml` の fail-closed 設計自体を見直すかの指示をいただきたい。
