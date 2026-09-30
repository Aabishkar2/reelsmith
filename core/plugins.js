'use strict';
/**
 * core/plugins.js — the plugin registry (docs/framework-spec.md §5).
 *
 * A plugin is a folder with plugin.js (CommonJS) exporting
 *   { name, kind: 'tts'|'stt'|'style'|'publish', version, description?, configSchema?, check?(ctx), … }
 * plus its kind's functions: tts → synthesize (synthesizePerformance, voices optional),
 * stt → transcribe, publish → publish, style → none.
 *
 * load(ctx) → registry. ctx = { root, config?, frameworkRoot?, log? } (config defaults to
 * core/config.load({ root })). Discovery order, later entries overriding the same `name`:
 *   1. built-ins        <framework>/plugins/<dir>/plugin.js
 *   2. built-in styles  <framework>/styles/<dir>/  (plugin.js, else synthesized from STYLE.md)
 *   3. project          <root>/plugins/<dir>/plugin.js, then <root>/styles/<dir>/  (skipped when
 *                       the project IS the framework checkout, i.e. clone mode; entries that are
 *                       symlinks back into the framework — the per-pack styles/<pack> links
 *                       `reelsmith init` makes in package mode — are the built-ins themselves and
 *                       are not listed twice)
 *   4. config.plugins[] entries: a path relative to the project root (a plugin dir, or a .js
 *                       file) or a module name resolved from the project (its plugin.js, else main)
 * A style folder without plugin.js becomes { name: frontmatter name || folder, kind: 'style',
 * version: frontmatter version || '1.0.0', description: frontmatter description || first heading,
 * dir, styleFile, kit?, reference? }.
 *
 * Nothing here throws on a broken plugin: a require() error or a validation failure lands in
 * registry.errors (and in list() with ok: false). A broken plugin still shadows an earlier one of
 * the same name (its name, or its folder/module name when it could not even load), so a failed
 * override is loud instead of silently falling back; asking for it via resolve() throws that error.
 *
 * registry:
 *   list(kind?)          every discovered entry, discovery order: { name, kind, version, description,
 *                        source, path, ok, error?, active, overriddenBy? }
 *   get(kind, name)      the active plugin object, or null. `name` may be the short provider id:
 *                        get('tts', 'openrouter') finds 'tts-openrouter' (also 'reelsmith-tts-<id>').
 *   info(kind, name)     the entry for that plugin (or null)
 *   resolve(kind, name)  like get() but throws a helpful error when it is missing or broken
 *   errors               [{ source, path, name?, error }]
 *   context(extra)       the ctx handed to check(): { root, config, env, log, paths, ...extra }
 *   checks(extra)        runs every active plugin's check(ctx) → [{ name, kind, ok, message }]
 *   shortName(plugin)    'tts-openrouter' → 'openrouter' (the provider id used in caches and meta)
 */
const fs = require('fs');
const path = require('path');
const project = require('./project');

const KINDS = ['tts', 'stt', 'style', 'publish'];
const REQUIRED_FNS = { tts: ['synthesize'], stt: ['transcribe'], publish: ['publish'], style: [] };
const OPTIONAL_FNS = ['check', 'synthesizePerformance', 'voices', 'available'];

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
const subdirs = dir => { try { return fs.readdirSync(dir).filter(d => !d.startsWith('.') && isDir(path.join(dir, d))).sort(); } catch (_) { return []; } };
const errMsg = e => String((e && e.message) || e).split('\n')[0];

/** null when `mod` is a valid plugin export, else the reason. */
function validate(mod) {
  if (!mod || typeof mod !== 'object' || Array.isArray(mod)) return 'plugin.js must export an object: module.exports = { name, kind, version, … }';
  if (typeof mod.name !== 'string' || !mod.name.trim() || /\s/.test(mod.name)) return '"name" must be a non-empty string without spaces';
  if (!KINDS.includes(mod.kind)) return `"kind" must be one of ${KINDS.join(', ')} (got ${JSON.stringify(mod.kind)})`;
  if (typeof mod.version !== 'string' || !mod.version.trim()) return '"version" must be a non-empty string, e.g. "1.0.0"';
  for (const fn of REQUIRED_FNS[mod.kind]) if (typeof mod[fn] !== 'function') return `a ${mod.kind} plugin must export ${fn}()`;
  for (const fn of OPTIONAL_FNS) if (mod[fn] !== undefined && typeof mod[fn] !== 'function') return `"${fn}" must be a function`;
  if (mod.configSchema !== undefined && (typeof mod.configSchema !== 'object' || mod.configSchema === null)) return '"configSchema" must be an object';
  return null;
}

