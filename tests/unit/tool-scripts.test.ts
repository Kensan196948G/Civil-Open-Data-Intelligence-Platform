import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const withEnvScript = path.join(process.cwd(), "scripts/tools/with-env.js");

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
});
