#!/usr/bin/env node
// deprecated shim, removed after the tutorial build: this tool moved to tools/ (or use the `reelsmith` CLI).
'use strict';
const path = require('path');
const target = path.join(__dirname, '..', 'tools', path.basename(__filename));
if (require.main !== module) module.exports = require(target);
else {
  const r = require('child_process').spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}
