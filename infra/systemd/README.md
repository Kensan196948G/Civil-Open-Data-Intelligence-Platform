# ローカル systemd ユニットの雛形（Issue #223）

`~/.config/systemd/user/` へ配置する user unit の雛形。**本番実行構成の変更にあたるため、設置は人間が行う。**

## 目的

2026-09-01 から 09-08 までの 7 日間、本番DBの日次バックアップが停止していたが誰も気づかなかった（Issue #218）。`codip-backup.timer` は毎日発火し、毎回 `203/EXEC` で失敗していた。

原因は単純で、**codip 系ユニットに失敗時の通知経路が一つも無かった**。

```
$ systemctl --user cat codip-{backup,ingestion,weather,healthcheck}.service | grep -iE "OnFailure|ExecStopPost"
（1件も定義なし）
```

失敗は journald に残るだけで、人間が能動的に `systemctl --user list-units --state=failed` を叩かない限り可視化されない。

外部通知先（メール / Webhook / Slack）の追加は宛先の選択を伴う人間の判断であり CLAUDE.md §5 の承認事項なので、ここでは**外部依存を持たない可視化**だけを行う。

## 構成

| ファイル | 役割 |
| --- | --- |
| `codip-unit-failed@.service` | `OnFailure=` から呼ばれ、失敗を機械可読なマーカーとして残す |
| `codip-ops-health.service` / `.timer` | マーカーとバックアップ鮮度を定期検査し、異常なら failed になる |

検査本体は git 管理下の `scripts/ops/check-local-ops-health.sh` と `scripts/ops/record-unit-failure.sh`。**unit にロジックを書かない**（Issue #218 で、git の外にあった実行主体が消えて復元できなくなったため）。

## なぜ「状態」と「マーカー」の両方を見るのか

`systemctl list-units --state=failed` の failed 状態は**次の成功で消える**。oneshot が「失敗 → 次回成功」を繰り返していると、状態だけを見ている監視には常に正常に見える。発生そのものを残さないと取りこぼす。

## 設置手順（人間が実施）

### 1. 監視ユニットを置く

`REPO` を実際のリポジトリパスに置き換える。

```ini
# ~/.config/systemd/user/codip-unit-failed@.service
[Unit]
Description=Record a failure of %i (CODIP ops visibility)

[Service]
Type=oneshot
ExecStart=REPO/scripts/ops/record-unit-failure.sh %i
```

```ini
# ~/.config/systemd/user/codip-ops-health.service
[Unit]
Description=CODIP local ops health check (backup freshness / unit failures)

[Service]
Type=oneshot
ExecStart=REPO/scripts/ops/check-local-ops-health.sh
```

```ini
# ~/.config/systemd/user/codip-ops-health.timer
[Unit]
Description=Run CODIP local ops health check hourly

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

### 2. 既存ユニットへ `OnFailure=` を足す

`codip-backup.service` / `codip-ingestion.service` / `codip-weather.service` / `codip-production.service` の `[Unit]` セクションへ 1 行追加する。

```ini
[Unit]
OnFailure=codip-unit-failed@%n.service
```

### 3. 有効化

```bash
systemctl --user daemon-reload
systemctl --user enable --now codip-ops-health.timer
systemctl --user start codip-ops-health.service   # 即時に一度走らせる
systemctl --user status codip-ops-health.service
```

## 動作確認

```bash
# 正常時
scripts/ops/check-local-ops-health.sh          # exit 0

# バックアップが古い状態を再現して検出されることを見る
CODIP_BACKUP_DIR=/tmp/codip-ops-test/backups \
CODIP_UNIT_FAILURE_DIR=/tmp/codip-ops-test/markers \
  scripts/ops/check-local-ops-health.sh        # exit 1
```

2026-09-09 の実測では、Issue #218 当時と同じ「最新バックアップが 168 時間前」の状態を作ると次を出して `exit 1` になる。

```
[ops-health][NG] バックアップが古い: codip-20260901T031702Z.dump.gpg (168時間前 > 上限 26時間)
```

## マーカーの後始末

対処が済んだら消す。消し忘れると検査が鳴り続ける（これは意図した設計で、**未対処のまま静かになることを避ける**）。

```bash
rm ~/.local/state/codip/failed-units/<unit>
```

## 調整できる値

| 環境変数 | 既定 | 意味 |
| --- | --- | --- |
| `CODIP_BACKUP_DIR` | `~/backups/codip` | バックアップ保存先 |
| `CODIP_UNIT_FAILURE_DIR` | `~/.local/state/codip/failed-units` | マーカー保存先 |
| `CODIP_MAX_BACKUP_AGE_HOURS` | `26` | 鮮度の上限。日次 03:17 に対し 2 時間の余裕を持たせている |
| `CODIP_UNIT_PREFIX` | `codip-` | 検査対象のユニット名接頭辞 |

## 残る限界

- **通知は行わない。** 検査が失敗しても、人が `systemctl --user status codip-ops-health.service` を見るか、`codip-ops-health.service` 自身の failed 状態に気づく必要がある。真の意味での通知（メール等）は宛先の決定を伴うため Issue #90 / #223 で別途扱う
- `~/backups` も systemd の状態もこのホストにしか無いため、**GitHub Actions からは検査できない**。ローカルで走らせる以外に手段がないことが、この欠陥が生まれた構造的な理由でもある

## 関連

- Issue #223（本 README の発端）
- Issue #218（バックアップ 7 日停止）
- Issue #231（本番リリースの隔離）
