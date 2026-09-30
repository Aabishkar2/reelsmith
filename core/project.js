'use strict';
/**
 * core/project.js — where the project is (docs/framework-spec.md §2, §11).
 *
 *   FRAMEWORK_ROOT         the reelsmith checkout / node_modules/reelsmith this file lives in.
 *   findRoot(start)        nearest directory at or above `start` holding reelsmith.config.json,
 *                          or a package.json named "reelsmith"; null when there is none.
 *   root(start = cwd)      findRoot(start) || FRAMEWORK_ROOT. In clone mode both are the repo.
 *   rootFor(videoDir)      root(videoDir): the project a video belongs to.
 *   resolveVideo(arg, { root, cwd, videosDir })
 *                          `videos/<name>`, `<name>` or an absolute path → absolute video dir
 *                          (tried against cwd, the project root and <root>/<videosDir>).
 *   real(p)                fs.realpathSync(p), or path.resolve(p) when it does not exist.
 *   isFramework(dir)       dir is the framework checkout itself (compared by real path).
 *   mode(start = cwd)      'clone'   the nearest project root is the framework checkout
 *                          'package' a project of its own (reelsmith.config.json), framework elsewhere
 *                                    (node_modules/reelsmith)
 *                          'none'    no project at or above start (root() falls back to the framework)
 */
const fs = require('fs');
const path = require('path');

const FRAMEWORK_ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = 'reelsmith.config.json';

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } }

function isProjectRoot(dir) {
  if (fs.existsSync(path.join(dir, CONFIG_FILE))) return true;
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'reelsmith'; } catch (_) { return false; }
}

function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  if (!isDir(dir)) dir = path.dirname(dir);
  for (;;) {
    if (isProjectRoot(dir)) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const root = (start = process.cwd()) => findRoot(start) || FRAMEWORK_ROOT;
const rootFor = videoDir => root(videoDir);

const real = p => { try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); } };
const isFramework = dir => real(dir) === real(FRAMEWORK_ROOT);

function mode(start = process.cwd()) {
  const found = findRoot(start);
  if (!found) return 'none';
  return isFramework(found) ? 'clone' : 'package';
}

function resolveVideo(arg, { root: r, cwd = process.cwd(), videosDir = 'videos' } = {}) {
  if (!arg || typeof arg !== 'string') throw new Error('missing video (videos/<name>, <name> or a path)');
  const base = r || root(cwd);
  const tries = path.isAbsolute(arg) ? [arg] : [path.resolve(cwd, arg), path.join(base, arg), path.join(base, videosDir, arg)];
  for (const c of tries) if (isDir(c)) return path.resolve(c);
  throw new Error(`video dir not found: ${arg} (tried ${tries.join(', ')})`);
}

module.exports = { FRAMEWORK_ROOT, CONFIG_FILE, findRoot, root, rootFor, resolveVideo, isProjectRoot, real, isFramework, mode };
