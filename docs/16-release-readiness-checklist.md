# リリース直前チェックリスト

CODIPを共有プレビューまたは本番相当環境へ出す前に、次の項目を必ず確認する。

## 1. ビルド・テスト

| 区分 | コマンド | 合格条件 |
| --- | --- | --- |
| 静的解析 | `npm run lint` | エラー0件 |
| 型検査 | `npx tsc --noEmit` | エラー0件 |
| 単体テスト | `npm run test` | 全テスト成功 |
| 依存監査 | `npm audit --audit-level=moderate` | moderate以上0件 |
| DB事前確認 | `DATABASE_URL=file:./dev.db npm run db:check-duplicates` | 公式URL重複0件 |
| 標準レコード方針 | `npm run db:check-standard-record-policy` | SQLite fallbackとPostgreSQL/PostGIS `standard_records` 読取MVPの契約がDB状態と一致 |
| PostgreSQL schema確認 | `npm run db:compare-schemas && npm run db:pg:validate && npm run db:pg:generate` | 中核モデルとPostgreSQL schemaが妥当 |
| PostgreSQL drift確認 | `npm run db:pg:check-drift` | 適用済みDBと `prisma/postgresql/schema.prisma` に差分がない |
| PostGIS DDL確認 | `npm run db:pg:check-postgis-ddl` | `standard_records` のPostGIS extension、SRID、index、JSONB defaultが一致 |
| API契約確認 | `npm run release:check-v1-contract && npm run release:check-doc-api-contract && npm run release:check-openapi-coverage` | v1契約、docs/API整合、OpenAPI route掲載が妥当 |
| Docker契約確認 | `npm run release:check-docker-contract` | Dockerfile、`.dockerignore`、image scan、GHCR push、SBOM/provenance設定が妥当 |
| Cloudflare/Neon契約確認 | `npm run release:check-cloudflare-contract` | staging runbook、環境変数、PostGIS/Hyperdrive前提が文書化済み |
| GitHub Actions契約確認 | `npm run release:check-github-actions-contract` | actionlint、危険なworkflow trigger、Trivy action固定、主要ActionsのSHA固定が妥当 |
| env検証 | `npm run release:validate-env:preview` | 共有プレビュー必須設定が妥当 |
| production env形状検証 | `npm run release:gate` 内の合成production env | PostgreSQL/PostGIS前提、外部DBのSSL指定、本番管理トークン強度、SQLite/未対応DB URL/起動時migration禁止の検査ロジックを確認 |
| production実ターゲットenv検証 | 実デプロイ環境のSecrets/Variablesを読み込んで `npm run release:validate-env:production-target` | `CODIP_DEPLOY_TARGET`、実HTTPS `CODIP_BASE_URL`、Cloudflare Hyperdrive、Neon branch、migration direct URL、外部PostgreSQL SSL、管理トークンまたはProxy認証設定、起動時migration禁止が実値で妥当 |
| ログ保持dry-run | `npm run db:prune -- --dry-run` | 取得ログ・サンプル保持期間の削除候補を確認できる |
| 本番ビルド | `npm run build` | 成功 |
| リリースゲート | `npm run release:gate` | ブラウザ非依存ゲートが一括成功 |
| 起動スモーク | `CODIP_ADMIN_TOKEN=... npm run release:smoke -- --base-url http://127.0.0.1:3100` | 主要画面、未認証管理UI非表示、CSP/HSTS、監視API、OpenAPI v1 schema、seed最小件数、公開DTO、後続API契約、v1 warning契約、地点照会の不正入力、管理APIガード、管理セッションCSRF、悪性URL複数種の登録拒否が成功 |
| 実ターゲットread-onlyスモーク | `npm run release:smoke -- --read-only --base-url https://...` | staging/production DBへ書き込まず、主要画面、監視API、後続API、管理ガードを確認 |
| Docker preview | GitHub Actions `docker-preview` job | production runner / preview runner build、production runner + PostgreSQL smoke、SQLite/PostgreSQL compose config、preview起動、ready、release smokeが成功 |
| Docker image scan | GitHub Actions `docker-image-security` job | Trivyでproduction runner imageに固定可能なHigh/Critical CVEがない |
| Docker supply chain | GitHub Actions `docker-supply-chain` job | GHCR image push、SBOM attestation、`mode=max` provenance、sha tag/digestが確認できる |
| PostGIS service image | CI service / PostgreSQL preview compose | `postgis/postgis@sha256:...` でdigest固定されている |
| Secret scan | GitHub Actions verify job | gitleaksと `.env` 追跡検出が成功 |
| SAST | GitHub Actions CodeQL | CodeQL workflowが成功。code scanning alert gateとして扱う場合はリポジトリ側でcode scanningを有効化し、`continue-on-error` の扱いをrelease前に再確認 |
| E2E | `npm run test:e2e` | CIまたはブラウザ実行可能環境で成功 |

## 1.1 リリース証跡

### 2026-07-13 Draft PR #17 記録済みgreen baseline

| 項目 | 記録 |
| --- | --- |
| PR | #17 `agent/release-readiness-postgis-ci` |
| commit SHA | `e2c007f4772235b77f9228805714d8aee4f8404d` |
| commit message | `align docker smoke admin token` |
| CI run | `29232542066` success |
| CodeQL run | `29232541952` success |
| verify | pass |
| e2e | pass |
| postgresql-compat | pass。PostGIS migration、seed、`/api/v1` standard_records smokeを確認 |
| docker-preview | pass。preview-runner migration/seed、production runner smokeを確認 |
| docker-image-security | pass。Trivy High/Critical CVE checkを確認 |
| production-target-env | skipped。PRでは実ターゲットSecretsを読まず、`workflow_dispatch` 実行時に記録 |
| docker-supply-chain | skipped。PRではpushせず、`main` push後にGHCR tag/digest/SBOM/provenanceを記録 |
| CodeRabbit | Draft PRのためreview skipped。Ready化後または `@coderabbitai review` で実レビュー |
| ローカルread-only smoke | `http://127.0.0.1:3104` に対して63 checks成功 |
| ローカルDocker | Docker daemon未接続のためローカル実行不可。CI `docker-preview` を証跡に採用 |

