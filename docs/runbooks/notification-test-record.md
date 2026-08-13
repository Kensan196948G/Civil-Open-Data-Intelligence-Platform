# 📨 通知テスト記録テンプレート

> 🗓️ 新設: 2026-08-11（Issue #90）｜ 種別: **非Secret の運用証跡様式** ｜ 関連: [監視・アラート runbook](./monitoring.md) / [アラート・通知設定 runbook](./alerts-and-notifications.md) / [運用台帳](../operations/operations-ledger.md)

通知テストは「送信APIが success を返したか」ではなく、**人間が実際に受信できたか**で合否を判定する。送信成功のみを根拠に「通知経路が成立した」と記録してはならない。

本ファイルは記録様式（§1）と記録台帳（§3）を兼ねる。台帳は追記のみとし、過去行を書き換えない。

---

## 1. 記録様式

通知テスト1件につき、次の列をすべて埋める。**空欄・推測値のまま「合格」としない。**

| 列 | 必須 | 記入内容 | 記入例 |
| --- | :---: | --- | --- |
| `実施日時 (UTC)` | ✅ | 通知テストを送信した時刻。ISO 8601 | `2026-08-11T04:15:00Z` |
| `対象経路` | ✅ | 通知経路の識別名 | `github-actions-failure` / `cloudflare-alert-policy` / `neon-alert` |
| `テスト方法` | ✅ | どう発火させたか | `production-smoke.yml を run_notification_test=true でdispatch` / `Dashboard Send test notification` |
| `送信結果` | ✅ | 送信API・UIの応答 | `success` / `error` / `不明` |
| `受信確認者` | ✅ | 受信を確認した**人間**のロール名 | `ReleaseManager` / `DevOps当番` |
| `受信時刻 (UTC)` | ✅ | 受信者が実際に通知を目視した時刻。未受信なら `未受信` | `2026-08-11T04:17:00Z` |
| `検知遅延` | ✅ | 送信→受信の経過時間。未受信なら `-` | `2分` |
| `判定` | ✅ | `PASS` / `FAIL` / `BLOCKED` / `NOT RUN` | `PASS` |
| `根拠` | ✅ | run URL、policy名、Actions run ID など**非Secret**の識別子 | `run 31456833751` |
| `次回実施予定` | ✅ | 月次試験の次回目安 | `2026-09-11` |

### 1.1 記入禁止事項（Safety）

次を本ファイル・commit message・PR本文・ログへ**書かない**。

- ❌ 通知先のメールアドレス、Teams/Slack の Webhook URL、その署名シークレット
- ❌ Cloudflare / Neon / GitHub の API token、Access service token の ID・Secret
- ❌ DB connection string、個人名・個人連絡先などのPII

通知先は**ロール名または経路の識別名**でのみ表現する（例: `IT/DX共有メールボックス`、`運用Teamsチャネル`）。実体の宛先は Cloudflare / GitHub / Neon の設定側に保持し、本ファイルからは参照しない。

### 1.2 判定基準

| 判定 | 条件 |
| --- | --- |
| `PASS` | 送信結果が成功、かつ**受信確認者が受信時刻を記入できた** |
| `FAIL` | 送信は成功したが受信できなかった、または送信自体が失敗した |
| `BLOCKED` | 権限不足・通知先未確定などで送信自体を実施できない |
| `NOT RUN` | 実施予定だが未実施。理由を `根拠` 列に記載する |

`BLOCKED` / `NOT RUN` を `PASS` へ繰り上げてはならない（Verification First）。

---

## 2. 実施手順

1. 対象経路の設定状態を確認する（`alerts-and-notifications.md` §3）。通知先が未確定なら `BLOCKED` として §3 へ記録し、テストを実施しない。
2. 受信確認者を**事前に**決め、テスト実施を通知しておく。受信確認者は送信者と同一人物でもよいが、ロール名を明記する。
3. テストを送信する。
   - GitHub Actions: `production-smoke.yml` を `workflow_dispatch` で `run_notification_test=true` にして実行する（本番probeは通常どおり実行。テスト専用incident Issueが `[TEST]` 接頭辞＋`production-smoke-test` label で起票される）。受信確認後、テストIssueをクローズする
   - Cloudflare: Dashboard の「Send test notification」または Notifications API のテスト送信
   - Neon: Console の Notifications からテストアラート
4. 受信確認者が受信を目視し、**受信時刻を記録する**。5分以内に受信しない場合は `FAIL` とする。
5. §3 の台帳へ1行追記し、`docs/operations/operations-ledger.md` §5 実行記録へ相互参照を残す。
6. 証跡変数（`CODIP_MONITORING_CONTACTS` / `CODIP_CLOUDFLARE_ALERT_POLICY` / `CODIP_SMOKE_MONITORING_SCHEDULE`）を更新する。値には**経路名と時刻のみ**を入れ、宛先実体を入れない。

> ⚠️ 通知先の追加・変更・ローテーションは人間承認事項（Approval PR 対象）である。本手順は**既に設定済みの経路をテストする**ためのものであり、設定変更を含まない。

---

## 3. 記録台帳

| 実施日時 (UTC) | 対象経路 | テスト方法 | 送信結果 | 受信確認者 | 受信時刻 (UTC) | 検知遅延 | 判定 | 根拠 | 次回実施予定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-10（時刻未記録） | cloudflare-alert-policy | Notifications API テスト送信 | success | 未記録 | 未記録 | - | `NOT RUN`（受信記録なし） | `alerts-and-notifications.md` §「2026-08-10 実施済み」。送信APIの成功のみが記録され、受信時刻・受信確認者が残っていない。QAはNotifications read権限が無く独立検証不能 | 権限付与後に再実施 |
| - | github-actions-failure | - | - | - | - | - | `BLOCKED` | 通知先が未確定（`alerts-and-notifications.md` §3.1 step1 が人間承認待ち）。`production-smoke.yml` に通知stepが存在しない | 通知先確定後 |
| - | neon-alert | - | - | - | - | - | `BLOCKED` | Neon Alerts 未設定（`alerts-and-notifications.md` §1） | 設定後 |
| 2026-08-12T00:52:12Z | github-actions-failure | `production-smoke.yml` を `workflow_dispatch` で `run_notification_test=true` 実行（本番probeは通常どおり成功） | success（job結論 success・テスト専用incident Issue作成） | CTO代行（kensan環境）※**Issue作成＝検知記録であり、人間のメール受信確認ではない** | 2026-08-12T00:52:14Z | 2秒（Issue作成時刻 - 検知時刻） | `PASS`（**Issue起票経路の実測**。人間の受信確認は次行で別管理） | run 31551646341 / Issue #152（`[TEST] [P2] production smoke failure`、`production-smoke-test` label、本文に種別明記） | 2026-09-11 |
| - | github-actions-failure（人間の受信確認） | GitHubメール/通知の目視 | - | 未確認（当番・通知先設定は人間作業） | 未受信 | - | `NOT RUN` | 通知先のメール設定と当番の登録が完了したら実施（`alerts-and-notifications.md` §3.1） | 通知先確定後 |

<!-- 新しい記録は上の表へ1行ずつ追記する。過去行は書き換えない。 -->

---

## 4. 月次通知試験との関係

`alerts-and-notifications.md` §4「月次通知試験」で実施する各項目は、本ファイル §3 へ1行ずつ記録する。月次試験で全経路が `PASS` にならない限り、`docs/operations/operations-ledger.md` の「アラート（未設定）」表記は解消しない。
