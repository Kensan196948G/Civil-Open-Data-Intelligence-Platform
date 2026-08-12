# ADR 0003: CodeQL SARIF upload cannot be enabled on this GitHub plan

- 状態: Accepted（2026-08-12）
- 決定者: CTO代行（Issue #139 の環境制約調査に基づく）。人間による追認を推奨
- 関連: Issue #132 / #139 / PR #137
- 日付の時刻系: 本文中の日付は **JST**（開発機のローカル時刻）。GitHub の API 応答・
  レビュー投稿時刻は UTC なので、日付境界付近では 1 日ずれて見える。実際にレビューで
  「未来日付」として指摘された（UTC 2026-08-11T23:22 の時点で本文は JST の 2026-08-12）。
  再現の基準は日付ではなく、併記した **run ID と commit** に置くこと。日付は読み手の
  目安であり、証跡の同定子ではない

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
5. **抑制（`result.suppressions`）を受理する経路を 1 本だけ定義し、通ったものを必ず出力する**
   （2026-08-12 追加）。受理は `kind: "external"` かつ理由が非空のものに限り、受理件数の
   上限（予算）は現在 **0**。詳細は後述の「抑制チャネルと受容記録」

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

### 抑制チャネルと受容記録（2026-08-12 追記）

決定 4 だけでは、まだ塞がっていない経路が 1 本あった。SARIF は検出ごとに
`result.suppressions` を持てるが、追加時点の `scripts/tools/check-codeql-sarif.js` は
**この欄を一度も参照していなかった**。抑制された検出があっても、ゲートはそれを通常の検出と
同じに扱うだけで、「何が、誰の判断で免除されたのか」は CI のどこにも現れない。
これは抑制を塞いだのではなく、**抑制を見えない場所へ移した**状態である。

そこで抑制を禁止するのではなく、**通れる形を 1 本だけ用意して、通ったものを必ず表に出す**。

| 検査 | 判定 |
| --- | --- |
| `kind: "external"` かつ理由（`justification`）が非空、`status` があれば `"accepted"` | **受理**。finding としては落とさない |
| `kind: "inSource"`（ソース中のコメントによる抑制） | **失敗**。コード上の 1 行で検出を消せる経路はレビューを経ない受容になる |
| 理由が空 / 欠落 | **失敗**。理由の無い抑制は何の記録でもない |
| `suppressions` が配列でない / エントリが object でない / `status` が `"accepted"` でない | **失敗**（形が読めないものを合格にしない。§3.5 と同じ原則） |
| 1 件でも不正な抑制が混ざる | **その result 全体を受理しない**（部分受理を許すと、不正な 1 件を正当な 1 件で隠せる） |
| 受理件数 > 予算 `MAX_ACCEPTED_SUPPRESSIONS` | **失敗**。受理とは別の検査である |

受理件数・ruleId・位置は、**合格・不合格のどちらでも必ず出力する**（抑制ゼロでも
`0 accepted suppression(s)` を出す。出力が無いことと 0 件は区別できない）。理由の本文は
出力しない。レビューされていない自由文を CI ログの記録にしないためで、SARIF の `message` を
出さないのと同じ判断である。

**予算は現在 0** である。本ゲートに対する受容を、まだ誰も決めていないという事実をそのまま
表している。予算は環境変数や CLI 引数で上書きできない。上書き手段を残すと、定数が取り除いた
はずの自由（誰でも黙って免除できる）がそのまま戻る。引き上げは下記の受容記録を伴う
レビュー済みの変更として行う。

#### 受容記録（acceptance record）

ゲートは理由の**中身**を判定しない（できない）。中身の要件はここに置き、PR レビューで確認する。
同じ 5 項目を、**性質の同じ 3 つの操作すべて**に適用する。individual な抑制も、ゲート全体の
非必須化も、「既知の検出を残したまま先へ進むことを誰かが引き受けた」という同じ行為だからである。

| 項目 | 内容 |
| --- | --- |
| 受容者 | 決裁した人間。セッションやツールの名前は受容者ではない |
| 受容日 | UTC の ISO 8601 |
| owner | 解消の担当。受容者と同一とは限らない |
| 期限 | 再評価の期日または発火条件。無期限の受容は書かない |
| 受容したリスク | 何が起こり得るかを具体的に。「low risk」は内容ではない |

