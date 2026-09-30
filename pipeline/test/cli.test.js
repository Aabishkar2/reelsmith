'use strict';
/**
 * pipeline/test/cli.test.js — the `reelsmith` CLI (bin/reelsmith.js → core/cli.js) and what it wraps:
 * argv parsing, --help for every command, usage errors (exit 2), plugins/styles/doctor --json shapes,
 * `new`, `init --link --no-install` (files, symlinks, package mode), core/serve.js (symlinked runtime
 * and styles are served, nothing else outside the project), the v3 preview fingerprint (local
 * scripts / style kits; older approvals stale; render refuses with exit 3), `mix` + voiceover-mix.json,
 * the audio auto-pick, `run --until`, `publish --notes`, and the legacy pipeline/cli.js alias.
 *   node pipeline/test/cli.test.js
 * No network, no API key, no browser. Needs ffmpeg/ffprobe (mix) and python for doctor's checks.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const env = require('../../core/env');
env.ensureOnPath();
const cli = require('../../core/cli');
const serve = require('../../core/serve');
const project = require('../../core/project');

const FW = path.join(__dirname, '..', '..');
const BIN = path.join(FW, 'bin', 'reelsmith.js');
const LEGACY = path.join(FW, 'pipeline', 'cli.js');
const FIXTURE = path.join(FW, 'videos', 'fixture-e2e');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rs-cli-')));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.stack || e.message).split('\n').slice(0, 6).join('\n    ')}`); }
}
const CLEAN_ENV = { ...process.env, OPENROUTER_API_KEY: '', REELSMITH_DEBUG: '' };
function rs(args, { cwd = FW, env: extra = {}, bin = BIN } = {}) {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...CLEAN_ENV, ...extra }, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', all: `${r.stdout || ''}${r.stderr || ''}` };
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const get = (port, p, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p, headers }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});
const tone = (file, sec, freq = 440) => spawnSync(env.bin('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${sec}`,
  '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', file], { stdio: 'ignore' }).status === 0;

(async () => {
  console.log('argv');
  await test('parseArgs: --a=v, --a v, switches, numbers, --, and usage errors', () => {
    const spec = { voice: { type: 'string' }, speed: { type: 'number' }, force: { type: 'boolean' }, help: { type: 'boolean' } };
    const a = cli.parseArgs(['vid', '--voice', 'Leda', '--speed=1.2', '--force', '--', '--not-a-flag'], spec);
    assert.deepStrictEqual(a, { pos: ['vid', '--not-a-flag'], flags: { voice: 'Leda', speed: 1.2, force: true } });
    assert.deepStrictEqual(cli.parseArgs(['--force=false', '-h'], spec).flags, { force: false, help: true });
    assert.throws(() => cli.parseArgs(['--bogus'], spec), e => e instanceof cli.UsageError && /unknown flag --bogus/.test(e.message));
    assert.throws(() => cli.parseArgs(['--voice'], spec), /needs a value/);
    assert.throws(() => cli.parseArgs(['--voice', '--force'], spec), /needs a value/);
    assert.throws(() => cli.parseArgs(['--speed=fast'], spec), /must be a number/);
    assert.throws(() => cli.parseArgs(['--force=maybe'], spec), /takes no value/);
    assert.deepStrictEqual(cli.parseArgs(['x', '--y', '--z=1']), { pos: ['x'], flags: { y: true, z: '1' } }, 'no spec: legacy-style parsing');
  });

  console.log('\nhelp + usage errors');
  const visible = Object.entries(cli.COMMANDS).filter(([, c]) => !c.hidden).map(([n]) => n);
  await test(`--help for every command (${visible.length}) exits 0 with its usage and every flag`, () => {
    for (const name of visible) {
      const r = rs([name, '--help']);
      assert.strictEqual(r.code, 0, `${name}: ${r.all}`);
      assert.ok(r.out.startsWith(`Usage: reelsmith ${name}`), `${name}: ${r.out.split('\n')[0]}`);
      for (const f of Object.keys(cli.COMMANDS[name].flags)) assert.ok(r.out.includes(`--${f}`), `${name} --help lacks --${f}`);
      if (cli.COMMANDS[name].json) assert.ok(r.out.includes('--json'), `${name} --help lacks --json`);
    }
    assert.strictEqual(rs(['help', 'render']).code, 0);
    assert.ok(rs(['help', 'render']).out.includes('gate'), 'help <cmd> = <cmd> --help');
  });
  await test('top-level --help lists every command; --version prints the package version', () => {
    const r = rs(['--help']);
    assert.strictEqual(r.code, 0);
    for (const name of visible) assert.ok(new RegExp(`^  ${name}\\b`, 'm').test(r.out), `--help lacks ${name}`);
    assert.strictEqual(rs(['--version']).out.trim(), require('../../package.json').version);
  });
  await test('exit 2: unknown command, unknown flag, missing <video>, extra argument, bad values', () => {
    const cases = [['nope'], ['tts', 'fixture-e2e', '--bogus'], ['lint'], ['lint', 'a', 'b'], ['run', 'fixture-e2e', '--until=render'],
      ['clip', 'fixture-e2e', '--from=3'], ['approve', 'fixture-e2e'], ['publish', 'fixture-e2e'], ['publish', 'fixture-e2e', '--to=youtube', '--privacy=secret'],
      ['tts', 'fixture-e2e', '--mode=karaoke'], ['draft', 'fixture-e2e', '--shards=0'], ['new', 'bad name!'], ['help', 'nope']];
    for (const args of cases) {
      const r = rs(args);
      assert.strictEqual(r.code, 2, `${args.join(' ')} → ${r.code}: ${r.all}`);
    }
    assert.ok(/unknown command "nope"/.test(rs(['nope']).err));
    assert.ok(/--until must be one of tts, mix, lint, sheet, draft/.test(rs(['run', 'fixture-e2e', '--until=render']).err));
  });
  await test('exit 1: a video that does not exist', () => {
    const r = rs(['lint', 'no-such-video']);
    assert.strictEqual(r.code, 1, r.all);
    assert.ok(/video dir not found/.test(r.err), r.err);
  });

  console.log('\nplugins / styles / doctor');
  await test('plugins --json: every built-in with name, kind, version, source, ok, active', () => {
    const r = rs(['plugins', '--json']);
    assert.strictEqual(r.code, 0, r.err);
    const list = JSON.parse(r.out);
    assert.ok(Array.isArray(list));
    for (const e of list) for (const k of ['name', 'kind', 'version', 'source', 'ok', 'active']) assert.ok(k in e, `${e.name} lacks ${k}`);
    const names = list.map(e => e.name);
    for (const n of ['tts-openrouter', 'stt-whisper', 'motion', 'reflective', 'tech-news']) assert.ok(names.includes(n), `${n} missing: ${names}`);
    assert.ok(list.every(e => !('plugin' in e)), 'no plugin objects in the JSON');
    assert.ok(/NAME\s+KIND\s+VERSION\s+SOURCE\s+STATUS/.test(rs(['plugins']).out));
  });
  await test('styles lists the three packs, the default marked', () => {
    const r = rs(['styles']);
    assert.strictEqual(r.code, 0, r.err);
    for (const n of ['motion', 'reflective', 'tech-news']) assert.ok(r.out.includes(n), `${n} missing`);
    const list = JSON.parse(rs(['styles', '--json']).out);
    assert.deepStrictEqual(list.map(s => s.name).sort(), ['motion', 'reflective', 'tech-news']);
    assert.strictEqual(list.filter(s => s.default).length, 1);
    assert.ok(list.find(s => s.name === 'motion').kit, 'motion has kit.jsx');
  });
  let doctorFw;
  await test('doctor --json: { ok, root, mode, checks[] } with the system, project, key and plugin rows', () => {
    const r = rs(['doctor', '--json']);
    doctorFw = JSON.parse(r.out);
    assert.strictEqual(r.code, doctorFw.ok ? 0 : 1, 'exit 1 only when a required item fails');
    assert.strictEqual(doctorFw.mode, 'clone');
    assert.strictEqual(fs.realpathSync(doctorFw.root), fs.realpathSync(FW));
    const ids = doctorFw.checks.map(c => c.id);
    for (const id of ['node', 'ffmpeg', 'ffprobe', 'python', 'whisper', 'chromium', 'env', 'OPENROUTER_API_KEY', 'publish', 'root', 'config', 'runtime', 'styles', 'videos', 'plugin:tts-openrouter', 'plugin:stt-whisper'])
      assert.ok(ids.includes(id), `no ${id} row: ${ids}`);
    for (const c of doctorFw.checks) {
      assert.ok(['ok', 'warn', 'fail'].includes(c.status) && typeof c.message === 'string' && typeof c.required === 'boolean', JSON.stringify(c));
      if (c.status === 'fail') assert.ok(c.required, `a non-required row must not be ✗: ${JSON.stringify(c)}`);
    }
    assert.strictEqual(doctorFw.checks.find(c => c.id === 'OPENROUTER_API_KEY').status, 'warn', 'blank key → ⚠, not a failure');
    const whisper = doctorFw.checks.find(c => c.id === 'whisper');
    assert.ok(whisper.status === 'ok' || whisper.optional, 'whisper is optional');
  });

  console.log('\ninit (package mode) + new');
  const P = path.join(TMP, 'proj');
  await test('init <dir> --link --no-install: template files, skills, package.json, links (runtime, styles/<pack>)', () => {
    const r = rs(['init', P, '--link', '--no-install', '--style=motion'], { cwd: TMP });
    assert.strictEqual(r.code, 0, r.all);
    for (const f of ['reelsmith.config.json', '.env.example', '.gitignore', 'CLAUDE.md', 'README.md', 'config/audio.md', 'config/music.md',
      'config/voice/performance.md', 'config/fillers.json', 'config/strategy.md', 'videos/.gitkeep', 'plugins/.gitkeep', 'music/CREDITS.md',
      '.claude/skills/reelsmith-pipeline/SKILL.md', 'package.json']) assert.ok(fs.existsSync(path.join(P, f)), `missing ${f}`);
    if (fs.existsSync(path.join(FW, 'music', 'download.sh'))) assert.ok(fs.statSync(path.join(P, 'music', 'download.sh')).mode & 0o100, 'download.sh executable');
    assert.ok(!fs.existsSync(path.join(P, 'gitignore')), 'template gitignore is renamed');
    assert.strictEqual(readJson(path.join(P, 'reelsmith.config.json')).style, 'motion');
    assert.deepStrictEqual(readJson(path.join(P, 'config', 'fillers.json')), readJson(path.join(FW, 'config', 'fillers.json')), 'fillers.json = the framework\'s');
    assert.ok(!('python' in readJson(path.join(P, 'config', 'fillers.json')).denoise), 'no hard-coded python');
    const pkg = readJson(path.join(P, 'package.json'));
    assert.strictEqual(pkg.dependencies.reelsmith, `file:${project.FRAMEWORK_ROOT}`);
    assert.strictEqual(fs.realpathSync(path.join(P, 'node_modules', 'reelsmith')), fs.realpathSync(FW));
    const rt = fs.readlinkSync(path.join(P, 'runtime'));
    assert.strictEqual(rt, path.join('node_modules', 'reelsmith', 'runtime'), 'relative runtime link');
    assert.ok(fs.existsSync(path.join(P, 'runtime', 'animations.jsx')));
    assert.ok(fs.lstatSync(path.join(P, 'styles')).isDirectory() && !fs.lstatSync(path.join(P, 'styles')).isSymbolicLink(), 'styles/ is a real folder');
    for (const e of ['motion', 'reflective', 'tech-news', 'design.md']) {
      assert.ok(fs.lstatSync(path.join(P, 'styles', e)).isSymbolicLink(), `styles/${e} is a link`);
      assert.strictEqual(fs.readlinkSync(path.join(P, 'styles', e)), path.join('..', 'node_modules', 'reelsmith', 'styles', e));
    }
    const gi = fs.readFileSync(path.join(P, '.gitignore'), 'utf8').split('\n');
    for (const l of ['/runtime', '/styles/motion', '/styles/design.md', 'node_modules/', '.env']) assert.ok(gi.includes(l), `.gitignore lacks ${l}`);
    assert.ok(fs.readFileSync(path.join(P, '.env.example'), 'utf8').includes('OPENROUTER_API_KEY='));
  });
  await test('init refuses a non-empty dir without --force; --force keeps existing files; framework checkout = no-op; bad style = 2', () => {
    const again = rs(['init', P, '--link', '--no-install'], { cwd: TMP });
    assert.strictEqual(again.code, 1, again.all);
    assert.ok(/not empty/.test(again.err));
    fs.writeFileSync(path.join(P, 'README.md'), 'mine\n');
    const forced = rs(['init', P, '--link', '--no-install', '--force'], { cwd: TMP });
    assert.strictEqual(forced.code, 0, forced.all);
    assert.strictEqual(fs.readFileSync(path.join(P, 'README.md'), 'utf8'), 'mine\n');
    const self = rs(['init', '.'], { cwd: FW });
    assert.strictEqual(self.code, 0);
    assert.ok(/framework checkout itself/.test(self.out), self.out);
    assert.strictEqual(rs(['init', path.join(TMP, 'x'), '--style=nope', '--no-install'], { cwd: TMP }).code, 2);
    assert.ok(!fs.existsSync(path.join(TMP, 'x')));
  });
  await test('inside the project: package mode, built-in styles listed once (the styles/<pack> links are not "project" packs)', () => {
    const list = JSON.parse(rs(['plugins', '--json'], { cwd: P }).out);
    const styles = list.filter(e => e.kind === 'style');
    assert.deepStrictEqual(styles.map(s => s.name).sort(), ['motion', 'reflective', 'tech-news']);
    assert.ok(styles.every(s => s.source === 'builtin style'), JSON.stringify(styles.map(s => s.source)));
    const d = JSON.parse(rs(['doctor', '--json'], { cwd: path.join(P, 'config') }).out);
    assert.strictEqual(d.mode, 'package');
    assert.strictEqual(fs.realpathSync(d.root), fs.realpathSync(P), 'root found from a subfolder');
    assert.strictEqual(d.checks.find(c => c.id === 'runtime').status, 'ok');
    assert.strictEqual(d.checks.find(c => c.id === 'styles').status, 'ok');
  });
  await test('new <name>: videos/<name>/script.md from the template (style, voice, 3 scenes); refuses to overwrite', () => {
    const r = rs(['new', 'demo', '--style=tech-news', '--voice=Leda'], { cwd: P });
    assert.strictEqual(r.code, 0, r.all);
    const file = path.join(P, 'videos', 'demo', 'script.md');
    const parsed = require('../script').load(path.dirname(file));
    assert.strictEqual(parsed.meta.style, 'tech-news');
    assert.strictEqual(parsed.meta.tts_voice, 'Leda');
    assert.strictEqual(parsed.meta.title, 'Demo');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(parsed.meta.date));
    assert.strictEqual(parsed.scenes.length, 3);
    assert.deepStrictEqual(parsed.warnings, []);
    assert.ok(!/\{\{/.test(fs.readFileSync(file, 'utf8')), 'no unfilled placeholder');
    const noVoice = rs(['new', 'plain'], { cwd: P });
    assert.strictEqual(noVoice.code, 0);
    const plain = require('../script').load(path.join(P, 'videos', 'plain'));
    assert.strictEqual(plain.meta.style, 'motion', 'default style from reelsmith.config.json');
    assert.ok(!('tts_voice' in plain.meta), 'no voice unless the creator named one');
    assert.strictEqual(rs(['new', 'demo'], { cwd: P }).code, 1, 'exists → 1');
    assert.strictEqual(rs(['new', 'demo', '--force'], { cwd: P }).code, 0);
    assert.strictEqual(rs(['new', 'demo2', '--style=nope'], { cwd: P }).code, 2);
    const outside = fs.mkdtempSync(path.join(TMP, 'none-'));
    const o = rs(['new', 'x'], { cwd: outside });
    assert.strictEqual(o.code, 1, o.all);
    assert.ok(/not inside a Reelsmith project/.test(o.err));
  });

  console.log('\ncore/serve.js (project root, symlinks)');
  await test('serves runtime/ and styles/<pack> through the symlinks; blocks dotfiles, traversal and other links out', async () => {
    fs.writeFileSync(path.join(P, '.env'), 'SECRET=1\n');
    fs.mkdirSync(path.join(P, 'videos', 'demo', 'images'), { recursive: true });
    fs.writeFileSync(path.join(P, 'videos', 'demo', 'images', 'a b.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(TMP, 'outside.txt'), 'not part of the project\n');
    fs.symlinkSync(TMP, path.join(P, 'videos', 'demo', 'leak'));                           // a link out of the project
    fs.symlinkSync(path.join(FW, 'core'), path.join(P, 'videos', 'demo', 'fwlink'));      // into the framework, but not a mount point
    const { server, port, url } = await serve.start(P);
    try {
      const ok = async (p, what) => { const r = await get(port, p); assert.strictEqual(r.status, 200, `${what || p}: ${r.status}`); return r; };
      const no = async p => assert.strictEqual((await get(port, p)).status, 404, p);
      const rt = await ok('/runtime/animations.jsx');
      assert.ok(rt.body.toString().includes('useSceneWindow'));
      await ok('/styles/motion/kit.jsx');
      await ok('/styles/design.md');
      await ok('/videos/demo/script.md');
      await ok(new URL(url(path.join(P, 'videos', 'demo', 'images', 'a b.svg'))).pathname, 'url() encodes a space');
      await no('/.env');
      await no('/%2e%2e/%2e%2e/etc/passwd');
      await no('/videos/demo/leak/outside.txt');
      await no('/videos/demo/fwlink/cli.js');
      await no('/videos/demo');
      await no('/node_modules/reelsmith/package.json');
      assert.strictEqual(serve.resolveFile(P, '/runtime/animations.jsx'), fs.realpathSync(path.join(FW, 'runtime', 'animations.jsx')));
    } finally { server.close(); }
    const mp3 = path.join(P, 'videos', 'demo', 'voiceover.mp3');
    if (tone(mp3, 1)) {
      const s2 = await serve.start(P);
      try {
        const r = await get(s2.port, '/videos/demo/voiceover.mp3', { Range: 'bytes=0-99' });
        assert.strictEqual(r.status, 206);
        assert.strictEqual(r.body.length, 100);
      } finally { s2.server.close(); }
    }
  });

  console.log('\napprove (fingerprint v3) + the render gate');
  const V = path.join(P, 'videos', 'kitvid');
  await test('the fingerprint covers local <script src> files (style kits); editing the kit invalidates the approval', () => {
    fs.mkdirSync(path.join(P, 'styles', 'mine'), { recursive: true });
    fs.writeFileSync(path.join(P, 'styles', 'mine', 'kit.jsx'), 'window.Kit = () => null;\n');
    fs.mkdirSync(V, { recursive: true });
    fs.writeFileSync(path.join(V, 'index.html'), '<!doctype html><script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>\n' +
      '<script type="text/babel" src="../../runtime/animations.jsx"></script>\n<script type="text/babel" src="../../styles/mine/kit.jsx?v=1"></script>\n' +
      '<!-- <script src="../../styles/commented-out.jsx"></script> -->\n');
    fs.writeFileSync(path.join(V, 'scenes.json'), JSON.stringify([{ idx: 1, dur: 1, file: 'voiceover/s1.mp3', words: [] }]));
    const ap = require('../../tools/approve-preview');
    const files = ap.fingerprintFiles(V).map(f => path.relative(P, f));
    assert.deepStrictEqual(files, ['videos/kitvid/index.html', 'videos/kitvid/scenes.json', 'runtime/animations.jsx', 'styles/mine/kit.jsx']);
    const a = rs(['approve', 'kitvid', '--by=tester', '--json'], { cwd: P });
    assert.strictEqual(a.code, 0, a.all);
    assert.strictEqual(JSON.parse(a.out).v, 3);
    assert.strictEqual(rs(['approve', 'kitvid', '--check'], { cwd: P }).code, 0);
    fs.appendFileSync(path.join(P, 'styles', 'mine', 'kit.jsx'), '// edited\n');
    const c = rs(['approve', 'kitvid', '--check'], { cwd: P });
    assert.strictEqual(c.code, 1);
    assert.ok(/changed since the preview was approved/.test(c.out), c.out);
  });
  await test('an approval older than v3 is stale; render refuses with exit 3 (before launching anything)', () => {
    const ap = require('../../tools/approve-preview');
    fs.writeFileSync(ap.approvalPath(V), JSON.stringify({ v: 2, fingerprint: ap.fingerprint(V, 2), by: 'old', at: 'x' }));
    const chk = ap.checkApproval(V);
    assert.strictEqual(chk.ok, false);
    assert.ok(/fingerprint v2/.test(chk.reason), chk.reason);
    const r = rs(['render', 'kitvid'], { cwd: P });
    assert.strictEqual(r.code, 3, r.all);
    assert.ok(/Preview gate/.test(r.err) && /reelsmith approve/.test(r.err), r.err);
  });

  console.log('\nmix + audio pick + run');
  const M = path.join(P, 'videos', 'mixvid');
  await test('mix writes voiceover-mix.mp3 + voiceover-mix.json { durationSec, voiceSec, tailSec, track, underDb, at }', () => {
    fs.mkdirSync(M, { recursive: true });
    fs.mkdirSync(path.join(P, 'music'), { recursive: true });
    assert.ok(tone(path.join(M, 'voiceover.mp3'), 3, 440) && tone(path.join(P, 'music', 'bed.mp3'), 12, 220), 'ffmpeg made the test audio');
    const none = rs(['mix', 'mixvid'], { cwd: P });
    assert.strictEqual(none.code, 2, none.all);
    assert.ok(/music\.defaultTrack/.test(none.err) && /bed\.mp3/.test(none.err), none.err);
    const r = rs(['mix', 'mixvid', '--track=music/bed.mp3', '--json'], { cwd: P });
    assert.strictEqual(r.code, 0, r.all);
    const info = readJson(path.join(M, 'voiceover-mix.json'));
    for (const k of ['durationSec', 'voiceSec', 'tailSec', 'track', 'underDb', 'at']) assert.ok(k in info, `no ${k}`);
    assert.strictEqual(info.track, 'music/bed.mp3');
    assert.strictEqual(info.underDb, 6);
    assert.ok(Math.abs(info.durationSec - (info.voiceSec + info.tailSec)) < 0.1, JSON.stringify(info));
    assert.deepStrictEqual(JSON.parse(r.out).durationSec, info.durationSec);
  });
  await test('draft/render audio pick: the mix, unless it was mixed over a different voice; --audio wins', () => {
    assert.strictEqual(path.basename(cli.pickAudio(M).file), 'voiceover-mix.mp3');
    assert.ok(tone(path.join(M, 'voiceover.mp3'), 4, 440));
    const stale = cli.pickAudio(M);
    assert.strictEqual(path.basename(stale.file), 'voiceover.mp3');
    assert.ok(/stale/.test(stale.how), stale.how);
    assert.strictEqual(cli.pickAudio(M, path.join(M, 'voiceover-mix.mp3')).how, '--audio');
    fs.rmSync(path.join(M, 'voiceover-mix.mp3'));
    assert.strictEqual(path.basename(cli.pickAudio(M).file), 'voiceover.mp3');
    assert.strictEqual(cli.pickAudio(path.join(P, 'videos', 'demo')).file !== null, true);
    assert.strictEqual(cli.pickAudio(path.join(P, 'videos', 'plain')).file, null);
  });
  await test('run on an own-voice video: tts skipped (take.json), mix skipped (no track), lint runs; --until stops there', () => {
    fs.cpSync(FIXTURE, path.join(P, 'videos', 'fx'), { recursive: true, filter: s => !/\.mp4$|frames/.test(s) });
    const r = rs(['run', 'fx', '--until=lint'], { cwd: P });
    assert.strictEqual(r.code, 0, r.all);
    assert.ok(/tts\s+\(skipped: own-voice/.test(r.out) && /mix\s+\(skipped/.test(r.out) && /lint ok/.test(r.out), r.out);
    assert.ok(!/sheet/.test(r.out.split('lint ok')[1] || ''), 'stopped after lint');
    const lint = JSON.parse(rs(['lint', 'fx', '--json'], { cwd: P }).out);
    assert.deepStrictEqual([lint.ok, lint.checkSync.ok, lint.validateSync.ok], [true, true, true]);
  });

  console.log('\npublish + legacy alias');
  await test('publish --notes writes the publish.md skeleton (title from script.md) once; unknown target → 1', () => {
    const r = rs(['publish', 'fx', '--notes'], { cwd: P });
    assert.strictEqual(r.code, 0, r.all);
    const md = fs.readFileSync(path.join(P, 'videos', 'fx', 'publish.md'), 'utf8');
    assert.ok(md.includes('Why Lambda cold starts hurt'), md.slice(0, 300));
    const again = rs(['publish', 'fx', '--notes'], { cwd: P });
    assert.strictEqual(again.code, 0);
    assert.ok(/already exists/.test(again.out), again.out);
    const bad = rs(['publish', 'fx', '--to=myspace', '--dry-run'], { cwd: P });
    assert.strictEqual(bad.code, 1, bad.all);
    assert.ok(/no publish provider "myspace"/.test(bad.out + bad.err), bad.all);
  });
  await test('pipeline/cli.js is an alias of the same commands (status), and only of the pipeline ones', () => {
    const a = rs(['status', 'fixture-e2e', '--json'], { bin: LEGACY });
    const b = rs(['status', 'fixture-e2e', '--json']);
    assert.strictEqual(a.code, 0, a.all);
    assert.strictEqual(a.out, b.out);
    assert.strictEqual(rs(['doctor'], { bin: LEGACY }).code, 2);
    assert.strictEqual(require('../cli').statusTable, cli.statusTable);
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
