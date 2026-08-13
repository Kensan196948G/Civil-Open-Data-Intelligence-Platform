import { describe, expect, it } from "vitest";

import { stripTagSpans } from "../../scripts/ingestion/html-text";

describe("stripTagSpans", () => {
  it("removes well-formed tags", () => {
    expect(stripTagSpans("<p>hello</p> <b>world</b>")).toBe("hello world");
  });

  it("can join removed spans with a separator", () => {
    const joined = stripTagSpans("<b>a</b><i>b</i>", " ");
    expect(joined.replace(/\s+/g, " ").trim()).toBe("a b");
  });

  it("leaves no tag structure behind for the multi-character bypass shape", () => {
    const text = stripTagSpans("<<script>alert(1)</script>");
    expect(text).toBe("alert(1)");
    expect(text).not.toMatch(/[<>]/);
  });

  it("drops an unterminated tag fragment instead of leaking a bare '<'", () => {
    expect(stripTagSpans("value < broken")).toBe("value ");
  });

  it("passes through plain text unchanged", () => {
    expect(stripTagSpans("東京 23 区のオープンデータ")).toBe("東京 23 区のオープンデータ");
  });

  it("treats null/undefined as empty text", () => {
    expect(stripTagSpans(null)).toBe("");
    expect(stripTagSpans(undefined)).toBe("");
  });
});
