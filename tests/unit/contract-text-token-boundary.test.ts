import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { matchState, createRequireText } = require("../../scripts/tools/contract-text.js") as {
  matchState: (source: string, needle: string) => "ok" | "absent" | "fragment";
  createRequireText: (errors: string[]) => (label: string, source: string, needle: string) => void;
};

/**
 * The tests are split by whether they would have failed before the fix.
 * Mixing the two makes "N tests added" read as defect-detection power, when
 * most of them only restate behaviour that already held.
 */
describe("contract-text token boundary", () => {
  describe("detects what substring matching could not (these fail on the pre-fix code)", () => {
    // Each row was measured against origin/main: the checker exits 0 with
    // "OK" on the mutated workflow, i.e. the contract passes while pinning
    // nothing.
    const extensions: Array<[string, string, string]> = [
      ["a digit appended", "retention-days: 14", "  retention-days: 145\n"],
      ["a second digit", "timeout-minutes: 5", "  timeout-minutes: 50\n"],
      ["zero extended", "fetch-depth: 0", "  fetch-depth: 01\n"],
      ["a decimal continues the number", "retention-days: 14", "  retention-days: 14.5\n"],
      ["a word extended", "severity: CRITICAL,HIGH", "  severity: CRITICAL,HIGHEST\n"],
      ["a pinned sha extended", "@sha256:53ada149", "FROM node@sha256:53ada149d4\n"],
    ];

    it.each(extensions)("%s", (_label, needle, source) => {
      expect(matchState(source, needle)).toBe("fragment");
    });

    it("also refuses a match that is extended on the left", () => {
      // The same defect mirrored: `fetch-depth: 0` matches inside
      // `prefetch-depth: 0`, which is a different key entirely.
      expect(matchState("  prefetch-depth: 0\n", "fetch-depth: 0")).toBe("fragment");
    });

    it("reports a fragment differently from an absence", () => {
      // Operationally these are opposite situations. Reporting "missing X"
      // for a value that is plainly visible in the file sends the reader
      // looking for the wrong thing.
      const errors: string[] = [];
      const requireText = createRequireText(errors);
      requireText("W", "  retention-days: 145\n", "retention-days: 14");
      requireText("W", "  nothing here\n", "retention-days: 14");

      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain("only inside a longer token");
      expect(errors[1]).toContain("missing");
      expect(errors[1]).not.toContain("only inside a longer token");
    });
  });

  describe("keeps what already worked (these pass before the fix too)", () => {
    it("accepts an exact, properly terminated match", () => {
      expect(matchState("  retention-days: 14\n", "retention-days: 14")).toBe("ok");
    });

    it("reports a genuinely absent needle as absent, not as a fragment", () => {
      expect(matchState("  retention-days: 30\n", "retention-days: 14")).toBe("absent");
    });

    it("accepts a match that ends at the end of the source", () => {
      expect(matchState("  retention-days: 14", "retention-days: 14")).toBe("ok");
    });

    it("accepts one bounded occurrence even when another is a fragment", () => {
      // The contract asks whether the text appears as a standalone token
      // somewhere, not whether every occurrence is standalone.
      expect(matchState("  retention-days: 145\n  retention-days: 14\n", "retention-days: 14")).toBe("ok");
    });
  });

  describe("leaves deliberate prefixes alone, without an exemption list", () => {
    // This is the part that must not become an enumeration. A needle written
    // as a prefix already ends at a structural character, so it has no edge
    // inside a token and the rule does not apply to it. Nothing here names a
    // workflow key, so a key added later is governed by the same predicate.
    const prefixes: Array<[string, string]> = [
      ["workflow_dispatch:", "on:\n  workflow_dispatch:\n    inputs:\n"],
      ["docker-image-security:", "jobs:\n  docker-image-security:\n    runs-on: ubuntu-latest\n"],
      ["FROM node:22-bookworm-slim@sha256:", "FROM node:22-bookworm-slim@sha256:53ada149 AS prod-deps\n"],
      ["permissions:\n  contents: read", "permissions:\n  contents: read\n  packages: write\n"],
    ];

    it.each(prefixes)("%j still matches", (needle, source) => {
      expect(matchState(source, needle)).toBe("ok");
    });

    it("applies the rule from the needle's own edges, not from a key list", () => {
      // Same key, two needles. The one that stops mid-token is checked; the
      // one that stops at ':' is not. No table decided that.
      expect(matchState("  retention-days: 145\n", "retention-days: 14")).toBe("fragment");
      expect(matchState("  retention-days: 145\n", "retention-days:")).toBe("ok");
    });
  });

  describe("the defect is removed from the tree, not just from one copy", () => {
    it("leaves no private substring-matching requireText in scripts/tools", () => {
      // The same three-line function had been copy-pasted into four checkers,
      // so fixing it in place would have left the next copy free to
      // reintroduce it. Matched by arity rather than by parameter names:
      // create-neon-backup-evidence.js has an unrelated two-argument
      // requireText that must not be caught here.
      const threeArgRequireText = /function\s+requireText\s*\([^)]*,[^)]*,[^)]*\)/;
      const offenders = readdirSync(new URL("../../scripts/tools/", import.meta.url))
        .filter((name) => name.endsWith(".js") && name !== "contract-text.js")
        .filter((name) =>
          threeArgRequireText.test(readFileSync(new URL(`../../scripts/tools/${name}`, import.meta.url), "utf8")),
        );

      expect(offenders).toEqual([]);
    });

    it("wires every contract checker that uses requireText to the shared module", () => {
      const dir = new URL("../../scripts/tools/", import.meta.url);
      const users = readdirSync(dir)
        .filter((name) => name.endsWith(".js") && name !== "contract-text.js")
        .map((name) => [name, readFileSync(new URL(name, dir), "utf8")] as const)
        .filter(([, source]) => /\brequireText\(\s*"/.test(source));

      expect(users.length).toBeGreaterThan(0);
      for (const [name, source] of users) {
        expect(source, `${name} must import the shared requireText`).toContain("createRequireText");
      }
    });
  });
});
