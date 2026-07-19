#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

function main() {
  const separatorIndex = process.argv.indexOf("--");
  if (separatorIndex < 0) {
    console.error("[with-env] usage: node scripts/tools/with-env.js KEY=value -- command [args...]");
    process.exit(2);
  }

  const assignments = process.argv.slice(2, separatorIndex);
  const command = process.argv[separatorIndex + 1];
  const args = process.argv.slice(separatorIndex + 2);

  if (!command) {
    console.error("[with-env] missing command after --");
    process.exit(2);
  }

  const env = { ...process.env };
  for (const assignment of assignments) {
    const eq = assignment.indexOf("=");
    if (eq <= 0) {
      console.error(`[with-env] invalid assignment: ${assignment}`);
      process.exit(2);
    }
    env[assignment.slice(0, eq)] = assignment.slice(eq + 1);
  }

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
  });

  if (result.error) {
    console.error(`[with-env] failed to spawn "${command}": ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

main();
