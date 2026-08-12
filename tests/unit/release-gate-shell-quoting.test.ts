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
      for (const char of [" ", "&", "|", ">", "<", "^", "%", "!", '"', "\\", "$", "`", "(", ")", "*", "?", ";", "'", "\t"]) {
        expect(quoteShellArg(char), `char ${JSON.stringify(char)}`).not.toBe(char);
      }
    });

    it("does not take the fast path when only part of the value is allowed", () => {
      expect(quoteShellArg("npm run")).toBe('"npm run"');
    });
  });

  it("stays importable: requiring the module must not run the release gate", () => {
    // main() is guarded by require.main, so this import performs no npm audit,
    // no migration and no build. Reaching this assertion is the evidence.
    expect(typeof quoteShellArg).toBe("function");
  });
});
