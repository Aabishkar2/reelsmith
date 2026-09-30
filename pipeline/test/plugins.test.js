'use strict';
/**
 * pipeline/test/plugins.test.js — core/plugins.js (discovery order, overrides, broken plugins,
 * kind validation, style packs), core/env.js, core/config.js, core/project.js and the built-in
 * tts-openrouter / stt-whisper plugins (stubbed fetch, no network, no whisper run).
 *   node pipeline/test/plugins.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const plugins = require('../../core/plugins');
const config = require('../../core/config');
const project = require('../../core/project');
const env = require('../../core/env');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.stack || e.message).split('\n').slice(0, 5).join('\n    ')}`); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-plugins-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
const ttsPlugin = (name, version, extra = '') => `module.exports = { name: '${name}', kind: 'tts', version: '${version}', description: '${name} ${version}',
  async synthesize() { return { audio: Buffer.from('x'), format: 'mp3' }; }${extra} };\n`;

// framework-like root: built-ins + styles
const FW = path.join(TMP, 'fw');
write(path.join(FW, 'plugins', 'tts-alpha', 'plugin.js'), ttsPlugin('tts-alpha', '1.0.0'));
write(path.join(FW, 'plugins', 'stt-beta', 'plugin.js'), `module.exports = { name: 'stt-beta', kind: 'stt', version: '1.0.0', async transcribe() { return []; },
  async check() { return { ok: true, message: 'beta ok' }; } };\n`);
write(path.join(FW, 'plugins', 'broken-syntax', 'plugin.js'), 'module.exports = { name: ;\n');
write(path.join(FW, 'plugins', 'throws', 'plugin.js'), "throw new Error('boom at require time');\n");
write(path.join(FW, 'plugins', 'bad-kind', 'plugin.js'), "module.exports = { name: 'bad-kind', kind: 'video', version: '1.0.0' };\n");
write(path.join(FW, 'plugins', 'no-version', 'plugin.js'), "module.exports = { name: 'no-version', kind: 'style' };\n");
write(path.join(FW, 'plugins', 'tts-nofn', 'plugin.js'), "module.exports = { name: 'tts-nofn', kind: 'tts', version: '1.0.0' };\n");
write(path.join(FW, 'plugins', 'check-throws', 'plugin.js'), `module.exports = { name: 'check-throws', kind: 'publish', version: '0.1.0',
  async publish() { return { ok: true }; }, async check() { throw new Error('no creds'); } };\n`);
fs.mkdirSync(path.join(FW, 'plugins', 'empty-dir'), { recursive: true });
write(path.join(FW, 'styles', 'neon', 'STYLE.md'), '---\nname: neon-glow\ndescription: bright neon look\n---\n\n# Neon\n');
write(path.join(FW, 'styles', 'neon', 'kit.jsx'), '// kit\n');
write(path.join(FW, 'styles', 'plain', 'STYLE.md'), '# Plain and simple\n\nNo frontmatter here.\n');
fs.mkdirSync(path.join(FW, 'styles', 'shared'), { recursive: true });           // not a style pack
write(path.join(FW, 'styles', 'design.md'), '# shared base rules\n');              // a file, not a pack
write(path.join(FW, 'styles', 'coded', 'plugin.js'), "module.exports = { name: 'coded', kind: 'style', version: '2.0.0', description: 'has plugin.js' };\n");
write(path.join(FW, 'styles', 'coded', 'STYLE.md'), '# Coded\n');

// project root: overrides + config entries
const PROJ = path.join(TMP, 'proj');
write(path.join(PROJ, 'plugins', 'tts-alpha', 'plugin.js'), ttsPlugin('tts-alpha', '2.0.0'));
write(path.join(PROJ, 'extra', 'alpha3', 'plugin.js'), ttsPlugin('tts-alpha', '3.0.0'));
write(path.join(PROJ, 'extra', 'single-file.js'), ttsPlugin('tts-gamma', '1.0.0'));
write(path.join(PROJ, 'node_modules', 'reelsmith-tts-fake', 'package.json'), JSON.stringify({ name: 'reelsmith-tts-fake', main: 'index.js' }));
write(path.join(PROJ, 'node_modules', 'reelsmith-tts-fake', 'plugin.js'), ttsPlugin('reelsmith-tts-fake', '0.9.0'));
write(path.join(PROJ, 'node_modules', 'reelsmith-tts-fake', 'index.js'), "throw new Error('main must not be used when plugin.js exists');\n");
write(path.join(PROJ, 'styles', 'plain', 'STYLE.md'), '---\ndescription: project override of plain\n---\n');
const CONFIG = { plugins: ['./extra/alpha3', './extra/single-file.js', 'reelsmith-tts-fake', './does-not-exist', 'no-such-module-xyz'] };

(async () => {
  console.log('core/plugins.js');
  let reg;
  await test('load() never throws on broken plugins; errors are recorded', async () => {
    reg = plugins.load({ root: PROJ, frameworkRoot: FW, config: CONFIG });
    const err = n => reg.errors.find(e => e.name === n);
    assert.ok(/failed to load/.test(err('broken-syntax').error), JSON.stringify(reg.errors));
    assert.ok(/boom at require time/.test(err('throws').error));
    assert.ok(/"kind" must be one of tts, stt, style, publish/.test(err('bad-kind').error));
    assert.ok(/"version"/.test(err('no-version').error));
    assert.ok(/must export synthesize\(\)/.test(err('tts-nofn').error));
    assert.ok(/no plugin\.js/.test(err('empty-dir').error));
    assert.ok(/not found/.test(err('does-not-exist').error));
    assert.ok(err('no-such-module-xyz'), 'unresolvable module recorded');
  });

  await test('discovery order: built-ins → project → config.plugins; later overrides the same name', async () => {
    const alphas = reg.list('tts').filter(e => e.name === 'tts-alpha');
    assert.deepStrictEqual(alphas.map(e => [e.version, e.source, e.active]), [['1.0.0', 'builtin', false], ['2.0.0', 'project', false], ['3.0.0', 'config', true]]);
    assert.strictEqual(alphas[0].overriddenBy, alphas[1].path);
    const order = reg.list().map(e => e.source);
    const firstIdx = s => order.indexOf(s), lastIdx = s => order.lastIndexOf(s);
    assert.ok(lastIdx('builtin') < firstIdx('project') && lastIdx('project style') < firstIdx('config'), order.join(','));
    assert.strictEqual(reg.get('tts', 'alpha').version, '3.0.0');
    assert.strictEqual(reg.get('tts', 'tts-alpha').version, '3.0.0', 'full name works too');
    assert.strictEqual(reg.get('tts', 'gamma').version, '1.0.0', 'a single .js file entry');
    assert.strictEqual(reg.get('tts', 'fake').version, '0.9.0', 'module name → its plugin.js, found from the project');
    assert.strictEqual(reg.get('stt', 'beta').name, 'stt-beta');
    assert.strictEqual(reg.get('stt', 'alpha'), null, 'kind must match');
  });

  await test('resolve(): helpful errors for missing and broken providers', async () => {
    assert.throws(() => reg.resolve('tts', 'nope'), e => /no tts provider "nope"/.test(e.message) && /alpha/.test(e.message) && /reelsmith\.config\.json/.test(e.message));
    assert.throws(() => reg.resolve('tts', 'nofn'), e => /is broken/.test(e.message) && /synthesize/.test(e.message));
    assert.strictEqual(reg.resolve('tts', 'alpha').version, '3.0.0');
  });

  await test('a broken override shadows the working plugin of the same name (loud, not a silent fallback)', async () => {
    const proj2 = path.join(TMP, 'proj2');
    write(path.join(proj2, 'plugins', 'stt-beta', 'plugin.js'), "throw new Error('half-written override');\n");
    const r = plugins.load({ root: proj2, frameworkRoot: FW, config: { plugins: [] } });
    assert.strictEqual(r.get('stt', 'beta'), null);
    assert.throws(() => r.resolve('stt', 'beta'), /half-written override/);
    assert.strictEqual(r.list().find(e => e.name === 'stt-beta' && e.source === 'builtin').active, false);
  });

  await test('style packs: synthesized from STYLE.md frontmatter (or folder + heading), plugin.js wins, non-packs skipped', async () => {
    const neon = reg.get('style', 'neon-glow');
    assert.ok(neon && neon.synthesized);
    assert.strictEqual(neon.description, 'bright neon look');
    assert.strictEqual(neon.dir, path.join(FW, 'styles', 'neon'));
    assert.strictEqual(neon.kit, path.join(FW, 'styles', 'neon', 'kit.jsx'));
    assert.strictEqual(reg.get('style', 'plain').description, 'project override of plain', 'project style overrides the built-in one');
    assert.strictEqual(reg.list('style').find(e => e.name === 'plain' && e.source === 'builtin style').description, 'Plain and simple');
    const coded = reg.get('style', 'coded');
    assert.strictEqual(coded.version, '2.0.0');
    assert.strictEqual(coded.dir, path.join(FW, 'styles', 'coded'));
    assert.ok(!reg.list().some(e => e.name === 'shared' || e.name === 'design'), 'folders without STYLE.md and files are not packs');
  });

  await test('clone mode (project root = framework root) does not load everything twice; missing styles/ is fine', async () => {
    const fw2 = path.join(TMP, 'fw2');
    write(path.join(fw2, 'plugins', 'tts-alpha', 'plugin.js'), ttsPlugin('tts-alpha', '1.0.0'));
    const r = plugins.load({ root: fw2, frameworkRoot: fw2, config: { plugins: [] } });
    assert.strictEqual(r.list().length, 1);
    assert.deepStrictEqual(r.errors, []);
  });

  await test('checks(): runs every active plugin check, a throwing check is reported not thrown', async () => {
    const res = await reg.checks();
    assert.deepStrictEqual(res.find(c => c.name === 'stt-beta'), { name: 'stt-beta', kind: 'stt', ok: true, message: 'beta ok' });
    const ct = res.find(c => c.name === 'check-throws');
    assert.ok(!ct.ok && /no creds/.test(ct.message));
    assert.ok(res.find(c => c.name === 'bad-kind' && !c.ok));
  });

  await test('validate(): shape rules', async () => {
    assert.ok(/export an object/.test(plugins.validate(null)));
    assert.ok(/export an object/.test(plugins.validate([])));
    assert.ok(/"name"/.test(plugins.validate({ name: 'has space', kind: 'tts', version: '1' })));
    assert.ok(/"check" must be a function/.test(plugins.validate({ name: 's', kind: 'style', version: '1', check: 'yes' })));
    assert.strictEqual(plugins.validate({ name: 's', kind: 'style', version: '1' }), null);
    assert.strictEqual(plugins.shortName({ name: 'tts-openrouter', kind: 'tts' }), 'openrouter');
    assert.strictEqual(plugins.shortName({ name: 'reelsmith-stt-deepgram', kind: 'stt' }), 'deepgram');
  });

  await test('the real framework: built-in tts-openrouter + stt-whisper load cleanly', async () => {
    const r = plugins.load({ root: project.FRAMEWORK_ROOT });
    const or = r.get('tts', 'openrouter'), wh = r.get('stt', 'whisper');
    assert.ok(or && typeof or.synthesize === 'function' && typeof or.synthesizePerformance === 'function');
    assert.ok(wh && typeof wh.transcribe === 'function');
    assert.ok(!r.errors.some(e => ['tts-openrouter', 'stt-whisper'].includes(e.name)), JSON.stringify(r.errors));
    for (const k of ['OPENROUTER_API_KEY', 'TTS_MODEL', 'TTS_VOICE', 'TTS_SPEED']) assert.ok(or.configSchema[k] && or.configSchema[k].env === k, k);
    assert.ok(or.voices().some(v => v.name === 'Leda'));
  });

  console.log('\nplugins/tts-openrouter (stubbed fetch)');
  const or = require('../../plugins/tts-openrouter/plugin');
  const stub = (responses) => {
    const f = async (url, init) => {
      f.calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
      const r = responses[Math.min(f.calls.length - 1, responses.length - 1)];
      return new Response(r.body !== undefined ? r.body : Buffer.alloc(4800), { status: r.status || 200, headers: { 'content-type': r.type !== undefined ? r.type : 'audio/pcm' } });
    };
    f.calls = [];
    return f;
  };

  await test('synthesizePerformance: one request, exactly { model, voice, input, response_format: "pcm" } → 24 kHz PCM', async () => {
    const f = stub([{ type: 'audio/L16;codec=pcm;rate=24000' }]);
    const r = await or.synthesizePerformance({ prompt: '# T\n\nTRANSCRIPT\nhi\n', voice: 'Leda', model: 'm', key: 'k', fetch: f });
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(f.calls[0].url, 'https://openrouter.ai/api/v1/audio/speech');
    assert.deepStrictEqual(f.calls[0].body, { model: 'm', voice: 'Leda', input: '# T\n\nTRANSCRIPT\nhi\n', response_format: 'pcm' });
    assert.strictEqual(f.calls[0].auth, 'Bearer k');
    assert.deepStrictEqual([r.format, r.sampleRate, r.audio.length], ['pcm', 24000, 4800]);
    const r2 = await or.synthesizePerformance({ prompt: 'p', voice: 'v', model: 'm', key: 'k', fetch: stub([{ type: 'application/octet-stream' }]) });
    assert.deepStrictEqual([r2.format, r2.sampleRate], ['pcm', 24000], 'unknown content type → the requested pcm');
  });

  await test('synthesize: format from content type or bytes; uses the global fetch when none is passed', async () => {
    const orig = globalThis.fetch;
    const f = stub([{ type: 'audio/mpeg', body: Buffer.from('ID3xxxx') }]);
    globalThis.fetch = f;
    try {
      const r = await or.synthesize({ text: 'Hello.', voice: 'Kore', model: 'm', key: 'k' });
      assert.strictEqual(f.calls.length, 1);
      assert.deepStrictEqual(f.calls[0].body, { model: 'm', voice: 'Kore', input: 'Hello.', response_format: 'mp3' });
      assert.strictEqual(r.format, 'mp3');
    } finally { globalThis.fetch = orig; }
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]);
    assert.strictEqual((await or.synthesize({ text: 'x', voice: 'v', model: 'm', key: 'k', fetch: stub([{ type: '', body: wav }]) })).format, 'wav');
  });

  await test('429/5xx retried twice, 401/403 fail at once with the .env hint, JSON body is an error, missing key is an error', async () => {
    const f = stub([{ status: 429, type: 'application/json', body: '{}' }, { status: 503, type: 'text/plain', body: 'x' }, {}]);
    await or.synthesizePerformance({ prompt: 'p', voice: 'v', model: 'm', key: 'k', fetch: f, retryDelayMs: 1 });
    assert.strictEqual(f.calls.length, 3);
    const g = stub([{ status: 500, type: 'text/plain', body: 'down' }]);
    await assert.rejects(or.synthesize({ text: 'x', voice: 'v', model: 'm', key: 'k', fetch: g, retryDelayMs: 1 }), /TTS HTTP 500/);
    assert.strictEqual(g.calls.length, 3);
    const h = stub([{ status: 403, type: 'application/json', body: '{"error":"no"}' }]);
    await assert.rejects(or.synthesizePerformance({ prompt: 'p', voice: 'v', model: 'm', key: 'k', fetch: h }), /OPENROUTER_API_KEY rejected \(HTTP 403\) — put a working key in \.env/);
    assert.strictEqual(h.calls.length, 1);
    await assert.rejects(or.synthesize({ text: 'x', voice: 'v', model: 'm', key: 'k', fetch: stub([{ type: 'application/json', body: '{"a":1}' }]) }), /not audio/);
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try { await assert.rejects(or.synthesize({ text: 'x', voice: 'v', model: 'm', fetch: stub([{}]) }), /OPENROUTER_API_KEY is not set/); }
    finally { if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved; }
  });

  await test('check(): key presence only, never the network', async () => {
    const orig = globalThis.fetch;
    let called = 0;
    globalThis.fetch = async () => { called++; throw new Error('no network in check'); };
    try {
      assert.strictEqual((await or.check({ env: {} })).ok, false);
      const ok = await or.check({ env: { OPENROUTER_API_KEY: 'x' } });
      assert.ok(ok.ok && /set/.test(ok.message));
      assert.strictEqual(called, 0);
    } finally { globalThis.fetch = orig; }
  });

  console.log('\nplugins/stt-whisper');
  await test('transcribe() wraps pipeline/whisper.js: a valid cache is returned without running python', async () => {
    const wh = require('../../plugins/stt-whisper/plugin');
    const dir = path.join(TMP, 'wh');
    const wav = write(path.join(dir, 'performance.wav'), 'x');
    const later = new Date(Date.now() + 5000);
    write(path.join(dir, 'performance.json'), JSON.stringify([{ word: 'hello', start: 0.1, end: 0.4, probability: 0.9 }]));
    write(path.join(dir, 'performance.whisper.json'), JSON.stringify({ mode: 'whole', model: 'turbo', prompt: null }));
    fs.utimesSync(path.join(dir, 'performance.json'), later, later);
    const words = await wh.transcribe({ wavPath: wav, mode: 'whole', prompt: '', model: 'turbo', quiet: true });
    assert.deepStrictEqual(words, [{ word: 'hello', start: 0.1, end: 0.4, conf: 0.9 }]);
    assert.ok(wh.available() === null || typeof wh.available() === 'string');
    await assert.rejects(wh.transcribe({}), /wavPath/);
  });

  console.log('\ncore/env.js');
  const saveEnv = { ...process.env };
  const restore = () => { for (const k of Object.keys(process.env)) if (!(k in saveEnv)) delete process.env[k]; Object.assign(process.env, saveEnv); env.reset(); };
  const fakeBin = (name, code = 0) => { const f = write(path.join(TMP, 'bin', name), `#!/bin/sh\nexit ${code}\n`); fs.chmodSync(f, 0o755); return f; };

  await test('FFMPEG_PATH override, fallback to PATH lookup when it is wrong, ensureOnPath() for a thin PATH', async () => {
    try {
      const fake = fakeBin('ffmpeg');
      process.env.FFMPEG_PATH = fake;
      env.reset();
      assert.strictEqual(env.ffmpeg(), fake);
      assert.strictEqual(env.describe().ffmpeg.via, 'FFMPEG_PATH');
      process.env.PATH = '/usr/bin:/bin';
      assert.deepStrictEqual(env.ensureOnPath().includes(path.dirname(fake)), true);
      assert.ok(process.env.PATH.split(':').includes(path.dirname(fake)));
      process.env.FFMPEG_PATH = path.join(TMP, 'nope', 'ffmpeg');
      env.reset();
      const found = env.ffmpeg();
      assert.ok(found === null || path.isAbsolute(found));
      assert.ok(/not an executable/.test(env.describe().ffmpeg.warning));
    } finally { restore(); }
    assert.strictEqual(env.resolve('definitely-not-a-command-xyz'), null);
    assert.strictEqual(env.node(), process.execPath);
    assert.strictEqual(env.bin('definitely-not-a-command-xyz'), 'definitely-not-a-command-xyz');
  });

  await test('python(): REELSMITH_PYTHON first, a python that does not start is skipped; results are cached', async () => {
    try {
      const good = fakeBin('mypython', 0);
      process.env.REELSMITH_PYTHON = good;
      env.reset();
      assert.strictEqual(env.python(), good);
      assert.strictEqual(env.pythonWithWhisper(), good, 'fake exits 0 for the find_spec probe too');
      fs.chmodSync(good, 0o644);                                   // cached: no re-probe until reset()
      assert.strictEqual(env.python(), good);
      process.env.REELSMITH_PYTHON = fakeBin('badpython', 1);
      env.reset();
      assert.notStrictEqual(env.python(), process.env.REELSMITH_PYTHON);
      assert.ok(env.pythonCandidates()[0].path === process.env.REELSMITH_PYTHON);
    } finally { restore(); }
    const p = env.paths();
    assert.strictEqual(p.node, process.execPath);
    assert.ok(Object.getOwnPropertyDescriptor(p, 'python').get, 'lazy getter');
  });

  console.log('\ncore/config.js + core/project.js');
  await test('defaults ← reelsmith.config.json (deep merge, arrays replace); invalid JSON names the file', async () => {
    const root = path.join(TMP, 'cfg');
    write(path.join(root, 'reelsmith.config.json'), JSON.stringify({ plugins: ['./x'], tts: { speed: 1.3, performance: { minMatched: 0.9 } } }));
    const { config: c, exists, file } = config.load({ root, env: false });
    assert.ok(exists && file === path.join(root, 'reelsmith.config.json'));
    assert.strictEqual(c.tts.speed, 1.3);
    assert.strictEqual(c.tts.model, 'google/gemini-3.8-flash-tts');
    assert.strictEqual(c.tts.performance.minMatched, 0.9);
    assert.strictEqual(c.tts.performance.respell, true);
    assert.deepStrictEqual(c.plugins, ['./x']);
    assert.strictEqual(c.tts.voice, null, 'no default voice');
    assert.strictEqual(config.DEFAULTS.tts.speed, 1.15, 'DEFAULTS untouched');
    assert.ok(Object.isFrozen(config.DEFAULTS.tts));
    const none = config.load({ root: path.join(TMP, 'empty'), env: false });
    assert.ok(!none.exists && none.config.tts.mode === 'sentence');
    write(path.join(TMP, 'bad', 'reelsmith.config.json'), '{ nope');
    assert.throws(() => config.load({ root: path.join(TMP, 'bad'), env: false }), e => e.message.includes(path.join(TMP, 'bad', 'reelsmith.config.json')) && /invalid JSON/.test(e.message));
    assert.strictEqual(config.pick(undefined, null, '', true, 0, 'x'), 0);
    assert.strictEqual(config.pick(undefined, ' ', 'v'), 'v');
  });

  await test('.env of a project root loads without overriding variables already set', async () => {
    const root = path.join(TMP, 'envproj');
    write(path.join(root, '.env'), 'RS_TEST_A=from-file\nRS_TEST_B="quoted"\n');
    process.env.RS_TEST_A = 'already';
    try {
      config.loadEnv(root);
      assert.strictEqual(process.env.RS_TEST_A, 'already');
      assert.strictEqual(process.env.RS_TEST_B, 'quoted');
    } finally { delete process.env.RS_TEST_A; delete process.env.RS_TEST_B; }
  });

  await test('project root discovery walks up from a video dir; resolveVideo accepts name, videos/name, absolute', async () => {
    const root = path.join(TMP, 'cfg');
    const vid = path.join(root, 'videos', 'demo');
    fs.mkdirSync(vid, { recursive: true });
    assert.strictEqual(project.findRoot(vid), root);
    assert.strictEqual(project.rootFor(vid), root);
    assert.strictEqual(project.findRoot(path.join(TMP, 'empty-nowhere')), null);
    assert.strictEqual(project.root(os.tmpdir()), project.findRoot(os.tmpdir()) || project.FRAMEWORK_ROOT);
    assert.strictEqual(project.resolveVideo('demo', { root, cwd: TMP }), vid);
    assert.strictEqual(project.resolveVideo('videos/demo', { root, cwd: TMP }), vid);
    assert.strictEqual(project.resolveVideo(vid, { root, cwd: TMP }), vid);
    assert.throws(() => project.resolveVideo('ghost', { root, cwd: TMP }), /video dir not found: ghost/);
  });

  console.log('\npipeline/tts.js sentence mode through the plugin seam');
  await test('provider joins the cache key; meta.json records provider + mode; stt comes from the stt plugin', async () => {
    env.ensureOnPath();
    const audio = require('../audio'), tts = require('../tts'), crypto = require('crypto');
    const sha = x => crypto.createHash('sha1').update(x).digest('hex').slice(0, 16);
    const clip = path.join(TMP, 'clip.wav');
    audio.ffmpeg(['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.8:sample_rate=24000', '-ac', '1', '-c:a', 'pcm_s16le', clip]);
    const root = path.join(TMP, 'sproj');
    write(path.join(root, 'reelsmith.config.json'), JSON.stringify({ version: 1 }));
    const md = '---\ntitle: t\n---\n\n## Script\n\n### Scene 1\nOne line here.\nAnother line.\n';
    const vid = path.join(root, 'videos', 'a');
    write(path.join(vid, 'script.md'), md);
    const calls = [];
    const stubP = { name: 'tts-stub', kind: 'tts', version: '1', async synthesize(a) { calls.push(a); return { audio: fs.readFileSync(clip), format: 'wav' }; } };
    const heard = [];
    const sttP = { name: 'stt-stub', kind: 'stt', version: '1', async transcribe(a) { heard.push(a); return [{ word: 'One', start: 0.05, end: 0.3 }]; } };
    const r = await tts.synthesize(vid, { voice: 'V', speed: 1, timings: 'whisper', quiet: true, ttsProvider: stubP, sttProvider: sttP });
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(Object.keys(calls[0]).filter(k => calls[0][k] !== undefined).sort(), ['format', 'model', 'text', 'voice']);
    const model = 'google/gemini-3.8-flash-tts';
    assert.ok(fs.existsSync(path.join(vid, 'voiceover', 'tts', `${sha(`stub|${model}|V|One line here.`)}.wav`)));
    assert.strictEqual(r.timings, 'whisper');
    assert.strictEqual(heard[0].mode, 'whole');
    const m = JSON.parse(fs.readFileSync(path.join(vid, 'voiceover', 'tts', 'meta.json'), 'utf8'));
    assert.deepStrictEqual([m.provider, m.mode, m.voice], ['stub', 'sentence', 'V']);
    // a clip cached before the provider was in the key is adopted for openrouter, not re-bought
    const vid2 = path.join(root, 'videos', 'b');
    write(path.join(vid2, 'script.md'), md);
    const cache = path.join(vid2, 'voiceover', 'tts');
    fs.mkdirSync(cache, { recursive: true });
    const trimmed = path.join(vid, 'voiceover', 'tts', `${sha(`stub|${model}|V|One line here.`)}.wav`);
    for (const t of ['One line here.', 'Another line.']) fs.copyFileSync(trimmed, path.join(cache, `${sha(`${model}|V|${t}`)}.wav`));
    const noNet = async () => { throw new Error('must not call the API'); };
    const r2 = await tts.synthesize(vid2, { voice: 'V', speed: 1, timings: 'estimate', quiet: true, fetch: noNet });
    assert.strictEqual(r2.apiCalls, 0);
    assert.strictEqual(r2.provider, 'openrouter');
    assert.ok(fs.existsSync(path.join(cache, `${sha(`openrouter|${model}|V|Another line.`)}.wav`)));
    assert.ok(!fs.existsSync(path.join(cache, `${sha(`${model}|V|Another line.`)}.wav`)));
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
