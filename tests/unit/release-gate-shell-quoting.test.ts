import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { quoteShellArg } = require("../../scripts/tools/release-gate.js") as {
  quoteShellArg: (value: string) => string;
};

/**
 * quoteShellArg is only reached on win32, where `spawnSync(..., { shell: true })`
 * hands one string to cmd.exe and the child re-parses it with the CRT rules
 * implemented by CommandLineToArgvW:
 *
 *   2n backslashes   + '"'  -> n backslashes, quote toggles
 *   2n+1 backslashes + '"'  -> n backslashes, literal '"'
 *   backslashes not followed by '"' -> literal, no doubling
 *
 * Asserting a particular output spelling would only pin today's implementation.
 * The property that actually matters is a round trip: parsing the produced token
 * back with those rules must yield the original value and consume the whole
 * token. That single assertion catches both failure directions — under-escaping
 * (a trailing backslash eats the closing quote and the rest of the line runs
 * unquoted) and over-escaping (every backslash doubled, so C:\a\b is corrupted).
 */
function parseSingleToken(token: string): { value: string; rest: string } {
  let value = "";
  let index = 0;
  let inQuotes = false;

  while (index < token.length) {
    let backslashes = 0;
    while (token[index] === "\\") {
      backslashes += 1;
      index += 1;
    }

    if (token[index] === '"') {
      value += "\\".repeat(Math.floor(backslashes / 2));
      if (backslashes % 2 === 1) value += '"';
      else inQuotes = !inQuotes;
      index += 1;
      continue;
    }

    value += "\\".repeat(backslashes);
    if (index >= token.length) break;
    // An unquoted space ends the token; anything after it is a separate
    // argument, which is exactly the breakout we must never produce.
    if (!inQuotes && token[index] === " ") return { value, rest: token.slice(index) };
    value += token[index];
    index += 1;
  }

  return { value, rest: "" };
}

function roundTrip(value: string): { value: string; rest: string } {
  return parseSingleToken(quoteShellArg(value));
}

