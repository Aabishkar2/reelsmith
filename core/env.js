'use strict';
/**
 * core/env.js — find the external tools Reelsmith shells out to, without any
 * hard-coded machine path (docs/framework-spec.md §11).
 *
 *   resolve(cmd)          absolute path of an executable, or null. Looks on $PATH, then in
 *                         FALLBACK_DIRS (/opt/homebrew/bin, /usr/local/bin, ~/.local/bin), so a
 *                         non-interactive shell with a thin PATH still finds Homebrew/uv installs.
 *   ffmpeg() / ffprobe()  $FFMPEG_PATH / $FFPROBE_PATH (a path or a command name), else resolve().
 *                         null when missing.
 *   bin(name)             ffmpeg()/ffprobe()/resolve(name), falling back to the bare name, for
 *                         spawn calls that should fail with the tool's own "not found" error.
 *   node()                process.execPath (the node running us; never a bare `node`).
 *   python()              first python that actually runs, from $REELSMITH_PYTHON, python3.11,
 *                         python3.12, python3.13, python3. null when none runs.
 *   pythonWithWhisper({ strict })
 *                         first of the same candidates that has openai-whisper. The default probe
 *                         is importlib.util.find_spec('whisper') (fast, no torch import); strict
 *                         does a real `import whisper` (what `doctor` / stt check() use). Cached.
 *   paths()               { ffmpeg, ffprobe, python, pythonWhisper, node } as lazy getters
 *                         (the plugin ctx.paths of docs/framework-spec.md §5).
 *   ensureOnPath()        prepends the directories of the resolved ffmpeg/ffprobe to process.env.PATH
 *                         when they aren't on it, so modules that spawn a bare 'ffmpeg'
 *                         (pipeline/audio.js) work from a thin PATH too. Returns the added dirs.
 *   describe()            resolution report for doctor: { tool: { path, via, warning? } }.
 *   reset()               drop the caches (tests; after changing env vars).
 *
 * Probes use execFileSync captured at load time, so tests that stub
 * child_process.spawnSync (pipeline/test/attempts.test.js) don't see them.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')];
const PYTHON_CANDIDATES = ['python3.11', 'python3.12', 'python3.13', 'python3'];
const IS_WIN = process.platform === 'win32';

const cache = new Map();
const info = {};

function memo(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

function isExecutable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (!IS_WIN) fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (_) { return false; }
}

function searchDirs() {
  const dirs = [...String(process.env.PATH || '').split(path.delimiter).filter(Boolean), ...FALLBACK_DIRS];
  return [...new Set(dirs)];
}

/** Absolute path of `cmd` (a command name, or a path containing a separator), or null. */
function resolve(cmd) {
  if (!cmd || typeof cmd !== 'string') return null;
  if (cmd.includes('/') || (IS_WIN && cmd.includes('\\'))) {
    const abs = path.resolve(cmd);
    return isExecutable(abs) ? abs : null;
  }
  const exts = IS_WIN ? ['', ...String(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)] : [''];
  for (const dir of searchDirs()) {
    for (const ext of exts) {
      const f = path.join(dir, cmd + ext);
      if (isExecutable(f)) return f;
    }
  }
  return null;
}

function tool(name, envVar) {
  return memo(`tool:${name}`, () => {
    const override = String(process.env[envVar] || '').trim();
    if (override) {
      const p = resolve(override);
      if (p) { info[name] = { path: p, via: envVar }; return p; }
      info[name] = { path: null, via: envVar, warning: `${envVar}=${override} is not an executable; falling back to PATH` };
    }
    const p = resolve(name);
    const onPath = p && String(process.env.PATH || '').split(path.delimiter).includes(path.dirname(p));
    info[name] = { ...(info[name] || {}), path: p, via: p ? (onPath ? 'PATH' : 'fallback dir') : 'not found' };
    return p;
  });
}

const ffmpeg = () => tool('ffmpeg', 'FFMPEG_PATH');
const ffprobe = () => tool('ffprobe', 'FFPROBE_PATH');
const node = () => process.execPath;

function bin(name) {
  if (name === 'ffmpeg') return ffmpeg() || 'ffmpeg';
  if (name === 'ffprobe') return ffprobe() || 'ffprobe';
  return resolve(name) || name;
}

/** Run `py -c code`; true when it exits 0 within timeoutMs. */
function runs(py, code, timeoutMs) {
  try {
    execFileSync(py, ['-c', code], { stdio: 'ignore', timeout: timeoutMs, windowsHide: true });
    return true;
  } catch (_) { return false; }
}

/** Unique, existing python candidates in precedence order: [{ cmd, path }]. */
function pythonCandidates() {
  const out = [], seen = new Set();
  const explicit = String(process.env.REELSMITH_PYTHON || '').trim();
  for (const cmd of [...(explicit ? [explicit] : []), ...PYTHON_CANDIDATES]) {
    const p = resolve(cmd);
    if (!p) continue;
    let real = p;
    try { real = fs.realpathSync(p); } catch (_) { /* keep p */ }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push({ cmd, path: p });
  }
  return out;
}

/** First python candidate that starts (import sys). */
function python() {
  return memo('python', () => {
    for (const c of pythonCandidates()) {
      if (runs(c.path, 'import sys', 15000)) { info.python = { path: c.path, via: c.cmd }; return c.path; }
    }
    info.python = { path: null, via: 'not found', warning: `none of ${['$REELSMITH_PYTHON', ...PYTHON_CANDIDATES].join(', ')} runs` };
    return null;
  });
}

const FIND_WHISPER = "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('whisper') else 1)";

/** First python candidate that has openai-whisper (strict = real import). */
function pythonWithWhisper({ strict = false } = {}) {
  return memo(`whisper:${strict}`, () => {
    for (const c of pythonCandidates()) {
      if (runs(c.path, strict ? 'import whisper' : FIND_WHISPER, strict ? 120000 : 15000)) {
        info.whisper = { path: c.path, via: c.cmd };
        return c.path;
      }
    }
    info.whisper = { path: null, via: 'not found', warning: 'no python with openai-whisper (pip install openai-whisper)' };
    return null;
  });
}

function paths() {
  return {
    get ffmpeg() { return ffmpeg(); },
    get ffprobe() { return ffprobe(); },
    get python() { return python(); },
    get pythonWhisper() { return pythonWithWhisper(); },
    node: process.execPath,
  };
}

function ensureOnPath() {
  const cur = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const add = [];
  for (const p of [ffmpeg(), ffprobe()]) {
    if (!p) continue;
    const d = path.dirname(p);
    if (!cur.includes(d) && !add.includes(d)) add.push(d);
  }
  if (add.length) process.env.PATH = [...add, ...cur].join(path.delimiter);
  return add;
}

function describe() {
  ffmpeg(); ffprobe(); python(); pythonWithWhisper();
  return { node: { path: process.execPath, via: 'process.execPath' }, ...JSON.parse(JSON.stringify(info)) };
}

function reset() {
  cache.clear();
  for (const k of Object.keys(info)) delete info[k];
}

module.exports = {
  resolve, ffmpeg, ffprobe, bin, node, python, pythonWithWhisper, pythonCandidates, paths, ensureOnPath, describe, reset,
  FALLBACK_DIRS, PYTHON_CANDIDATES,
};