最新のPR headに対するCI状態はGitHub PR checksを正とする。実ターゲットstaging/production release時は、下の記録欄へ対象環境のSecrets/Variables、GHCR digest、SBOM/provenance、read-only smoke結果を追記する。

### 2026-07-13 Issue #15 テストカバレッジ補完 + ローカルrelease:gate green

| 項目 | 記録 |
| --- | --- |
| PR | #17 `agent/release-readiness-postgis-ci` |
| commit SHA | `06fa915b7dd1992760b76f1f045406ae0f4bc704` |
| 変更内容 | `CODIP_ADMIN_EMAIL_DOMAINS` allowlist（ドメイン一致・`@`prefix正規化・非該当ドメイン拒否）のunitテスト3件を `tests/unit/admin-auth.test.ts` に追加。自己導入回帰として `worker-configuration.d.ts`（`wrangler types` 生成物）が `tsconfig.json`/`eslint.config.mjs` の走査対象に含まれ、`NodeJS.ProcessEnv` をグローバル汚染していた問題を発見し、両ファイルのexclude/ignoresへ追加して解消 |
| `npm run release:gate` | pass。audit → 契約チェック8種 → db:prune dry-run → schema parity → postgresql validate/generate → env契約（local/preview/production-synthetic）→ lint → typecheck → unit test 206件（19ファイル）→ production build（27 routes）まで一括成功 |
| `npx tsc --noEmit` | エラー0件（`worker-configuration.d.ts` 除外により、無関係ファイルへ波及していた `TS18046 unknown` 系カスケードエラーが解消したことを個別確認） |
| `npm run lint` | 警告0件（除外前は生成物由来の unused eslint-disable directive 警告2件） |
| `npx vitest run` | 206 passed（admin-auth.test.ts は24→27件に増加） |
| E2E (`npx playwright test`) | ローカルサンドボックスで6件失敗。全て `browserType.launch` 起動直後の `SIGTRAP` によるプロセス強制終了で、テスト対象ロジック（admin-session、CSRF、タグ、データソース登録）とは無関係。§5「現時点の既知制約」に記録済みのローカルChromium起動制約の再現であり、CIでのE2E成功実績（直前baseline参照）と矛盾しない。追加対応不要と判断 |
| 人間確認事項 | main へのmerge可否は人間の明示承認待ち（自動merge対象外: release-readiness PRのため） |

### 2026-07-13 CI `npm ci` EUSAGE障害の原因分析と修正

直前commit (`06fa915`→`e2f5041`) push後のCI再実行で `verify` / `e2e` / `postgresql-compat` / `docker-preview` / `docker-image-security` の5ジョブが `npm ci` EUSAGE (`Missing: @emnapi/runtime@1.11.2 from lock file` / `Missing: @emnapi/core@1.11.2 from lock file`) で失敗した。ローカルの `npm ci` は成功しており矛盾していたため、原因分析を実施。

| 項目 | 記録 |
| --- | --- |
| PR | #17 `agent/release-readiness-postgis-ci` |
| 修正commit SHA | `0d31a4a` |
| 根本原因 | `package-lock.json` をローカルのnpm 11.6.2 (Node v25.2.1) で生成しており、CI実行環境のnpm 10.9.8 (`.github/workflows/ci.yml` の `actions/setup-node` で `node-version: 22` 指定) とでpeer/optionalDependency解決結果が異なっていた。`@ast-grep/napi` のWASMフォールバック用optionalDependency (`@emnapi/core`・`@emnapi/runtime`) がnpm 11.xでは暗黙に充足済みと判定されlockfileへの明示エントリが省略される一方、npm 10.xの `npm ci` は厳格に不在と判定してEUSAGEを出していた |
| 再現方法 | `nvm use 22` でCIと同一のnpm 10.9.8に切り替え、`rm -rf node_modules && npm ci` でCIと同一のEUSAGE失敗をローカル再現 |
| 修正方法 | 同じnpm 10.9.8環境で `npm install` を実行し `package-lock.json` を再生成（26 insertions, 25 deletions。`@emnapi/core`・`@emnapi/runtime` エントリ追加と一部 `peer` フラグ調整のみ。意図しないパッケージバージョン変動なし） |
| 検証 | 修正後の lockfile で npm 10.9.8・npm 11.6.2 の両方において `npm ci` 成功を確認。`npm run release:gate` も再実行し pass を確認 |
| CI再実行結果 | run `29237264877` (CI) / `29237265144` (CodeQL) 双方success。`verify`・`e2e`・`postgresql-compat`・`docker-preview`・`docker-image-security` すべて `pass` に復帰 |
| 学習 | lockfile生成・検証は、コミット前にCI実行環境と同一のNode/npmバージョン (`nvm use <ci-node-version>`) で行うことで、ローカル/CI間のnpmバージョン差に起因する `npm ci` 失敗を未然に防げる |

### 2026-07-13 CodeRabbit Agentレビュー(コミット済み差分)結果と対応

`coderabbit:code-reviewer` エージェント(バックグラウンド実行、`coderabbit review --agent --base main --type committed` をラップ)により、mainとの差分5コミット(`04ee580`〜`e2f5041`)を対象とした独立レビューを実施した。`npx tsc --noEmit`・`npm test`・`npm run lint`・`npm audit`・`npx wrangler types` の実測値、およびCloudflare Terraform provider公式スキーマドキュメントとの照合による検証済みレビュー。

| 重大度 | 件数 | 内容 | 対応 |
| --- | --- | --- | --- |
| Critical | 0 | 該当なし。シークレット漏洩なし、`npm audit` 0 vulnerabilities | - |
| High | 1 | `infra/cloudflare/access.tf`: Terraform provider v5に存在しない `application_id`/`precedence` を使用し、`include` をv4形式の `dynamic` ブロックで記述していたため、human operatorの初回 `terraform apply` が確実に失敗する構成だった | 修正済み(commit `00d66e8`)。`include` をv5のAttributes Set形式に書き換え、ポリシー→アプリケーションの関連付けをv5仕様どおり `cloudflare_zero_trust_access_application.policies` 側に反転 |
| Medium | 1 | `infra/cloudflare/variables.tf`: `allowed_emails`・`allowed_email_domains` が両方空でも `terraform apply` を止める検証がなく、Access保護が実質無効なポリシーが無警告で作られ得る | 修正済み(commit `00d66e8`)。`allowed_email_domains` にcross-variable `validation` を追加。`versions.tf` の `required_version` を `>= 1.9` に引き上げ(cross-variable validationはTerraform 1.9.0以降の機能のため) |
| Low | 2 | (1) `docs/13-deployment-and-operations.md` 112行目に旧「Cloudflare Pages/Workers」表記が残存し、同ファイル19行目の採用方針説明と矛盾。(2) `tsconfig.json`/`eslint.config.mjs` の除外設定自体は正しいとの確認のみ | (1) 修正済み(commit `00d66e8`)、「Cloudflare Workers」表記に統一。(2) コード変更不要と判断。CodeRabbit CLIの代替提案(`compilerOptions.types` へ追加)は `NodeJS.ProcessEnv` グローバル汚染を再発させるため不採用と明記されており、現状の `exclude` ベースを維持 |

