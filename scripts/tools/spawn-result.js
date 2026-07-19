function exitCodeFromSpawnResult(result, command, label, logger = console.error) {
  if (result.error) {
    logger(`[${label}] failed to spawn "${command}": ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

module.exports = { exitCodeFromSpawnResult };
