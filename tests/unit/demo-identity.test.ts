import { afterEach, describe, expect, it, vi } from "vitest";
import { demoIdentityEnabled, demoUserEmailFromEnv } from "@/lib/demo-identity";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo identity", () => {
  it("未設定では null（既存の Access 識別子経路へ委ねる）", () => {
    vi.stubEnv("CODIP_DEMO_IDENTITY", "");
    vi.stubEnv("CODIP_DEMO_USER_EMAIL", "");
    expect(demoIdentityEnabled()).toBe(false);
    expect(demoUserEmailFromEnv()).toBeNull();
  });

  it("片方だけの設定では有効化しない", () => {
    vi.stubEnv("CODIP_DEMO_IDENTITY", "true");
    vi.stubEnv("CODIP_DEMO_USER_EMAIL", "");
    expect(demoUserEmailFromEnv()).toBeNull();

    vi.stubEnv("CODIP_DEMO_IDENTITY", "false");
    vi.stubEnv("CODIP_DEMO_USER_EMAIL", "demo.engineer@example.com");
    expect(demoUserEmailFromEnv()).toBeNull();
  });

  it("2つ揃った場合のみ小文字正規化して返す", () => {
    vi.stubEnv("CODIP_DEMO_IDENTITY", "true");
    vi.stubEnv("CODIP_DEMO_USER_EMAIL", "Demo.Engineer@Example.com");
    expect(demoUserEmailFromEnv()).toBe("demo.engineer@example.com");
  });

  it("@ を含まない値・長すぎる値は拒否する", () => {
    vi.stubEnv("CODIP_DEMO_IDENTITY", "true");
    vi.stubEnv("CODIP_DEMO_USER_EMAIL", "not-an-email");
    expect(demoUserEmailFromEnv()).toBeNull();

    vi.stubEnv("CODIP_DEMO_USER_EMAIL", `${"a".repeat(250)}@example.com`);
    expect(demoUserEmailFromEnv()).toBeNull();
  });

  it("本番モード (CODIP_ENV_MODE=production) では設定値に関係なくランタイムで無効化する", () => {
    vi.stubEnv("CODIP_ENV_MODE", "production");
    vi.stubEnv("CODIP_DEMO_IDENTITY", "true");
    vi.stubEnv("CODIP_DEMO_USER_EMAIL", "demo.engineer@example.com");
    expect(demoIdentityEnabled()).toBe(false);
    expect(demoUserEmailFromEnv()).toBeNull();
  });

  it("Workers の NODE_ENV=production でも preview モードなら有効のまま", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ENV_MODE", "preview");
    vi.stubEnv("CODIP_DEMO_IDENTITY", "true");
    vi.stubEnv("CODIP_DEMO_USER_EMAIL", "demo.engineer@example.com");
    expect(demoIdentityEnabled()).toBe(true);
    expect(demoUserEmailFromEnv()).toBe("demo.engineer@example.com");
  });
});
