'use strict';
/**
 * core/cli.js — the `reelsmith` command line (docs/framework-spec.md §3).
 *
 * bin/reelsmith.js calls main(process.argv.slice(2)); pipeline/cli.js is a thin alias onto the same
 * command implementations (main(argv, { legacy: true })). Zero-dependency argv parsing:
 * `--flag=value`, `--flag value` (value flags only), `--switch`, `--` ends the flags. Every command
 * takes --help (-h); structured ones take --json (the result on stdout, logs on stderr). Unknown
 * commands and flags are usage errors.
 *
 * Exit codes: 0 ok · 1 error · 2 usage · 3 gate refused (a final render without a current
 * preview approval). A command's own failure is 1 (a rejected re-record clip too; the legacy
 * pipeline/cli.js alias keeps its old 2 for that).
 *
 * Every command resolves the project root through core/project.js (a video's root is
 * rootFor(videoDir); commands without a video use the project around the cwd), loads
 * reelsmith.config.json + .env (core/config.js) and puts the resolved ffmpeg/ffprobe on PATH
 * (core/env.ensureOnPath). Module APIs are called in-process (pipeline/*, core/plugins,
 * tools/approve-preview); the CLI-only tools are spawned with process.execPath:
 * tools/check-sync.js, tools/validate-sync.js, tools/contact-sheet.js, tools/preview.js,
 * tools/mix-music.js, renderer/render.js, app/server.js.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');
const project = require('./project');
const env = require('./env');
const coreConfig = require('./config');

const FW = project.FRAMEWORK_ROOT;
const TOOLS = path.join(FW, 'tools');
const RENDER = path.join(FW, 'renderer', 'render.js');
const APP = path.join(FW, 'app', 'server.js');
const VERSION = (() => { try { return require(path.join(FW, 'package.json')).version; } catch (_) { return '0.0.0'; } })();
const RUN_STEPS = ['tts', 'mix', 'lint', 'sheet', 'draft'];
const PRIVACIES = ['private', 'unlisted', 'public'];

class UsageError extends Error { constructor(message, cmd) { super(message); this.exitCode = 2; this.cmd = cmd; } }
class CliError extends Error { constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; } }

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const relCwd = p => path.relative(process.cwd(), p) || '.';
const firstLine = e => String((e && e.message) || e).split('\n')[0];
const within = (parent, child) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

// ── argv ─────────────────────────────────────────────────────────────────────

/**
 * parseArgs(argv, spec?) → { pos, flags }. spec = { name: { type: 'boolean'|'string'|'number' } };
 * with a spec, unknown flags and bad values throw UsageError. Without one, `--x` is true and
 * `--x=v` is 'v' (no `--x v` form, it can't be told apart from a positional).
 */
function parseArgs(argv, spec = null, cmd = null) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--') { pos.push(...argv.slice(i + 1).map(String)); break; }
    if (a === '-h') { flags.help = true; continue; }
    const m = a.match(/^--([^=]+)(?:=([\s\S]*))?$/);
    if (!m) { pos.push(a); continue; }
    const name = m[1];
    const def = spec ? spec[name] : null;
    if (spec && !def) throw new UsageError(`unknown flag --${name}`, cmd);
    const type = def ? def.type : (m[2] === undefined ? 'boolean' : 'string');
    if (type === 'boolean') {
      if (m[2] === undefined || /^(true|1|yes)$/i.test(m[2])) flags[name] = true;
      else if (/^(false|0|no)$/i.test(m[2])) flags[name] = false;
      else throw new UsageError(`--${name} is a switch and takes no value (got "${m[2]}")`, cmd);
      continue;
    }
    let v = m[2];
    if (v === undefined) {
      const next = argv[i + 1];
      if (next === undefined || String(next).startsWith('--')) {
        throw new UsageError(`--${name} needs a value${def && def.value ? `: --${name}=${def.value}` : ''}`, cmd);
      }
      v = String(next);
      i++;
    }
    if (type === 'number') {
      const n = Number(v);
      if (!String(v).trim() || !Number.isFinite(n)) throw new UsageError(`--${name} must be a number (got "${v}")`, cmd);
      flags[name] = n;
    } else flags[name] = v;
  }
  return { pos, flags };
}

// ── shared helpers ───────────────────────────────────────────────────────────

function loadProject(root) {
  try { return coreConfig.load({ root }); }
  catch (e) { throw new CliError(`${firstLine(e)} — fix reelsmith.config.json`); }
}

/** <video> → { dir, root, config, name, rel } (videos/<name>, <name> or a path). */
function videoContext(arg, cmd) {
  if (!arg) throw new UsageError('missing <video> (videos/<name>, <name> or a path)', cmd);
  const cwdRoot = project.root(process.cwd());
  let videosDir = 'videos';
  try { videosDir = coreConfig.load({ root: cwdRoot, env: false }).config.videosDir || 'videos'; } catch (_) { /* reported below */ }
  let dir;
  try { dir = project.resolveVideo(arg, { root: cwdRoot, videosDir }); } catch (e) { throw new CliError(e.message); }
  const root = project.rootFor(dir);
  const { config } = loadProject(root);
  return { dir, root, config, name: path.basename(dir), rel: relCwd(dir) };
}

/** The project around the cwd: { root, config, found } (found: a reelsmith.config.json / framework checkout). */
function cwdProject() {
  const found = project.findRoot(process.cwd());
  const root = found || FW;
  return { root, found: Boolean(found), ...loadProject(root) };
}

function registryFor(root, config) {
  return require('./plugins').load({ root, config });
}

/** Run a node script: inherit stdio (async, waits; Ctrl+C reaches the child, which cleans up), or capture. */
function runNode(script, args, { capture = false, cwd, extraEnv = {}, stdin = 'inherit' } = {}) {
  const childEnv = { ...process.env, ...extraEnv };
  if (capture) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: childEnv, cwd,
      stdio: ['ignore', 'pipe', capture === 'stdout' ? 'inherit' : 'pipe'] });
    return { code: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: [stdin, 'inherit', 'inherit'], env: childEnv, cwd });
    const onInt = () => {};                                  // the terminal sends SIGINT to the child as well
    const onTerm = () => { try { child.kill('SIGTERM'); } catch (_) { /* gone */ } };
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    const done = (res) => { process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); resolve(res); };
    child.on('error', e => done({ code: 1, error: e }));
    child.on('exit', (code, signal) => done({ code: code === null ? (signal === 'SIGINT' ? 130 : 1) : code, signal }));
  });
}

