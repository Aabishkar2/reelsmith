'use strict';
/**
 * core/config.js — project config: built-in DEFAULTS ← <root>/reelsmith.config.json, plus
 * <root>/.env (docs/framework-spec.md §4). config/tts.json is retired: its defaults live here.
 *
 *   load({ root, start, file, env = true }) → { root, file, exists, config }
 *       root   project root (default: core/project.root(start || cwd))
 *       file   config path (default <root>/reelsmith.config.json; missing → defaults only;
 *              invalid JSON → throws with the file name)
 *       env    also load <root>/.env (dotenv, never overrides variables already set)
 *   loadEnv(root)      the .env part alone, once per file per process
 *   merge(base, over)  deep merge: plain objects merge, arrays and scalars (and null) replace
 *   pick(...values)    first value that is set (undefined, null, '', a bare `--flag` → unset);
 *                      how every per-setting precedence chain is written:
 *                      flag > script.md frontmatter > per-video meta > env > config file > DEFAULTS
 */
const fs = require('fs');
const path = require('path');
const project = require('./project');

const deepFreeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };

const DEFAULTS = deepFreeze({
  version: 1,
  videosDir: 'videos',
  style: 'reflective',
  plugins: [],
  tts: {
    provider: 'openrouter',
    model: 'google/gemini-3.8-flash-tts',
    voice: null,               // deliberately no default: the creator names one per video
    speed: 1.15,               // ffmpeg atempo, pitch kept (creator's pick, 2026-09-29)
    mode: 'sentence',          // 'sentence' (pipeline/tts.js) | 'performance' (pipeline/performance.js)
    // sentence mode
    sentenceGapSec: 0.35,      // silence between sentences, before the speed factor
    sceneTailSec: 0.6,         // silence after each scene, before the speed factor
    responseFormat: 'mp3',     // what sentence mode asks the provider for
    trimDb: -50,               // head/tail silence trim threshold per clip
    timings: 'auto',           // 'auto' | 'whisper' | 'estimate'
    // performance mode
    performance: {
      directionFile: 'config/voice/performance.md',   // PERFORMANCE block source (frontmatter tts_performance: overrides)
      minMatched: 0.8,         // fail when fewer script sentences are found in the transcript
      respell: true,           // subtitle words use the script's spelling where whisper misspelled a matched word
    },
  },
  stt: { provider: 'whisper', model: 'turbo' },
  music: { dir: 'music', underDb: 6, voiceLufs: -16 },
  publish: { targets: {} },
  render: { fps: 30, width: 720, height: 1280 },
  app: { port: 4310 },
});

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  if (over === undefined) return clone(base);
  if (!isPlain(base) || !isPlain(over)) return clone(over);
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? merge(out[k], v) : clone(v);
  return out;
}

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}

const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== true && String(v).trim() !== '');

const envLoaded = new Set();
function loadEnv(root = project.root()) {
  const file = path.join(path.resolve(root), '.env');
  if (envLoaded.has(file)) return;
  envLoaded.add(file);
  // The framework's own .env goes through pipeline/config.loadEnv so both loaders share one
  // "already loaded" flag (a second load would re-set variables a test deliberately deleted).
  if (path.dirname(file) === project.FRAMEWORK_ROOT) { require('../pipeline/config').loadEnv(); return; }
  if (!fs.existsSync(file)) return;
  try { require('dotenv').config({ path: file, quiet: true }); return; } catch (_) { /* dotenv missing: parse below */ }
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function readConfigFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error(`${file}: invalid JSON (${e.message})`); }
  if (!isPlain(json)) throw new Error(`${file}: must be a JSON object`);
  return json;
}

function load({ root, start, file, env = true } = {}) {
  const r = path.resolve(root || project.root(start || process.cwd()));
  const f = file ? path.resolve(r, file) : path.join(r, project.CONFIG_FILE);
  if (env) loadEnv(r);
  const user = readConfigFile(f);
  const config = merge(DEFAULTS, user || {});
  if (!Array.isArray(config.plugins)) throw new Error(`${f}: "plugins" must be an array of paths or module names`);
  return { root: r, file: f, exists: user !== null, config };
}

module.exports = { DEFAULTS, load, loadEnv, merge, pick, readConfigFile };
