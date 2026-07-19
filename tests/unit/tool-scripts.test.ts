import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const withEnvScript = path.join(process.cwd(), "scripts/tools/with-env.js");
const placeholderScript = path.join(process.cwd(), "scripts/tools/check-production-placeholders.js");

describe("tool scripts", () => {
  it("runs a command with cross-platform environment assignments", () => {
    const result = spawnSync(
      process.execPath,
      [withEnvScript, "CODIP_TEST_VALUE=windows-safe", "--", "node", "-e", "console.log(process.env.CODIP_TEST_VALUE)"],
      {
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("windows-safe");
  });

  it("rejects malformed environment assignments", () => {
    const result = spawnSync(process.execPath, [withEnvScript, "CODIP_TEST_VALUE", "--", "node", "-v"], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("invalid assignment");
  });

  it("rejects unresolved production Cloudflare placeholders", () => {
    const result = spawnSync(process.execPath, [placeholderScript, "--env", "production"], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("id is still a placeholder");
  });

  it("accepts a production wrangler config after Hyperdrive placeholders are resolved", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codip-placeholder-test-"));
    const wrangler = fs
      .readFileSync(path.join(process.cwd(), "wrangler.jsonc"), "utf8")
      .replace(/REPLACE_WITH_WRANGLER_HYPERDRIVE_CREATE_OUTPUT/g, "11111111111111111111111111111111")
      .replace(/REPLACE_WITH_STAGING_HYPERDRIVE_ID/g, "22222222222222222222222222222222")
      .replace(/REPLACE_WITH_PRODUCTION_HYPERDRIVE_ID/g, "33333333333333333333333333333333");
    fs.writeFileSync(path.join(tmp, "wrangler.jsonc"), wrangler);

    const result = spawnSync(process.execPath, [placeholderScript, "--env", "production"], {
      cwd: tmp,
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[production-placeholders] OK (production)");
  });
});