/** ffprobe duration (s) or null. */
function probeDuration(file) {
  try {
    const out = execFileSync(env.bin('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const d = Number(out);
    return Number.isFinite(d) ? d : null;
  } catch (_) { return null; }
}

/**
 * Audio for draft/render/clip: --audio, else voiceover-mix.mp3 (unless voiceover-mix.json says it was
 * mixed over a different voice than today's voiceover.mp3), else voiceover.mp3.
 * → { file | null, how }
 */
function pickAudio(dir, explicit) {
  if (explicit) {
    const f = path.resolve(explicit);
    if (!isFile(f)) throw new CliError(`--audio file not found: ${explicit}`);
    return { file: f, how: '--audio' };
  }
  const mix = path.join(dir, 'voiceover-mix.mp3'), vo = path.join(dir, 'voiceover.mp3');
  if (isFile(mix)) {
    const info = readJson(path.join(dir, 'voiceover-mix.json'));
    const voSec = info && Number.isFinite(info.voiceSec) && isFile(vo) ? probeDuration(vo) : null;
    if (voSec == null || Math.abs(voSec - info.voiceSec) <= 0.02) return { file: mix, how: 'voiceover-mix.mp3 (music bed)' };
    return { file: vo, how: `voiceover.mp3 — voiceover-mix.mp3 is stale (mixed over a ${info.voiceSec}s voice, voiceover.mp3 is ${voSec.toFixed(2)}s; re-run reelsmith mix)` };
  }
  if (isFile(vo)) return { file: vo, how: 'voiceover.mp3 (no voiceover-mix.mp3)' };
  return { file: null, how: 'none (no voiceover-mix.mp3 or voiceover.mp3 yet)' };
}

function flagArgs(flags, names) {
  const out = [];
  for (const n of names) {
    const v = flags[n];
    if (v === undefined || v === false) continue;
    out.push(v === true ? `--${n}` : `--${n}=${v}`);
  }
  return out;
}

const logFor = json => (json ? (...a) => console.error(...a) : (...a) => console.log(...a));
const printJson = obj => console.log(JSON.stringify(obj, null, 2));

// ── pipeline commands (analyze / rerecord / cut / status / tts / jev) ────────

const pad = (s, n) => String(s).padEnd(n);
function statusTable(take) {
  const lines = [];
  lines.push(`${take.video}  take=${take.take}  status=${take.status}  audio=${take.audio ? take.audio.durationSec : '?'}s  jev=${take.jev ? take.jev.model : 'off'}`);
  if (take.problem) lines.push(`!! ${take.problem.message}`);
  lines.push(`${pad('id', 7)}${pad('status', 12)}${pad('wer', 7)}${pad('wpm', 6)}flags`);
  lines.push('-'.repeat(78));
  for (const s of take.sentences) {
    const flags = (s.flags || []).map(f => `${f.severity === 'bad' ? '!' : f.severity === 'missing' ? '?' : f.severity === 'info' ? 'i:' : ''}${f.type}${f.detail ? `(${f.detail})` : ''}`).join(', ');
    lines.push(`${pad(s.id, 7)}${pad(s.status, 12)}${pad(s.wer === null || s.wer === undefined ? '-' : s.wer.toFixed(2), 7)}${pad(s.wpm ?? '-', 6)}${flags}`);
    if (s.status === 'bad' || s.status === 'missing') lines.push(`${' '.repeat(7)}script: ${s.text}\n${' '.repeat(7)}heard:  ${s.heard || '—'}`);
  }
  const sm = take.summary || {};
  lines.push('-'.repeat(78));
  lines.push(`ok ${sm.ok}  warn ${sm.warn}  bad ${sm.bad}  missing ${sm.missing}  rerecorded ${sm.rerecorded || 0}  fillers ${sm.fillers}  cuts ${(take.cuts || []).length}  est. clean ${sm.estimatedCleanSec}s`);
  return lines.join('\n');
}

async function cmdAnalyze({ pos, flags }) {
  const v = videoContext(pos[0], 'analyze');
  const take = await require('../pipeline/analyze').analyze(v.dir, {
    take: flags.take, useJev: !flags['no-jev'], whisperModel: flags['whisper-model'], forceWhisper: Boolean(flags['force-whisper']),
  });
  if (flags.json) console.log(JSON.stringify(take)); else console.log(statusTable(take));
  return 0;
}

async function cmdRerecord({ pos, flags }, opts) {
  const v = videoContext(pos[0], 'rerecord');
  if (!flags.sentence || !flags.clip) throw new UsageError('--sentence=<id> and --clip=<takes/rr-…> are required', 'rerecord');
  const r = await require('../pipeline/splice').rerecord(v.dir, flags.sentence, flags.clip, {
    useJev: !flags['no-jev'], whisperModel: flags['whisper-model'], forceWhisper: Boolean(flags['force-whisper']),
  });
  if (flags.json) console.log(JSON.stringify(r));
  else console.log(!r.ok ? `✗ ${flags.sentence} clip rejected: ${r.reason}`
    : r.kept === 'take' ? `~ ${flags.sentence} ${r.reason}` : `✓ ${flags.sentence} re-recorded (${r.sentence.clipStatus}, wer ${r.sentence.wer})`);
  return r.ok ? 0 : (opts.legacy ? 2 : 1);
}

async function cmdCut({ pos, flags }) {
  const v = videoContext(pos[0], 'cut');
  const log = logFor(flags.json);
  const r = require('../pipeline/cut').finalize(v.dir);
  if (flags.json) console.log(JSON.stringify(r));
  else {
    for (const s of r.scenes) log(`  scene ${s.idx}: ${s.dur.toFixed(2)}s  ${s.words.length} words  ${s.file}`);
    for (const w of r.warnings) log(`  warning: ${w}`);
    log(`voiceover.mp3 ${r.totalSec}s, scenes.json written (${r.scenes.length} scenes)`);
  }
  return 0;
}

async function cmdStatus({ pos, flags }) {
  const v = videoContext(pos[0], 'status');
  const f = path.join(v.dir, 'take.json');
  if (!fs.existsSync(f)) throw new CliError(`no take.json in ${v.rel} (reelsmith analyze ${v.rel} makes one from a recorded take)`);
  const take = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (flags.json) console.log(JSON.stringify({ status: take.status, summary: take.summary, sentences: take.sentences.map(s => ({ id: s.id, status: s.status, wer: s.wer, wpm: s.wpm, flags: s.flags })) }));
  else console.log(statusTable(take));
  return 0;
}

async function ttsRun(v, flags) {
  const tts = require('../pipeline/tts');
  const log = logFor(flags.json);
  const opts = {
    mode: flags.mode, provider: flags.provider, model: flags.model, voice: flags.voice,
    speed: flags.speed === undefined ? undefined : String(flags.speed),
    timings: flags.timings, whisperModel: flags['whisper-model'], ctaSec: flags.cta,
    force: Boolean(flags.force), offline: Boolean(flags.offline), root: v.root,
  };
  if (opts.mode && !tts.MODES.includes(opts.mode)) throw new UsageError(`--mode must be one of ${tts.MODES.join(', ')} (got ${opts.mode})`, 'tts');
  if (opts.timings && !['auto', 'whisper', 'estimate'].includes(opts.timings)) throw new UsageError(`--timings must be auto, whisper or estimate (got ${opts.timings})`, 'tts');
  const mode = tts.resolveMode(v.dir, opts);
  if (mode === 'performance') {
    const r = await require('../pipeline/performance').synthesize(v.dir, opts);
    if (flags.json) console.log(JSON.stringify(r));
    else {
      for (const s of r.scenes) log(`  scene ${s.idx}: ${s.dur.toFixed(2)}s  ${s.words.length} words  ${s.file}`);
      log(`performance mode: ${r.provider} ${r.model} / voice ${r.voice} / ${r.speed}x — ${r.cached ? `audio cached, 0 API calls${r.directionChanged ? ' (direction text changed since this voice was made; --force re-voices)' : ''}` : `${r.apiCalls} API call`}`);
      log(`alignment: ${r.matched}/${r.sentences} sentences matched${r.unmatched.length ? ` (not found: ${r.unmatched.map(s => s.id).join(', ')})` : ''}; word timings: ${r.timings}`);
      log(`voiceover.mp3 ${r.totalSec}s, scenes.json written (${r.scenes.length} scenes)`);
    }
    return r;
  }
  if (opts.offline) throw new UsageError('--offline is only supported with --mode=performance', 'tts');
  const r = await tts.synthesize(v.dir, opts);
  if (flags.json) console.log(JSON.stringify(r));
  else {
    for (const s of r.scenes) log(`  scene ${s.idx}: ${s.dur.toFixed(2)}s  ${s.words.length} words  ${s.file}`);
    log(`${r.model} / voice ${r.voice} / ${r.speed}x — ${r.apiCalls} API calls, ${r.cached} cached`);
    log(`word timings: ${r.timings}${r.timingsFallback ? ` (${r.timingsFallback})` : ''}`);
    log(`voiceover.mp3 ${r.totalSec}s, scenes.json written (${r.scenes.length} scenes)`);
  }
  return r;
}

async function cmdTts({ pos, flags }) {
  await ttsRun(videoContext(pos[0], 'tts'), flags);
  return 0;
}

async function cmdJev() {
  console.log(JSON.stringify(await require('../pipeline/jev').verifySlug(), null, 2));
  return 0;
}

// ── record / preview ─────────────────────────────────────────────────────────

async function cmdRecord({ flags }) {
  const p = cwdProject();
  const extraEnv = { REELSMITH_ROOT: p.root };
  if (flags.port !== undefined) {
    if (!(Number.isInteger(flags.port) && flags.port > 0 && flags.port < 65536)) throw new UsageError(`--port must be 1–65535 (got ${flags.port})`, 'record');
    extraEnv.APP_PORT = String(flags.port);
  }
  return (await runNode(APP, [], { extraEnv })).code;
}

async function cmdPreview({ pos, flags }) {
  const v = videoContext(pos[0], 'preview');
  if (flags.port !== undefined && !(Number.isInteger(flags.port) && flags.port > 0 && flags.port < 65536)) throw new UsageError(`--port must be 1–65535 (got ${flags.port})`, 'preview');
  return (await runNode(path.join(TOOLS, 'preview.js'), [v.dir, ...flagArgs(flags, ['port', 'lan', 'no-open'])])).code;
}

// ── mix / lint / sheet ───────────────────────────────────────────────────────

function musicTracks(root, config) {
  const dir = path.resolve(root, (config.music && config.music.dir) || 'music');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /\.(mp3|wav|m4a)$/i.test(f)).sort(); } catch (_) { /* none */ }
  return { dir, files, rel: path.relative(root, dir) || '.' };
}

async function mixRun(v, flags, { quiet = false } = {}) {
  const log = logFor(flags.json);
  let track = flags.track;
  let from = '--track';
  if (!track && v.config.music && v.config.music.defaultTrack) { track = v.config.music.defaultTrack; from = 'reelsmith.config.json music.defaultTrack'; }
  if (!track) {
    const t = musicTracks(v.root, v.config);
    throw new UsageError(`no --track given and reelsmith.config.json music.defaultTrack is not set.\n` +
      (t.files.length ? `  tracks in ${t.rel}/: ${t.files.join(', ')}\n  pick one by mood (config/music.md): reelsmith mix ${v.rel} --track=${t.rel}/${t.files[0]}`
        : `  no tracks in ${t.rel}/ yet (bash music/download.sh fetches the defaults)`), 'mix');
  }
  if (!isFile(path.join(v.dir, 'voiceover.mp3'))) throw new CliError(`no voiceover.mp3 in ${v.rel} yet — run reelsmith tts (or reelsmith cut) first`);
  const args = [v.dir, `--track=${track}`, ...(flags.under !== undefined ? [`--under=${flags.under}`] : [])];
  const r = runNode(path.join(TOOLS, 'mix-music.js'), args, { capture: 'stdout' });
  const line = r.stdout.trim().split('\n').filter(Boolean).pop() || '';
  let info = null;
  try { info = JSON.parse(line); } catch (_) { /* not JSON */ }
  if (r.code !== 0 || !info) throw new CliError(`mix failed${r.code ? ` (exit ${r.code})` : ''}${line && !info ? `: ${line}` : ''}`);
  if (flags.json && !quiet) printJson(info);
  else log(`✓ ${info.out}: ${Number(info.durationSec).toFixed(2)}s (${Number(info.voiceSec).toFixed(2)}s voice + ${info.tailSec}s music tail) · ${info.track} (${from}) ${info.underDb} dB under the voice, bed gain ${info.bedGainDb} dB`);
  return info;
}

async function cmdMix({ pos, flags }) {
  await mixRun(videoContext(pos[0], 'mix'), flags);
  return 0;
}

function lintRun(v, flags) {
  const log = logFor(flags.json);
  const html = path.join(v.dir, 'index.html');
  if (!isFile(html)) throw new CliError(`no index.html in ${v.rel} yet (the html-animation skill writes it)`);
  const out = {};
  for (const [key, tool] of [['checkSync', 'check-sync.js'], ['validateSync', 'validate-sync.js']]) {
    const r = runNode(path.join(TOOLS, tool), [html], { capture: true });
    out[key] = { ok: r.code === 0, code: r.code, output: `${r.stdout}${r.stderr}`.trim() };
    if (!flags.json && out[key].output) log(out[key].output);
  }
  out.ok = out.checkSync.ok && out.validateSync.ok;
  if (flags.json) printJson(out);
  else log(out.ok ? `\n✓ lint ok (check-sync + validate-sync)` : `\n✗ lint failed (${['checkSync', 'validateSync'].filter(k => !out[k].ok).map(k => (k === 'checkSync' ? 'check-sync' : 'validate-sync')).join(', ')})`);
  return out;
}

async function cmdLint({ pos, flags }) {
  return lintRun(videoContext(pos[0], 'lint'), flags).ok ? 0 : 1;
}

async function cmdSheet({ pos, flags }) {
  const v = videoContext(pos[0], 'sheet');
  if (!isFile(path.join(v.dir, 'index.html'))) throw new CliError(`no index.html in ${v.rel} yet (the html-animation skill writes it)`);
  return (await runNode(path.join(TOOLS, 'contact-sheet.js'), [v.dir, ...flagArgs(flags, ['stills', 'per-scene', 'cols', 'times', 'out'])])).code;
}

