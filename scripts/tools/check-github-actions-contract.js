#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createRequireText } = require("./contract-text.js");

const root = process.cwd();
function readNormalized(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

const WORKFLOW_DIR = ".github/workflows";

/**
 * 全ワークフローに掛かる検査 (SHA ピン・禁止パターン) の対象は、ディレクトリを
 * 実際に読んで導出する。ハードコード列挙だと workflow を1つ足した日に検査対象が
 * 増えず、追加分だけが無検査のまま緑で通る (Issue #133)。
 */
function listWorkflowFiles() {
  return fs
    .readdirSync(path.join(root, WORKFLOW_DIR), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => `${WORKFLOW_DIR}/${entry.name}`)
    .sort();
}

const workflowFiles = listWorkflowFiles();

// 走査対象が空のときに「対象が無いので合格」とすると、ディレクトリの改名やパス誤りが
// 「検査していない」ではなく「検査して合格した」として現れる。0 件は合格ではない。
if (workflowFiles.length === 0) {
  console.error(`[github-actions-contract][error] no workflow files found under ${WORKFLOW_DIR}`);
  process.exit(1);
}

const workflowSources = new Map(workflowFiles.map((file) => [file, readNormalized(file)]));

const errors = [];

/** 内容検査が名指しするファイル。消えていれば空文字ではなく error として現れる。 */
function workflowSource(relativePath) {
  const source = workflowSources.get(relativePath);
  if (source === undefined) {
    errors.push(`expected workflow file is missing: ${relativePath}`);
    return "";
  }
  return source;
}

const ci = workflowSource(".github/workflows/ci.yml");
const codeql = workflowSource(".github/workflows/codeql.yml");
const neonBackup = workflowSource(".github/workflows/neon-backup.yml");
const productionSmoke = workflowSource(".github/workflows/production-smoke.yml");
const packageJson = readNormalized("package.json");

const requireText = createRequireText(errors);

/**
 * workflow 内の**全ジョブ**の step を切り出す。インデント幅は最初の step 行から取り、
 * 決め打ちにしない。
 *
 * 設計上の要点が 3 つある。
 *
 * 1. コメント行 (行頭が `#`) は step 本文から**除去**する。契約の needle がコメント文で
 *    満たせるなら、それは実効設定ではなく説明文を検査していることになり、「文言の部分一致で
 *    網羅を主張する」形へ戻ってしまう。
 * 2. コメント行を step 列の終端と見なさない。step と同じインデントのコメントは
 *    step 列の途中に普通に現れる。
 * 3. 浅いインデントの実体行では**打ち切らず**、現在の step を閉じて走査を続ける。
 *    ジョブ境界で打ち切ると、2 つ目以降のジョブに置いた step が契約から見えなくなり、
 *    「ジョブを分けた瞬間に静かに found 0」になる。
 */
function workflowSteps(source) {
  const lines = source.split("\n");
  const first = lines.findIndex((line) => /^\s+- (name|id|uses|run):/.test(line));
  if (first === -1) return [];

  const indent = /^(\s*)- /.exec(lines[first])[1];
  const isStepStart = (line) => line.startsWith(`${indent}- `);
  const isComment = (line) => line.trimStart().startsWith("#");
  const steps = [];
  let current = null;
  for (const line of lines.slice(first)) {
    if (isStepStart(line)) {
      current = [line];
      steps.push(current);
      continue;
    }
    if (isComment(line)) continue;
    // 空行は step の内側にも現れる。step の終わりは「浅いインデントの実体行」で判定する。
    if (line.trim() !== "" && !line.startsWith(`${indent} `)) {
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  return steps.map((step) => step.join("\n"));
}

/**
 * needle を **step へ束縛して** 検査する。ファイル全体の部分一致は「どこかに
 * 書いてある」しか見ないため、`continue-on-error: true` を probe 以外の step へ
 * 移しても通ってしまう（そのとき probe は落ちなくなり、後続の判定 step は
 * 動くのに judge 対象が失敗を報告しない）。
 *
 * selector に一致する step がちょうど1つでなければ失敗させる。0件は「対象が
 * 無いので合格」ではなく、step 名の変更や YAML 構造の変化で**検査が成立しなかった**
 * ことを意味する（docs/security/evidence-gate-audit.md §3.5）。
 */
function selectStep(label, source, selector) {
  const steps = workflowSteps(source);
  if (steps.length === 0) {
    errors.push(`${label}: no steps parsed (step contract cannot be evaluated)`);
    return null;
  }
  const matched = steps.filter((step) => step.includes(selector));
  if (matched.length !== 1) {
    errors.push(`${label}: expected exactly one step matching "${selector}", found ${matched.length}`);
    return null;
  }
  return matched[0];
}

function requireStepText(label, source, selector, needle) {
  const step = selectStep(label, source, selector);
  if (step === null) return;
  if (!step.includes(needle)) {
    errors.push(`${label}: step "${selector}" missing ${needle}`);
  }
}

/**
 * needle を **行全体** として検査する。`requireStepText` の部分一致は、値の接尾辞を
 * 伸ばす変更を通してしまう。実測: download 側の artifact 名を `codeql-sarif` から
 * `codeql-sarif-v2` へ変えても `includes("name: codeql-sarif")` は真になり、
 * 保存側と取得側が食い違ったまま契約が合格した。
 *
 * 「どこかに現れる」で十分な設定 (`upload: never` など) は requireStepText で、
 * **値の全体が一致していること自体が意味を持つ** 設定 (artifact 名、path) は
 * こちらで検査する。
 */
function requireStepLine(label, source, selector, line) {
  const step = selectStep(label, source, selector);
  if (step === null) return;
  if (!step.split("\n").some((entry) => entry.trim() === line)) {
    errors.push(`${label}: step "${selector}" missing line "${line}"`);
  }
}

/**
 * job ブロック内の needle を **行全体** として検査する。`requireText` の部分一致は、
 * 値の接尾辞を伸ばす変更を通してしまう。実測 (#143 head b1d23e2 に対する変異):
 *
 *   - `if: always()`    → `if: always() && false`  : exit 0 (生存)
 *   - `needs: analyze`  → `needs: analyze-preview` : exit 0 (生存)
 *
 * 前者は判定ジョブを恒久 skip にし、後者は存在しないジョブへ結線する。どちらも
 * 「結線が切れたのに契約は合格」で、この契約が塞いだはずの形そのものである。
 * step 側は `requireStepText` → `requireStepLine` で行全体一致へ直したのに、job 側だけ
 * 部分一致のまま残っていた。**同じ契約の入口ごとに強度が違うこと自体が欠陥**であり、
 * 弱いほうの入口が実効的な強度を決める。
 *
 * コメント行は除外する (`workflowSteps` と同じ理由): 契約の needle を説明文で
 * 満たせるなら、検査しているのは実効設定ではない。
 */
function requireJobLine(label, jobBlock, line) {
  const found = jobBlock
    .split("\n")
    .filter((entry) => !entry.trimStart().startsWith("#"))
    .some((entry) => entry.trim() === line);
  if (!found) {
    errors.push(`${label} missing line "${line}"`);
  }
}

function requireJobBlock(label, source, jobName) {
  const match = source.match(new RegExp(`\\n  ${jobName}:\\n[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:\\n|\\n?$)`));
  if (!match) {
    errors.push(`${label} missing ${jobName} job`);
    return "";
  }
  return match[0];
}

const nodePreviewJob = requireJobBlock("CI workflow", ci, "node-preview");

requireText("CI workflow", ci, "permissions:\n  contents: read");
requireText("CI workflow", ci, "pull-requests: read");
requireText("CI workflow", ci, "workflow_dispatch:");
requireText("CI workflow", ci, "production-target-env:");
requireText("CI workflow", ci, "npm run release:validate-env:production-target");
requireText("CI workflow", ci, "npm run release:check-audit-contract");
requireText("CI workflow", ci, "npm run typecheck");
requireText("CI workflow", ci, "npm run cf:build");
requireText("CI workflow", ci, "npm run release:check-cloudflare-build-artifact");
requireText("CI workflow", ci, "CODIP_CLOUDFLARE_ACCESS_EVIDENCE");
requireText("CI workflow", ci, "CODIP_CLOUDFLARE_ALERT_POLICY");
requireText("CI workflow", ci, "CODIP_NEON_MONITORING_EVIDENCE");
requireText("CI workflow", ci, "CODIP_BACKUP_RESTORE_EVIDENCE");
requireText("CI workflow", ci, "npm run db:pg:check-postgis-ddl");
requireText("CI workflow", ci, "npm run db:pg:check-drift");
requireText("CI workflow", ci, "npm run release:smoke -- --read-only");
requireText("CI workflow", ci, "--expect-standard-records");
requireText("CI workflow", ci, "--expect-seed-standard-record");
requireText("CI workflow", ci, "Lint GitHub Actions workflows");
requireText("CI workflow", ci, "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz");
requireText("CI workflow", ci, "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8");
requireText("CI workflow", ci, "sha256sum -c -");
requireText("CI workflow", ci, "./actionlint -color");
requireText("CI workflow", ci, "docker-image-security:");
requireText("CI workflow", ci, "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25");
requireText("CI workflow", ci, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
requireText("CI workflow", ci, "fetch-depth: 0");
requireText("CI workflow", ci, "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
requireText("CI workflow", ci, "gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7");
requireText("CI workflow", ci, "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
requireText("Neon backup workflow", neonBackup, "name: Neon Backup");
requireText("Neon backup workflow", neonBackup, "schedule:");
requireText("Neon backup workflow", neonBackup, "workflow_dispatch:");
requireText("Neon backup workflow", neonBackup, "permissions:\n  contents: read");
requireText("Neon backup workflow", neonBackup, "persist-credentials: false");
requireText("Neon backup workflow", neonBackup, "secrets.CODIP_NEON_PGDUMP_DATABASE_URL");
requireText("Neon backup workflow", neonBackup, "secrets.CODIP_NEON_BACKUP_ENCRYPTION_PASSPHRASE");
requireText("Neon backup workflow", neonBackup, "::add-mask::$NEON_DATABASE_URL");
requireText("Neon backup workflow", neonBackup, "::add-mask::$CODIP_BACKUP_ENCRYPTION_PASSPHRASE");
requireText("Neon backup workflow", neonBackup, "pg_dump --format=custom --no-owner --no-privileges --file");
requireText("Neon backup workflow", neonBackup, "gpg --batch --yes --pinentry-mode loopback");
requireText("Neon backup workflow", neonBackup, "shred -u \"$dump_path\" || rm -f \"$dump_path\"");
requireText("Neon backup workflow", neonBackup, "release:create-neon-backup-evidence");
requireText("Neon backup workflow", neonBackup, "release:check-neon-backup-evidence");
requireText("Neon backup workflow", neonBackup, "github-actions-artifact://");
requireText("Neon backup workflow", neonBackup, "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
requireText("Neon backup workflow", neonBackup, "retention-days: 14");
if (neonBackup.includes("pull_request:")) {
  errors.push("Neon backup workflow must not run on pull_request");
}
requireText("Production smoke workflow", productionSmoke, "name: Production Smoke");
requireText("Production smoke workflow", productionSmoke, "schedule:");
requireText("Production smoke workflow", productionSmoke, "workflow_dispatch:");
requireText("Production smoke workflow", productionSmoke, "permissions:\n  contents: read");
requireText("Production smoke workflow", productionSmoke, "--strict-production");
requireText("Production smoke workflow", productionSmoke, "--allow-preview-down");
requireText("Production smoke workflow", productionSmoke, "https://odip.mirai-dx-platform.com");
requireText("Production smoke workflow", productionSmoke, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
requireText("Production smoke workflow", productionSmoke, "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
requireText("Production smoke workflow", productionSmoke, "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
requireText("Production smoke workflow", productionSmoke, "retention-days: 14");
requireText("Production smoke workflow", productionSmoke, "timeout-minutes: 5");
requireText("Production smoke workflow", productionSmoke, "persist-credentials: false");
requireText("Production smoke workflow", productionSmoke, 'cron: "7,22,37,52 * * * *"');
requireText("Production smoke workflow", productionSmoke, "cancel-in-progress: false");
// probe は落ちても後続 (summary / artifact / 判定) を走らせる必要があるため
// continue-on-error を持つ。ただしそれは probe step の性質であって workflow の
// 性質ではない。以下は step へ束縛する (T-B12)。
requireStepText("Production smoke workflow", productionSmoke, "id: production-status", "continue-on-error: true");
requireStepText("Production smoke workflow", productionSmoke, "name: Publish run summary", "if: always()");
requireStepText(
  "Production smoke workflow",
  productionSmoke,
  "name: Upload redacted monitoring evidence",
  "if: always()",
);
requireStepText(
  "Production smoke workflow",
  productionSmoke,
  "name: Enforce production readiness",
  "if: steps.production-status.outcome == 'failure'",
);
requireText("Neon backup workflow", neonBackup, "CODIP_NEON_BRANCH: main");
requireText("Neon backup workflow", neonBackup, "vars.CODIP_NEON_PGDUMP_HOST");
requireText("Neon backup workflow", neonBackup, "--endpoint-host");
if (productionSmoke.includes("pull_request:")) {
  errors.push("Production smoke workflow must not run on pull_request");
}
requireText("node-preview job", nodePreviewJob, "persist-credentials: false");
requireText("node-preview job", nodePreviewJob, "Prepare SQLite preview database");
requireText("node-preview job", nodePreviewJob, "npm run db:generate");
requireText("node-preview job", nodePreviewJob, "npx prisma migrate deploy");
requireText("node-preview job", nodePreviewJob, "npx prisma db seed");
requireText("node-preview job", nodePreviewJob, "Build production app");
requireText("node-preview job", nodePreviewJob, "npm run build");
requireText("node-preview job", nodePreviewJob, "Direct Node preview release smoke");
requireText("node-preview job", nodePreviewJob, "npm run start:checked -- --hostname 127.0.0.1 --port 3110");
requireText("node-preview job", nodePreviewJob, "http://127.0.0.1:3110/api/ready");
requireText("node-preview job", nodePreviewJob, "npm run release:smoke -- --base-url http://127.0.0.1:3110");
requireText("CodeQL workflow", codeql, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
requireText("CodeQL workflow", codeql, "github/codeql-action/init@1ad29ea4a422cce9a242a9fae469541dcd08addc");
requireText("CodeQL workflow", codeql, "github/codeql-action/analyze@1ad29ea4a422cce9a242a9fae469541dcd08addc");
// このリポジトリは personal account の private repo のため GitHub Advanced Security
// (SARIFアップロード) が使えない。upload: never で解析自体をローカル実行し、解析失敗時は
// ジョブを落とす。SARIFはartifactとして保持する (ADR 0003 / Issue #139)。
//
// ⏳ 再評価トリガ: この2行は回避策を恒久化する向きの束縛である。GHAS が利用可能になった
// (= Issue #139 がクローズできる) 時点で、`upload: never` の契約行と analyze の該当設定を
// 削除し、通常の code-scanning アップロードへ戻すこと。契約に賞味期限が書かれていないと、
// 制約が消えた後も契約が正しい変更を阻む。詳細と判定条件は
// docs/adr/0003-codeql-upload-platform-limitation.md「将来の再評価」に置く。
requireStepText("CodeQL workflow", codeql, "github/codeql-action/analyze@", "upload: never");
requireStepText("CodeQL workflow", codeql, "github/codeql-action/analyze@", "output: sarif-results");
// セレクタは step 自身の名前で指定する。`name: codeql-sarif` は artifact 名であり、
// 保存側と取得側の両方に現れるため一意にならない。
requireStepText("CodeQL workflow", codeql, "name: Retain CodeQL SARIF as a CI artifact", "retention-days: 14");
requireStepText(
  "CodeQL workflow",
  codeql,
  "name: Retain CodeQL SARIF as a CI artifact",
  "if-no-files-found: error",
);
// upload: never の下では analyze は「アナライザが失敗したとき」しか落ちず、検出結果では
// 落ちない。findings を判定する step が無ければ、この security scan は presence-only
// (等級3) のままになる。step へ束縛して、名前を変えただけで検査が消えないようにする。
//
// **行全体一致**で見る。部分一致だと引数を*足す*変更が通ってしまう。実測 (#143 head
// fc54702 に対する変異): `… sarif-results` を `… sarif-results docs/security/permissive.json`
// へ変えても `includes` は真で exit 0 だった。スクリプトは argv[3] を受容記録のパスとして
// 受け取るので、CI 側で寛容な記録を差すことができ、契約はそれを見逃していた。
// argv[3] 自体は残す (テストが一時ファイルを渡すため必要で、パス上書きは justification 必須・
// 解決パス出力ありなので**記録の無い免除**を作らない)。閉じるべきは CI 側の経路だけである。
requireStepLine(
  "CodeQL workflow",
  codeql,
  "name: Fail on CodeQL findings",
  "run: node scripts/tools/check-codeql-sarif.js sarif-results",
);
// 判定コマンドを step へ束縛しても、**ジョブが走らなければ**このスキャンは何も測らない。
// `codeql-findings` は analyze とは別ジョブなので、結線は3箇所で切れる。
//
//   - `needs: analyze` を外す → SARIF がまだ無いうちに download が走る
//   - `if: always()` を外す  → analyze が落ちた回だけ判定が skip される。skip は
//     GitHub 上で赤にならないため、**判定が最も要る回に限って沈黙する**
//   - artifact の name / path がずれる → 別の SARIF を読むか、読めない
//
// いずれも「検査が成立しなかった」を「問題なし」と区別せず通す形で、
// docs/security/evidence-gate-audit.md §3.5 の欠陥族と同型である。結線自体を契約にする。
const codeqlFindingsJob = requireJobBlock("CodeQL workflow", codeql, "codeql-findings");
requireJobLine("CodeQL findings job", codeqlFindingsJob, "needs: analyze");
requireJobLine("CodeQL findings job", codeqlFindingsJob, "if: always()");
// artifact の name / path はリテラルで固定する。保存側と取得側を互いに比較すると、
// 両方を同時に書き換えたとき一致したまま通る。判定スクリプトの引数と analyze の
// `output:` も同じ文字列に乗っているため、4箇所を1つのリテラルへ束ねる。
requireStepLine("CodeQL workflow", codeql, "actions/upload-artifact@", "name: codeql-sarif");
requireStepLine("CodeQL workflow", codeql, "actions/upload-artifact@", "path: sarif-results");
requireStepLine("CodeQL workflow", codeql, "actions/download-artifact@", "name: codeql-sarif");
requireStepLine("CodeQL workflow", codeql, "actions/download-artifact@", "path: sarif-results");
requireText("package.json", packageJson, "\"release:check-codeql-sarif\": \"node scripts/tools/check-codeql-sarif.js\"");
// analyze は最終 step なので、落ちても実行すべき後続が無い。continue-on-error を付けると
// security scan が必ず success になり、「CI必須チェックが全て success (security scan含む)」を
// 満たしたと主張できなくなる (Issue #132)。復活を検知するため、不在側を契約にする。
if (codeql.includes("continue-on-error")) {
  errors.push("CodeQL workflow must not use continue-on-error: a security scan that cannot fail is not a gate");
}
requireText("package.json", packageJson, "\"typecheck\": \"npm run db:generate && tsc --noEmit\"");

const forbiddenPatterns = [
  "pull_request_target:",
  "docker/scout-action",
  "aquasecurity/trivy-action@v0.31",
  "aquasecurity/trivy-action@v0.32",
  "aquasecurity/trivy-action@v0.33",
];

for (const pattern of forbiddenPatterns) {
  for (const [file, source] of workflowSources) {
    if (source.includes(pattern)) {
      errors.push(`${file} must not contain ${pattern}`);
    }
  }
}

const actionRefs = [...workflowSources].flatMap(([file, source]) =>
  [...source.matchAll(/uses:\s+[^@\s]+\/[^@\s]+@([^\s#]+)/g)].map((match) => ({
    file,
    ref: match[1],
  })),
);

// 参照が1件も採れないなら、正規表現が実体に追随できていないか workflow が空である。
// どちらも「ピンが正しい」ではないので、0 件を合格にしない。
if (actionRefs.length === 0) {
  errors.push(`no action refs found in ${workflowFiles.length} workflow file(s): pin check inspected nothing`);
}

const unpinnedActions = actionRefs
  .filter(({ ref }) => !/^[0-9a-f]{40}$/i.test(ref))
  .map(({ file, ref }) => `${file}@${ref}`);

if (unpinnedActions.length > 0) {
  errors.push(`workflows have non-SHA action refs: ${unpinnedActions.join(", ")}`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[github-actions-contract][error] ${error}`);
  process.exit(1);
}

// 何件を見たうえでの OK かをログに残す。件数が落ちたことをログ差分で気付けるようにする。
console.log(
  `[github-actions-contract] OK (${workflowFiles.length} workflow files, ${actionRefs.length} action refs pinned)`,
);
