import { describe, expect, it } from "vitest";
import { detectFormat } from "@/lib/format-detector";

describe("detectFormat", () => {
  it("Content-Type application/json → JSON", () => {
    expect(detectFormat("application/json", '{"a":1}')).toBe("JSON");
  });

  it("JSON レスポンスに GeoJSON type があれば GeoJSON", () => {
    expect(
      detectFormat("application/json", '{"type":"FeatureCollection","features":[]}'),
    ).toBe("GeoJSON");
  });

  it("application/geo+json → GeoJSON", () => {
    expect(detectFormat("application/geo+json", "{}")).toBe("GeoJSON");
  });

  it("text/csv → CSV", () => {
    expect(detectFormat("text/csv", "a,b\n1,2")).toBe("CSV");
  });

  it("application/pdf → PDF", () => {
    expect(detectFormat("application/pdf", "%PDF-1.7")).toBe("PDF");
  });

  it("text/html → HTML", () => {
    expect(detectFormat("text/html; charset=utf-8", "<!doctype html><html>")).toBe("HTML");
  });

  it("application/xml → XML", () => {
    expect(detectFormat("application/xml", "<?xml version=\"1.0\"?><feed/>")).toBe("XML");
  });

  it("Content-Type 不明でも JSON 実体を判定する", () => {
    expect(detectFormat(null, '{"key":"value"}')).toBe("JSON");
  });

  it("Content-Type 不明でも XML 実体を判定する", () => {
    expect(detectFormat("application/octet-stream", "<?xml version=\"1.0\"?><root/>")).toBe("XML");
  });

  it("Content-Type 不明でも HTML 実体を判定する", () => {
    expect(detectFormat(null, "<!DOCTYPE HTML><html><body></body></html>")).toBe("HTML");
  });

  it("CSV らしき実体を判定する", () => {
    expect(detectFormat(null, "name,age,city\nTaro,30,Tokyo\nHanako,25,Osaka")).toBe("CSV");
  });

  it("判定不能なら unknown", () => {
    expect(detectFormat(null, "just some plain text")).toBe("unknown");
  });

  it("空レスポンスは unknown", () => {
    expect(detectFormat(null, "")).toBe("unknown");
  });
});