// ── draft / clip / render / approve ──────────────────────────────────────────

const RENDER_PASS = ['fps', 'shards', 'encoder', 'gpu', 'keep-segments', 'duration'];

async function renderRun(v, flags, kind) {
  const html = path.join(v.dir, 'index.html');
  if (!isFile(html)) throw new CliError(`no index.html in ${v.rel} yet (the html-animation skill writes it)`);
  if (!isFile(path.join(v.dir, 'scenes.json')) && flags.duration === undefined) throw new CliError(`no scenes.json in ${v.rel} yet — run reelsmith tts (or reelsmith cut) first`);
  if (flags.encoder !== undefined && !['auto', 'videotoolbox', 'x264'].includes(flags.encoder)) throw new UsageError(`--encoder must be auto, videotoolbox or x264 (got ${flags.encoder})`, kind);
  if (flags.shards !== undefined && !(Number.isInteger(flags.shards) && flags.shards > 0)) throw new UsageError(`--shards must be a positive integer (got ${flags.shards})`, kind);
  if (kind === 'render') {
    const gate = require('../tools/approve-preview').checkApproval(v.dir);
    if (!gate.ok) {
      console.error(`Preview gate: ${gate.reason}.`);
      console.error(`  1. reelsmith draft ${v.rel}  and  reelsmith sheet ${v.rel} --stills`);
      console.error('  2. show the user draft.mp4, the contact sheet and the stills; wait for an explicit "approved"');
      console.error(`  3. reelsmith approve ${v.rel} --by="<who>"   then run reelsmith render ${v.rel} again`);
      return 3;
    }
  }
  const audio = pickAudio(v.dir, flags.audio);
  console.log(`Audio: ${audio.file ? relCwd(audio.file) : '(none)'}  [${audio.how}]`);
  const args = [html];
  if (kind === 'draft' || (kind === 'clip' && flags.draft)) args.push('--draft');
  if (kind === 'clip') args.push(`--from=${flags.from}`, `--to=${flags.to}`);
  if (audio.file) args.push(`--audio=${audio.file}`);
  args.push(...flagArgs(flags, RENDER_PASS));
  return (await runNode(RENDER, args)).code;
}

async function cmdDraft({ pos, flags }) { return renderRun(videoContext(pos[0], 'draft'), flags, 'draft'); }
async function cmdRender({ pos, flags }) { return renderRun(videoContext(pos[0], 'render'), flags, 'render'); }
async function cmdClip({ pos, flags }) {
  if (flags.from === undefined || flags.to === undefined) throw new UsageError('--from=S and --to=S are required (seconds)', 'clip');
  if (!(flags.to > flags.from)) throw new UsageError(`--to must be after --from (got ${flags.from}–${flags.to})`, 'clip');
  return renderRun(videoContext(pos[0], 'clip'), flags, 'clip');
}

async function cmdApprove({ pos, flags }) {
  const v = videoContext(pos[0], 'approve');
  const ap = require('../tools/approve-preview');
  if (flags.check) {
    const r = ap.checkApproval(v.dir);
    if (flags.json) printJson({ ok: r.ok, ...(r.ok ? { approval: r.approval } : { reason: r.reason }) });
    else console.log(r.ok ? `✓ preview approved (${r.approval.by}, ${r.approval.at})` : `✗ ${r.reason}`);
    return r.ok ? 0 : 1;
  }
  if (!flags.by || !String(flags.by).trim()) throw new UsageError('--by=<who approved> is required (only after the user explicitly approved the draft and stills)', 'approve');
  let rec;
  try { rec = ap.approve(v.dir, String(flags.by).trim()); } catch (e) { throw new CliError(`cannot approve ${v.rel}: ${firstLine(e)}`); }
  if (flags.json) printJson({ ...rec, path: relCwd(rec.path) });
  else console.log(`✓ preview approved by ${rec.by} → ${relCwd(rec.path)} (fingerprint v${rec.v}; any later edit needs a new approval)`);
  return 0;
}

// ── plugins / styles ─────────────────────────────────────────────────────────

function table(rows, cols) {
  const widths = cols.map(c => Math.max(c.label.length, ...rows.map(r => String(r[c.key] ?? '').length)));
  const line = r => cols.map((c, i) => (i === cols.length - 1 ? String(r[c.key] ?? '') : String(r[c.key] ?? '').padEnd(widths[i]))).join('  ');
  return [line(Object.fromEntries(cols.map(c => [c.key, c.label]))), ...rows.map(line)].join('\n');
}

async function cmdPlugins({ flags }) {
  const p = cwdProject();
  const reg = registryFor(p.root, p.config);
  const list = reg.list().map(e => ({ ...e, path: path.relative(p.root, e.path).startsWith('..') ? e.path : path.relative(p.root, e.path) }));
  if (flags.json) { printJson(list); return 0; }
  const rows = list.map(e => ({
    name: e.name, kind: e.kind || '?', version: e.version || '-', source: e.source,
    status: !e.ok ? `error: ${e.error}` : e.active ? 'ok' : `overridden by ${path.relative(p.root, e.overriddenBy) || e.overriddenBy}`,
  }));
  console.log(table(rows, [{ key: 'name', label: 'NAME' }, { key: 'kind', label: 'KIND' }, { key: 'version', label: 'VERSION' },
    { key: 'source', label: 'SOURCE' }, { key: 'status', label: 'STATUS' }]));
  const bad = list.filter(e => !e.ok).length;
  console.log(`\n${list.length} plugin${list.length === 1 ? '' : 's'}${bad ? `, ${bad} with errors` : ''} (project ${p.root})`);
  return 0;
}

function styleList(root, config) {
  const reg = registryFor(root, config);
  return reg.list('style').filter(e => e.active && e.ok).map(e => {
    const s = reg.get('style', e.name) || {};
    return { name: e.name, version: e.version, description: e.description, source: e.source, dir: s.dir || null,
      styleFile: s.styleFile || null, kit: Boolean(s.kit), reference: Boolean(s.reference), default: e.name === config.style };
  });
}

async function cmdStyles({ flags }) {
  const p = cwdProject();
  const list = styleList(p.root, p.config);
  if (flags.json) { printJson(list.map(s => ({ ...s, dir: s.dir && relOr(p.root, s.dir), styleFile: s.styleFile && relOr(p.root, s.styleFile) }))); return 0; }
  if (!list.length) { console.log('no style packs found (styles/<name>/STYLE.md)'); return 1; }
  const rows = list.map(s => ({ name: `${s.default ? '* ' : '  '}${s.name}`, version: s.version, source: s.source, kit: s.kit ? 'kit.jsx' : '-',
    description: String(s.description || '').slice(0, 72) }));
  console.log(table(rows, [{ key: 'name', label: '  NAME' }, { key: 'version', label: 'VERSION' }, { key: 'source', label: 'SOURCE' },
    { key: 'kit', label: 'KIT' }, { key: 'description', label: 'DESCRIPTION' }]));
  console.log(`\n* = default (reelsmith.config.json "style"; a video picks its own with style: in script.md). Read styles/<name>/STYLE.md.`);
  if (!list.some(s => s.default)) console.log(`⚠ the configured default style "${p.config.style}" is not installed`);
  return 0;
}

const relOr = (root, p) => { const r = path.relative(root, p); return r.startsWith('..') ? p : r; };

// ── new ──────────────────────────────────────────────────────────────────────

async function cmdNew({ pos, flags }) {
  const name = pos[0];
  if (!name) throw new UsageError('missing <name> (letters, digits, - and _)', 'new');
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new UsageError(`invalid video name "${name}": use letters, digits, - and _ (it becomes videos/${name}/)`, 'new');
  const found = project.findRoot(process.cwd());
  if (!found) throw new CliError('not inside a Reelsmith project (no reelsmith.config.json here or above) — run reelsmith init first');
  const { config } = loadProject(found);
  const style = flags.style || config.style;
  const styles = styleList(found, config).map(s => s.name);
  if (flags.style && !styles.includes(flags.style)) throw new UsageError(`unknown style "${flags.style}" (installed: ${styles.join(', ') || 'none'})`, 'new');
  const dir = path.join(found, config.videosDir || 'videos', name);
  const file = path.join(dir, 'script.md');
  if (isFile(file) && !flags.force) throw new CliError(`${relCwd(file)} already exists (--force overwrites it)`);
  const tplFile = [path.join(found, 'templates', 'video', 'script.md'), path.join(FW, 'templates', 'video', 'script.md')].find(isFile);
  if (!tplFile) throw new CliError('templates/video/script.md is missing from the framework');
  const title = name.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
  const vars = {
    title, topic: 'general', date: new Date().toISOString().slice(0, 10), style: style || 'reflective', name,
    voice: flags.voice ? `tts_voice: ${flags.voice}\n` : '# tts_voice: <ask the creator which voice; there is no default>\n',
  };
  const text = fs.readFileSync(tplFile, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, text);
  if (flags.json) { printJson({ name, dir: relCwd(dir), script: relCwd(file), style: vars.style, voice: flags.voice || null }); return 0; }
  console.log(`✓ ${relCwd(file)} (style ${vars.style}${flags.voice ? `, voice ${flags.voice}` : ''})`);
  console.log('\nNext: research → script → voice (ask the agent: "make a video about <topic>"), or by hand:');
  console.log(`  edit ${relCwd(file)}`);
  console.log(`  reelsmith tts ${name} --voice=<voice>      (or reelsmith record for your own voice)`);
  return 0;
}

// ── doctor ───────────────────────────────────────────────────────────────────

function toolVersion(bin, args, re) {
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
    const m = String(out).match(re);
    return m ? m[1] : String(out).split('\n')[0].trim();
  } catch (e) {
    const m = String((e && (e.stdout || e.stderr)) || '').match(re);
    return m ? m[1] : null;
  }
}

