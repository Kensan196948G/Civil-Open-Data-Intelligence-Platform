import { describe, expect, it } from "vitest";
import {
  ACCEPTED_SCRIPT_SRC,
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  type CspExpectation,
  type CspProblem,
  type CspProblemKind,
  PINNED_DIRECTIVES,
  describeCspProblems,
  evaluateCspHeaders,
} from "../e2e/csp-contract";
import {
  CONSOLE_ALLOWLIST,
  CSP_VIOLATION_PATTERN,
  type CapturedEntry,
  decideAllowlist,
  unexplainedEntries,
} from "../e2e/console-noise";

/**
 * 変異回帰テスト (Issue #125 / T-Q5)。
 *
 * 手で入れた変異は再現性が無く、検証者が変われば失われる。ここでは同じ変異を
 * **メモリ上で** 機械的に生成し、判定関数が必ず問題として報告することを表明する。
 * ファイルの書き換えもサブプロセス起動も行わないので `npm test` の中で完結する。
 *
 * 隣の csp-contract.test.ts との役割分担:
 *   - csp-contract.test.ts  : 期待値そのものの正しさ。実測した CSP のリテラルを
 *                             ピン留め値と突き合わせる (値が間違っていたら落ちる)
 *   - このファイル          : 判定能力。ピン留め値からベースラインを生成し、
 *                             そこへ変異を入れて「判定関数が黙認しないこと」を見る
 * 前者が値を守り、後者が検知力を守る。ベースラインをピン留め値から生成しているのは
 * 意図的で、そうすることで PINNED_DIRECTIVES へディレクティブが増えたときに変異
 * 網羅が自動で追随する。値の正しさは前者が独立に担保しているので循環しない。
 *
 * 期待値側の変異について:
 *   PINNED_DIRECTIVES へソースを足す変異 (= 契約が実測より緩い状態) と、実測から
 *   同じソースを取り除く変異は双対であり、どちらも「契約にあって実測に無いソース」
 *   として同じ判定経路 (hardened) を通る。evaluateCspHeaders は期待値を module
 *   定数から直接読むため、期待値をメモリ上で差し替えるには判定ロジック側へ引数を
 *   足すか module mock が要る。T-Q5 は csp-contract.ts を読み取り専用としているので、
 *   ここでは双対な入力側変異で同じ経路を踏む。
 */

/** ACCEPTED_SCRIPT_SRC のどれを基準に変異させるか。E2E と同じ development で固定する。 */
const BASELINE_VARIANT_LABEL = "development";

const baselineVariant = ACCEPTED_SCRIPT_SRC.find((variant) => variant.label === BASELINE_VARIANT_LABEL);
if (!baselineVariant) {
  throw new Error(
    `${BASELINE_VARIANT_LABEL} 構成が ACCEPTED_SCRIPT_SRC から消えている。` +
      "変異の基準が無くなるので、このテストを先に直すこと",
  );
}

/**
 * 変異前のヘッダ構成。script-src を含む全ディレクティブ。
 * 構成を固定して評価するので、`'unsafe-eval'` の増減が「環境差」として説明されない。
 */
const BASELINE_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  ...PINNED_DIRECTIVES,
  "script-src": baselineVariant.sources,
};

const PINNED_EXPECTATION: CspExpectation = { scriptSrcVariant: BASELINE_VARIANT_LABEL };

/** 変異で足す外部オリジン。既存のどの受容値とも重ならない値にする。 */
const INJECTED_SOURCE = "https://mutation.example";

function serialize(directives: Record<string, readonly string[]>): string {
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}

function mutateDirectives(
  mutate: (directives: Record<string, string[]>) => void,
): Record<string, string> {
  const copy: Record<string, string[]> = {};
  for (const [name, sources] of Object.entries(BASELINE_DIRECTIVES)) copy[name] = [...sources];
  mutate(copy);
  return { [CSP_HEADER]: serialize(copy) };
}

const BASELINE_HEADERS = mutateDirectives(() => {});