function parseFrontmatter(text) {
  try { return require('../pipeline/script').parseFrontmatter(text); } catch (_) { return { meta: {}, body: text }; }
}

/** Synthesized style plugin for styles/<dir>/ (STYLE.md frontmatter), or null when there's no STYLE.md. */
function styleFromDir(dir) {
  const styleFile = path.join(dir, 'STYLE.md');
  if (!isFile(styleFile)) return null;
  const { meta, body } = parseFrontmatter(fs.readFileSync(styleFile, 'utf8'));
  const heading = (String(body).match(/^#\s+(.+?)\s*$/m) || [])[1];
  const kit = path.join(dir, 'kit.jsx'), reference = path.join(dir, 'reference');
  return {
    name: String(meta.name || path.basename(dir)), kind: 'style', version: String(meta.version || '1.0.0'),
    description: String(meta.description || heading || ''), dir, styleFile,
    ...(isFile(kit) ? { kit } : {}), ...(isDir(reference) ? { reference } : {}), synthesized: true,
  };
}

/** config.plugins entry → absolute file to require (throws with a readable reason). */
function resolveEntry(entry, root, frameworkRoot) {
  if (typeof entry !== 'string' || !entry.trim()) throw new Error(`plugins[] entries must be strings (got ${JSON.stringify(entry)})`);
  const looksLikePath = entry.startsWith('.') || path.isAbsolute(entry) || /[\\/]/.test(entry) && !entry.startsWith('@');
  if (looksLikePath) {
    const p = path.resolve(root, entry);
    if (isDir(p)) {
      if (isFile(path.join(p, 'plugin.js'))) return path.join(p, 'plugin.js');
      if (isFile(path.join(p, 'STYLE.md'))) return p;                 // a style pack folder
      return require.resolve(p);                                       // package.json main / index.js
    }
    if (isFile(p)) return p;
    throw new Error(`not found: ${p}`);
  }
  const paths = [root, frameworkRoot];
  try { return require.resolve(`${entry}/plugin.js`, { paths }); } catch (_) { /* fall through to main */ }
  return require.resolve(entry, { paths });
}

const realOr = p => { try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); } };
const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);

function discover({ root, frameworkRoot, config }) {
  const out = [];
  const fwReal = realOr(frameworkRoot);
  const scan = (base, source) => {
    const linked = dir => source !== 'builtin' && within(fwReal, realOr(dir));   // a link to a built-in
    for (const d of subdirs(path.join(base, 'plugins'))) {
      if (linked(path.join(base, 'plugins', d))) continue;
      const file = path.join(base, 'plugins', d, 'plugin.js');
      out.push(isFile(file) ? { source, file, hint: d } : { source, file, hint: d, error: 'no plugin.js in this folder' });
    }
    for (const d of subdirs(path.join(base, 'styles'))) {
      const dir = path.join(base, 'styles', d);
      if (linked(dir)) continue;
      if (isFile(path.join(dir, 'plugin.js'))) out.push({ source: `${source} style`, file: path.join(dir, 'plugin.js'), hint: d, styleDir: dir });
      else if (isFile(path.join(dir, 'STYLE.md'))) out.push({ source: `${source} style`, styleDir: dir, file: path.join(dir, 'STYLE.md'), hint: d });
      // a folder without STYLE.md (shared assets, work in progress) is not a style pack: skip it
    }
  };
  scan(frameworkRoot, 'builtin');
  if (realOr(root) !== fwReal) scan(root, 'project');
  for (const entry of config.plugins || []) {
    const hint = typeof entry === 'string' ? path.basename(entry).replace(/\.js$/, '') : String(entry);
    try {
      const file = resolveEntry(entry, root, frameworkRoot);
      if (isDir(file)) out.push({ source: 'config', styleDir: file, file: path.join(file, 'STYLE.md'), hint, entry });
      else out.push({ source: 'config', file, hint, entry });
    } catch (e) { out.push({ source: 'config', file: String(entry), hint, entry, error: errMsg(e) }); }
  }
  return out;
}

function shortName(plugin) {
  const n = String((plugin && plugin.name) || plugin || '');
  const k = plugin && plugin.kind;
  return k ? n.replace(new RegExp(`^(reelsmith-)?${k}-`), '') : n;
}

