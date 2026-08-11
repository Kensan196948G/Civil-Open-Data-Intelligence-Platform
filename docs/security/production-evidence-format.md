# 本番証跡変数の形式要件

最終更新: 2026-08-12

`scripts/tools/production-evidence-report.js`（`npm run release:production-evidence`）が検査する 8 つの証跡変数について、
要求される形式と、その形式を要求する理由を記録する。

## 1. なぜ形式を要求するか

この 8 変数は GitHub Variables から供給される。値を入力するのは、デプロイを実行する当人である。

Issue #128 以前、検査は「空でない」「placeholder 文字列に一致しない」の 2 点だけだった。
したがって `ok` の 2 文字を 8 変数すべてに入れれば、readiness チェック 8 項目がすべて ✅ になり、
リリースは「誰も確認していない監視体制」を証跡として記録できた。

形式要件の正本は `scripts/tools/production-evidence-report.js` の `EVIDENCE_FORMATS` にあり、
値を供給する側（GitHub Variables）には置かない。**供給者が書き換えられる期待値は期待値ではない。**
同じ方式は `scripts/tools/validate-production-target-env.js:99-101` の `PRODUCTION_BASE_HOSTNAME` が先例で、
値は `vars.*` から来るが、期待するホスト名はコード側に固定されている。

### この検査が証明しないこと

形式検査は**記録された証跡が「答えの形」をしていること**しか示さない。
アラートポリシーが実在すること、連絡先に到達できること、訓練が実際に行われたことは証明しない。
それらは Cloudflare / Neon の API を叩く必要があり、Issue #128 の対象外である。

区別としては、`ok` のような無内容な入力と、日付・ホスト名・結果語を伴う具体的な申告を分離するための下限である。
形式が通っても内容が真であるとは限らない — このゲートを「監視が設定済みである証明」として引用してはならない。

## 2. 形式要件一覧

すべての変数に共通して、空文字列・placeholder 文字列（`example`、`replace`、`change-this`、`dummy` 等）は不合格となる。
そのうえで、変数ごとに次を要求する。

| 変数 | 最小長 | 要求する形式 | 例 |
| --- | ---: | --- | --- |
| `CODIP_CLOUDFLARE_ACCESS_EVIDENCE` | 24 | アプリケーションのホスト名 + ポリシー名 + 確認日 (ISO 8601) | `odip.mirai-dx-platform.com policy=codip-admins verified=2026-07-19` |
| `CODIP_MONITORING_CONTACTS` | 6 | カンマ区切りの連絡先。各要素はメールアドレス、`#channel`、`team:<name>`、`oncall:<name>` のいずれか | `release-oncall@example.org, #codip-alerts` |
| `CODIP_CLOUDFLARE_ALERT_POLICY` | 20 | ポリシー名 + 通知テスト実施日 (ISO 8601) | `codip-production-p1 notification-test=2026-07-19` |
| `CODIP_CLOUDFLARE_LOGS_EVIDENCE` | 20 | ログ照会結果の要約 + 照会日 (ISO 8601) | `workers logs queried 2026-07-19T06:30:00Z errors=0` |
| `CODIP_NEON_MONITORING_EVIDENCE` | 20 | Neon ブランチ名 + 確認日 (ISO 8601) | `branch codip-production checked 2026-07-19 slow-queries=0` |
| `CODIP_SMOKE_MONITORING_SCHEDULE` | 5 | 5 フィールドの cron 式、または定義済みキーワード（`hourly` / `daily` / `weekly` / `monthly` / `per-release`） | `*/15 * * * *` |
| `CODIP_ROLLBACK_OWNER` | 4 | 空白を含まない単一の識別子（4 文字以上）。アカウント名、チームハンドル、メールアドレス | `release-manager` |
| `CODIP_BACKUP_RESTORE_EVIDENCE` | 24 | PITR ウィンドウ + 訓練実施日 (ISO 8601) + 訓練結果（`success` / `failed` / `partial` / `not-run` / `blocked`） | `neon pitr 24h drill 2026-07-19 outcome=not-run` |

同じ表は `npm run release:production-evidence` の出力（`## Evidence Format Requirements` 節）にも印字される。
CI で ⚠️ が出た運用者が、このドキュメントを開かずとも何を入れるべきか分かるようにするためである。

### 個別の判定規則

**日付 (ISO 8601)** — `YYYY-MM-DD` または完全なタイムスタンプ。値の中のどこかに 1 つ以上含まれていればよいが、
少なくとも 1 つが **2025-01-01 以降、実行時刻の +24 時間以内**でなければならない。
範囲を設けているのは、打ち間違い（`2016-...`）、サンプルの貼り付け、未来日での「確認済み」申告を落とすためである。

