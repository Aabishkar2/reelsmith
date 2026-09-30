#!/usr/bin/env node
'use strict';
/**
 * bin/reelsmith.js — the `reelsmith` CLI (package.json "bin"). Everything lives in core/cli.js;
 * `reelsmith --help` lists the commands, `reelsmith <command> --help` their flags.
 * Exit codes: 0 ok · 1 error · 2 usage · 3 gate refused.
 */
require('../core/cli').main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => { console.error(`error: ${err && err.stack ? err.stack : err}`); process.exitCode = 1; },
);