function load(ctx = {}) {
  const frameworkRoot = path.resolve(ctx.frameworkRoot || project.FRAMEWORK_ROOT);
  const root = path.resolve(ctx.root || project.root());
  const config = ctx.config || require('./config').load({ root, env: false }).config;
  const log = ctx.log || (() => {});

  const entries = [];
  const errors = [];
  const byName = new Map();                     // name → entry (last one wins, may be broken)

  const add = (entry) => {
    const prev = byName.get(entry.name);
    if (prev) { prev.active = false; prev.overriddenBy = entry.path; }
    entry.active = true;
    byName.set(entry.name, entry);
    entries.push(entry);
  };

  for (const c of discover({ root, frameworkRoot, config })) {
    const base = { source: c.source, path: c.file };
    if (c.error) {
      errors.push({ ...base, name: c.hint, error: c.error });
      add({ ...base, name: c.hint, kind: null, version: null, description: '', ok: false, error: c.error, plugin: null });
      continue;
    }
    let mod;
    try {
      if (c.styleDir && path.basename(c.file) === 'STYLE.md') mod = styleFromDir(c.styleDir);
      else {
        mod = require(c.file);
        if (c.styleDir && mod && typeof mod === 'object' && !mod.dir) mod = { ...mod, dir: c.styleDir, styleFile: path.join(c.styleDir, 'STYLE.md') };
      }
    } catch (e) {
      const error = `failed to load: ${errMsg(e)}`;
      errors.push({ ...base, name: c.hint, error });
      add({ ...base, name: c.hint, kind: null, version: null, description: '', ok: false, error, plugin: null });
      log(`plugin ${c.file}: ${error}`);
      continue;
    }
    const bad = validate(mod);
    const name = mod && typeof mod.name === 'string' && mod.name.trim() ? mod.name : c.hint;
    if (bad) {
      errors.push({ ...base, name, error: bad });
      add({ ...base, name, kind: KINDS.includes(mod && mod.kind) ? mod.kind : null, version: (mod && mod.version) || null,
        description: (mod && mod.description) || '', ok: false, error: bad, plugin: null });
      log(`plugin ${c.file}: ${bad}`);
      continue;
    }
    add({ ...base, name, kind: mod.kind, version: mod.version, description: mod.description || '', ok: true, plugin: mod });
  }

  const candidates = (kind, name) => [name, `${kind}-${name}`, `reelsmith-${kind}-${name}`, `reelsmith-${name}`];
  const find = (kind, name) => {
    for (const n of candidates(kind, String(name))) {
      const e = byName.get(n);
      if (e && (e.kind === kind || (!e.ok && e.kind === null))) return e;
    }
    return null;
  };

  const registry = {
    root, frameworkRoot, config, errors,
    list(kind) {
      return entries.filter(e => !kind || e.kind === kind).map(({ plugin, ...e }) => ({ ...e }));
    },
    get(kind, name) {
      const e = find(kind, name);
      return e && e.ok ? e.plugin : null;
    },
    info(kind, name) {
      const e = find(kind, name);
      if (!e) return null;
      const { plugin, ...rest } = e;
      return { ...rest };
    },
    resolve(kind, name) {
      const e = find(kind, name);
      if (e && e.ok) return e.plugin;
      if (e) throw new Error(`${kind} provider "${name}" (${e.path}) is broken: ${e.error}`);
      const have = entries.filter(x => x.ok && x.active && x.kind === kind).map(x => shortName(x.plugin));
      throw new Error(`no ${kind} provider "${name}" — loaded: ${have.join(', ') || 'none'}` +
        (errors.length ? `; plugin errors: ${errors.map(x => `${x.name}: ${x.error}`).join('; ')}` : '') +
        `. Add it under plugins/ or list it in reelsmith.config.json "plugins".`);
    },
    context(extra = {}) {
      const env = require('./env');
      return { root, config, env: process.env, log: ctx.log || ((...a) => console.error(...a)), paths: env.paths(), ...extra };
    },
    async checks(extra = {}) {
      const c = registry.context(extra);
      const out = [];
      for (const e of entries.filter(x => x.active)) {
        if (!e.ok) { out.push({ name: e.name, kind: e.kind, ok: false, message: e.error }); continue; }
        if (typeof e.plugin.check !== 'function') { out.push({ name: e.name, kind: e.kind, ok: true, message: 'no check()' }); continue; }
        try {
          const r = (await e.plugin.check(c)) || {};
          out.push({ name: e.name, kind: e.kind, ok: Boolean(r.ok), message: String(r.message || ''), ...(r.optional ? { optional: true } : {}) });
        } catch (err) { out.push({ name: e.name, kind: e.kind, ok: false, message: `check() threw: ${errMsg(err)}` }); }
      }
      return out;
    },
    shortName,
  };
  return registry;
}

module.exports = { load, validate, shortName, styleFromDir, KINDS };