**High指摘の二重検証**: CodeRabbit Agent自身が「サンドボックスに `terraform` 未インストールのためドキュメント照合による推論」と申告していたため、以下2点で独立検証を行った。

1. Cloudflare Terraform provider公式ドキュメント(`zero_trust_access_policy.md`・`zero_trust_access_application.md`)をWebFetchで直接照合し、`application_id`/`precedence` が同リソースに存在しないこと、`include`/`policies` がそれぞれAttributes Set/Attributes Listであることを確認
2. Terraform 1.9.8を一時的にスクラッチパスへ導入し、`infra/cloudflare` で `terraform init && terraform validate` を実機実行して `Success! The configuration is valid.` を確認(provider `cloudflare/cloudflare` v5.22.0)。`.terraform.lock.hcl` は `terraform providers lock -platform=linux_amd64 -platform=darwin_amd64 -platform=darwin_arm64 -platform=windows_amd64` で4プラットフォーム分のチェックサムを含めて生成しコミットした

| 項目 | 記録 |
| --- | --- |
| レビュー対象 | `agent/release-readiness-postgis-ci` の main との差分5コミット(`04ee580`〜`e2f5041`) |
| 修正commit SHA | `00d66e8` |
| 実機検証 | `terraform validate` success (provider cloudflare/cloudflare v5.22.0、Terraform 1.9.8) |
| 未対応 | なし。Critical/High/Medium/Lowすべて対応完了 |
| 残課題 | Codexレビュー(通常・対抗)は `disable-model-invocation` によりCTOから自律起動不可のため未実施。人間への実行依頼が必要 |

### 2026-07-13 CodeRabbit全体レビュー(--type all、mainとの全差分)結果と対応

`coderabbit:code-reviewer` エージェント(バックグラウンド実行、`coderabbit review --agent --base main --type all` をラップ、PID監視で完了検知)により、`agent/release-readiness-postgis-ci` ブランチの main との全差分(156ファイル、約18.2k行、所要約13分)を対象とした包括レビューを実施した。JSONL形式の出力(finding単位でストリーム、最終行に `status: review_completed` サマリー)をパースして全件を確認。

| 重大度 | 件数 | 内容 |
| --- | --- | --- |
| Critical | 0 | 該当なし |
| Major | 6 | `scripts/db/sqlite-backup.sh` 3件(sqlite3不在時の不安全な`cp`フォールバック・バックアップファイル名衝突・umask未設定)、`src/lib/url-safety.ts` 1件(URL解析失敗時のfail-openパターン)、`playwright.config.ts` 1件(`reuseExistingServer`が既存サーバーの設定を未検証のまま再利用)、`scripts/tools/compare-prisma-models.js` 1件(PostgreSQL専用フィールドの許可リストがフィールド名のみ検証し型・リレーション定義を見ない) |
| Minor | 2 | `src/lib/standard-records.ts` 2件(GeoJSON feature化で`safeProperties`のスプレッド順序が逆で生プロパティが正規フィールドを上書き可能・`standardRecordsAvailable`が空結果を永続キャッシュし後続の取り込みを反映しない) |

**対応内容(major 6件・minor 2件、計8件すべて対応済み)**:

| ファイル | 対応 |
| --- | --- |
| `scripts/db/sqlite-backup.sh` | `sqlite3`不在時は`cp`フォールバックせず`exit 1`(WALモードでの破損コピー防止)、`mktemp`でバックアップパスの一意性を保証、`umask 077`でowner-only権限を強制。実機検証: 同一秒内2回連続実行でファイル名衝突がないこと、ディレクトリ700・ファイル600権限になることを確認 |
| `src/lib/url-safety.ts` | `hasUrlCredentials`・`hasSecretQueryParams`はURL解析失敗時に`true`(安全側)を返すよう変更、`sanitizeUrl`は解析失敗時に元の入力ではなく固定文字列`"[invalid-url]"`を返すよう変更(fail-open→fail-closed)。専用テストが存在しなかったため`tests/unit/url-safety.test.ts`を新規追加(12件) |
| `src/lib/standard-records.ts` | GeoJSON feature化で`...safeProperties(row.properties)`を正規フィールドより先にスプレッドするよう順序を修正(`standardRecordDto`と同じパターンに統一)。`standardRecordsAvailable`は`true`の結果のみキャッシュし、`false`は毎回再評価するよう変更。`tests/unit/standard-records-availability.test.ts`を新規追加(4件、false→true遷移を含む) |
| `playwright.config.ts` | `webServer.reuseExistingServer`を`!process.env.CI`から`false`固定に変更。PlaywrightはURL疎通しか確認できずDB/admin token/allowed-origin設定を検証できないため、常に指定`command`でサーバーを起動し直す |
| `scripts/tools/compare-prisma-models.js` | `allowedPostgresOnlyFields`を`Set<string>`(フィールド名のみ)から`Map<string, string>`(フィールド名→期待される正規化済みシグネチャ)に変更し、型・リレーション定義の不一致も検知するよう修正。実機検証: 現行スキーマでexit code 0、シグネチャを意図的に壊した改変版でexit code 1になることを確認 |

既存テスト`tests/unit/http-client.test.ts`の`sanitizeUrl`旧仕様(fail-open)を前提にしたケースも新しい安全側の期待値に更新した。

