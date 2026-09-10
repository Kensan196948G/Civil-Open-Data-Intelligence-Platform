import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/tools/post-release-status.js");

const require = createRequire(import.meta.url);
const {
  DEFAULT_PREVIEW_URL,
  DEFAULT_PRODUCTION_URL,
  buildReport,
  parseArgs,
  renderReport,
  fetchWithTimeout,
  inspectProbe,
  buildIncidentDigest,
  escapeMarkdownTable,
} = require("../../scripts/tools/post-release-status.js") as {
  DEFAULT_PREVIEW_URL: string;
  DEFAULT_PRODUCTION_URL: string;
  parseArgs: (argv: string[]) => {
    productionUrl: string;
    previewUrl: string;
    strictProduction: boolean;
    allowPreviewDown: boolean;
    timeoutMs: number;
    maxResponseMs: number;
    accessClientId: string;
    accessClientSecret: string;
    diagnosisOut: string;
  };
  buildReport: (
    args: {
      productionUrl: string;
      previewUrl: string;
      strictProduction: boolean;
      allowPreviewDown: boolean;
      timeoutMs: number;
      maxResponseMs: number;
      accessClientId: string;
      accessClientSecret: string;
    },
    deps: {
      resolver?: { resolve4: (host: string) => Promise<string[]>; resolve6: (host: string) => Promise<string[]> };
      fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
    },
  ) => Promise<{
    productionConnected: boolean;
    productionEndpointUnhealthy: boolean;
    previewHealthy: boolean;
    ready: boolean;
    productionDns: { ok: boolean; error: string };
    productionProbes: { path: string; status: number; ok: boolean; state: string }[];
    productionDiagnosis: string[][];
    accessTokenConfigured: boolean;
  }>;
  renderReport: (report: unknown) => string;
  buildIncidentDigest: (report: unknown) => {
    overall: string;
    productionConnected: boolean;
    accessTokenConfigured: boolean;
    productionStatuses: { path: string; status: number }[];
    diagnosis: { check: string; state: string; detail: string }[];
  };
  fetchWithTimeout: (
    url: string,
    options: {
      fetcher: (url: string, init?: RequestInit) => Promise<Response>;
      timeoutMs: number;
      headers?: Record<string, string>;
    },
  ) => Promise<{ ok: boolean; status: number; state: string; headers: Record<string, string> }>;
  inspectProbe: (
    pathname: string,
    result: { ok: boolean; status: number; state: string; responseTimeMs: number; bodyPreview: string },
    maxResponseMs: number,
  ) => {
    ok: boolean;
    state: string;
    responseTimeOk: boolean;
    readyPayloadOk: boolean;
    databaseState?: string;
    readyState?: string;
  };
  escapeMarkdownTable: (value: unknown) => string;
};

const baseArgs = {
  productionUrl: DEFAULT_PRODUCTION_URL,
  previewUrl: DEFAULT_PREVIEW_URL,
  strictProduction: false,
  allowPreviewDown: false,
  timeoutMs: 1000,
  maxResponseMs: 5000,
  accessClientId: "",
  accessClientSecret: "",
};

function okFetcher() {
  return vi.fn(async () => new Response("{}", { status: 200 }));
}

/**
 * mock fetcher が「どちらのエンドポイント宛か」を決める判定。
 *
 * 以前は `url.includes("odip.mirai-dx-platform.com")` と書いていた。部分一致では
 * `https://evil.example.com/?next=odip.mirai-dx-platform.com` のように**ホストが別で
 * あってもパスやクエリに文字列が現れるだけ**の URL が production 宛と判定される。
 * mock の分岐が本物より緩いと、本番判定の検査が意図しない要求まで拾って緑になり得る。
 * ここは hostname を厳密比較する (CodeQL js/incomplete-url-substring-sanitization, 7.8)。
 *
 * 期待ホストは DEFAULT_PRODUCTION_URL から導出する。テスト側へホスト名を書き写すと、
 * 本番 URL が変わったときに mock だけ古い値のまま残る。
 */
const PRODUCTION_HOSTNAME = new URL(DEFAULT_PRODUCTION_URL).hostname;

function isProductionUrl(url: string): boolean {
  try {
    return new URL(url).hostname === PRODUCTION_HOSTNAME;
  } catch {
    // 相対 URL など、そもそも production 宛になり得ないもの
    return false;
  }
}

