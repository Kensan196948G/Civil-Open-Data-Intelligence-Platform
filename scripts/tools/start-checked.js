#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { exitCodeFromSpawnResult } = require("./spawn-result");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  const exitCode = exitCodeFromSpawnResult(result, command, "start-checked");
  if (exitCode !== 0) process.exit(exitCode);
}

function main() {
  const mode = process.env.CODIP_ENV_MODE?.trim() || "production";
  run(process.execPath, [path.join(process.cwd(), "scripts/tools/validate-env.js"), "--mode", mode]);
  run("next", ["start", ...process.argv.slice(2)]);
}

main();