**訓練結果** — 語境界で照合する。単純な部分文字列照合では `unsuccessful` が `success` に一致し、
失敗した復旧訓練を成功として読んでしまう。語彙は `scripts/tools/create-neon-backup-evidence.js` と共通で、
リリース工程のどちら側でも同じ語が同じ意味を持つ。

**スケジュール** — `*/5 read-only smoke` のような自由記述は不合格。スケジュールらしく読めるが、
機械にも代理の運用者にも実行できる周期を指していない。

**連絡先** — 不一致があっても値そのものは出力しない（連絡先情報のため）。何件中何件が不一致かだけを報告する。

## 3. 出力の読み方

| 表示 | 意味 |
| --- | --- |
| `✅ set (recorded, format checked)` | 記録があり、形式要件も満たしている。readiness チェックが ✅ になるのはこの場合のみ |
| `⚠️ <要件>` | 記録はあるが形式が要件を満たしていない。満たすべき要件が併記される |
| `⚠️ unset` / `⚠️ placeholder-like` | 未設定、または placeholder 文字列。**形式検査以前に落ちている** |
| `⚠️ no format requirement registered (add <KEY> to EVIDENCE_FORMATS)` | 証跡キーとして検査対象なのに形式要件が未登録。**値の問題ではなく実装側の登録漏れ**（§4.1） |

証跡の値そのものは、合格時も不合格時もレポートに印字しない。連絡先や運用上の記述を含むためである。

## 4. 導入時の注意

形式要件は、**既存の GitHub Variables 設定値を FAIL させ得る**。
`--strict` 付きの実行（`.github/workflows/ci.yml` の production-target job）で ⚠️ が出た場合、
それはゲートの誤検知ではなく、記録されていた証跡が確認可能な形をしていなかったという意味である。
値を要件に合う形へ書き直す（＝実際に確認して日付と結果を記録する）ことで解消する。

`scripts/deploy/deploy-production.mjs` は、これらの変数が未設定のときにフォールバック既定値を与える。
既定値のいくつかは本形式要件を満たさない（例: 連絡先がメール形式でない、スケジュールが自由記述）。
これは意図した fail-closed であり、退行ではない。恒久的な解決は、既定値を廃して未設定を明示的な FAIL とすることである。

### 4.1 証跡変数を追加するとき

証跡変数を `MONITORING_ENV_KEYS` または `BACKUP_RESTORE_ENV_KEYS` へ追加した場合、
**同時に `EVIDENCE_FORMATS` へ形式要件を登録しなければならない。**

登録を忘れたキーは、`⚠️ no format requirement registered` を返して readiness チェックを FAIL させる。
これは意図した挙動である。登録漏れのキーを「形式要件が無いのだから素通り」として扱うと、
そのキーだけが Issue #128 以前の presence-only 判定（＝空でなければ ✅）へ戻ることになり、
本ドキュメントが要求している検査が、追加した本人にも気づかれないまま無効化される。

この不変条件は `tests/unit/production-evidence-report.test.ts` の
`evidence format registration is exhaustive` が双方向に表明する。

| 表明 | 防ぐもの |
| --- | --- |
| 検査対象キー ⊆ `EVIDENCE_FORMATS` | 要件の登録漏れ（そのキーだけ検査されない） |
| `EVIDENCE_FORMATS` ⊆ 検査対象キー | 死んだ要件（書いたが誰も参照しない要件を「効いている」と誤認する） |

実行時の fail-closed とテストの網羅表明は役割が異なり、片方では足りない。
テストだけでは本番実行時に素通りし、実行時分岐だけでは「なぜ ⚠️ なのか」が実装者へ伝わらない。

## 5. 関連

| 参照先 | 内容 |
| --- | --- |
| `scripts/tools/production-evidence-report.js` | 形式要件の正本 (`EVIDENCE_FORMATS`) |
| `tests/unit/production-evidence-report.test.ts` | 形式不正で FAIL することの単体テスト |
| [evidence-gate-audit.md](evidence-gate-audit.md) | 証跡ゲート全体の監査（自己申告ゲートの一覧と是正状況） |
| [../runbooks/restore-drill-record.md](../runbooks/restore-drill-record.md) | 復旧訓練の記録様式（`CODIP_BACKUP_RESTORE_EVIDENCE` の供給元） |
| [../16-release-readiness-checklist.md](../16-release-readiness-checklist.md) | リリース前確認項目 |
