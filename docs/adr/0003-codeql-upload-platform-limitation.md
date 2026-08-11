# ADR 0003: CodeQL SARIF upload cannot be enabled on this GitHub plan

- 状態: Accepted（2026-08-12）
- 決定者: CTO代行（Issue #139 の環境制約調査に基づく）。人間による追認を推奨
- 関連: Issue #132 / #139 / PR #137

## 背景

Issue #132 の是正（`continue-on-error: true` の除去）により、CodeQL `analyze` の
**SARIFアップロード**が常に失敗していることが可視化された。

```text
[error] Code scanning is not enabled for this repository.
        Please enable code scanning in the repository settings.
```

## 調査結果（2026-08-12 実測）

| 確認項目 | 結果 |
| --- | --- |
| リポジトリ可視性 | `private: true`（personal account `Kensan196948G`） |
| repo 権限 | `admin: true`（所有者） |
| `GET /code-scanning/default-setup` | HTTP 403（機能自体が無効） |
| `PUT /code-scanning/default-setup` | HTTP 404（本プランでは設定API自体が存在しない） |
| CodeQL 解析本体 | 正常動作（250 TS / 45 JS / 6 Actions ファイルをスキャン、SARIF生成まで完了） |

GitHub の Code scanning（SARIFアップロード）は **GitHub Advanced Security (GHAS)** が必要で、
これは Organization + Enterprise プランのみで提供される。**personal account の private
repository では有効化できない**。したがって「リポジトリ設定で有効化すれば直る」ではなく、
構造的に不可能である。

## 決定

CodeQL ワークフローを「ローカル解析＋アーティファクト保存」構成へ変更する。

1. `github/codeql-action/analyze` に `upload: never` を指定（SARIFアップロードを試みない）
2. 解析自体の失敗（DB構築失敗・言語検出失敗等）は従来どおりジョブを失敗させる
3. SARIF は `codeql-sarif` artifact として14日間保持し、CIログと併せて確認可能にする
4. **SARIF の検出内容を判定する `codeql-findings` ジョブを追加し、`security-severity` が
   7.0 以上（GitHub 換算の high / critical）の検出でジョブを失敗させる**
   （`scripts/tools/check-codeql-sarif.js`、2026-08-12 追加）。
   判定は必須チェック `analyze` とは**別ジョブ**に置く（理由は後述）

これにより:

- 「CodeQL が実行された」ことが**反証可能**になる（#132 の目的を維持）
- アップロード不能に起因する恒久 RED で全マージが止まる状態を解消する
- セキュリティは従来（`continue-on-error` で握り潰していた状態）より**低下しない**。
  アップロードは従来も 403 で失敗しており、実質一度も code-scanning へ記録されていない

### 決定 4 を後から追加した理由（2026-08-12 追記）

決定 1〜3 だけの構成には穴があった。`upload: never` の下では `analyze` が失敗するのは
**アナライザ自身が失敗したとき**だけで、**検出結果では失敗しない**。SARIF は誰も読まない
14日間の artifact に落ちるだけになる。この状態のジョブが緑であることは
「スキャンが走った」ことしか示さず、「何も見つからなかった」ことは誰も検証していない。
これは `docs/security/evidence-gate-audit.md` が定義する**等級3（内容非検証 / presence-only）**
そのものであり、組織方針の品質ゲート「critical および high severity の未解決脆弱性ゼロ」を
このジョブの緑で満たしたと主張することはできない。決定 4 はその穴を塞ぐ。

閾値に SARIF の `level` を使ってはならない。実測（run 31541261002 / commit `9ea42d5` の
`codeql-sarif` artifact）では、検出 6 件はすべて `defaultConfiguration.level: warning`
でありながら `security-severity: 7.8`（high）だった。`level === "error"` を閾値にすると
high 6 件を抱えたまま緑で通り、presence-only を presence-only で置き換えることになる。
組織方針が critical + high をゼロと要求している以上、閾値はそこに一致していなければならない。

判定は「検出 0 件」と「検査が成立しなかった」を区別する。走査対象が無い・JSON が壊れている・
`runs` が空・`results` キーが無い・`invocations[].executionSuccessful` が true でない・
rule カタログが空・result の rule を引けない — これらは**すべて失敗**として扱い、
空集合を合格として通さない（監査文書 §3.5 を本ゲート自身にも適用する）。

### なぜ別ジョブなのか（マージ凍結の回避）

`analyze` は branch protection の必須チェックである（2026-08-12 実測:
`required_status_checks.contexts` に `analyze` を含む）。判定 step を `analyze` 内に置くと、
下記「既知の残課題」の high が解消されるまで **main への全マージが凍結**する。
そのうち production コードの 1 件は `src/**` にあり backend の所有外であるため、
backend には自ら凍結を解除する手段がない。解除できない凍結を一方的に作ることは避け、
判定は `codeql-findings` という**別ジョブ**へ置いた。

この構成の意味を正確に述べる。

- `codeql-findings` は**本物の赤を出す**。検出内容は artifact ではなく CI の結果として見える
- ただし現時点では**マージを阻止しない**（必須チェックではない）
- したがって `analyze` の緑は、依然として「high 脆弱性ゼロ」の根拠には**ならない**