/**
 * CspProblemKind の全値。判定関数が報告しうる種類がここに揃っていることを型で強制する。
 * 種類を増減したら次の代入が compile error になるので、変異の追加漏れが型検査で止まる。
 */
const ALL_PROBLEM_KINDS = [
  "header-missing",
  "header-duplicated",
  "report-only-added",
  "directive-added",
  "directive-removed",
  "directive-duplicated",
  "loosened",
  "hardened",
] as const;

type ListedKind = (typeof ALL_PROBLEM_KINDS)[number];
const _kindsAreExhaustive: ListedKind extends CspProblemKind
  ? CspProblemKind extends ListedKind
    ? true
    : never
  : never = true;
void _kindsAreExhaustive;

type Mutation = {
  /** 失敗時にどの変異が検知されなかったか読めるようにする */
  readonly label: string;
  readonly kind: CspProblemKind;
  /** その変異が対象としたディレクティブ。ヘッダ全体の変異では undefined */
  readonly directive?: string;
  /** 同時に出てはならない種類。緩和と硬化の取り違えを検知する */
  readonly notKind?: CspProblemKind;
  readonly headers: Record<string, string>;
  readonly expectation?: CspExpectation;
};

const directiveNames = Object.keys(BASELINE_DIRECTIVES);

/**
 * ピン留め表からの生成。ディレクティブが増えたら変異も自動で増える。
 * ここを手書きの列挙に戻すと、次に足されたディレクティブが無検査になる。
 */
const generatedMutations: Mutation[] = [
  // ソース値の追加 = 意図せぬ緩和。loosened として報告され、hardened にはならないこと
  ...directiveNames.map<Mutation>((name) => ({
    label: `${name} へ ${INJECTED_SOURCE} を足す`,
    kind: "loosened",
    notKind: "hardened",
    directive: name,
    headers: mutateDirectives((directives) => {
      directives[name].push(INJECTED_SOURCE);
    }),
  })),

  // ソース値の削除 = 意図せぬ硬化。hardened として報告され、loosened にはならないこと。
  // これは「PINNED_DIRECTIVES 側へ同じ値を足す変異」と双対である
  ...directiveNames.flatMap<Mutation>((name) =>
    BASELINE_DIRECTIVES[name].map<Mutation>((source) => ({
      label: `${name} から ${source} を削る`,
      kind: "hardened",
      notKind: "loosened",
      directive: name,
      headers: mutateDirectives((directives) => {
        directives[name] = directives[name].filter((candidate) => candidate !== source);
      }),
    })),
  ),

  // ディレクティブごと削除
  ...directiveNames.map<Mutation>((name) => ({
    label: `${name} ごと削除する`,
    kind: "directive-removed",
    directive: name,
    headers: mutateDirectives((directives) => {
      delete directives[name];
    }),
  })),

  // ディレクティブの重複。ブラウザは最初の 1 つを使うため、後ろに緩い定義を足しても
  // 効かない一方で、意図せず前方の定義を上書きしたつもりになる事故が起きる
  ...directiveNames.map<Mutation>((name) => ({
    label: `${name} を二重に書く`,
    kind: "directive-duplicated",
    directive: name,
    headers: {
      [CSP_HEADER]: `${BASELINE_HEADERS[CSP_HEADER]}; ${[name, ...BASELINE_DIRECTIVES[name]].join(" ")}`,
    },
  })),
];