適用対象:

1. 個別の抑制（`justification` に 5 項目を書き、下表へ 1 行足す）
2. 予算 `MAX_ACCEPTED_SUPPRESSIONS` の引き上げ
3. `codeql-findings` を必須チェックにしないまま運用すること

**現在の受容記録**

| 対象 | 受容者 | 受容日 | owner | 期限 | 受容したリスク |
| --- | --- | --- | --- | --- | --- |
| 個別の抑制 | — | — | — | — | 該当なし（受理件数 0 / 予算 0） |
| `codeql-findings` を必須にしない | **未決（ユーザー決裁待ち）** | — | backend | Issue #142 の完了時に再評価 | 既知の high 6 件（うち production コード 1 件）を残したまま main へマージできる。`analyze` の緑は「high ゼロ」の根拠にならず、`codeql-findings` の赤はマージを阻止しない |

2 行目を「未決」と書いているのは、backend が受容者になれないためである。必須化しない状態は
現に運用されているので、受容そのものは**既に起きている**。受容者欄が空のままであること自体が
残課題であり、Issue #142 の決裁時に埋める。埋まるまでは、このジョブの状態を品質ゲートの
根拠として引用するときに必須化されていないことを併記する（前節の要求と同じ）。

### `security-severity` の値検証（2026-08-12 追記 / CodeRabbit 指摘）

抑制チャネルと**同じ形の穴**が、閾値判定そのものにも残っていた。初版の判定は
`!Number.isFinite(Number(raw))` だけで、値が読めるかを見ていた。ところが JavaScript の
`Number()` は `""` / `null` / `false` / `[]` をいずれも `0` へ変換する。いずれも有限値なので
検査を通り、**「重大度 0」として黙って合格していた**。

実測（修正前、6 種の不正値）:

| 値 | 修正前 | 修正後 |
| --- | --- | --- |
| `""` / `null` / `false` / `[]` | **exit 0**（severity 0 として合格） | exit 1（structural problem） |
| `-5` | exit 0 | exit 1（範囲外） |
| `42` | exit 1 だが **finding として**（重大度 42 の検出と誤分類） | exit 1（範囲外 = 読めない値） |

**「重大度が明示されているが読めない」ことと「重大度が無い」ことは違う。** 前者は分類できない
のだから、分類できないという記録を残して落とす。後者（キー自体が無い）は `level` による判定へ
回す。抑制チャネルと同じく、不正な入力が**拒否ではなく沈黙**を生む形が問題であり、
`docs/security/evidence-gate-audit.md` §3.5 の「空集合を合格として扱わない」の変種である。

判定は次の 4 段で、いずれも finding ではなく **structural problem** に数える。範囲外の値は
「極めて重大な検出」ではなく「読めない値」だからである（`42` を finding として扱うと、
壊れた SARIF が最重大の検出に化ける）。

1. キー自体が無い → 判定しない（`level` へ委ねる）
2. 文字列でも数値でもない（`null` / boolean / array / object）→ 失敗
3. 文字列だが空・空白のみ → 失敗（**明示された `0` とは区別する**）
4. 数値として読めない、または `0`–`10` の範囲外 → 失敗

`"0"` と `0` は正当な値として合格し続ける。これが本検査を「空値の禁止」ではなく「値の検証」に
している核心なので、回帰テストで固定した。

ただし `0` を受理することは**本リポジトリのローカル方針であって、SARIF の定義域ではない**。
`security-severity` は SARIF 標準のプロパティではなく GitHub code scanning の拡張であり、
GitHub 側では `0` は「重大度の表明が無い」として扱われ、`0`–`10` という区間も
GitHub の換算表（`0.0–3.9` low / `4.0–6.9` medium / `7.0–8.9` high / `9.0–10.0` critical）に
由来する。本検査が `0` を「読めない値」ではなく「正当な値」として通すのは、
*壊れた SARIF を検出する* という本検査の目的にとって `0` は壊れていないからであり、
*重大度が低い* と判断したからではない。