| 項目 | 記録 |
| --- | --- |
| レビュー対象 | `agent/release-readiness-postgis-ci` の main との全差分(156ファイル、約18.2k行) |
| 修正commit SHA | `fbf81b9` |
| ローカル検証 | lint clean・`tsc --noEmit` clean・vitest 222/222 pass(新規16件含む)・production build success |
| 未対応 | なし。Critical/Major/Minorすべて対応完了 |
| 残課題 | Codexレビュー(通常・対抗)は `disable-model-invocation` によりCTOから自律起動不可のため未実施。人間への実行依頼が必要(§91行目と同一課題) |

### 2026-07-13 Codex代替の独立レビュー(silent-failure-hunter / code-reviewer)結果と対応

本PRはPostgreSQL/PostGISのDBスキーマ変更を含むため、プロジェクト方針上はCodex対抗レビューが必須対象だが、`disable-model-invocation`によりCTOから自律起動できない(上記残課題と同一)。人間への実行依頼は継続しつつ、応答を待つ間の品質保証を補強する目的で、性質の異なる2種類の独立レビューエージェントをCodeRabbit対応コミット(`fbf81b9`)に対して並列実行した。

| 観点 | 実行エージェント | 結論 |
| --- | --- | --- |
| エラー処理・沈黙failure(fail-open/fail-closedの一貫性、並行性、握り潰し) | `silent-failure-hunter` | Critical/High該当なし。LOW 1件(`secretQueryParamNames()`のfail-open運用が関数名から読み取れない) |
| 一般コード品質(意図した問題の解決度・新規テストの妥当性・既存規約との整合性・型検証の抜け道) | `feature-dev:code-reviewer` | Critical/High該当なし(confidence≥80の問題0件)。merge blockingな指摘なし |

**対応内容(LOW 1件)**:

| ファイル | 対応 |
| --- | --- |
| `src/lib/url-safety.ts` | `secretQueryParamNames()`にJSDocを追加し、この関数がfail-open(パース失敗時`[]`)であることと、安全性判定には`hasSecretQueryParams`(fail-closed)を使うべきことを明記。動作変更なし、ドキュメントのみ |

| 項目 | 記録 |
| --- | --- |
| レビュー対象 | commit `fbf81b9`(6ファイル)。ドキュメントのみの`e616fe9`は対象外 |
| 修正commit SHA | `094316f` |
| ローカル検証 | `tsc --noEmit` clean・lint clean・`tests/unit/url-safety.test.ts`+`tests/unit/http-client.test.ts` 23/23 pass |
| 未対応 | なし |
| 残課題 | Codexレビュー(通常・対抗)自体は未実施のまま(上記と同一課題)。今回の独立レビューはCodexの代替であって同一ではなく、人間によるCodex実行判断は引き続き必要 |

### 2026-07-13 証跡commit・PR本文への反映確認

上記2件(CodeRabbit全体レビュー対応・独立レビュー対応)のドキュメント証跡commitに対するCI結果、およびPR本文への反映を記録する。

| 項目 | 記録 |
| --- | --- |
| 証跡commit | `e616fe9`(CodeRabbit分)、`f3d0608`(独立レビュー分) |
| `f3d0608` CI結果 | GitHub Actions 全項目 pass(analyze / docker-image-security / docker-preview / e2e / postgresql-compat / verify)。`docker-supply-chain` / `production-target-env` は条件付きskip(想定通り) |
| PR #17 本文 | CodeRabbit全体レビュー結果と独立レビュー結果(silent-failure-hunter / code-reviewer)を追記し、`gh api ... -X PATCH`で更新済み |
| PR状態 | draft継続。Codexレビュー(通常・対抗)が人間未実行のため、CTO判断でreadyへの遷移は保留 |

### 2026-07-17 自律 CTO 再検証

PR #17 branch (`agent/release-readiness-postgis-ci`) を自律 CTO が再検証した。Docker PostGIS preview (`docker-compose.postgresql-preview.yml`) を新規ビルド・起動し、SQLite preview と PostgreSQL/PostGIS 環境の両方で全ゲートを再走させた結果、ローカルで取りうる検証は全 green。