必須化（= `codeql-findings` を required status checks へ追加）は保護規則の変更であり、
組織方針 §17 により人間の決裁を要する。条件は「既知の残課題」の 6 件が解消または分類済みに
なることとする。それまでの間、本ジョブの状態を品質ゲート判定の根拠として引用する場合は、
必須化されていないことを併記すること。

## 制約と代替

| 手段 | 可否 | 備考 |
| --- | --- | --- |
| GitHub Code scanning 有効化 | ❌ | GHAS が必要。現プランでは不可能 |
| CodeQL CLI をCIで直接実行 | ⚠️ | private repo での CLI 使用にも GHAS ライセンスが必要とされ、同様に不可 |
| ローカル解析 + SARIF artifact（本決定） | ✅ | 解析ゲートと記録を維持。アラート管理UI（Security tab）は使えない |
| リポジトリを public 化 | ⚠️ | 公開不可の情報が無いことを確認できれば可能だが、本決定では選択しない |
| GitHub Team/Enterprise へ移行 | ⚠️ | 費用と組織判断が必要。必要なら人間が判断する |

## 将来の再評価

### 再評価トリガ（契約の賞味期限）

`scripts/tools/check-github-actions-contract.js` は `upload: never` の存在を契約として
**要求**している。これは回避策を恒久化する向きの束縛である。契約に賞味期限が書かれていないと、
制約が消えた後も契約が「正しい変更」を阻み、誰もその理由を思い出せなくなる。

| 発火条件 | 実施すること | 判定方法 |
| --- | --- | --- |
| GHAS が利用可能になる（= Issue #139 をクローズできる） | ①契約から `upload: never` / `output: sarif-results` の要求行を削除 ②`analyze` を通常の code-scanning アップロードへ戻す ③本ADRを Superseded にする | `GET /repos/{owner}/{repo}/code-scanning/default-setup` が 403 を返さなくなること |
| リポジトリを public 化 / Organization へ移管 | 同上（GHAS 前提が変わるため再判定） | リポジトリの `visibility` / `owner.type` の変化 |

再評価が完了するまでは、決定 4 の findings ゲートが本ジョブの実質的な唯一の判定である。
GHAS へ戻した後も決定 4 を残すかは、code-scanning 側のアラート運用が確立してから判断する
（二重管理になるため、自動では残さない）。

上記の判定を Issue #139 のクローズ条件へも書いておくこと。ADR 側にだけ書くと、
Issue を閉じた人が契約行の存在を知らないまま放置される。

### その他

- GitHub プランを GHAS 対応へ変更した場合は、`upload: never` を外し通常の
  code-scanning アップロードへ戻す（本ADRを更新する）
- アラートの可視化が必要になった場合は、SARIF artifact を週次で集計する別基盤を検討する

## 既知の残課題（2026-08-12 時点）

決定 4 の導入により、`codeql-findings` ジョブは**現時点で赤になる**。これは仕様どおりの
結果であり、緑にするために閾値を上げたり除外リストを置いたりはしていない。
実測（run 31541261002 / commit `9ea42d5` の SARIF）の内訳は次のとおり、いずれも
`security-severity: 7.8`（high）である。

| 位置 | ルール | 所有 | 状況 |
| --- | --- | --- | --- |
| `src/connectors/xroad.ts:9` | `js/incomplete-url-substring-sanitization` | frontend（`src/**`） | **backend の担当外**。production コードにある唯一の検出。分類と対応の判断が必要 |
| `scripts/tools/release-gate.js:7` | `js/incomplete-sanitization` | backend | Windows 経路の引数クォート（バックスラッシュ非エスケープ）。修正候補だが検証環境が無い |
| `tests/unit/evidence-gate-audit-scenarios.test.ts:124` | `js/incomplete-url-substring-sanitization` | backend | #129 以前の substring 判定を**意図的に**再現した検証用コード |
| `tests/unit/post-release-status.test.ts:169`, `:281` | `js/incomplete-url-substring-sanitization` | backend | テスト用モックルータの URL 判定 |
| `tests/unit/release-smoke-csp.test.ts:47` | `js/incomplete-url-substring-sanitization` | backend | 上記と同じく旧実装の再現 |

除外リスト（allowlist）は置かなかった。理由は 2 つある。

1. 6 件のうち production コードの 1 件は backend の所有外にある。所有外のコードについて
   「安全である」というセキュリティ判断を backend が下すことはできない。
2. 除外で緑にする行為は、本ADRが塞ごうとしている欠陥（緑を根拠として使えない状態）
   そのものである。

`tests/**` の 4 件は、いずれも「脆弱な旧実装を再現して検出できることを確かめる」テスト
コードであり、production へ配布されない。パス単位の除外（`tests/**` を解析対象から外す）は
妥当な選択肢だが、本変更では採らなかった。除外の是非は 6 件全体の分類と同時に判断すべきで、
先に片方だけ通すと「残り 1 件のために赤い」状態の意味が読み取りにくくなるためである。

分類・対応は Issue として起票し、人間または所有ロールが判断する。
