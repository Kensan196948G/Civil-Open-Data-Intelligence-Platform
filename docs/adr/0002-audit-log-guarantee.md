# ADR 0002: 監査ログ記録保証は短時間mutationを同一transaction、クライアント起点イベントを同期APIで扱う

## ステータス

採用

## 背景

CODIPは公開データソース台帳、タグ、接続確認、サンプル取得、品質再計算、設定変更、監査ログエクスポート、APIキー操作を扱う。運用上、主要な変更操作は `audit_logs` に証跡が残ることを期待する。

初期実装では一部の監査記録が主操作の後続処理として実行され、監査DB書き込みに失敗しても主操作が成功し得た。CodeRabbitレビューとIssue #46で、主操作成功時の証跡欠落リスクが指摘された。

## 判断

短時間で完結するサーバー側mutationは、主操作と監査ログ作成を同一Prisma transactionに含める。

| 対象 | 採用方式 | 理由 |
| --- | --- | --- |
| データソース登録・更新・削除 | 同一transaction | 台帳変更と証跡を不可分にする |
| タグ追加・削除 | 同一transaction | UI操作と監査証跡が短時間で完結する |
| 接続確認 | 外部fetch完了後、DB保存と監査を同一transaction | 外部I/Oをtransaction外へ出し、DB永続化部分だけを不可分にする |
| サンプル取得 | 外部fetch完了後、取得ログ・サンプル・状態更新・監査を同一transaction | 長時間lockを避けつつ、保存済み結果と証跡を不可分にする |
| 品質再計算 | 同一transaction | 品質チェック作成、スコア更新、監査を不可分にする |
| 設定変更 | 同一transaction | 運用設定変更と証跡を不可分にする |
| クライアント起点イベント | `/api/admin/audit-events` の同期POST。監査INSERT失敗時は 503 | ブラウザ内エクスポートやAPIキー操作は主操作自体をサーバーで巻き戻せないため、記録APIは失敗を明示する |
| 管理セッション開始・終了 | ベストエフォート `recordAudit()` | セッション監査のためにログイン・ログアウト自体を失敗させない |

## outbox方式を採用しない理由

現時点の主要mutationは、外部I/O後に短いDB transactionで完結できる。永続outboxとretry workerは、Cloudflare Workers / Neon本番構成、キュー、重複排除、再送監視、運用アラートが必要になり、現行MVPの複雑さに対して過剰である。

ただし、次の条件を満たした場合はoutbox方式へ移行する。

| 条件 | 移行判断 |
| --- | --- |
| 長時間外部処理をDB transaction内へ入れる必要が出た | outboxへ移行 |
| 非同期ジョブ、Cron、Queue、batch ingestが主操作になる | outboxへ移行 |
| 監査失敗の自動retryと未処理件数アラートが必要になった | outboxへ移行 |
| Cloudflare Queues等の運用証跡を本番で確認済み | outbox実装を検討 |

## 影響

| 影響 | 内容 |
| --- | --- |
| 良い影響 | 主要mutation成功時に監査証跡が欠けるリスクを大きく下げる |
| 注意点 | 外部fetch自体はtransaction外で実行する。fetch成功後のDB保存と監査を不可分にする |
| 運用影響 | クライアント起点監査イベントが503の場合、UI上の主操作は完了済みでも監査記録は失敗しているため、運用ログとIssueで追跡する |
| 将来課題 | 非同期ジョブや長時間処理が増えた時点でoutbox + retry + alertへ移行する |

## 検証

次のテストで回帰を検知する。

| テスト | 観点 |
| --- | --- |
| `tests/unit/source-routes.test.ts` | データソース登録・更新・削除の監査記録 |
| `tests/unit/tags-route.test.ts` | タグ追加・削除の監査記録 |
| `tests/unit/audit-transaction-routes.test.ts` | 接続確認、サンプル取得、品質再計算の監査記録 |
| `tests/unit/admin-settings-route.test.ts` | 設定変更、クライアント起点監査イベント、監査INSERT失敗時503 |
| `scripts/tools/check-audit-contract.js` | ADR、運用docs、source comment、release gate契約の欠落検知 |