/** 生成では表現できない、ヘッダ集合そのものへの変異。 */
const structuralMutations: Mutation[] = [
  {
    label: "契約に無いディレクティブ (worker-src) を足す",
    kind: "directive-added",
    directive: "worker-src",
    headers: { [CSP_HEADER]: `${BASELINE_HEADERS[CSP_HEADER]}; worker-src 'self' blob:` },
  },
  {
    label: "CSP ヘッダが 2 つ返る (Playwright は改行で連結する)",
    kind: "header-duplicated",
    headers: { [CSP_HEADER]: `${BASELINE_HEADERS[CSP_HEADER]}\nscript-src 'self' 'nonce-abc'` },
  },
  {
    label: "report-only ヘッダを別に足す",
    kind: "report-only-added",
    directive: CSP_REPORT_ONLY_HEADER,
    headers: {
      ...BASELINE_HEADERS,
      [CSP_REPORT_ONLY_HEADER]: "script-src 'self' 'nonce-abc' 'strict-dynamic'",
    },
  },
  {
    label: "CSP ヘッダごと消す",
    kind: "header-missing",
    directive: CSP_HEADER,
    headers: {},
  },
  {
    label: "CSP ヘッダを空文字にする",
    kind: "header-missing",
    directive: CSP_HEADER,
    headers: { [CSP_HEADER]: "" },
  },
  {
    label: "CSP ヘッダを空白だけにする",
    kind: "header-missing",
    directive: CSP_HEADER,
    headers: { [CSP_HEADER]: "   " },
  },
  {
    // 本番が誤って development 構成を配信した場合。構成をピン留めしないと
    // 「環境差」として説明されて素通りする
    label: "production 固定なのに script-src へ 'unsafe-eval' が残っている",
    kind: "loosened",
    directive: "script-src",
    notKind: "hardened",
    headers: BASELINE_HEADERS,
    expectation: { scriptSrcVariant: "production" },
  },
  {
    // 逆向き。E2E は dev サーバを見ているので production 構成が返ったら異常
    label: "development 固定なのに script-src が production 構成になっている",
    kind: "hardened",
    directive: "script-src",
    notKind: "loosened",
    headers: mutateDirectives((directives) => {
      directives["script-src"] = directives["script-src"].filter((source) => source !== "'unsafe-eval'");
    }),
  },
];

const MUTATIONS: readonly Mutation[] = [...generatedMutations, ...structuralMutations];

function evaluate(mutation: Mutation): CspProblem[] {
  return evaluateCspHeaders(mutation.headers, mutation.expectation ?? PINNED_EXPECTATION);
}

describe("変異前のベースラインは契約を満たす", () => {
  it("生成したベースラインが問題ゼロで通る", () => {
    // ここが落ちるなら変異ではなく生成器かピン留め値が壊れている
    expect(describeCspProblems(evaluateCspHeaders(BASELINE_HEADERS, PINNED_EXPECTATION))).toBe("");
  });

  it("変異はベースラインと必ず異なるヘッダを作る", () => {
    // 「変異したつもりで何も変えていない」空虚な行を弾く。
    // 変異前後で同一なら、そのテストは何も検査していない
    for (const mutation of MUTATIONS) {
      const changedHeaders = JSON.stringify(mutation.headers) !== JSON.stringify(BASELINE_HEADERS);
      const changedExpectation = mutation.expectation !== undefined;
      expect(
        changedHeaders || changedExpectation,
        `変異 "${mutation.label}" はベースラインを変更していない`,
      ).toBe(true);
    }
  });
});

describe("判定関数はすべての変異を報告する", () => {
  it.each(MUTATIONS)("$label -> $kind", (mutation) => {
    const problems = evaluate(mutation);

    expect(
      problems.length,
      `変異 "${mutation.label}" が検知されなかった (期待: ${mutation.kind})`,
    ).toBeGreaterThan(0);

    const matching = problems.filter((problem) => problem.kind === mutation.kind);
    expect(
      matching.length,
      `変異 "${mutation.label}" は ${mutation.kind} として報告されるべきだが、` +
        `実際の報告は:\n${describeCspProblems(problems)}`,
    ).toBeGreaterThan(0);

    if (mutation.directive !== undefined) {
      expect(
        matching.map((problem) => problem.directive),
        `変異 "${mutation.label}" の報告が別のディレクティブに付いている`,
      ).toContain(mutation.directive);
    }
  });

  it.each(MUTATIONS.filter((mutation) => mutation.notKind !== undefined))(
    "$label は $notKind とは報告しない",
    (mutation) => {
      // 緩和と硬化を取り違えると、失敗時の指示 (直せ / 裁定を再開しろ) が逆になる
      const problems = evaluate(mutation);
      const confused = problems.filter(
        (problem) => problem.kind === mutation.notKind && problem.directive === mutation.directive,
      );
      expect(
        describeCspProblems(confused),
        `変異 "${mutation.label}" が ${mutation.directive} で ${mutation.notKind} と誤分類された`,
      ).toBe("");
    },
  );

  it("報告に必ず理由が入る", () => {
    for (const mutation of MUTATIONS) {
      for (const problem of evaluate(mutation)) {
        expect(problem.detail.length, `${mutation.label} の報告に説明が無い`).toBeGreaterThan(10);
      }
    }
  });
});

