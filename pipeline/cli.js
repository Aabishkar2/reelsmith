#!/usr/bin/env node
'use strict';
/**
 * pipeline/cli.js — docs/spec.md §10
 *
 *   node pipeline/cli.js analyze  videos/<name> [--take=takes/take-01] [--no-jev] [--whisper-model=turbo] [--force-whisper] [--json]
 *   node pipeline/cli.js rerecord videos/<name> --sentence=s2.1 --clip=takes/rr-s2.1-1 [--no-jev] [--whisper-model=…] [--json]
 *   node pipeline/cli.js cut      videos/<name> [--json]        (alias: finalize)
 *   node pipeline/cli.js status   videos/<name> [--json]
 *   node pipeline/cli.js tts      videos/<name> --voice=<name> [--model=…] [--speed=1.15] [--timings=auto|whisper|estimate] [--cta=3] [--force] [--json]   (TTS voice instead of a take; pipeline/tts.js)
 *   node pipeline/cli.js jev                                   (verify the Jev slug on OpenRouter)
 * `splice` is accepted as an alias of `rerecord`. <name> alone resolves to videos/<name>.
 * --json prints the machine-readable result on stdout (logs go to stderr).
 */
const fs = require('fs');
const path = require('path');
const { ROOT, loadEnv } = require('./config');

function parseArgs(argv) {
  const pos = [], flags = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    else pos.push(a);
  }
  return { pos, flags };
}

function resolveVideoDir(arg) {
  if (!arg) throw new Error('missing video dir (videos/<name>)');
  for (const c of [path.resolve(arg), path.join(ROOT, arg), path.join(ROOT, 'videos', arg)]) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
  }
  throw new Error(`video dir not found: ${arg}`);
}

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

async function main() {
  loadEnv();
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  const json = Boolean(flags.json);
  const log = (...a) => (json ? console.error(...a) : console.log(...a));

  switch (cmd) {
    case 'analyze': {
      const dir = resolveVideoDir(pos[0]);
      const take = await require('./analyze').analyze(dir, {
        take: flags.take, useJev: !flags['no-jev'], whisperModel: flags['whisper-model'], forceWhisper: Boolean(flags['force-whisper']),
      });
      if (json) console.log(JSON.stringify(take)); else log(statusTable(take));
      break;
    }
    case 'rerecord':
    case 'splice': {
      const dir = resolveVideoDir(pos[0]);
      if (!flags.sentence || !flags.clip) throw new Error('--sentence=<id> and --clip=<takes/rr-…> are required');
      const r = await require('./splice').rerecord(dir, flags.sentence, flags.clip, {
        useJev: !flags['no-jev'], whisperModel: flags['whisper-model'], forceWhisper: Boolean(flags['force-whisper']),
      });
      if (json) console.log(JSON.stringify(r));
      else log(!r.ok ? `✗ ${flags.sentence} clip rejected: ${r.reason}`
        : r.kept === 'take' ? `~ ${flags.sentence} ${r.reason}` : `✓ ${flags.sentence} re-recorded (${r.sentence.clipStatus}, wer ${r.sentence.wer})`);
      if (!r.ok) process.exitCode = 2;
      break;
    }
    case 'cut':
    case 'finalize': {
      const dir = resolveVideoDir(pos[0]);
      const r = require('./cut').finalize(dir);
      if (json) console.log(JSON.stringify(r));
      else {
        for (const s of r.scenes) log(`  scene ${s.idx}: ${s.dur.toFixed(2)}s  ${s.words.length} words  ${s.file}`);
        for (const w of r.warnings) log(`  warning: ${w}`);
        log(`voiceover.mp3 ${r.totalSec}s, scenes.json written (${r.scenes.length} scenes)`);
      }
      break;
    }
    case 'tts': {
      const dir = resolveVideoDir(pos[0]);
      const r = await require('./tts').synthesize(dir, {
        model: flags.model, voice: flags.voice, speed: flags.speed, timings: flags.timings, whisperModel: flags['whisper-model'],
        ctaSec: flags.cta, force: Boolean(flags.force),
      });
      if (json) console.log(JSON.stringify(r));
      else {
        for (const s of r.scenes) log(`  scene ${s.idx}: ${s.dur.toFixed(2)}s  ${s.words.length} words  ${s.file}`);
        log(`${r.model} / voice ${r.voice} / ${r.speed}x — ${r.apiCalls} API calls, ${r.cached} cached`);
        log(`word timings: ${r.timings}${r.timingsFallback ? ` (${r.timingsFallback})` : ''}`);
        log(`voiceover.mp3 ${r.totalSec}s, scenes.json written (${r.scenes.length} scenes)`);
      }
      break;
    }
    case 'status': {
      const dir = resolveVideoDir(pos[0]);
      const f = path.join(dir, 'take.json');
      if (!fs.existsSync(f)) throw new Error(`no take.json in ${dir}`);
      const take = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (json) console.log(JSON.stringify({ status: take.status, summary: take.summary, sentences: take.sentences.map(s => ({ id: s.id, status: s.status, wer: s.wer, wpm: s.wpm, flags: s.flags })) }));
      else log(statusTable(take));
      break;
    }
    case 'jev': {
      console.log(JSON.stringify(await require('./jev').verifySlug(), null, 2));
      break;
    }
    default:
      console.error('usage: node pipeline/cli.js analyze|rerecord|cut|tts|status videos/<name> [--flags]  (see header)');
      process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(e => { console.error(`error: ${e.message}`); process.exitCode = 1; });
}
module.exports = { statusTable, resolveVideoDir, parseArgs };
