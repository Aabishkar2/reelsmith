#!/usr/bin/env node
'use strict';
/**
 * pipeline/cli.js — legacy entry point, kept so existing scripts and tests keep working. It is a
 * thin alias onto the same command implementations as `reelsmith` (core/cli.js):
 *
 *   node pipeline/cli.js analyze  <video> [--take=takes/take-01] [--no-jev] [--whisper-model=turbo] [--force-whisper] [--json]
 *   node pipeline/cli.js rerecord <video> --sentence=s2.1 --clip=takes/rr-s2.1-1 [--no-jev] [--whisper-model=…] [--json]   (alias: splice)
 *   node pipeline/cli.js cut      <video> [--json]                                                                     (alias: finalize)
 *   node pipeline/cli.js status   <video> [--json]
 *   node pipeline/cli.js tts      <video> --voice=<name> [--mode=sentence|performance] [--provider=…] [--model=…] [--speed=1.15]
 *                                 [--timings=auto|whisper|estimate] [--whisper-model=…] [--cta=3] [--force] [--offline] [--json]
 *   node pipeline/cli.js jev      (verify the Jev slug on OpenRouter)
 *
 * == `reelsmith analyze|rerecord|cut|status|tts …` (see `reelsmith <command> --help`). The one
 * difference: a rejected re-record clip exits 2 here (as it always did), 1 under `reelsmith`.
 * --json prints the machine-readable result on stdout (logs go to stderr).
 */
const cli = require('../core/cli');

/** Kept for callers of the old module API. */
function resolveVideoDir(arg) {
  return require('../core/project').resolveVideo(arg);
}
const parseArgs = argv => cli.parseArgs(argv);

if (require.main === module) {
  cli.main(process.argv.slice(2), { legacy: true }).then(
    (code) => { process.exitCode = code; },
    (err) => { console.error(`error: ${err && err.message ? err.message : err}`); process.exitCode = 1; },
  );
}
module.exports = { statusTable: cli.statusTable, resolveVideoDir, parseArgs, main: argv => cli.main(argv, { legacy: true }) };