この区別が実装上で意味を持つ場面がある。**`security-severity` が `0` でも `level: error` なら
本ゲートは FAIL する。** 判定は「severity ≥ 7 **または** level ∈ FAILING_LEVELS」の**論理和**で
あって、severity 側の値が判定を打ち切る構造にはなっていない。`0` を「重大度なし」と読み替えて
level 側を見ない実装にすると、error の指摘が丸ごと素通りする。この経路は回帰テスト
`fails a severity-0 rule whose level is error, without consulting either constant`
（`tests/unit/codeql-sarif-gate.test.ts`）で固定した。テストは `0` と `error` を**リテラルで**
書いており、`FAILING_LEVELS` などの定数を経由しない。定数を経由させると、定数を書き換えた
変更がテストごと道連れになって、固定したはずの経路が黙って消える。

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

#### 復帰時の SARIF ライフサイクル（①を実施する前に決めること）

`output: sarif-results` を外すと CodeQL の SARIF 既定出力は `../results` へ戻る。artifact の
保存側・取得側・判定スクリプトの引数・契約はすべて `sarif-results` と artifact 名
`codeql-sarif` に乗っているため、①だけを実施すると **artifact が生成されない / 取得できない**。
どちらへ倒すかを先に決め、同じ変更で全経路を揃える。

| 決めること | A: artifact を維持する | B: artifact をやめる |
| --- | --- | --- |
| `analyze` の `output:` | `sarif-results` を残す（`upload: never` だけ外す） | 削除（既定 `../results` へ戻す） |
| upload / download step | そのまま | 両方削除 |
| `codeql-findings` ジョブ | そのまま（決定 4 を残す場合） | 削除 |
| `check-github-actions-contract.js` | `upload: never` の要求行のみ削除 | CodeQL 関連の契約行（`upload: never` / `output:` / retain step / artifact 名・path・`needs` / `if: always()` / 判定 step）をまとめて削除 |
| 判定の所在 | 決定 4 と code-scanning の二重管理を明示的に受容する | code-scanning のアラート運用へ一本化する |

切替は canary run で確認してから本適用する。`default-setup` API の 403 が消えたことは
**GHAS が使えること**しか示さず、SARIF が実際に取り込まれ可視化されたことは示さない。

#### canary の実施手順（人間が実行する。自動ゲートにしない）

**検出0件を成功条件にしてはならない。** 「Code Scanning 画面にアラートが出ない」は、
取り込みが壊れている状態と、取り込みが正常でコードに指摘が無い状態を区別できない。
経路の疎通は、**出ることが分かっている指摘**が実際に出ることでしか確認できない。

1. 短命ブランチに、対象言語で CodeQL が確実に検出するコードを1つ置く
   （例: `js/sql-injection` のように、既定クエリスイートに含まれ検出条件が明確なもの）。
   `main` へは入れない。canary 用ブランチは確認後に削除する
2. その run で **その指摘が Code Scanning 画面に現れること**を目視する。
   件数と rule id を控える（画面が空でないことではなく、**期待した指摘であること**を見る）
3. A を選んだ場合は artifact の生成と取得が両方成功することを確認する
4. `node scripts/tools/check-github-actions-contract.js` が通ることを確認する
5. canary ブランチを削除し、`main` に埋め込みコードが残っていないことを確認する

この手順を CI のゲートへ落とし込まないこと。ゲート化するには「指摘が出ること」を
恒常的な合格条件にする必要があり、それは**検出されるコードをリポジトリに常設する**ことを
意味する。逆に「エラーが出ないこと」を合格条件にすると、沈黙で通るゲート
（`docs/security/evidence-gate-audit.md` §3.5 の欠陥クラス）を新設することになる。
経路疎通の確認は移行時の一度きりの人間作業として扱い、担当・実施日・観測した rule id を
Issue #139 へ記録する。

上記の判定を Issue #139 のクローズ条件へも書いておくこと。ADR 側にだけ書くと、
Issue を閉じた人が契約行の存在を知らないまま放置される。

### その他

- GitHub プランを GHAS 対応へ変更した場合は、`upload: never` を外し通常の
  code-scanning アップロードへ戻す（本ADRを更新する）。手順は上の
  「復帰時の SARIF ライフサイクル」に従うこと。`upload: never` を外すだけでは
  artifact 経路が壊れる
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

分類・対応は **Issue #142** で追跡する。`codeql-findings` を required status checks へ
追加する（= 必須化する）判断は、#142 の完了条件が満たされた後の §17 案件であり、
人間の決裁を要する。