async function doctorChecks() {
  const cwd = process.cwd();
  const mode = project.mode(cwd);
  const root = project.root(cwd);
  const rows = [];
  const add = (group, id, label, status, message, extra = {}) => rows.push({ group, id, label, status, message, required: false, ...extra });

  // System
  const [major] = process.versions.node.split('.').map(Number);
  add('System', 'node', 'node', major >= 22 ? 'ok' : major >= 20 ? 'warn' : 'fail',
    major >= 22 ? `v${process.versions.node} (${process.execPath})` : major >= 20 ? `v${process.versions.node} — works, 22 recommended` : `v${process.versions.node} — Reelsmith needs Node 20 or newer (22 recommended; Playwright requires 20)`,
    { required: true, path: process.execPath, version: process.versions.node });
  const desc = env.describe();
  for (const t of ['ffmpeg', 'ffprobe']) {
    const p = env[t]();
    const d = desc[t] || {};
    if (!p) { add('System', t, t, 'fail', `not found — brew install ffmpeg (macOS) / apt install ffmpeg (Linux), or set ${t === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'}`, { required: true }); continue; }
    const ver = toolVersion(p, ['-hide_banner', '-version'], new RegExp(`${t} version (\\S+)`));
    add('System', t, t, 'ok', `${p}${ver ? ` (${ver})` : ''}${d.via === 'fallback dir' ? ' — not on PATH, found in a fallback dir' : ''}${d.warning ? ` — ${d.warning}` : ''}`, { required: true, path: p, version: ver });
  }
  const py = env.python();
  const pyVer = py ? toolVersion(py, ['--version'], /Python (\S+)/) : null;
  add('System', 'python', 'python', py ? 'ok' : 'warn',
    py ? `${py}${pyVer ? ` (Python ${pyVer})` : ''}${desc.python && desc.python.via ? ` via ${desc.python.via}` : ''}` : 'no python found (optional: needed for word timings and own-voice takes; Python 3.11 recommended, or set REELSMITH_PYTHON)',
    { optional: true, path: py, version: pyVer });
  const wpy = env.pythonWithWhisper({ strict: true });
  add('System', 'whisper', 'openai-whisper', wpy ? 'ok' : 'warn',
    wpy ? `imports in ${wpy}` : `not importable${py ? ` in ${py}` : ''} (optional: needed for word timings and own-voice takes) — ${py || 'python3'} -m pip install openai-whisper`,
    { optional: true, path: wpy });
  let chromium = null, chromiumErr = null;
  try {
    const exe = require('playwright').chromium.executablePath();
    if (exe && fs.existsSync(exe)) chromium = exe; else chromiumErr = 'Chromium is not installed — npx playwright install chromium';
  } catch (e) { chromiumErr = `playwright is not installed (${firstLine(e)}) — npm install`; }
  add('System', 'chromium', 'Playwright Chromium', chromium ? 'ok' : 'fail', chromium || chromiumErr, { required: true, path: chromium });

  // Project + config (loads .env before the key and plugin checks)
  let config = coreConfig.DEFAULTS, configErr = null, configExists = false;
  try { const l = coreConfig.load({ root }); config = l.config; configExists = l.exists; } catch (e) { configErr = firstLine(e); }
  const modeText = { clone: 'clone mode: the framework checkout is the project', package: `package mode: framework at ${FW}`, none: 'no project here — reelsmith init <dir> creates one' }[mode];
  add('Project', 'root', 'project', mode === 'none' ? 'warn' : 'ok', `${root} (${modeText})`, { path: root, mode });
  add('Project', 'config', 'reelsmith.config.json', configErr ? 'fail' : configExists ? 'ok' : 'warn',
    configErr || (configExists ? `valid (default style ${config.style}, tts ${config.tts.provider}, stt ${config.stt.provider})` : 'missing — built-in defaults apply'), { required: Boolean(configErr) });
  const runtime = path.join(root, 'runtime', 'animations.jsx');
  const runtimeLink = (() => { try { return fs.lstatSync(path.join(root, 'runtime')).isSymbolicLink() ? fs.readlinkSync(path.join(root, 'runtime')) : null; } catch (_) { return null; } })();
  add('Project', 'runtime', 'runtime', isFile(runtime) ? 'ok' : 'fail',
    isFile(runtime) ? `runtime/animations.jsx${runtimeLink ? ` (→ ${runtimeLink})` : ''}` : `runtime/animations.jsx is missing${runtimeLink ? ` (the runtime symlink → ${runtimeLink} is dangling: npm install)` : ''} — every index.html loads ../../runtime/animations.jsx; reelsmith init links it`,
    { required: mode !== 'none' });
  let reg = null, regErr = null;
  try { reg = registryFor(root, config); } catch (e) { regErr = firstLine(e); }
  const styles = reg ? reg.list('style').filter(e => e.active && e.ok).map(e => e.name) : [];
  const missingLinks = mode === 'package' ? styles.filter(s => !isFile(path.join(root, 'styles', s, 'STYLE.md'))) : [];
  add('Project', 'styles', 'style packs', !styles.length ? 'fail' : !styles.includes(config.style) || missingLinks.length ? 'warn' : 'ok',
    !styles.length ? (regErr || 'none found') : `${styles.join(', ')} (default ${config.style}${styles.includes(config.style) ? '' : ': NOT INSTALLED'})` +
      (missingLinks.length ? ` — not under styles/ in this project: ${missingLinks.join(', ')} (index.html loads ../../styles/<pack>/kit.jsx; reelsmith init links them)` : ''),
    { required: !styles.length });
  const vdir = path.join(root, config.videosDir || 'videos');
  const videos = isDir(vdir) ? fs.readdirSync(vdir).filter(d => !d.startsWith('.') && isDir(path.join(vdir, d))) : null;
  add('Project', 'videos', `${config.videosDir || 'videos'}/`, videos ? 'ok' : 'warn', videos ? `${videos.length} video${videos.length === 1 ? '' : 's'}` : 'missing — reelsmith new <name> creates it');

  // Keys (.env)
  const envFile = path.join(root, '.env');
  add('Keys', 'env', '.env', isFile(envFile) ? 'ok' : 'warn', isFile(envFile) ? envFile : `no .env in ${root} — cp .env.example .env and add your keys`);
  add('Keys', 'OPENROUTER_API_KEY', 'OPENROUTER_API_KEY', process.env.OPENROUTER_API_KEY ? 'ok' : 'warn',
    process.env.OPENROUTER_API_KEY ? 'set (TTS voices, Jev)' : 'not set — needed to generate TTS voices (not for your own recorded voice, or audio that is already cached)');
  const pubKeys = ['META_SYSTEM_TOKEN', 'META_PAGE_ID', 'META_IG_USER_ID', 'DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID'];
  const setKeys = pubKeys.filter(k => process.env[k]);
  add('Keys', 'publish', 'publish keys', setKeys.length === pubKeys.length ? 'ok' : 'warn',
    `optional (publishing only): ${setKeys.length ? `set ${setKeys.join(', ')}` : 'none set'}${setKeys.length < pubKeys.length ? `; not set ${pubKeys.filter(k => !process.env[k]).join(', ')}` : ''} (YouTube uses an OAuth client file, see publish-youtube below)`,
    { optional: true });

  // Plugins
  if (reg) {
    const providers = new Set([`tts:${config.tts.provider}`, `stt:${config.stt.provider}`]);
    const isProvider = e => e.kind && providers.has(`${e.kind}:${reg.shortName({ name: e.name, kind: e.kind })}`);
    const checks = await reg.checks();
    const entries = reg.list().filter(e => e.active);
    for (const c of checks) {
      const e = entries.find(x => x.name === c.name) || {};
      const optional = c.optional || e.kind === 'publish' || e.kind === 'stt';
      const required = !e.ok && isProvider(e);
      add('Plugins', `plugin:${c.name}`, `${c.name}${c.kind ? ` (${c.kind})` : ''}`, c.ok ? 'ok' : required ? 'fail' : 'warn',
        `${c.message || (c.ok ? 'ok' : 'failed')}${!c.ok && optional ? ' (optional)' : ''}`, { required, optional: !c.ok && optional, kind: c.kind, source: e.source });
    }
  } else add('Plugins', 'plugins', 'plugins', 'fail', regErr || 'the registry failed to load', { required: true });
  return { ok: !rows.some(r => r.status === 'fail' && r.required), version: VERSION, root, mode, frameworkRoot: FW, checks: rows };
}

async function cmdDoctor({ flags }) {
  const report = await doctorChecks();
  if (flags.json) { printJson(report); return report.ok ? 0 : 1; }
  const sym = { ok: '✓', warn: '⚠', fail: '✗' };
  console.log(`Reelsmith doctor  v${report.version}  (${report.root}, ${report.mode} mode)`);
  let group = null;
  const width = Math.max(...report.checks.map(r => r.label.length));
  for (const r of report.checks) {
    if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
    console.log(`  ${sym[r.status] || '·'} ${r.label.padEnd(width)}  ${r.message}`);
  }
  const failed = report.checks.filter(r => r.status === 'fail' && r.required);
  const optional = report.checks.filter(r => r.status !== 'ok' && !r.required);
  console.log('');
  if (failed.length) console.log(`✗ ${failed.length} required check${failed.length === 1 ? '' : 's'} failed: ${failed.map(r => r.label).join(', ')}`);
  else console.log(`✓ all required checks passed${optional.length ? ` (${optional.length} optional item${optional.length === 1 ? '' : 's'} need attention: ${optional.map(r => r.label).join(', ')})` : ''}`);
  return report.ok ? 0 : 1;
}

// ── init ─────────────────────────────────────────────────────────────────────

const TEMPLATE = path.join(FW, 'templates', 'project');
const RENAMES = { gitignore: '.gitignore' };                 // npm never packs a file named .gitignore

function copyTree(src, dest, res, { rename = {}, top = true } = {}) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const from = path.join(src, e.name);
    const to = path.join(dest, (top && rename[e.name]) || e.name);
    if (e.isDirectory()) { fs.mkdirSync(to, { recursive: true }); copyTree(from, to, res, { rename, top: false }); continue; }
    if (fs.existsSync(to)) { res.kept.push(to); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    try { fs.chmodSync(to, fs.statSync(from).mode & 0o777); } catch (_) { /* best effort */ }
    res.created.push(to);
  }
}