| 項目 | 記録 |
| --- | --- |
| branch | `agent/release-readiness-postgis-ci` (PR #17 Draft 継続中) |
| HEAD commit | `1f1d570` |
| lint / type / unit | 0 / 0 / 222 pass |
| contract checks (6種) | all OK (19 API routes covered) |
| `release:gate` | OK |
| `npm run build` | success (27 routes) |
| Docker PostGIS preview | `civil-open-data-intelligence-platform-{codip,postgres}-1` healthy。`http://127.0.0.1:3102` で standard_records 1 行を投入・seed |
| `db:pg:check-drift` | OK (`standard_records` GiST index のみ無視は仕様、 `db:pg:check-postgis-ddl` で別途検証) |
| `db:pg:check-postgis-ddl` | OK |
| `db:check-standard-record-policy` (PostgreSQL) | OK: standard_records=1 |
| `validate-env --mode preview` | OK |
| `release:smoke --base-url http://127.0.0.1:3102 --expect-standard-records --expect-seed-standard-record` | OK 80 checks (v1 records/point/layers/layers-features/freshness payload + admin guard + CSRF + 悪性URL 6種拒否) |
| ソース内 機密値 grep (`password|api[_-]?key|secret|token`) | ヒット 0件 (label/regex/placeholder のみ) |
| ソース内 TODO/FIXME/XXX/HACK | 0件 |
| ローカル E2E (`npm run test:e2e`) | 18 failed (Chromium `SIGTRAP` 起動直後強制終了)。§5「現時点の既知制約」に既載のローカル Chromium 制約の再現。CI `e2e` ジョブは `pass` 実績で、本制約と矛盾しない。追加対応不要 |

| 残課題 | 状態 |
| --- | --- |
| Codex review (通常・対抗) | 未実施。Issue #19 で人間依頼中、PR は Draft 維持 |
| Issue #18 Workers 互換性 (`dns.lookup`, `driverAdapters`) | 部分解消。SSRF事前DNS検証は `resolve4` / `resolve6` へ更新済み、PostgreSQL Prisma Clientは `@prisma/adapter-pg` へ更新済み。Prisma 6.19系ではdriver adapterのpreview flagは不要。残りは接続時DNSピン留めのWorkers最終設計と実Cloudflare/Neonリソース証跡 |
| PR #17 merge | 人間判断待ち (Codex レビュー結果 + main 承認) |
| Cloudflare/Neon staging smoke 実環境証跡 | 未実施 (staging/production deploy 時に記録欄 §6 を使用) |

### 2026-07-18 自律 CTO 再検証 + インフラ実態調査 (本セッション)

前セッション (2026-07-17) の証跡が未 commit のまま残っていたため、**主張をそのまま信用せず全ゲートを再実行**して再現性を確認したうえで commit した。加えて、これまで文書上の前提でしかなかった Cloudflare / Neon の**実リソース存在確認**を初めて実施した。

#### 再検証結果 (全て再現・commit `1f1d570` に対して実行)

| 項目 | 結果 |
| --- | --- |
| `npm run lint` | PASS (0 errors) |
| `npx tsc --noEmit` | PASS (0 errors) |
| `npm run test` | PASS (222/222, 21 files) |
| `npm run build` | PASS (27 routes) |
| `npm run release:gate` | PASS |
| 契約チェック 6 種 + `db:compare-schemas` | PASS (all OK) |
| `db:pg:validate` / `check-postgis-ddl` / `check-drift` / `check-standard-record-policy` | PASS (稼働中 PostGIS コンテナへ実接続) |
| `release:smoke --base-url http://127.0.0.1:3102 --expect-standard-records --expect-seed-standard-record` | PASS (80 checks) |
| CI (GitHub Actions) | PASS。`head_sha = 1f1d570` が現 HEAD と一致することを確認済み |

#### 新規発見と対応

| # | 発見 | 重要度 | 対応 |
| --- | --- | --- | --- |
| 1 | **実行可能な rollback 手順が存在しなかった**。`docs/13` に rollback の記載がゼロ、runbook 2 本にも事象→方針の表のみでコマンドがなく、リリースゲート「rollback 手順が文書化済み」を実質的に満たしていなかった | High | `docs/runbooks/rollback.md` を新規作成 (判断フロー / Workers / GHCR / Neon PITR / Prisma / SQLite / 検証 / 記録欄)。`docs/13` §4.1・§5 から接続 |
| 2 | **Cloudflare / Neon の実リソースが未作成**。Worker `codip` 不在 (`workers_list` は別プロジェクトのみ)、Hyperdrive config 0 件、CODIP の Neon project 不在 | 情報 (Blocker ではない) | 「未デプロイ」が正常状態。ただし本番化は Neon project 作成・Hyperdrive 作成 (課金発生・人間承認必須) から始まる旨を §本番化の前提 に明記 |
| 3 | **main に branch protection が未設定** (`gh api .../branches/main/protection` → 404)。「CI 未通過 merge 禁止」「main 直 push 禁止」が運用規律のみで技術的強制がない | Medium | Issue 起票。PR #17 merge 前の設定を推奨 |
| 4 | **PR #17 の merge は GHCR へのイメージ push を伴う**。`.github/workflows/ci.yml:448` の `docker-supply-chain` が `push && refs/heads/main` で発火 | 情報 | 承認者への申し送り事項として明記 (リポジトリが private のためイメージも既定 private) |
| 5 | Issue #18 の fail-closed 評価を **Cloudflare 公式ドキュメントで一次裏付け**。`node:dns` は `nodejs_compat` で利用可能だが `lookup` / `lookupService` / `resolve` は "Not implemented" を throw する | 情報 | `docs/13` §2 の既存評価 (fail-closed) が正しいことを確認。修正経路も `resolve4`/`resolve6` 置換で確定 |
| 6 | `npm run db:pg:validate` 等は `localhost:5432` 前提だが、`docker-compose.postgresql-preview.yml` は postgres のポートを公開していないため、チェックリスト記載のコマンドがローカルでそのまま通らない | Low | 下記「PostgreSQL チェックの実行方法」に回避手順を記載 |
| 7 | Neon の history window は同組織の既存プロジェクトで **24 時間**。障害検知が翌日にずれると PITR で戻せない | Medium | `docs/13` §5 と rollback.md §4.3 に警告を記載。本番 Neon project 作成時に要判断 |

#### 独立監査エージェント 3 種の結果 (2026-07-18)

性質の異なる 3 つの read-only 監査エージェントを並列実行した。Codex レビューの代替ではなく、待機中の品質保証を補強する目的。

| 観点 | 結論 | blocking |
| --- | --- | --- |
| 🔒 セキュリティ (secret / PII / 認可 / injection / SSRF / XSS / 依存 / ヘッダ) | Critical 0・High 0。Medium 2・Low 3 | **0 件** |
| 📋 文書と実装の整合性 | High 1・Medium 3・Low 3 | **1 件 (本セッションで修正済み)** |
| 🎨 UI / アクセシビリティ | Medium 3・Low 1。ただし実ブラウザ検証は BLOCKED | **0 件** (ただし下記の NOT RUN に注意) |

**セキュリティ監査で確認された主な事項** (いずれも独立に再現可能):

- git 全履歴 (45 commits) のファイル名走査で `.env` / `*.pem` / `*.key` の混入 0 件。高エントロピーパターン (`AKIA` / `sk-` / `ghp_` / `xox*-` / PEM / JWT) 0 件
- 全 19 route を個別確認。状態変更系 (POST/PUT/DELETE) は全件が関数先頭で `requireAdminRequest()` を呼ぶ。Server Actions は 0 件
- 生 SQL 20 箇所すべてパラメータ化 (`$queryRawUnsafe` / `Prisma.raw` の使用 0 件)
- SSRF は多層防御 (静的検証 → 事前 DNS 検証 → 接続時 DNS ピン留め → リダイレクト各ホップ再検証 → 読込上限)。パース不能な IPv6 は非公開扱いで拒否 (fail-closed)
- `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` の使用 0 件
- `npm audit`: 全依存 862 packages / prod のみ 63 packages ともに全重大度 0 件

**文書監査で検出された High (修正済み)**: SQLite 復元手順のバックアップファイル名が実スクリプト出力と不一致で、記載どおりでは必ず失敗する状態だった。実際に `scripts/db/sqlite-backup.sh` を実行して不一致を確認したうえで修正した (commit `30fd76e`)。

| 指摘 | 対応 |
| --- | --- |
| High-1 復元手順のファイル名不一致 | ✅ 修正。`ls -1t` で実ファイルを列挙する方式へ変更、旧 WAL/SHM 削除も追加 |
| Medium-2 `docs/13` に rollback 導線なし | ✅ 修正。§4.1 を新設し runbook へ接続 |
| Medium-3 `CODIP_ENV_MODE` 未文書化 | ✅ 修正。`.env.example` と §2.1 表へ追記 |
| Medium-4 README の 3104 URL と私有 IP | ✅ 修正。compose 実ポート 3100/3102 へ置換 |
| Low-6 README に database-deployment.md / rollback.md の掲載なし | ✅ 修正 |
| Medium (Sec) レート制限が `CODIP_TRUST_PROXY_HEADERS` 未設定時にグローバル化。docs/09 の記述と乖離 | 📋 Issue #23 |
| Medium (UI) title 重複 / 404 英語 / フォーカス指標 | 📋 Issue #22 |
| Low-5 検証専用フラグ 4 種が未記載 | 📋 未対応 (実害なし) |

#### ⚠️ UI 検証の重大な制約 (NOT RUN)

本ホスト (Linux 6.17) では Chromium が全ビルド共通で `SIGTRAP` / RC=133 により起動せず、
Firefox はインストール破損、WebKit 未インストールのため、**実ブラウザによる UI 検証ができなかった**。

| 項目 | 状態 |
| --- | --- |
| desktop (1440x900) レイアウト崩れ・横スクロール | **NOT RUN** |
| mobile (375x667) レスポンシブ挙動 | **NOT RUN** |
| console エラーの有無 | **NOT RUN** |
| キーボード操作の実挙動・フォーカス視認性 | **NOT RUN** |
| client 描画 4 画面 (`/map` `/logs` `/tags` `/sources/new`) の実描画結果 | **NOT RUN** |

curl による SSR HTML 解析で確認できた範囲は PASS: 全 8 ルートで `lang="ja"`・viewport meta 存在・
h1 ちょうど 1 個で階層飛びなし・名前なしコントロール 0 件・`/sources` のフィルタ 7 項目すべて `<label for>` 対応・
empty state 表示・404 は HTTP status 正常。

CI の `e2e` job (chromium) は pass しており `tests/e2e/accessibility.spec.ts` が
スキップリンク + フォーカス遷移・`aria-current`・フォーム label・`role="alert"`・未認証時の管理UI非表示を回帰検証している。
ただし **`playwright.config.ts` の project は `Desktop Chrome` のみで、モバイル viewport の自動検証は存在しない**。
レスポンシブは実装されている (`md:` / `lg:` の 17 箇所、テーブル 4 件中 3 件に `overflow-x-auto`) が、
**自動検証されていない**ことをリリース判断時に考慮すること。

#### PostgreSQL チェックの実行方法 (発見 6 の回避手順)

`docker-compose.postgresql-preview.yml` は postgres のホストポートを公開しないため、
コンテナ IP を指定して `DATABASE_URL` を上書きする。

```bash
PGIP=$(docker inspect civil-open-data-intelligence-platform-postgres-1 \
  --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
export DATABASE_URL="postgresql://codip:codip@$PGIP:5432/codip?schema=public"

node scripts/tools/check-postgis-standard-record-ddl.js
node scripts/tools/check-postgresql-migration-drift.js
node scripts/tools/check-standard-record-policy.js
```

#### 本番化の前提 (実リソース未作成のため)

Cloudflare / Neon への実デプロイは、以下の**人間承認必須**の作業から始まる。CTO は判断材料の提示までとし実行しない。

| # | 作業 | 承認が必要な理由 |
| --- | --- | --- |
| 1 | Neon project / branch の作成 | 課金発生・リソース作成 |
| 2 | `wrangler hyperdrive create` と `wrangler.jsonc` の id 置換 | 課金発生・リソース作成 |
| 3 | `wrangler secret put` による秘密情報登録 | Secrets の登録 |
| 4 | Issue #18 の残件解消 (接続時DNSピン留めのWorkers最終設計、実Hyperdrive/Neon証跡) | `dns.lookup` 依存除去と `@prisma/adapter-pg` 導入は完了。実Cloudflare/Neon targetでのDB接続証跡は本番切替の前提条件 |
| 5 | `infra/cloudflare/` の `terraform apply` (Access 保護) | 本番アクセス制御の変更 |
| 6 | `wrangler deploy --env production` | 本番デプロイ |

### 2026-07-18 Codex レビュー (通常・対抗) 実施と裁定

5 日間人間実行待ちだった Codex レビューについて、人間が「以降のレビュー実行を CTO へ委任
(merge のみ Y/N 人間判断)」と明示したことを受け、CTO が companion script 直接起動で両方を実行した。

| レビュー | 実行方式 | 結果 |
| --- | --- | --- |
| Codex review (通常) | built-in reviewer, `--base main` | 指摘 1 件 (P2)。Critical/High 0 件 |
| Codex adversarial review | 全差分投入方式は 19k 行差分で context window 超過 ×2 → **agentic task モードへ切替**、critical surface (prisma/ + admin-auth + url-guard/http-client/url-safety + standard-records + rate-limit + validators + api/) に限定して成功 | P1 1・P2 3・P3 1、PASS 1 領域 |

#### 裁定と対応 (全 6 指摘)

| # | 指摘 | 裁定 | 対応 |
| --- | --- | --- | --- |
| 通常-P2 | `dataSourceUpdateSchema` が部分更新 (`{requiresApiKey:true}` のみ等) を誤って拒否 | ✅ 採用 (実証再現済み) | **本 PR で修正**。update schema から `superRefine` を外し、PUT route が既存レコードとマージした実効状態で検査する方式へ変更 |
| 対抗-1 P1 | PostGIS migration が環境非依存でなく、down 経路もない | ⚠️ 部分採用 | rollback playbook は `docs/runbooks/rollback.md` (2026-07-18 作成) が既に充足。残る「能力事前確認」を staging runbook §3.0 に **PostGIS capability preflight** として追加。なお Neon は PostGIS を標準サポートしており、指摘中の「Neon で postgis が利用不可」という前提は当てはまらない |
| 対抗-2 P2 | token auth + proxy auth 併存時に token 経路が proxy 境界を迂回 | 📋 条件付き採用 → Issue #24 | token 認証維持は docs/09 記載の意図した設計であり、token 経路に CSRF 検査がないのは正当 (カスタムヘッダーはブラウザが cross-origin 自動送信できない)。ただし「本番は proxy 単独へ絞れるべき」は妥当なため、無効化フラグの追加を Issue 化。PR 凍結方針により merge 後対応 |
| 対抗-3 P2 | 部分更新で URL のみ http へ変更すると requiresApiKey→HTTPS 不変条件が破れる | ✅ 採用 (実証再現済み: `{officialUrl:"http://..."}` が schema を通過) | **本 PR で修正**。通常-P2 と同一のマージ後検査で両方向を同時に閉じた。route テスト 3 件 + 検査関数テスト 5 件を追加 |
| 対抗-4 P2 | rate-limit の識別子が偽装可能/脆弱で分散非対応 | 📋 既知・文書化済み (保留) | TRUST=true の前提条件は docs/09:71 に、単一プロセス制約と WAF 併用は docs/09:69 に記載済み。未設定時のグローバルバケット化は Issue #23 で docs 修正済み (followup branch)。分散ストアは Workers 移行 (#18) と同一スコープ |
| 対抗-5 P3 | `standardRecordsAvailable` が一度 true になると再評価されない | 📋 採用 → Issue #25 | 発生条件 (全レコード運用削除) が稀で再起動で復旧するため P3 妥当。TTL 化を Issue 化し merge 後対応 |

#### 本 PR で適用した修正 (通常-P2 + 対抗-3)

| ファイル | 変更 |
| --- | --- |
| `src/lib/validators.ts` | `apiKeyHttpsInvariantViolation()` を新設 (マージ後の実効状態を検査)。`dataSourceUpdateSchema` から `superRefine` を除去し検査点を route に一本化。create schema は従来どおり |
| `src/app/api/sources/[id]/route.ts` | PUT で既存レコードとマージした実効値に対して不変条件を検査し、違反時は `validation_error` 400 (`.flatten()` 互換形状) |
| `tests/unit/validators.test.ts` | 検査関数 5 ケース + update schema の受理変更を反映 (21 tests) |
| `tests/unit/source-routes.test.ts` | PUT route の両方向 3 ケース追加 (4 tests) |

検証: lint 0 / `tsc --noEmit` 0 / vitest **230/230** pass / production build 成功 / `release:gate` OK / 契約チェック OK。
両指摘は修正前に scratchpad の再現スクリプトで実証し、修正後はテストで回帰化した。

#### 2026-07-18 CodeRabbit 追レビュー (Codex 修正 commit 差分限定) と TOCTOU 対応

Codex 指摘修正 (`51bdda5`) は CodeRabbit 未レビューのコード変更を含むため、merge 判断前に
`coderabbit review --agent -t committed --base 301bf5b` で差分限定レビューを実施した。

| 項目 | 記録 |
| --- | --- |
| 指摘 | major 1 件 (Critical 0): マージ後検査と保存が非アトミックで、フィールドが互いに素な並行部分更新の合成が不変条件を破る TOCTOU |
| 検証 | 論理的に正当と確認 (A: `officialUrl→http` と B: `requiresApiKey→true` が個別に検査を通過し、合成結果 `true+http` が違反) |
| 対応 | `$transaction` 内で UPDATE の実行結果行 (行ロックにより並行 commit 済み値を含む) を再検査し、違反時は rollback + 409 conflict。事前のマージ後検査 (400) は分かりやすさのため維持する二段構え |
| 修正 commit | `059fcc7`。TOCTOU 再現テストを追加 (vitest 231/231 pass) |
| 再チェック | 修正差分への `coderabbit review -t uncommitted` → **findings 0** |

### 実ターゲットリリース時の記録欄

| 項目 | 記録 |
| --- | --- |
| 確認日 |  |
| 確認者 |  |
| commit SHA |  |
| GHCR image tag |  |
| image digest |  |
| Neon branch |  |
| migration ID |  |
| 実ターゲット `release:validate-env:production-target` 結果 |  |
| `db:pg:check-drift` 結果 |  |
| `db:pg:check-postgis-ddl` 結果 |  |
| `/api/ready` 結果 |  |
| `release:smoke` 結果 |  |
| read-only `release:smoke` 結果 |  |
| rollback owner |  |

## 2. ランタイム確認

| URL | 目的 | 合格条件 |
| --- | --- | --- |
| `/api/health` | プロセス生存確認 | `200` と `status: ok` |
| `/api/ready` | DB接続を含むレディネス | `200` と `status: ready` |
| `/api/openapi` | API契約公開 | OpenAPI `3.1.0` を返す |
| `/api/v1/records/search` | 後続システム向け検索 | PostGIS投入時は `standard_records` 由来の `data.records` を返す。SQLite/未投入時も `data.records`、`meta.requestId`、`warnings` を返す |
| `/api/v1/records/point` | 地点照会 | PostGIS投入時は空間評価を返す。未投入時は `records=[]`、`spatialEvaluation.evaluated=false`、`not_standardized` warningを返す |
| `/api/v1/sources/{id}/freshness` | 鮮度API | 品質状態、最終成功日時、連続失敗数を返す |
| `/api/v1/layers` | レイヤー一覧 | `data.layers`、`dataAvailability`、`geometryStatus`、`featuresUrl` を返す |
| `/api/v1/layers/{id}/features` | レイヤー地物 | PostGIS投入時はGeoJSON FeatureCollectionに地物を返す。未標準化時は `not_standardized` warningを返す |
| `/` | ダッシュボード | `200` |
| `/sources` | 台帳検索 | `200` |
| `/map` | 地図プレビュー | `200` |
| `/settings` | 管理設定 | `200` |

## 3. セキュリティ確認

| 項目 | 合格条件 |
| --- | --- |
| 管理操作保護 | 本番・共有プレビューでは `CODIP_ADMIN_TOKEN`、または `CODIP_TRUST_PROXY_AUTH=true`、`CODIP_TRUST_PROXY_SECRET`、管理者メールallowlistを設定 |
| 管理トークン強度 | `CODIP_ADMIN_TOKEN` は32文字以上の十分ランダムな値を使い、共有チャットやGitに貼らない |
| 管理セッション | HTTPSでは `__Host-` Cookie。HTTPローカル検証で `CODIP_ALLOW_INSECURE_LOCAL_COOKIES=true` の場合のみ通常Cookie。CookieはHttpOnly、SameSite Strict、署名付き期限、nonceを持つ |
| CSRF | Cookie認証の変更系管理APIで同一Origin検証が動作し、管理セッション開始・終了ではOrigin/Referer欠落も拒否する |
| プロキシCSRF | Cloudflare Access等のプロキシ認証による変更系管理APIでも同一Origin検証が動作する |
| ローカル解除 | `CODIP_ALLOW_INSECURE_ADMIN=true` はローカル開発以外で使用しない |
| プロキシ信頼 | `cf-access-authenticated-user-email` 単独では管理操作を許可しない |
| 秘密情報 | `.env`、APIキー、認証ヘッダー、接続文字列をGitに含めない。URL内の秘密系クエリは台帳登録時に拒否する |
| Docker context | `.dockerignore` で `.env*` を除外し、`.env.example` のみ許可する |
| Docker runtime | production `runner` はdevDependenciesを含めず、migration/seedは `preview-runner` またはone-off release jobで実行する |
| Secret scan | GitHub Actionsでgitleaksと `.env` 追跡検出を実行する |
| ログ | APIキー、トークン、認証ヘッダーを保存しない |
| ログ・サンプル閲覧 | 取得ログとサンプルレスポンス本文は管理者のみ閲覧可能 |
| APIキー必須データ | サンプル本文をDBへ保存しない |
| 取得URL | SSRF対策により private / loopback / metadata IP を拒否 |
| URL資格情報 | 非HTTPスキーム、内部ホスト、`user:password@host` 形式、秘密系クエリ付きURLを登録拒否し、ログでも除去する |
| 運用ログ返却 | 管理者向けログ・サンプルも返却直前に再マスクする |
| GSI標高API | 台帳URLがGSI正規HTTPSホスト・パスに一致する場合だけ `/api/map/elevation` から取得する |
| 公開検索 | 内部メモ `note` を公開検索条件に含めない |
| ready詳細 | `/api/ready` 障害時に内部例外や接続先を公開しない |
| レート制限 | `/api/dashboard`, `/api/sources`, `/api/tags`, `/api/map/elevation`, `/api/admin/session`, 取得系管理APIで `429` が返る |
| APIキー付きコネクタ | e-Stat等はHTTPSかつ正規ホストだけに実行時APIキーを付与する |
| プロキシヘッダー | `CODIP_TRUST_PROXY_HEADERS=true` 以外ではForwarded系IP/host/protoヘッダーを信頼しない |
| セキュリティヘッダー | release smokeでCSP主要値、`unsafe-eval` 不在、HSTSを検査する |
| キャッシュ | 標高APIの同一点再取得で外部API・ログ書き込みを抑制 |
| ログ保持 | `npm run db:prune -- --dry-run` で削除候補を確認できる |

## 3.1 アクセシビリティ確認

| 項目 | 合格条件 |
| --- | --- |
| フォームラベル | 台帳検索、ログ絞り込み、データソース登録/編集、管理トークン、GeoJSON入力の主要入力に `label` と入力要素の関連付けがある |
| 共通ナビ | スキップリンク、main focus、現在ページ `aria-current` がある |
| データ表 | 検索結果、取得ログ、品質履歴にcaptionとscope付き見出しがある |
| エラー通知 | 保存エラー、管理セッションエラー、接続確認エラー、削除エラー、タグ追加エラー、GeoJSONエラー、座標入力エラーは `role=\"alert\"` または同等の通知を持つ |
| 地図代替操作 | クリック操作に加え、緯度経度入力で標高確認できる |
| 管理UI | 未認証時はタグ追加、登録、編集、削除、接続確認等の管理操作UIを表示せず、設定画面へ案内する |

## 4. 運用確認

| 項目 | 合格条件 |
| --- | --- |
| データソース台帳 | MVP対象の公式データソースが登録済み |
| 出典・ライセンス | 登録データの出典と利用条件が確認可能 |
| 品質状態 | 品質スコアまたは要確認状態が画面で確認可能 |
| 取得ログ | 接続確認・サンプル取得の実行結果が記録される |
| GitHub Project | 既知課題、リリース前残件、レビュー結果がIssue化されている |

## 5. 現時点の既知制約

| 制約 | 対応方針 |
| --- | --- |
| ローカルPlaywright Chromiumが一部環境で `SIGTRAP` になる | CIではE2E成功済み。ローカル実行不能環境はIssue証跡で追跡 |
| ローカルDBはSQLite preview | 本番スケール時はNeon PostgreSQL/PostGISへ移行。PostGIS migration/seed/runtime smokeはCIで検証済み |
| ローカルSQLite seedは `standard_records` 未投入 | PostGIS seed/CIでは検証用標準レコードを投入し、`--expect-standard-records` smokeで読取APIを確認 |
| PostgreSQL runtime smoke | CIまたはPostGIS利用可能なstagingで、PostgreSQL Clientによる `/api/ready`、`/api/sources`、`/api/v1` standard_records modeを確認 |
| Docker previewはSQLite単一インスタンス | 関係者検証用に限定し、本番利用しない。起動時migrationはpreviewのみ許可 |
| 3D都市モデル表示は未実装 | PLATEAU連携フェーズで扱う |
| AIによる判断機能は未実装 | 検索支援・要約補助に限定して将来導入 |

## 5.1 Known Release Documentation Gaps

| Gap | Project issue化の粒度 |
| --- | --- |
| Cloudflare Workersは目標構成で、現行共有previewはNode.jsコンテナ中心 | staging導入時に `wrangler` / adapter / Access / Hyperdrive の実設定証跡を追加 |
| 標準レコード本体と原本保存基盤はstaging未投入 | `/api/v1` のPostGIS読取パスとCI用標準レコードsmokeは実装済み。実データ投入、原本保存先、移行手順はstaging導入時に追加 |
| Cloudflare/Neon staging smokeはrunbook準備済みで実環境証跡は未記録 | 初回staging deploy時に `/api/ready`、`/api/sources`、migration、rollback ownerを記録 |