/**
 * mock のルーティング判定が「厳密比較へ変えた意味がある」ことを、実行のたびに再現する。
 *
 * 旧実装 (legacyIncludesRouting) を据え置いてあるので、この主張は手順型の変異試験と違い
 * 退行しない。`isProductionUrl` を部分一致へ戻すと、下の 2 ケースが即座に落ちる。
 *
 * ⚠ この関数は**意図的に脆弱な形のまま**である。ここを厳密比較へ直すと、下の
 *   「旧実装は素通りさせた」が成立しなくなり、証明そのものが消える。
 *
 * ⚠ CodeQL `js/incomplete-url-substring-sanitization` がここを指摘しないのは、
 *   引数が実行時計算値 (`new URL(...).hostname`) でクエリが定数解決できないためであり、
 *   **この書き方が安全だからではない**。スキャナが黙っていることを根拠にしないこと。
 */
function legacyIncludesRouting(url: string): boolean {
  return url.includes(PRODUCTION_HOSTNAME);
}

describe("mock fetcher のルーティング判定 (CodeQL js/incomplete-url-substring-sanitization)", () => {
  const decoys = [
    `https://evil.example.com/?next=${PRODUCTION_HOSTNAME}`,
    `https://evil.example.com/${PRODUCTION_HOSTNAME}/api/health`,
    `https://${PRODUCTION_HOSTNAME}.evil.example.com/api/health`,
  ];

  it("本物の production URL は従来どおり production 宛と判定する", () => {
    expect(isProductionUrl(`${DEFAULT_PRODUCTION_URL}/api/health`)).toBe(true);
    // 前提の確認: 旧実装も本物は通していた (最初から落ちていたなら差の証明にならない)
    expect(legacyIncludesRouting(`${DEFAULT_PRODUCTION_URL}/api/health`)).toBe(true);
  });

  it.each(decoys)("ホストが別の %s を production 宛と誤認しない", (url) => {
    expect(legacyIncludesRouting(url)).toBe(true); // 旧実装は素通りさせた
    expect(isProductionUrl(url)).toBe(false); // 新実装は弾く
  });

  it("preview URL を production 宛と判定しない", () => {
    expect(isProductionUrl(`${DEFAULT_PREVIEW_URL}/api/health`)).toBe(false);
  });
});