/** A relative symlink at `link` → `target` (absolute); copies when the platform can't symlink. */
function linkOrCopy(link, target, res) {
  let st = null;
  try { st = fs.lstatSync(link); } catch (_) { /* absent */ }
  if (st) {
    if (st.isSymbolicLink() && path.resolve(path.dirname(link), fs.readlinkSync(link)) === target) { res.kept.push(link); return 'kept'; }
    res.kept.push(link);
    res.notes.push(`kept the existing ${path.relative(res.dest, link)} (not a link to ${path.relative(res.dest, target)})`);
    return 'kept';
  }
  const rel = path.relative(path.dirname(link), target);
  let isDirTarget = true;
  try { isDirTarget = fs.statSync(target).isDirectory(); } catch (_) { isDirTarget = !path.extname(target); }
  try {
    fs.symlinkSync(rel, link, isDirTarget ? 'dir' : 'file');
    res.links.push(`${path.relative(res.dest, link)} → ${rel}`);
    return 'linked';
  } catch (e) {
    const source = fs.existsSync(target) ? target : path.join(FW, path.relative(path.join(res.dest, 'node_modules', 'reelsmith'), target));
    if (!fs.existsSync(source)) { res.notes.push(`could not link ${path.relative(res.dest, link)} (${e.code || firstLine(e)}) and nothing to copy yet`); return 'failed'; }
    fs.cpSync(source, link, { recursive: true, dereference: true });
    res.notes.push(`symlinks are not available here (${e.code || firstLine(e)}): copied ${path.relative(res.dest, link)} instead — re-copy it after upgrading reelsmith`);
    return 'copied';
  }
}

function npmBin(name) {
  const sibling = path.join(path.dirname(process.execPath), process.platform === 'win32' ? `${name}.cmd` : name);
  return fs.existsSync(sibling) ? sibling : env.resolve(name) || name;
}

