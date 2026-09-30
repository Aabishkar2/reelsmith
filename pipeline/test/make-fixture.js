'use strict';
/**
 * pipeline/test/make-fixture.js — synthetic takes for the end-to-end test.
 *
 * Writes pipeline/test/fixture/script.md (4 scenes, 10 sentences, "900ms",
 * "$0.30") and renders two takes with edge-tts (python3.11 pipeline/test/tts.py):
 *   fixture/clean.mp3  exact script
 *   fixture/bad.mp3    restart "S3 is the... S3 is the oldest…", "um", "uh",
 *                      stutter "the, the" (whisper drops an unpunctuated TTS
 *                      "the the"), 900 → 600, s2.3 skipped, a leading
 *                      "So," and a 3.0 s silence (ffmpeg) between s3.2 and s3.3
 * Then lays out two video dirs the pipeline can analyze:
 *   fixture/clean/{script.md, takes/take-01.{wav,hq.wav}}
 *   fixture/bad/{script.md, takes/take-01.{wav,hq.wav}}
 * Re-uses existing mp3s unless --force. Needs network (edge-tts).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const audio = require('../audio');

const FIX = path.join(__dirname, 'fixture');
const TTS = path.join(__dirname, 'tts.py');
const VOICE = '--voice=en-US-AndrewNeural';
const RATE = '--rate=+0%';

const SCRIPT = `---
title: Why Lambda cold starts hurt
topic: aws
date: 2026-09-27
wpm: 150            # teleprompter speed
---

## Script

### Scene 1
S3 is the oldest and most widely used AWS service.
> say "S3" as "ess three"
It stores objects like files, logs, and backups.

### Scene 2
Lambda runs your code without any servers to manage.
But a cold start can add 900ms before your function even begins.
That delay happens every time a new container spins up.

### Scene 3
Provisioned concurrency keeps containers warm and ready.
It costs about $0.30 per hour for each warm instance.
For busy APIs, the price is worth paying.

### Scene 4
Measure your cold starts before you pay to remove them.
Follow for more AWS tips every week.
`;

// Bad take, split where the silence gets inserted.
const BAD_A = [
  'S3 is the... S3 is the oldest and most widely used AWS service.',
  'It stores, um, objects like files, logs, and backups.',
  'Lambda runs your code without any servers to manage.',
  'But a cold start can add 600ms before your function even begins.',
  // s2.3 skipped
  'Provisioned concurrency, uh, keeps containers warm and ready.',
  'It costs about $0.30 per hour for each warm instance.',
].join(' ');
const BAD_B = [
  'For busy APIs, the, the price is worth paying.',
  'So, measure your cold starts before you pay to remove them.',
  'Follow for more AWS tips every week.',
].join(' ');
const PAUSE_SEC = 3.0;

function tts(text, out) {
  const r = spawnSync('python3.11', [TTS, text, out, VOICE, RATE], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error(`edge-tts failed (network?): ${(r.stderr || r.stdout || '').trim().slice(-400)}`);
}

function spokenText(md) {
  return require('../script').parse(md).sentences.map(s => s.text).join(' ');
}

function layout(name, mp3) {
  const dir = path.join(FIX, name);
  fs.mkdirSync(path.join(dir, 'takes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'script.md'), SCRIPT);
  for (const f of ['take-01.wav', 'take-01.hq.wav', 'take-01.json']) fs.rmSync(path.join(dir, 'takes', f), { force: true });
  audio.toWavHq(mp3, path.join(dir, 'takes', 'take-01.hq.wav'));
  audio.toWav16k(path.join(dir, 'takes', 'take-01.hq.wav'), path.join(dir, 'takes', 'take-01.wav'));
  for (const f of ['take.json', 'scenes.json', 'voiceover.mp3']) fs.rmSync(path.join(dir, f), { force: true });
  fs.rmSync(path.join(dir, 'voiceover'), { recursive: true, force: true });
  return dir;
}

function make({ force = false } = {}) {
  fs.mkdirSync(FIX, { recursive: true });
  fs.writeFileSync(path.join(FIX, 'script.md'), SCRIPT);
  const clean = path.join(FIX, 'clean.mp3');
  const bad = path.join(FIX, 'bad.mp3');
  if (force || !fs.existsSync(clean)) { console.log('  tts clean take…'); tts(spokenText(SCRIPT), clean); }
  if (force || process.argv.includes('--force-bad') || !fs.existsSync(bad)) {
    console.log('  tts bad take…');
    const a = path.join(FIX, '_bad-a.mp3'), b = path.join(FIX, '_bad-b.mp3');
    tts(BAD_A, a); tts(BAD_B, b);
    // [a][PAUSE_SEC of silence][b] → bad.mp3
    audio.ffmpeg(['-loglevel', 'error', '-i', a, '-f', 'lavfi', '-t', String(PAUSE_SEC), '-i', 'anullsrc=r=48000:cl=mono', '-i', b,
      '-filter_complex', '[0:a]aresample=48000,aformat=channel_layouts=mono[x];[2:a]aresample=48000,aformat=channel_layouts=mono[z];[x][1:a][z]concat=n=3:v=0:a=1[out]',
      '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '128k', bad]);
    fs.rmSync(a, { force: true }); fs.rmSync(b, { force: true });
  }
  // a re-record clip for the skipped sentence s2.3 (used to test splice + cut)
  const rr = path.join(FIX, 'rr-s2.3.mp3');
  if (force || !fs.existsSync(rr)) { console.log('  tts re-record clip…'); tts('That delay happens every time a new container spins up.', rr); }
  const out = { script: path.join(FIX, 'script.md'), clean: layout('clean', clean), bad: layout('bad', bad), pauseSec: PAUSE_SEC };
  for (const f of ['rr-s2.3-1.wav', 'rr-s2.3-1.hq.wav', 'rr-s2.3-1.json']) fs.rmSync(path.join(out.bad, 'takes', f), { force: true });
  audio.toWavHq(rr, path.join(out.bad, 'takes', 'rr-s2.3-1.hq.wav'));
  audio.toWav16k(path.join(out.bad, 'takes', 'rr-s2.3-1.hq.wav'), path.join(out.bad, 'takes', 'rr-s2.3-1.wav'));
  out.rerecordClip = 'takes/rr-s2.3-1';
  return out;
}

module.exports = { make, SCRIPT, BAD_A, BAD_B, FIX };

if (require.main === module) {
  try { const r = make({ force: process.argv.includes('--force') }); console.log(JSON.stringify(r, null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