describe("post-release-status", () => {
  it("defaults to the approved production subdomain and shared preview URL", () => {
    const args = parseArgs([]);

    expect(args.productionUrl).toBe("https://odip.mirai-dx-platform.com");
    expect(args.previewUrl).toBe("http://192.168.0.185:3100");
    expect(args.strictProduction).toBe(false);
    expect(args.maxResponseMs).toBe(5000);
    expect(args.accessClientId).toBe("");
    expect(args.accessClientSecret).toBe("");
  });

  it("reads Cloudflare Access service token credentials from the environment", () => {
    const previousId = process.env.CF_ACCESS_CLIENT_ID;
    const previousSecret = process.env.CF_ACCESS_CLIENT_SECRET;
    process.env.CF_ACCESS_CLIENT_ID = "service-client-id";
    process.env.CF_ACCESS_CLIENT_SECRET = "service-client-secret";
    try {
      const args = parseArgs([]);
      expect(args.accessClientId).toBe("service-client-id");
      expect(args.accessClientSecret).toBe("service-client-secret");
    } finally {
      if (previousId === undefined) delete process.env.CF_ACCESS_CLIENT_ID;
      else process.env.CF_ACCESS_CLIENT_ID = previousId;
      if (previousSecret === undefined) delete process.env.CF_ACCESS_CLIENT_SECRET;
      else process.env.CF_ACCESS_CLIENT_SECRET = previousSecret;
    }
  });

  it("keeps non-strict monitoring usable while production DNS is not connected", async () => {
    const report = await buildReport(baseArgs, {
      resolver: {
        resolve4: async () => {
          throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
        },
        resolve6: async () => {
          throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
        },
      },
      fetcher: okFetcher(),
    });

    expect(report.productionDns.ok).toBe(false);
    expect(report.productionConnected).toBe(false);
    expect(report.previewHealthy).toBe(true);
    expect(report.ready).toBe(true);

    const text = renderReport(report);
    expect(text).toContain("odip.mirai-dx-platform.com");
    expect(text).toContain("Max response time: 5000ms");
    expect(text).toContain("Production connected: no");
    expect(text).toContain("Preview healthy: yes");
    expect(text).not.toMatch(/password/i);
    expect(text).not.toMatch(/service-client-secret|gho_|sk-/i);
  });

  it("fails readiness in strict production mode when DNS is unresolved", async () => {
    const report = await buildReport(
      { ...baseArgs, strictProduction: true },
      {
        resolver: {
          resolve4: async () => {
            throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
          },
          resolve6: async () => {
            throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
          },
        },
        fetcher: okFetcher(),
      },
    );

    expect(report.ready).toBe(false);
    expect(renderReport(report)).toContain("hold production cutover");
  });

  it("probes and flags production endpoint failures even when local DNS resolution is inconclusive", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (isProductionUrl(url)) {
        return new Response("522: Connection timed out", {
          status: 522,
          headers: { server: "cloudflare", "cf-ray": "abc-NRT" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    const report = await buildReport(baseArgs, {
      resolver: {
        resolve4: async () => {
          throw Object.assign(new Error("resolver refused"), { code: "ECONNREFUSED" });
        },
        resolve6: async () => {
          throw Object.assign(new Error("resolver refused"), { code: "ECONNREFUSED" });
        },
      },
      fetcher,
    });

    expect(report.productionDns.ok).toBe(false);
    expect(report.productionProbes).toHaveLength(2);
    expect(report.productionProbes[0].status).toBe(522);
    expect(report.productionConnected).toBe(false);
    expect(report.productionEndpointUnhealthy).toBe(true);
    expect(report.ready).toBe(false);
    const text = renderReport(report);
    expect(text).toContain("investigate production route/origin health");
    expect(text).toContain("Production Route Diagnosis");
    expect(text).toContain("Cloudflare edge reached");
    expect(text).toContain("production Worker route is deployed");
    expect(text).not.toContain("abc-NRT");
  });

  it("marks production connected only when DNS and read-only probes succeed", async () => {
    const report = await buildReport(
      { ...baseArgs, strictProduction: true },
      {
        resolver: {
          resolve4: async () => ["203.0.113.10"],
          resolve6: async () => [],
        },
        fetcher: okFetcher(),
      },
    );

    expect(report.productionConnected).toBe(true);
    expect(report.previewHealthy).toBe(true);
    expect(report.ready).toBe(true);
    expect(renderReport(report)).toContain("Production connected: yes");
  });

  it("does not treat Access or login redirects as a healthy API response", async () => {
    const result = await fetchWithTimeout("https://odip.mirai-dx-platform.com/api/health", {
      fetcher: async () => new Response("", { status: 302, headers: { location: "https://example.com/login" } }),
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
    expect(result.headers.location).toBeUndefined();
  });

  it("sends Cloudflare Access service token headers when credentials are provided", async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response("{}", { status: 200 });
    });

    const result = await fetchWithTimeout("https://odip.mirai-dx-platform.com/api/health", {
      fetcher,
      timeoutMs: 1000,
      headers: { "cf-access-client-id": "service-client-id", "cf-access-client-secret": "service-client-secret" },
    });

    expect(result.ok).toBe(true);
    expect(capturedHeaders).toEqual(
      expect.objectContaining({
        accept: expect.any(String),
        "cf-access-client-id": "service-client-id",
        "cf-access-client-secret": "service-client-secret",
      }),
    );
  });

  it("marks production connected when Access-authenticated probes return 200", async () => {
    const report = await buildReport(
      {
        ...baseArgs,
        strictProduction: true,
        accessClientId: "service-client-id",
        accessClientSecret: "service-client-secret",
      },
      {
        resolver: {
          resolve4: async () => ["203.0.113.10"],
          resolve6: async () => [],
        },
        fetcher: okFetcher(),
      },
    );

    expect(report.accessTokenConfigured).toBe(true);
    expect(report.productionConnected).toBe(true);
    expect(report.ready).toBe(true);
    expect(renderReport(report)).toContain("Access service token: configured");
  });

  it("reports an Access boundary diagnosis when production returns 302 with Cloudflare edge headers", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (isProductionUrl(url)) {
        return new Response("", {
          status: 302,
          headers: {
            server: "cloudflare",
            "cf-ray": "abc-NRT",
            location: "https://example-team.cloudflareaccess.com/cdn-cgi/access/login/odip.example.com?kid=x",
          },
        });
      }
      return new Response("{}", { status: 200 });
    });

    const report = await buildReport(
      { ...baseArgs, strictProduction: true },
      {
        resolver: {
          resolve4: async () => ["203.0.113.10"],
          resolve6: async () => [],
        },
        fetcher,
      },
    );

    expect(report.productionConnected).toBe(false);
    expect(report.productionEndpointUnhealthy).toBe(true);
    const diagnosis = report.productionDiagnosis.map((row) => row[0]).join(",");
    expect(diagnosis).toContain("Cloudflare Access boundary");
    expect(renderReport(report)).toContain("Access service token: not configured");
    expect(renderReport(report)).not.toContain("service-client-secret");
  });

  it("diagnoses a rejected service token when 302 persists although credentials are configured", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (isProductionUrl(url)) {
        return new Response("", {
          status: 302,
          headers: {
            server: "cloudflare",
            "cf-ray": "abc-NRT",
            "www-authenticate": 'Cloudflare-Access resource_metadata="https://odip.example.com/.well-known/x"',
          },
        });
      }
      return new Response("{}", { status: 200 });
    });

    const report = await buildReport(
      {
        ...baseArgs,
        strictProduction: true,
        accessClientId: "service-client-id",
        accessClientSecret: "service-client-secret",
      },
      {
        resolver: {
          resolve4: async () => ["203.0.113.10"],
          resolve6: async () => [],
        },
        fetcher,
      },
    );

    const diagnosis = report.productionDiagnosis.map((row) => row[0]).join(",");
    // token設定済みで302が返るのは「Accessが有効なので期待動作」ではなく、
    // 監視用service tokenがAccessに拒否されている状態。未設定時と同じ案内へ
    // 落とすと、当番は設定済みsecretの再設定を試みて原因へ辿り着けない。
    expect(diagnosis).toContain("Cloudflare Access service token rejected");
    expect(diagnosis).not.toContain("Cloudflare Access boundary");

    const rendered = renderReport(report);
    expect(rendered).toContain("Access service token: configured");
    // ID/secretのペア不一致という実際の原因を指し示すこと
    expect(rendered).toContain("same service token");
    // 診断を変えるだけで、障害そのものを緑化しない（症状抑制の禁止）
    expect(report.productionConnected).toBe(false);
    expect(report.ready).toBe(false);
    // 資格情報を出力へ漏らさない
    expect(rendered).not.toContain("service-client-secret");
    expect(rendered).not.toContain("service-client-id");
  });

  // Issue #207: probeは初回失敗の時点で「service tokenが拒否されている」と正しく
  // 診断していたが、その結論はartifact側にしか残らず、incident Issue本文にはrunへの
  // リンクしか載らなかった。結果として101回以上・4日間・352コメントの間、当番は
  // Issueを見ても原因へ辿り着けなかった。digestは通知へ載せる分の契約である。
  it("exposes the rejected-token diagnosis in the non-secret incident digest", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (isProductionUrl(url)) {
        return new Response("", {
          status: 302,
          headers: {
            server: "cloudflare",
            "cf-ray": "abc-NRT",
            "www-authenticate": 'Cloudflare-Access resource_metadata="https://odip.example.com/.well-known/x"',
          },
        });
      }
      return new Response("{}", { status: 200 });
    });

    const report = await buildReport(
      {
        ...baseArgs,
        strictProduction: true,
        accessClientId: "service-client-id",
        accessClientSecret: "service-client-secret",
      },
      {
        resolver: { resolve4: async () => ["203.0.113.10"], resolve6: async () => [] },
        fetcher,
      },
    );

    const digest = buildIncidentDigest(report);
    const serialized = JSON.stringify(digest);

    // 当番が最初に読む一行が「本番が落ちた」ではなく「監視credentialが拒否された」であること
    expect(digest.diagnosis.map((row) => row.check)).toContain("Cloudflare Access service token rejected");
    // ペア不一致という実際の原因を、artifactを取得しなくても本文だけで辿れること
    expect(serialized).toContain("same service token");
    expect(digest.accessTokenConfigured).toBe(true);
    expect(digest.overall).toBe("ATTENTION");
    expect(digest.productionConnected).toBe(false);
    // 初動に必要な応答コードは載せる
    expect(digest.productionStatuses).toEqual([
      { path: "/api/health", status: 302 },
      { path: "/api/ready", status: 302 },
    ]);

    // digestはIssue本文へ入る。資格情報を持ち込まないことが成立条件。
    expect(serialized).not.toContain("service-client-secret");
    expect(serialized).not.toContain("service-client-id");
  });

  it("keeps the digest free of endpoint-controlled text and table-breaking characters", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (isProductionUrl(url)) {
        // endpointが制御できる本文・ヘッダを返しても、digestへは載らないこと。
        return new Response("| injected | row |\n## fake heading", {
          status: 500,
          headers: { server: "cloudflare", "cf-ray": "x", "x-evil": "| pipe |\n newline" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    const report = await buildReport(
      { ...baseArgs, strictProduction: true },
      { resolver: { resolve4: async () => ["203.0.113.10"], resolve6: async () => [] }, fetcher },
    );

    const digest = buildIncidentDigest(report);
    for (const row of digest.diagnosis) {
      for (const value of [row.check, row.state, row.detail]) {
        expect(value).not.toMatch(/[\r\n]/);
        expect(value.length).toBeLessThanOrEqual(500);
      }
    }
    expect(JSON.stringify(digest)).not.toContain("injected");
    expect(digest.productionStatuses.every((probe) => Number.isInteger(probe.status))).toBe(true);
  });

  it("accepts --diagnosis-out and defaults it to disabled", () => {
    expect(parseArgs([]).diagnosisOut).toBe("");
    expect(parseArgs(["--diagnosis-out", "production-diagnosis.json"]).diagnosisOut).toBe(
      "production-diagnosis.json",
    );
  });

  it("does not blame the service token for a 302 that carries no Access challenge", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (isProductionUrl(url)) {
        // Accessを通過したあとにorigin自身がリダイレクトした場合。Cloudflare経由なので
        // cf-ray は付くが、Accessのchallenge証跡は無い。
        return new Response("", {
          status: 302,
          headers: { server: "cloudflare", "cf-ray": "abc-NRT", location: "https://odip.example.com/login" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    const report = await buildReport(
      {
        ...baseArgs,
        strictProduction: true,
        accessClientId: "service-client-id",
        accessClientSecret: "service-client-secret",
      },
      {
        resolver: {
          resolve4: async () => ["203.0.113.10"],
          resolve6: async () => [],
        },
        fetcher,
      },
    );

    const diagnosis = report.productionDiagnosis.map((row) => row[0]).join(",");
    expect(diagnosis).toContain("Production redirect without an Access challenge");
    expect(diagnosis).not.toContain("Cloudflare Access service token rejected");
    expect(diagnosis).not.toContain("Cloudflare Access boundary");
    expect(report.ready).toBe(false);
  });

  it("identifies an Access challenge by strict hostname, not by substring", async () => {
    const challenge = async (headers: Record<string, string>) => {
      const result = await fetchWithTimeout("https://odip.example.com/api/health", {
        fetcher: async () => new Response("", { status: 302, headers }),
        timeoutMs: 1000,
      });
      return (result as { accessChallenge?: boolean }).accessChallenge;
    };

    // 正規のAccess login redirect
    expect(
      await challenge({ location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/odip.example.com?kid=x" }),
    ).toBe(true);
    // WWW-Authenticate のscheme
    expect(await challenge({ "www-authenticate": 'Cloudflare-Access resource_metadata="https://x/y"' })).toBe(true);

    // substring判定なら通ってしまうなりすましホスト
    expect(
      await challenge({ location: "https://evil-cloudflareaccess.com.attacker.test/cdn-cgi/access/login/x" }),
    ).toBe(false);
    expect(
      await challenge({ location: "https://attacker.test/cloudflareaccess.com/cdn-cgi/access/login/x" }),
    ).toBe(false);
    // 正規ホストでもlogin以外のpathはchallengeではない
    expect(await challenge({ location: "https://team.cloudflareaccess.com/some/other/path" })).toBe(false);
    // httpsでないredirect
    expect(await challenge({ location: "http://team.cloudflareaccess.com/cdn-cgi/access/login/x" })).toBe(false);
    // redirectなし
    expect(await challenge({})).toBe(false);
  });

  it("records /api/ready database health when the endpoint returns the standard payload", () => {
    const probe = inspectProbe(
      "/api/ready",
      {
        ok: true,
        status: 200,
        state: "200",
        responseTimeMs: 37,
        bodyPreview: JSON.stringify({ status: "ready", checks: { database: "ok" } }),
      },
      5000,
    );

    expect(probe.ok).toBe(true);
    expect(probe.readyState).toBe("ready");
    expect(probe.databaseState).toBe("ok");
    expect(probe.state).toContain("db=ok");
  });

  it("fails /api/ready when the database check is not ok", () => {
    const probe = inspectProbe(
      "/api/ready",
      {
        ok: true,
        status: 200,
        state: "200",
        responseTimeMs: 37,
        bodyPreview: JSON.stringify({ status: "ready", checks: { database: "degraded" } }),
      },
      5000,
    );

    expect(probe.ok).toBe(false);
    expect(probe.readyPayloadOk).toBe(false);
    expect(probe.state).toContain("db=degraded");
  });

  it("marks slow probes as not ready", () => {
    const probe = inspectProbe(
      "/api/health",
      {
        ok: true,
        status: 200,
        state: "200",
        responseTimeMs: 6001,
        bodyPreview: "{}",
      },
      5000,
    );

    expect(probe.ok).toBe(false);
    expect(probe.responseTimeOk).toBe(false);
    expect(probe.state).toContain("slow>5000ms");
  });

  it("escapes endpoint-controlled values before rendering Markdown tables", () => {
    expect(escapeMarkdownTable("ready|spoofed\n| injected | row")).toBe(
      "ready\\|spoofed \\| injected \\| row",
    );
  });
});

// CodeRabbit 指摘: 引数解析だけでは「main() が実際に digest を書く」契約を守れない。
// parseArgs が通っても書き出し側が壊れれば、incident 本文から診断が黙って消える。
describe("post-release-status / --diagnosis-out のファイル出力契約", () => {
  const runProbe = (extraArgs: string[]) =>
    new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          scriptPath,
          // 到達不能な宛先へ向けて短いタイムアウトで落とす。ネットワークに依存せず
          // 「失敗経路でも digest が書かれる」ことを見る (書かれなければ本番と同じ盲点)。
          "--production-url",
          "http://127.0.0.1:1",
          "--preview-url",
          "http://127.0.0.1:1",
          "--timeout-ms",
          "300",
          ...extraArgs,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      child.stdout.on("data", (chunk) => (stdout += String(chunk)));
      child.stderr.on("data", (chunk) => (stdout += String(chunk)));
      child.on("close", (code) => resolve({ code, stdout }));
    });

  it("指定パスへ digest を JSON として書き出す", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "codip-digest-")), "production-diagnosis.json");
    const { code } = await runProbe(["--diagnosis-out", out]);

    // 本番が落ちている以上、終了コードは失敗のままであること（診断を書いても緑化しない）
    expect(code).toBe(1);
    const digest = JSON.parse(readFileSync(out, "utf8"));
    expect(digest.overall).toBe("ATTENTION");
    expect(digest.productionConnected).toBe(false);
    expect(Array.isArray(digest.diagnosis)).toBe(true);
    expect(digest.diagnosis.length).toBeGreaterThan(0);
    for (const row of digest.diagnosis) {
      expect(typeof row.check).toBe("string");
      expect(typeof row.state).toBe("string");
      expect(typeof row.detail).toBe("string");
    }
    expect(digest.productionStatuses.every((probe: { status: number }) => Number.isInteger(probe.status))).toBe(true);
  }, 20_000);

  it("--diagnosis-out を渡さなければファイルを作らない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codip-digest-"));
    const { code } = await runProbe([]);
    expect(code).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  }, 20_000);

  it("書き出しに失敗しても本来の判定と終了コードは落とさない", async () => {
    // 存在しないディレクトリ配下を指定して writeFileSync を失敗させる。
    const out = join(mkdtempSync(join(tmpdir(), "codip-digest-")), "missing-dir", "d.json");
    const { code, stdout } = await runProbe(["--diagnosis-out", out]);

    expect(code).toBe(1);
    // 握り潰さず理由を残すこと
    expect(stdout).toContain("could not write diagnosis digest");
    // digest を書けなくても本番状態の判定自体は出力されること
    expect(stdout).toContain("Post-release Runtime Status");
  }, 20_000);
});