function runNpm(args, cwd, { inherit = false } = {}) {
  const childEnv = { ...process.env, PATH: [path.dirname(process.execPath), process.env.PATH || ''].join(path.delimiter) };   // npm's shebang needs node
  const r = spawnSync(npmBin('npm'), args, { cwd, env: childEnv, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', shell: process.platform === 'win32' });
  return { code: r.status === null ? 1 : r.status, out: `${r.stdout || ''}${r.stderr || ''}`, error: r.error };
}

async function cmdInit({ pos, flags }) {
  const dest = path.resolve(pos[0] || '.');
  const fwReal = project.real(FW);
  if (project.isFramework(dest)) {
    console.log(`${dest} is the Reelsmith framework checkout itself (clone mode): it is already a project. Nothing to do.`);
    console.log('To start a separate project: reelsmith init ../my-channel');
    return 0;
  }
  if (within(fwReal, project.real(dest))) throw new CliError(`${dest} is inside the framework checkout (${FW}); pick a folder outside it`);
  const packs = styleList(FW, coreConfig.DEFAULTS).filter(s => s.source === 'builtin style');
  const style = flags.style || 'reflective';
  if (!packs.some(s => s.name === style)) throw new UsageError(`unknown style "${style}" (built-in packs: ${packs.map(s => s.name).join(', ')})`, 'init');
  if (isDir(dest)) {
    const entries = fs.readdirSync(dest).filter(e => !['.git', '.DS_Store'].includes(e));
    if (entries.length && !flags.force) throw new CliError(`${dest} is not empty (${entries.slice(0, 5).join(', ')}${entries.length > 5 ? ', …' : ''}) — use --force to scaffold into it (existing files are kept)`);
  } else if (fs.existsSync(dest)) throw new CliError(`${dest} exists and is not a directory`);
  fs.mkdirSync(dest, { recursive: true });
  const res = { dest, created: [], kept: [], links: [], notes: [] };
  const say = (...a) => console.log(...a);

  // 1. package.json first (npm init -y would lift the template README into "description"), then
  //    templates/project/ (+ placeholders for the two agent docs if the template lacks them)
  const pkgFile = path.join(dest, 'package.json');
  if (!isFile(pkgFile)) {
    const r = runNpm(['init', '-y'], dest);
    if (r.code !== 0 || !isFile(pkgFile)) {
      const name = path.basename(dest).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '') || 'reelsmith-project';
      fs.writeFileSync(pkgFile, JSON.stringify({ name, version: '0.1.0' }, null, 2) + '\n');
      res.notes.push(`npm init -y failed (${firstLine(r.error || r.out) || `exit ${r.code}`}); wrote a minimal package.json`);
    } else {
      const fresh = readJson(pkgFile) || {};                  // npm's placeholders that mean nothing for a video project
      if (fresh.main === 'index.js' && !isFile(path.join(dest, 'index.js'))) delete fresh.main;
      if (fresh.scripts && /no test specified/.test(fresh.scripts.test || '')) delete fresh.scripts.test;
      if (fresh.scripts && !Object.keys(fresh.scripts).length) delete fresh.scripts;
      fs.writeFileSync(pkgFile, JSON.stringify(fresh, null, 2) + '\n');
    }
    res.created.push(pkgFile);
  }
  copyTree(TEMPLATE, dest, res, { rename: RENAMES });
  const placeholders = {
    'CLAUDE.md': '# Agent instructions\n\nThis is a Reelsmith project. Start with `.claude/skills/reelsmith-pipeline/SKILL.md` whenever someone asks for a video.\nRun `npx reelsmith --help` for the commands.\n',
    'README.md': '# My Reelsmith project\n\nShort videos made with Reelsmith: script in, short out.\n\n```bash\ncp .env.example .env\nnpx reelsmith doctor\nnpx reelsmith new my-first-video\n```\n',
  };
  for (const [f, text] of Object.entries(placeholders)) {
    const to = path.join(dest, f);
    if (!fs.existsSync(to)) { fs.writeFileSync(to, text); res.created.push(to); }
  }
  // style in reelsmith.config.json
  const cfgFile = path.join(dest, 'reelsmith.config.json');
  const cfg = readJson(cfgFile);
  if (cfg && res.created.includes(cfgFile)) { cfg.style = style; fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n'); }
  else if (cfg && cfg.style !== style && flags.style) res.notes.push(`kept the existing reelsmith.config.json (style ${cfg.style}); set "style": "${style}" there if you want it`);
  // 2. skills → .claude/skills/, music/download.sh
  const skills = path.join(FW, 'skills');
  if (isDir(skills)) { fs.mkdirSync(path.join(dest, '.claude', 'skills'), { recursive: true }); copyTree(skills, path.join(dest, '.claude', 'skills'), res); }
  const dl = path.join(FW, 'music', 'download.sh');
  if (isFile(dl)) {
    const to = path.join(dest, 'music', 'download.sh');
    if (fs.existsSync(to)) res.kept.push(to);
    else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(dl, to); fs.chmodSync(to, 0o755); res.created.push(to); }
  }

  // 3. the reelsmith dependency
  const pkg = readJson(pkgFile) || {};
  const depSpec = flags.link ? `file:${FW}` : 'github:Aabishkar2/reelsmith';
  pkg.private = pkg.private !== undefined ? pkg.private : true;
  pkg.dependencies = { ...(pkg.dependencies || {}), reelsmith: depSpec };
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  const nm = path.join(dest, 'node_modules', 'reelsmith');
  if (flags.link) {
    // --link: node_modules/reelsmith → this framework checkout, exactly what `npm install` makes of a
    // file: dependency, but offline and without touching npm's global prefix (no `npm link`).
    fs.mkdirSync(path.dirname(nm), { recursive: true });
    let st = null;
    try { st = fs.lstatSync(nm); } catch (_) { /* absent */ }
    if (!st) { fs.symlinkSync(FW, nm, 'dir'); res.links.push(`node_modules/reelsmith → ${FW}`); }
    else res.kept.push(nm);
    const bin = path.join(dest, 'node_modules', '.bin', 'reelsmith');
    if (!fs.existsSync(bin)) {
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      try { fs.symlinkSync(path.join('..', 'reelsmith', 'bin', 'reelsmith.js'), bin, 'file'); res.links.push('node_modules/.bin/reelsmith → ../reelsmith/bin/reelsmith.js'); } catch (_) { /* npx falls back to npm install */ }
    }
  }

  // 4. install (npm install, Playwright's Chromium) unless --no-install
  let installFailed = false;
  if (!flags['no-install']) {
    say(`→ npm install (reelsmith ${depSpec})`);
    const r = runNpm(['install', '--no-fund', '--no-audit'], dest, { inherit: true });
    if (r.code !== 0) { installFailed = true; res.notes.push(`npm install failed (exit ${r.code}) — fix it and run npm install in ${dest}`); }
    let cli = null;
    for (const base of [nm, FW]) { try { cli = path.join(path.dirname(require.resolve('playwright/package.json', { paths: [base] })), 'cli.js'); break; } catch (_) { /* next */ } }
    say('→ playwright install chromium');
    const pw = cli ? spawnSync(process.execPath, [cli, 'install', 'chromium'], { cwd: dest, stdio: 'inherit' })
      : spawnSync(npmBin('npx'), ['--yes', 'playwright', 'install', 'chromium'], { cwd: dest, stdio: 'inherit', env: { ...process.env, PATH: [path.dirname(process.execPath), process.env.PATH || ''].join(path.delimiter) } });
    if (pw.status !== 0) { installFailed = true; res.notes.push('playwright install chromium failed — run: npx playwright install chromium'); }
  }

  // 5. runtime + styles: relative symlinks into node_modules/reelsmith, so ../../runtime/animations.jsx
  //    and ../../styles/<pack>/kit.jsx resolve from videos/<name>/index.html. styles/ itself is a real
  //    folder (your own packs live beside the linked built-ins).
  const pkgRoot = path.join(dest, 'node_modules', 'reelsmith');
  linkOrCopy(path.join(dest, 'runtime'), path.join(pkgRoot, 'runtime'), res);
  fs.mkdirSync(path.join(dest, 'styles'), { recursive: true });
  const fwStyles = path.join(FW, 'styles');
  const styleEntries = isDir(fwStyles) ? fs.readdirSync(fwStyles).filter(e => (isDir(path.join(fwStyles, e)) && isFile(path.join(fwStyles, e, 'STYLE.md'))) || /\.md$/i.test(e)).sort() : [];
  for (const e of styleEntries) linkOrCopy(path.join(dest, 'styles', e), path.join(pkgRoot, 'styles', e), res);
  const gi = path.join(dest, '.gitignore');
  if (isFile(gi)) {
    const text = fs.readFileSync(gi, 'utf8');
    const want = ['/runtime', ...styleEntries.map(e => `/styles/${e}`)].filter(l => !text.split(/\r?\n/).includes(l));
    if (want.length) fs.appendFileSync(gi, `${text.endsWith('\n') ? '' : '\n'}${want.join('\n')}\n`);
  }

  // 6. report
  say(`\n✓ Reelsmith project in ${dest}  (style ${style}; reelsmith ${depSpec})`);
  say(`  created ${res.created.length} files${res.kept.length ? `, kept ${res.kept.length} existing` : ''}; links: ${res.links.length ? res.links.join(', ') : 'none'}`);
  for (const n of res.notes) say(`  ! ${n}`);
  if (!isDir(pkgRoot)) say(`  ! node_modules/reelsmith is not installed yet, so runtime/ and styles/<pack> point nowhere until you run npm install`);
  const cdTo = pos[0] && pos[0] !== '.' ? pos[0] : null;       // as typed (a realpath'd cwd makes relative paths odd)
  say('\nNext steps:');
  if (cdTo) say(`  cd ${/\s/.test(cdTo) ? JSON.stringify(cdTo) : cdTo}`);
  if (flags['no-install'] && !flags.link) say('  npm install && npx playwright install chromium');
  else if (flags['no-install']) say('  npx playwright install chromium        (once per machine, if doctor says Chromium is missing)');
  say('  cp .env.example .env                   # OPENROUTER_API_KEY for TTS voices; publish tokens later');
  say('  npx reelsmith doctor                   # what is missing on this machine');
  say('  npx reelsmith new my-first-video       # videos/my-first-video/script.md');
  say('  then open the folder in Claude Code and say "make me a video about <topic>"');
  return installFailed ? 1 : 0;
}

// ── publish ──────────────────────────────────────────────────────────────────

async function cmdPublish({ pos, flags }) {
  const v = videoContext(pos[0], 'publish');
  const log = logFor(flags.json);
  if (flags.notes) {
    const notes = require('./publishNotes');
    const title = (() => { try { return require('../pipeline/script').load(v.dir).meta.title || ''; } catch (_) { return ''; } })();
    const r = notes.writeSkeleton(v.dir, { force: Boolean(flags.force), title: String(title || '') });
    if (flags.json) printJson({ path: relCwd(r.path), written: r.written });
    else log(r.written ? `✓ ${relCwd(r.path)} (skeleton: title from script.md, empty description / hashtags / tags) — fill it in, then get it approved`
      : `${relCwd(r.path)} already exists — edit it (--force resets it to the skeleton)`);
    return 0;
  }
  if (flags.privacy !== undefined && !PRIVACIES.includes(flags.privacy)) throw new UsageError(`--privacy must be one of ${PRIVACIES.join(', ')} (got ${flags.privacy})`, 'publish');
  const reg = registryFor(v.root, v.config);
  const loaded = reg.list('publish').filter(e => e.ok && e.active).map(e => reg.shortName({ name: e.name, kind: 'publish' }));
  const targets = String(flags.to || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!targets.length) {
    const configured = Object.keys((v.config.publish && v.config.publish.targets) || {});
    throw new UsageError(`--to=<target>[,<target>] is required (publish plugins: ${loaded.join(', ') || 'none'}${configured.length ? `; configured targets: ${configured.join(', ')}` : ''})`, 'publish');
  }
  const ctxBase = {
    root: v.root, config: v.config, env: process.env, log, paths: env.paths(),
  };
  const results = [];
  for (const t of targets) {
    let plugin;
    try { plugin = reg.resolve('publish', t); } catch (e) { results.push({ ok: false, target: t, error: firstLine(e) }); log(`✗ ${t}: ${firstLine(e)}`); continue; }
    const targetConfig = ((v.config.publish && v.config.publish.targets) || {})[t] || {};
    if (flags.auth) {
      if (typeof plugin.auth !== 'function') { results.push({ ok: false, target: t, error: `${plugin.name} has no auth step (its credentials come from .env — see reelsmith doctor)` }); log(`✗ ${t}: ${plugin.name} has no auth step (its credentials come from .env)`); continue; }
      try {
        const r = (await plugin.auth({ ...ctxBase, targetConfig, check: Boolean(flags.check) })) || { ok: true };
        results.push({ target: t, ...r, ok: r.ok !== false });
        log(`${r.ok === false ? '✗' : '✓'} ${t}: ${r.message || (r.ok === false ? 'auth failed' : 'authorized')}`);
      } catch (e) { results.push({ ok: false, target: t, error: firstLine(e) }); log(`✗ ${t}: ${firstLine(e)}`); }
      continue;
    }
    let script = null, scenes = null;
    try { script = require('../pipeline/script').load(v.dir); } catch (_) { /* optional */ }
    scenes = readJson(path.join(v.dir, 'scenes.json'));
    const args = {
      ...ctxBase, targetConfig,
      video: { name: v.name, dir: v.dir, script, scenes },
      dryRun: Boolean(flags['dry-run']), force: Boolean(flags.force),
      privacy: flags.privacy, file: flags.file, publicUrl: flags['public-url'], channel: flags.channel,
    };
    try {
      const r = (await plugin.publish(args)) || {};
      const out = { target: t, ...r, ok: r.ok !== false };
      results.push(out);
      const what = out.skipped ? `skipped: ${out.skipped}` : out.refused ? `refused: ${out.refused}` : out.dryRun ? 'dry run ok (nothing sent)'
        : out.url || out.id ? `published ${out.url || out.id}` : 'done';
      log(`${out.ok ? '✓' : '✗'} ${t}: ${out.ok ? what : (out.error || out.refused || (out.problems || []).join('; ') || 'failed')}`);
    } catch (e) { results.push({ ok: false, target: t, error: firstLine(e) }); log(`✗ ${t}: ${firstLine(e)}`); }
  }
  if (flags.json) printJson(results.map(r => { const { request, ...rest } = r; return request !== undefined ? { ...rest, request } : rest; }));
  return results.every(r => r.ok) ? 0 : 1;
}

// ── run ──────────────────────────────────────────────────────────────────────

async function cmdRun({ pos, flags }) {
  const until = flags.until || 'draft';
  if (!RUN_STEPS.includes(until)) throw new UsageError(`--until must be one of ${RUN_STEPS.join(', ')} (got ${until})`, 'run');
  const v = videoContext(pos[0], 'run');
  const stop = RUN_STEPS.indexOf(until);
  const step = (i, name, note = '') => console.log(`\n── ${i + 1}/${stop + 1} ${name}${note ? `  ${note}` : ''}`);
  // 1. tts (skipped for an own-voice video: a take.json and no TTS meta)
  const ownVoice = isFile(path.join(v.dir, 'take.json')) && !isFile(path.join(v.dir, 'voiceover', 'tts', 'meta.json'));
  if (ownVoice) step(0, 'tts', '(skipped: own-voice video with take.json; reelsmith cut makes its voice)');
  else { step(0, 'tts'); await ttsRun(v, { voice: flags.voice }); }
  if (stop === 0) return 0;
  // 2. mix (the configured default track, else the track this video was mixed with before; none → skip)
  const prev = readJson(path.join(v.dir, 'voiceover-mix.json'));
  const track = (v.config.music && v.config.music.defaultTrack) || (prev && prev.track) || null;
  if (!track) step(1, 'mix', '(skipped: no --track configured — set music.defaultTrack or run reelsmith mix once)');
  else { step(1, 'mix'); await mixRun(v, { track, ...(prev && !(v.config.music && v.config.music.defaultTrack) && prev.underDb !== undefined ? { under: prev.underDb } : {}) }); }
  if (stop === 1) return 0;
  // 3. lint
  step(2, 'lint');
  if (!lintRun(v, {}).ok) { console.log('\nStopped: fix the lint errors, then run it again.'); return 1; }
  if (stop === 2) return 0;
  // 4. sheet (+ stills: what the human reviews at the preview gate)
  step(3, 'sheet', '--stills');
  const s = (await runNode(path.join(TOOLS, 'contact-sheet.js'), [v.dir, '--stills'])).code;
  if (s !== 0) return s;
  if (stop === 3) return 0;
  // 5. draft
  step(4, 'draft');
  const d = await renderRun(v, {}, 'draft');
  if (d === 0) console.log(`\nNext: show the user ${v.rel}/draft.mp4, frames/contact-sheet.png and frames/stills/. Only after an explicit "approved": reelsmith approve ${v.rel} --by="<who>", then reelsmith render ${v.rel}.`);
  return d;
}

// ── command table + help ─────────────────────────────────────────────────────

const F = {
  json: { type: 'boolean', desc: 'print the result as JSON on stdout (logs go to stderr)' },
  help: { type: 'boolean', desc: 'show this help' },
};
const RF = {
  fps: { type: 'number', value: 'N', desc: 'frames per second (final 30, draft 15)' },
  shards: { type: 'number', value: 'N', desc: 'parallel browser shards (default: auto, ≤ cores − 1)' },
  encoder: { type: 'string', value: 'auto|videotoolbox|x264', desc: 'H.264 encoder (auto: VideoToolbox on macOS)' },
  gpu: { type: 'boolean', desc: 'full Chromium with GPU raster (faster; pixels differ slightly)' },
  'keep-segments': { type: 'boolean', desc: 'keep the segment cache after a successful render' },
  duration: { type: 'number', value: 'S', desc: 'override the length (default Σ scenes.json dur, or the music tail)' },
  audio: { type: 'string', value: 'file', desc: 'audio to mux (default: voiceover-mix.mp3, else voiceover.mp3)' },
};

const COMMANDS = {
  init: {
    group: 'Project', usage: '[dir] [--link] [--style=<pack>] [--no-install] [--force]', max: 1, run: cmdInit,
    summary: 'scaffold a new project',
    about: 'Copies templates/project/ into <dir> (default: the current folder): reelsmith.config.json, .env.example, .gitignore, CLAUDE.md, README.md, config/ (audio, music, voice/performance, fillers, strategy), videos/, music/CREDITS.md + download.sh, plugins/, and the skills into .claude/skills/. Adds the reelsmith dependency to package.json (npm init -y first if there is none), runs npm install and installs Playwright\'s Chromium, then links runtime → node_modules/reelsmith/runtime and styles/<pack> → node_modules/reelsmith/styles/<pack> (relative symlinks; copies where symlinks are not available). Refuses a non-empty folder without --force. Inside the framework checkout itself (clone mode) it does nothing.',
    flags: {
      link: { type: 'boolean', desc: 'use this framework checkout: "reelsmith": "file:<path>" and node_modules/reelsmith → <path> (offline; no npm link)' },
      style: { type: 'string', value: 'reflective|tech-news|motion', desc: 'default style pack (default reflective)' },
      'no-install': { type: 'boolean', desc: 'skip npm install and the Chromium download' },
      force: { type: 'boolean', desc: 'scaffold into a non-empty folder (existing files are kept)' },
    },
    wraps: 'templates/project/', examples: ['reelsmith init my-channel', 'reelsmith init my-channel --style=motion', 'node ~/reelsmith/bin/reelsmith.js init /tmp/demo --link --no-install'],
  },
  doctor: {
    group: 'Project', usage: '[--json]', max: 0, run: cmdDoctor, json: true,
    summary: 'check node, ffmpeg, python + whisper, Chromium, keys, plugins',
    about: 'Checks node (≥ 20, 22 recommended), ffmpeg + ffprobe, python and openai-whisper (optional: word timings and own-voice takes), Playwright\'s Chromium, the project (root, mode, reelsmith.config.json, runtime, style packs, videos/), the keys in .env and every plugin\'s check(). ✓ ok · ⚠ needs attention (optional items say so) · ✗ required and failing. Exits 1 only when a required item fails.',
    flags: {}, wraps: 'core/env.js, core/plugins.js',
  },
  new: {
    group: 'Project', usage: '<name> [--style=<pack>] [--voice=<v>] [--force]', min: 1, max: 1, run: cmdNew, json: true,
    summary: 'create videos/<name>/script.md from the template',
    about: 'Writes videos/<name>/script.md from templates/video/script.md (a project may override it with its own templates/video/script.md): frontmatter (title from the name, today\'s date, style, tts_voice when --voice is given), three scene blocks, ## Voice direction and ## Scene Hints. Refuses to overwrite without --force.',
    flags: {
      style: { type: 'string', value: 'pack', desc: 'style pack (default: reelsmith.config.json "style")' },
      voice: { type: 'string', value: 'name', desc: 'TTS voice the creator picked (written as tts_voice:)' },
      force: { type: 'boolean', desc: 'overwrite an existing script.md' },
    },
    wraps: 'templates/video/script.md', examples: ['reelsmith new why-rust --style=motion --voice=Leda'],
  },
  tts: {
    group: 'Voice', usage: '<video> --voice=<name> [--mode=sentence|performance] [--model=…] [--speed=…] [--force] [--offline]', min: 1, max: 1, run: cmdTts, json: true,
    summary: 'script → voice + word timings → scenes.json',
    about: 'Voices script.md with the tts plugin (default tts-openrouter) and times every word with the stt plugin (default stt-whisper), writing voiceover/sN.mp3, voiceover.mp3 and scenes.json. sentence mode: one call per line, cached per line. performance mode: the whole script in one call directed by config/voice/performance.md; the audio is cached and reused (no API call) while the transcript and context are unchanged. There is no default voice: ask the creator. Precedence per setting: flag > script.md frontmatter > the voice this video used last > env > reelsmith.config.json > defaults.',
    flags: {
      voice: { type: 'string', value: 'name', desc: 'TTS voice (no default: ask the creator)' },
      mode: { type: 'string', value: 'sentence|performance', desc: 'one call per line (default) or the whole script in one call' },
      provider: { type: 'string', value: 'id', desc: 'tts provider (default reelsmith.config.json tts.provider = openrouter)' },
      model: { type: 'string', value: 'id', desc: 'TTS model (default google/gemini-3.8-flash-tts)' },
      speed: { type: 'number', value: 'x', desc: 'tempo, 0.5–2 (default 1.15; applied locally, never re-calls the API)' },
      timings: { type: 'string', value: 'auto|whisper|estimate', desc: 'sentence mode word timings (default auto)' },
      'whisper-model': { type: 'string', value: 'name', desc: 'whisper model (default turbo)' },
      cta: { type: 'number', value: 'S', desc: 'append a silent end-card scene of S seconds' },
      force: { type: 'boolean', desc: 're-voice even when cached audio exists' },
      offline: { type: 'boolean', desc: 'performance mode: never call the TTS API (fails if the audio is not cached)' },
    },
    wraps: 'pipeline/tts.js, pipeline/performance.js (tts + stt plugins)', examples: ['reelsmith tts my-video --voice=Leda', 'reelsmith tts my-video --voice=Leda --mode=performance'],
  },
  record: {
    group: 'Voice', usage: '[--port=N]', max: 0, run: cmdRecord,
    summary: 'start the teleprompter app (own voice)',
    about: 'Starts the local teleprompter / recorder / take-review app for the project around the current folder (default http://localhost:4310; APP_PORT or reelsmith.config.json app.port). Ctrl+C stops it.',
    flags: { port: { type: 'number', value: 'N', desc: 'port (default reelsmith.config.json app.port, 4310)' } }, wraps: 'app/server.js',
  },
  analyze: {
    group: 'Voice', usage: '<video> [--take=takes/take-01] [--no-jev] [--whisper-model=…] [--force-whisper]', min: 1, max: 1, run: cmdAnalyze, json: true,
    summary: 'recorded take → take.json',
    flags: {
      take: { type: 'string', value: 'takes/take-NN', desc: 'which take (default: the newest)' },
      'no-jev': { type: 'boolean', desc: 'rules only, no Jev AI filler decisions' },
      'whisper-model': { type: 'string', value: 'name', desc: 'whisper model (default turbo)' },
      'force-whisper': { type: 'boolean', desc: 'ignore the cached transcript' },
    },
    wraps: 'pipeline/analyze.js',
  },
  rerecord: {
    group: 'Voice', usage: '<video> --sentence=<id> --clip=takes/rr-<id>-N [--no-jev] [--whisper-model=…]', min: 1, max: 1, run: cmdRerecord, json: true, aliases: ['splice'],
    summary: 'splice a re-recorded line into the take',
    about: 'Checks a re-recorded clip of one sentence against the script and splices it into take.json when it is better. A rejected clip leaves the take unchanged and exits 1.',
    flags: {
      sentence: { type: 'string', value: 's<scene>.<line>', desc: 'the sentence id (required)' },
      clip: { type: 'string', value: 'takes/rr-…', desc: 'the clip base path (required)' },
      'no-jev': { type: 'boolean', desc: 'rules only' },
      'whisper-model': { type: 'string', value: 'name', desc: 'whisper model' },
      'force-whisper': { type: 'boolean', desc: 'ignore cached transcripts' },
    },
    wraps: 'pipeline/splice.js',
  },
  cut: {
    group: 'Voice', usage: '<video>', min: 1, max: 1, run: cmdCut, json: true, aliases: ['finalize'],
    summary: 'finalize the take → scenes.json + voiceover.mp3', flags: {}, wraps: 'pipeline/cut.js',
  },
  status: {
    group: 'Voice', usage: '<video>', min: 1, max: 1, run: cmdStatus, json: true,
    summary: 'print the take.json summary', flags: {}, wraps: 'take.json',
  },
  mix: {
    group: 'Voice', usage: '<video> [--track=music/<file>.mp3] [--under=6]', min: 1, max: 1, run: cmdMix, json: true,
    summary: 'music bed → voiceover-mix.mp3',
    about: 'Lays a music bed under voiceover.mp3: the voice loudnormed to −16 LUFS, the track measured and set --under dB below it (default 6), a gentle duck, fades and a 2.5 s tail. Writes voiceover-mix.mp3 and voiceover-mix.json; draft and render pick it up by themselves. Without --track: reelsmith.config.json music.defaultTrack, else an error listing the tracks in music/ (mp3, wav, m4a). Pick the track by mood (config/music.md).',
    flags: {
      track: { type: 'string', value: 'music/<file>.mp3', desc: 'the music track (default music.defaultTrack)' },
      under: { type: 'number', value: 'dB', desc: 'bed level under the voice (default 6; 4 only when the creator asks)' },
    },
    wraps: 'tools/mix-music.js',
  },
  lint: {
    group: 'Picture', usage: '<video>', min: 1, max: 1, run: cmdLint, json: true,
    summary: 'check-sync + validate-sync; non-zero exit on failure',
    about: 'Runs both linters on index.html: hand-picked delays and wall-clock nondeterminism (check-sync), useWordCue phrases against scenes.json, fade() on text and SubtitleRail presence (validate-sync). Exits 1 if either fails.',
    flags: {}, wraps: 'tools/check-sync.js, tools/validate-sync.js',
  },
  sheet: {
    group: 'Picture', usage: '<video> [--stills] [--per-scene=3] [--cols=4] [--times=a,b]', min: 1, max: 1, run: cmdSheet,
    summary: 'contact sheet → frames/contact-sheet.png',
    flags: {
      stills: { type: 'boolean', desc: 'also write full-size frames/stills/*.jpg (what the human reviews)' },
      'per-scene': { type: 'number', value: 'N', desc: 'frames per scene (default 3)' },
      cols: { type: 'number', value: 'N', desc: 'grid columns (default 4)' },
      times: { type: 'string', value: 'a,b,c', desc: 'extra frame times in seconds' },
      out: { type: 'string', value: 'file.png', desc: 'output path' },
    },
    wraps: 'tools/contact-sheet.js',
  },
  preview: {
    group: 'Picture', usage: '<video> [--lan] [--port=N] [--no-open]', min: 1, max: 1, run: cmdPreview,
    summary: 'live browser playback with the voice',
    flags: {
      lan: { type: 'boolean', desc: 'listen on the LAN and print a /qr link for a phone' },
      port: { type: 'number', value: 'N', desc: 'port (default 3000, else a free one)' },
      'no-open': { type: 'boolean', desc: 'do not open a browser' },
    },
    wraps: 'tools/preview.js',
  },
  draft: {
    group: 'Picture', usage: '<video> [--audio=…]', min: 1, max: 1, run: cmdDraft,
    summary: 'fast low-res render → draft.mp4 (no gate)',
    about: 'Renders at 15 fps and 0.75× size for review. Audio: --audio, else voiceover-mix.mp3, else voiceover.mp3 (printed). A music tail runs to the end of the mix on the closing frame.',
    flags: { ...RF }, wraps: 'renderer/render.js --draft',
  },
  clip: {
    group: 'Picture', usage: '<video> --from=S --to=S [--draft] [--audio=…]', min: 1, max: 1, run: cmdClip,
    summary: 'render one range → clip-<S>s-<S>s.mp4 (no gate)',
    flags: {
      from: { type: 'number', value: 'S', desc: 'start (seconds, required)' },
      to: { type: 'number', value: 'S', desc: 'end (seconds, required)' },
      draft: { type: 'boolean', desc: 'draft quality' },
      ...RF,
    },
    wraps: 'renderer/render.js --from --to',
  },
  approve: {
    group: 'Picture', usage: '<video> --by=<who> [--check]', min: 1, max: 1, run: cmdApprove, json: true,
    summary: 'record the preview approval fingerprint',
    about: 'Run ONLY after the user explicitly approved the draft, the contact sheet and the stills. Writes preview-approved.json with a fingerprint of index.html, scenes.json, the runtime, every local script index.html loads (style kits) and the images; any later edit invalidates it. --check exits 0 when the approval is current, 1 when not.',
    flags: {
      by: { type: 'string', value: 'who', desc: 'who approved (required)' },
      check: { type: 'boolean', desc: 'only check the current approval' },
    },
    wraps: 'tools/approve-preview.js',
  },
  render: {
    group: 'Picture', usage: '<video> [--fps=30] [--shards=N] [--encoder=auto|videotoolbox|x264] [--audio=…]', min: 1, max: 1, run: cmdRender,
    summary: 'final render → output.mp4 (gate enforced, exit 3)',
    about: 'Renders 720×1280 at 30 fps. Refuses (exit 3) without a current preview approval (reelsmith approve). Audio: --audio, else voiceover-mix.mp3, else voiceover.mp3 (printed).',
    flags: { ...RF }, wraps: 'renderer/render.js',
  },
  publish: {
    group: 'Ship', usage: '<video> --to=<target>[,<target>] [--dry-run] [--force] [--privacy=…] [--file=…] [--public-url=…] [--channel=…] | --notes | --auth', min: 1, max: 1, run: cmdPublish, json: true,
    summary: 'run publish plugins; --notes only writes the publish.md skeleton',
    about: 'For each --to target, resolves the publish plugin (publish-<target>) and calls its publish(): metadata from publish.md, results in publish/<target>.json, a second upload refused without --force. --dry-run does everything except the network write and prints what would be sent. Always dry-run first, and post only when the user says so. --notes writes publish.md (title from script.md, empty sections) and exits. --auth runs the plugin\'s sign-in step (e.g. YouTube OAuth). Privacy (YouTube): --privacy, else publish.md privacy:, else private.',
    flags: {
      to: { type: 'string', value: 'youtube,meta,discord', desc: 'comma-separated targets' },
      'dry-run': { type: 'boolean', desc: 'build and print the request, send nothing' },
      force: { type: 'boolean', desc: 'publish again although publish/<target>.json has an id (with --notes: reset publish.md)' },
      privacy: { type: 'string', value: 'private|unlisted|public', desc: 'YouTube privacy (default: publish.md privacy:, else private)' },
      file: { type: 'string', value: 'file.mp4', desc: 'the video file (default output.mp4)' },
      'public-url': { type: 'string', value: 'url', desc: 'a public URL of the mp4 (Instagram needs one)' },
      channel: { type: 'string', value: 'id', desc: 'Discord channel id (default DISCORD_CHANNEL_ID)' },
      notes: { type: 'boolean', desc: 'write the publish.md skeleton and exit' },
      auth: { type: 'boolean', desc: 'run the target plugin\'s auth() (sign-in) and exit' },
      check: { type: 'boolean', desc: 'with --auth: only verify the stored credentials' },
    },
    wraps: 'plugins/publish-*, core/publishNotes.js',
    examples: ['reelsmith publish my-video --notes', 'reelsmith publish my-video --to=youtube,discord --dry-run', 'reelsmith publish my-video --to=youtube --auth'],
  },
  plugins: {
    group: 'Project', usage: '[--json]', max: 0, run: cmdPlugins, json: true,
    summary: 'list loaded plugins with kind, version, source, status',
    about: 'Built-ins (plugins/, styles/), then the project\'s plugins/ and styles/, then reelsmith.config.json "plugins"; a later plugin with the same name overrides an earlier one. A broken plugin is listed with its error.',
    flags: {}, wraps: 'core/plugins.js',
  },
  styles: {
    group: 'Project', usage: '[--json]', max: 0, run: cmdStyles, json: true,
    summary: 'list style packs', flags: {}, wraps: 'styles/<name>/STYLE.md',
  },
  run: {
    group: 'Ship', usage: '<video> [--voice=…] [--until=tts|mix|lint|sheet|draft]', min: 1, max: 1, run: cmdRun,
    summary: 'tts → mix → lint → sheet → draft; never approves or renders',
    about: 'Convenience for the mechanical middle of the pipeline. tts is skipped for an own-voice video (take.json); mix uses music.defaultTrack, else the track the video was mixed with before, else it is skipped; sheet writes the stills too. Stops at the first failing step, or after --until.',
    flags: {
      voice: { type: 'string', value: 'name', desc: 'TTS voice (as for reelsmith tts)' },
      until: { type: 'string', value: 'tts|mix|lint|sheet|draft', desc: 'last step to run (default draft)' },
    },
    wraps: 'the commands above',
  },
  jev: { hidden: true, usage: '', max: 0, run: cmdJev, summary: 'verify the Jev model slug on OpenRouter', flags: {} },
};

const ALIASES = {};
for (const [name, c] of Object.entries(COMMANDS)) for (const a of c.aliases || []) ALIASES[a] = name;

function flagSpec(cmdName) {
  const c = COMMANDS[cmdName];
  return { ...c.flags, help: F.help, ...(c.json ? { json: F.json } : {}) };
}

function commandHelp(name) {
  const c = COMMANDS[name];
  const spec = flagSpec(name);
  const lines = [`Usage: reelsmith ${name}${c.usage ? ` ${c.usage}` : ''}`, '', c.summary.replace(/^./, s => s.toUpperCase()) + '.'];
  if (c.about) lines.push('', ...wrap(c.about, 92));
  lines.push('', 'Options:');
  const shown = Object.entries(spec).map(([k, d]) => [k === 'help' ? '-h, --help' : `--${k}${d.type === 'boolean' ? '' : `=<${d.value || 'value'}>`}`, d.desc || '']);
  const w = Math.min(34, Math.max(...shown.map(s => s[0].length)));
  for (const [f, d] of shown) lines.push(`  ${f.padEnd(w)}  ${d}`);
  if (/<video>/.test(c.usage || '')) lines.push('', '<video> is videos/<name>, <name> or a path.');
  if (c.aliases) lines.push(`Alias: ${c.aliases.join(', ')}`);
  if (c.wraps) lines.push(`Wraps: ${c.wraps}`);
  if (c.examples) lines.push('', 'Examples:', ...c.examples.map(e => `  ${e}`));
  return lines.join('\n');
}

function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && (line + ' ' + word).length > width) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