describe("変異表が判定関数の全報告種類を尽くしている", () => {
  it("CspProblemKind のどれも未検査で残らない", () => {
    // 種類を足したのに変異を足し忘れたら、その種類は「一度も検知確認していない」
    // ことになる。ALL_PROBLEM_KINDS 側は型で網羅を強制済み
    const exercised = new Set<CspProblemKind>();
    for (const mutation of MUTATIONS) {
      for (const problem of evaluate(mutation)) exercised.add(problem.kind);
    }

    const missing = ALL_PROBLEM_KINDS.filter((kind) => !exercised.has(kind));
    expect(missing, `変異が用意されていない報告種類: ${missing.join(", ")}`).toEqual([]);
  });

  it("すべてのピン留めディレクティブが変異対象になっている", () => {
    const covered = new Set(MUTATIONS.map((mutation) => mutation.directive));
    for (const name of directiveNames) {
      expect(covered.has(name), `${name} に対する変異が生成されていない`).toBe(true);
    }
  });
});

describe("console allowlist は偶然一致でも CSP 違反を通さない", () => {
  const entry = (text: string, location = ""): CapturedEntry => ({
    source: "console",
    route: "/sites",
    text,
    location,
  });

  /** 文言側の規則が拾うマーカー。network 層の行はこれを 1 つも含まないこと。 */
  const WORDING_MARKER = /Content Security Policy|Refused to/i;

  /**
   * allowlist の matches に**わざと一致させた上で** CSP 違反を示すもの。
   * 各行は「allowlist が実際に一致すること」と「それでも通らないこと」を両方表明する。
   * 前者を表明しないと、matches の条件が変わったときにこのテストが素通りする。
   *
   * `layer` は拾われた経路の区別。Chromium は navigation / frame / worker が CSP で
   * 落ちた場合、説明文ではなく net error だけを出す。両方を持たないと、片方の枝を
   * 消しても表全体は緑のままになる (2026-08-12 に実際に取りこぼしていた)。
   */
  const collisions: ReadonlyArray<{
    label: string;
    entryId: string;
    layer: "wording" | "network";
    captured: CapturedEntry;
  }> = [
    {
      label: "style-src から fonts.googleapis.com が外れたときの文言",
      entryId: "google-fonts-cdn-unreachable",
      layer: "wording",
      captured: entry(
        "Refused to load the stylesheet 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP' " +
          'because it violates the following Content Security Policy directive: "style-src \'self\'". ' +
          "Failed to load resource",
        "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP",
      ),
    },
    {
      label: "font-src から fonts.gstatic.com が外れたときの文言",
      entryId: "google-fonts-cdn-unreachable",
      layer: "wording",
      captured: entry(
        "Refused to load the font 'https://fonts.gstatic.com/s/ibmplexsansjp/v1/font.woff2' " +
          "because it violates the following Content Security Policy directive. " +
          "net::ERR_FAILED",
        "https://fonts.gstatic.com/s/ibmplexsansjp/v1/font.woff2",
      ),
    },
    {
      // 2026-08-12 の取りこぼし本体。CSP でオリジンを外してもテストが緑のままだった
      label: "CSP ブロックが net error だけで出る場合 (説明文が付かない)",
      entryId: "google-fonts-cdn-unreachable",
      layer: "network",
      captured: entry(
        "Failed to load resource: net::ERR_BLOCKED_BY_CSP",
        "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP",
      ),
    },
    {
      // CSP 専用ではない (X-Frame-Options / CORP / COEP でも出る) が、
      // いずれもセキュリティヘッダ由来のブロックなので外形要因として説明させない
      label: "セキュリティヘッダによるブロックが net error だけで出る場合",
      entryId: "google-fonts-cdn-unreachable",
      layer: "network",
      captured: entry(
        "Failed to load resource: net::ERR_BLOCKED_BY_RESPONSE",
        "https://fonts.gstatic.com/s/ibmplexsansjp/v1/font.woff2",
      ),
    },
  ];

  it.each(collisions)("$label は allowlist に一致する", ({ captured, entryId }) => {
    // 「偶然一致」が仮定ではなく事実であることを先に固定する。
    // allowlist の条件を変えてここが落ちたら、下の除外テストも作り直す必要がある
    const matched = CONSOLE_ALLOWLIST.filter((candidate) => candidate.matches(captured));
    expect(
      matched.map((candidate) => candidate.id),
      `${entryId} が一致しないなら、この行はもう「偶然一致」の検査になっていない`,
    ).toContain(entryId);
  });

  it.each(collisions)("$label は allowlist に一致しても通さない", ({ captured }) => {
    expect(CSP_VIOLATION_PATTERN.test(captured.text), "CSP 違反として認識されていない").toBe(true);
    expect(decideAllowlist(captured).allowed, "CSP 違反が allowlist で握り潰された").toBe(false);
    expect(unexplainedEntries([captured]), "CSP 違反が失敗対象から外れた").toHaveLength(1);
  });

  it.each(collisions.filter((collision) => collision.layer === "network"))(
    "$label は CSP の説明文を含まないのに通らない",
    ({ captured }) => {
      // この表明が無いと、CSP_VIOLATION_PATTERN から net error の枝を消しても
      // 文言側の行が拾ってくれるので表全体は緑のままになる。
      // 「説明文を含まない」ことを先に固定して、net error 側の検査であることを保証する
      expect(
        WORDING_MARKER.test(captured.text),
        "この行は文言側の規則で拾われており、net error 側の検査になっていない",
      ).toBe(false);
      expect(decideAllowlist(captured).allowed, "net error 形式の CSP ブロックが握り潰された").toBe(false);
    },
  );

  it("衝突表が文言側と net error 側の両方を持つ", () => {
    // 片方だけになると、その層の判定が消えても表は緑のままになる
    const layers = new Set(collisions.map((collision) => collision.layer));
    expect([...layers].sort(), "衝突表から層が欠けている").toEqual(["network", "wording"]);
  });

  it("allowlist を空にしても CSP 違反の判定は変わらない", () => {
    // CSP_VIOLATION_PATTERN が allowlist より先に評価されることの表明。
    // 順序が入れ替わると、この検査の存在理由そのものを allowlist が隠せてしまう
    for (const { captured } of collisions) {
      expect(decideAllowlist(captured).entryId, "CSP 違反に allowlist の id が付いた").toBeUndefined();
    }
  });

  it.each([
    // 逆側の固定。除外規則を広げすぎると、既知の外形要因まで落ちるようになる。
    // ERR_BLOCKED_BY_* を足したときに `net::ERR_` 全体を弾いてしまう誤りを検知する
    "Failed to load resource: net::ERR_NAME_NOT_RESOLVED",
    "Failed to load resource: net::ERR_CONNECTION_TIMED_OUT",
    "Failed to load resource: net::ERR_INTERNET_DISCONNECTED",
  ])("CSP 由来でないネットワーク失敗は従来どおり allowlist される: %s", (text) => {
    const captured = entry(text, "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP");
    expect(
      CSP_VIOLATION_PATTERN.test(captured.text),
      "真の外形要因がセキュリティブロックとして扱われている",
    ).toBe(false);
    const decision = decideAllowlist(captured);
    expect(decision.allowed).toBe(true);
    expect(decision.entryId).toBe("google-fonts-cdn-unreachable");
  });
});