describe("release-gate quoteShellArg", () => {
  describe("survives a CRT round trip", () => {
    const values: Array<[string, string]> = [
      ["plain command", "npm"],
      ["flag with equals", "--audit-level=moderate"],
      ["value with a space", "a b"],
      ["embedded double quotes", 'he said "hi"'],
      ["trailing backslash", "C:\\path\\"],
      ["run of trailing backslashes", "D:\\dir\\\\"],
      ["interior backslashes and a space", "C:\\Program Files\\node\\node.exe"],
      ["backslash directly before a quote", 'a\\" && whoami'],
      ["only backslashes and quotes", '\\"\\"'],
      ["long trailing run", "tail\\\\\\"],
    ];

    it.each(values)("%s", (_label, value) => {
      expect(roundTrip(value)).toEqual({ value, rest: "" });
    });
  });

  describe("the two failure directions, stated separately", () => {
    it("does not let a crafted value break out of the token", () => {
      // Escaping '"' while leaving '\' alone yields `"a\\" && whoami"`, which the
      // CRT closes early and runs ` && whoami` outside the quotes.
      const parsed = roundTrip('a\\" && whoami');
      expect(parsed.rest).toBe("");
      expect(parsed.value).toBe('a\\" && whoami');
    });

    it("does not let a trailing backslash consume the closing quote", () => {
      expect(roundTrip("C:\\path\\")).toEqual({ value: "C:\\path\\", rest: "" });
    });

    it("does not double backslashes that never reach a quote", () => {
      // Escaping every backslash is the opposite mistake: it is safe but wrong,
      // turning C:\Program Files\node\node.exe into a path with doubled
      // separators. This value already round-tripped before the fix, so a
      // regression here would be introduced by the fix itself.
      const value = "C:\\Program Files\\node\\node.exe";
      expect(roundTrip(value)).toEqual({ value, rest: "" });
    });
  });

  describe("fast path accepts exactly the intended character set", () => {
    // Bidirectional: every intended character passes through unquoted, and
    // nothing outside the set does. A one-directional check cannot detect a
    // character silently added to or dropped from the class.
    it("returns each allowed character unchanged", () => {
      for (const char of "abzABZ059_./:@=-") {
        expect(quoteShellArg(char), `char ${JSON.stringify(char)}`).toBe(char);
      }
    });

    it("returns the arguments release-gate actually passes unchanged", () => {
      for (const value of ["npm", "run", "db:migrate", "--audit-level=moderate", "release:check-v1-contract"]) {
        expect(quoteShellArg(value)).toBe(value);
      }
    });

    it("quotes every character outside the set", () => {
      // '%' and '!' are outside the set too, but they fail closed rather than
      // being quoted — see the cmd.exe layer block below.
      for (const char of [" ", "&", "|", ">", "<", "^", '"', "\\", "$", "`", "(", ")", "*", "?", ";", "'", "\t"]) {
        expect(quoteShellArg(char), `char ${JSON.stringify(char)}`).not.toBe(char);
      }
    });

    it("does not take the fast path when only part of the value is allowed", () => {
      expect(quoteShellArg("npm run")).toBe('"npm run"');
    });
  });

  describe("the cmd.exe layer, which quoting alone does not cover", () => {
    // The line is parsed twice: cmd.exe first, then the child's CRT. Every test
    // above exercises the CRT axis. Without this block the suite would be green
    // while never touching the other parser — the same "green means covered"
    // mistake this repository is currently cataloguing.
    it("neutralises the cmd metacharacters that double quotes do cover", () => {
      // cmd.exe does not interpret these inside double quotes, so quoting is
      // sufficient and the CRT round trip must still hold.
      for (const value of ["a & b", "a | b", "a > b", "a < b", "a ^ b"]) {
        expect(quoteShellArg(value).startsWith('"'), `value ${JSON.stringify(value)}`).toBe(true);
        expect(roundTrip(value), `value ${JSON.stringify(value)}`).toEqual({ value, rest: "" });
      }
    });

    it("fails closed on the two characters quotes do not cover", () => {
      // cmd.exe expands %VAR% inside double quotes, and !VAR! too when delayed
      // expansion is enabled. Neither can be escaped reliably on a cmd command
      // line, so emitting a token here would mean vouching for a value we
      // cannot produce faithfully.
      for (const value of ["%PATH%", "a%b", "100%", "!DELAYED!", "a!b"]) {
        expect(() => quoteShellArg(value), `value ${JSON.stringify(value)}`).toThrow(/cannot safely quote/);
      }
    });

    it("does not leak the rejected value in the error message", () => {
      // The value may be a secret; the character class alone identifies the
      // problem, so the message must not echo it back into CI logs.
      expect(() => quoteShellArg("%SECRET_TOKEN%")).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining("SECRET_TOKEN") }),
      );
    });

    it("rejects nothing that release-gate actually passes today", () => {
      // Reachability: every run() call site passes source literals, so the
      // fail-close above is unreachable in the current program. It is a guard
      // for future callers, not a behaviour change.
      const source = require("node:fs").readFileSync(
        new URL("../../scripts/tools/release-gate.js", import.meta.url),
        "utf8",
      ) as string;
      const callSites = [...source.matchAll(/run\(\s*"[^"]*"\s*,\s*("[^"]*")\s*,\s*(\[[^\]]*\])/g)];
      expect(callSites.length).toBeGreaterThan(0);

      for (const [, command, argsLiteral] of callSites) {
        const args = [...argsLiteral.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
        for (const value of [JSON.parse(command) as string, ...args]) {
          expect(() => quoteShellArg(value), `arg ${JSON.stringify(value)}`).not.toThrow();
        }
      }
    });
  });

  describe("the parser above, checked against Microsoft's published examples", () => {
    // Every assertion in this file runs through parseSingleToken, so a
    // misreading of the CRT rules would corrupt the implementation and the
    // oracle in the same direction and the suite would stay green. win32 is
    // unavailable here, so the only independent check left is a first-party
    // source. These input -> argv[1] pairs are published verbatim in
    // "Parsing C command-line arguments"
    // (https://learn.microsoft.com/cpp/c-language/parsing-c-command-line-arguments)
    // and in the CommandLineToArgvW remarks
    // (https://learn.microsoft.com/windows/win32/api/shellapi/nf-shellapi-commandlinetoargvw).
    // They are not derived from this repository's reading of the rules.
    const documented: Array<[string, string]> = [
      [String.raw`"a b c" d e`, String.raw`a b c`],
      [String.raw`"ab\"c" "\\" d`, String.raw`ab"c`],
      [String.raw`a\\\b d"e f"g h`, String.raw`a\\\b`],
      [String.raw`a\\\"b c d`, String.raw`a\"b`],
      [String.raw`a\\\\"b c" d e`, String.raw`a\\b c`],
    ];

    it.each(documented)("parses %j to the documented argv[1]", (input, expected) => {
      expect(parseSingleToken(input).value).toBe(expected);
    });

    // The table has a sixth row, `a"b"" c d` -> `ab" c d`, which this parser
    // does NOT reproduce: it applies the rule that a pair of double quotes
    // inside a quoted string collapses to one literal quote. Dropping the row
    // silently would be the same "green means covered" mistake this file is
    // careful about elsewhere, so the reason is asserted rather than claimed:
    // quoteShellArg can never emit a bare '""' pair, so the rule is
    // unreachable for the values this function produces.
    it("never emits an interior quote that is not preceded by a backslash", () => {
      const corpus = [
        "npm",
        "a b",
        'he said "hi"',
        "C:\\path\\",
        "C:\\Program Files\\node\\node.exe",
        'a\\" && whoami',
        '\\"\\"',
        "tail\\\\\\",
        '""',
        "",
      ];

      for (const value of corpus) {
        const token = quoteShellArg(value);
        if (!token.startsWith('"')) continue;
        const interior = token.slice(1, -1);
        for (let index = 0; index < interior.length; index += 1) {
          if (interior[index] !== '"') continue;
          expect(interior[index - 1], `value ${JSON.stringify(value)} token ${JSON.stringify(token)}`).toBe("\\");
        }
      }
    });
  });

  it("stays importable: requiring the module must not run the release gate", () => {
    // main() is guarded by require.main, so this import performs no npm audit,
    // no migration and no build. Reaching this assertion is the evidence.
    expect(typeof quoteShellArg).toBe("function");
  });
});