function mainHelp() {
  const groups = {};
  for (const [name, c] of Object.entries(COMMANDS)) if (!c.hidden) (groups[c.group] = groups[c.group] || []).push([name, c]);
  const lines = [`reelsmith ${VERSION} — script in, short out.`, '', 'Usage: reelsmith <command> [options]      reelsmith <command> --help for details'];
  for (const [g, cmds] of Object.entries(groups)) {
    lines.push('', g);
    for (const [name, c] of cmds) {
      const arg = (c.usage || '').match(/^(<[^>]+>|\[dir\])/);
      lines.push(`  ${`${name}${arg ? ` ${arg[1]}` : ''}`.padEnd(18)} ${c.summary}`);
    }
  }
  lines.push('', '<video> is videos/<name>, <name> or a path. Commands work from any folder inside the project.',
    'Exit codes: 0 ok · 1 error · 2 usage · 3 gate refused (render without a current approval).');
  return lines.join('\n');
}

// ── main ─────────────────────────────────────────────────────────────────────

const LEGACY = new Set(['analyze', 'rerecord', 'splice', 'cut', 'finalize', 'status', 'tts', 'jev']);

/** → exit code. opts.legacy: the pipeline/cli.js alias (only its old commands; its old exit 2 for a rejected clip). */
async function main(argv = process.argv.slice(2), opts = {}) {
  const [first, ...rest] = argv;
  const prog = opts.legacy ? 'node pipeline/cli.js' : 'reelsmith';
  if (!opts.legacy && (first === undefined || first === '--help' || first === '-h' || first === 'help')) {
    if (first === 'help' && rest[0]) {
      const n = ALIASES[rest[0]] || rest[0];
      if (!COMMANDS[n]) { console.error(`reelsmith: unknown command "${rest[0]}" (reelsmith --help lists them)`); return 2; }
      console.log(commandHelp(n));
      return 0;
    }
    console.log(mainHelp());
    return 0;
  }
  if (!opts.legacy && (first === '--version' || first === '-v' || first === 'version')) { console.log(VERSION); return 0; }
  const name = ALIASES[first] || first;
  const cmd = COMMANDS[name];
  if (!cmd || (opts.legacy && !LEGACY.has(first))) {
    console.error(`${prog}: unknown command "${first}"${opts.legacy ? ' (usage: node pipeline/cli.js analyze|rerecord|cut|tts|status videos/<name> [--flags]; or use `reelsmith <command>`)' : ' (reelsmith --help lists the commands)'}`);
    return 2;
  }
  let parsed;
  try {
    parsed = parseArgs(rest, flagSpec(name), name);
    if (parsed.flags.help) { console.log(commandHelp(name)); return 0; }
    if (cmd.min && parsed.pos.length < cmd.min) throw new UsageError(`missing ${(cmd.usage || '').split(' ')[0]}`, name);
    if (cmd.max !== undefined && parsed.pos.length > cmd.max) throw new UsageError(`unexpected argument${parsed.pos.length - cmd.max > 1 ? 's' : ''}: ${parsed.pos.slice(cmd.max).join(' ')}`, name);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`${prog} ${name}: ${e.message}\nUsage: reelsmith ${name} ${cmd.usage || ''}   (reelsmith ${name} --help)`);
    return 2;
  }
  try {
    env.ensureOnPath();
    if (name !== 'init') {                                   // load the project's .env (init has no project yet)
      try { coreConfig.loadEnv(project.root(process.cwd())); } catch (_) { /* commands report config errors themselves */ }
    }
    const code = await cmd.run(parsed, opts);
    return typeof code === 'number' ? code : 0;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${prog} ${e.cmd || name}: ${e.message}\n(reelsmith ${e.cmd || name} --help)`);
      return 2;
    }
    console.error(`error: ${e instanceof CliError ? e.message : (process.env.REELSMITH_DEBUG ? e.stack : e.message)}`);
    return e.exitCode || 1;
  }
}

module.exports = { main, parseArgs, statusTable, pickAudio, doctorChecks, commandHelp, mainHelp, COMMANDS, ALIASES, RUN_STEPS, UsageError, CliError, VERSION };
