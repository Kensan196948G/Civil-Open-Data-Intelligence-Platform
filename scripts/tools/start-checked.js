#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  const mode = process.env.CODIP_ENV_MODE?.trim() || "production";
  run(process.execPath, [path.join(process.cwd(), "scripts/tools/validate-env.js"), "--mode", mode]);
  run("next", ["start"]);
}

main();
