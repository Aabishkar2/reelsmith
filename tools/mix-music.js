#!/usr/bin/env node
'use strict';
/**
 * tools/mix-music.js — lay a background music bed under voiceover.mp3 (config/music.md; `reelsmith mix`).
 *
 * Usage:
 *   reelsmith mix <video> [--track=music/<file>.mp3] [--under=6]
 *   node tools/mix-music.js videos/<name> --track=music/<file>.mp3 [--under=6] [--voice=voiceover.mp3] [--out=voiceover-mix.mp3]
 *
 * The bed is set RELATIVE to the voice: the voice is loudnormed to music.voiceLufs (-16 LUFS), the
 * track's own loudness is measured (ebur128), and the bed is gained to sit --under dB (default
 * reelsmith.config.json music.underDb = 6, the creator's pick) below the voice. A gentle sidechain
 * duck dips it a little more under speech. Fades in 1.5 s, out over the last 3 s, with a
 * music.tailSec (2.5 s) music tail after the voice. Voice timing is not shifted, so scenes.json
 * stays valid; `reelsmith draft|render` pick voiceover-mix.mp3 automatically and run the video to
 * the end of the tail (the closing frame holds).
 *
 * Writes <out> and, next to it, <out minus .mp3>.json (voiceover-mix.json):
 *   { durationSec, voiceSec, tailSec, track, underDb, voiceLufs, musicLufs, bedGainDb, at }
 * and prints the same object (plus `out`) as one JSON line on stdout.
 *
 * --track is looked up relative to the video folder, then the project root, then the project's
 * music dir (music.dir), then the framework checkout.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const env = require('../core/env');
const project = require('../core/project');
const coreConfig = require('../core/config');

const USAGE = 'Usage: node tools/mix-music.js videos/<name> --track=music/<file>.mp3 [--under=6] [--voice=voiceover.mp3] [--out=voiceover-mix.mp3]';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const dirArg = args.find(a => !a.startsWith('--'));
if (args.includes('--help')) { console.log(USAGE); process.exit(0); }
if (!dirArg || !flag('track')) { console.error(USAGE); process.exit(2); }

let videoDir = path.resolve(dirArg);
if (!fs.existsSync(videoDir)) { try { videoDir = project.resolveVideo(dirArg); } catch (e) { console.error(e.message); process.exit(1); } }
const root = project.rootFor(videoDir);
const { config } = coreConfig.load({ root });
const music = config.music || {};
env.ensureOnPath();
const FFMPEG = env.bin('ffmpeg');
const FFPROBE = env.bin('ffprobe');

const VOICE_LUFS = Number(music.voiceLufs ?? -16);
const TAIL_SEC = Number(music.tailSec ?? 2.5);
const firstExisting = (p, bases) => {
  if (path.isAbsolute(p)) return p;
  for (const b of bases) if (fs.existsSync(path.join(b, p))) return path.join(b, p);
  return path.join(bases[0], p);
};
const musicDir = path.resolve(root, music.dir || 'music');
const voice = firstExisting(flag('voice', 'voiceover.mp3'), [videoDir]);
const track = firstExisting(flag('track'), [videoDir, root, musicDir, project.FRAMEWORK_ROOT]);
const out = path.join(videoDir, flag('out', 'voiceover-mix.mp3'));
const under = Number(flag('under', String(music.underDb ?? 6)));

for (const f of [voice, track]) if (!fs.existsSync(f)) { console.error(`not found: ${f}`); process.exit(1); }
if (!Number.isFinite(under)) { console.error('--under must be a number (dB)'); process.exit(2); }
if (!Number.isFinite(VOICE_LUFS) || !Number.isFinite(TAIL_SEC) || TAIL_SEC < 0) {
  console.error('reelsmith.config.json music.voiceLufs / music.tailSec must be numbers'); process.exit(1);
}

const duration = f => Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

/** Integrated loudness (LUFS) of the first 120 s — enough for a looping bed. */
function lufs(f) {
  // ebur128 prints its summary on stderr; the last "I:" line is the integrated value.
  const r = spawnSync(FFMPEG, ['-hide_banner', '-t', '120', '-i', f, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-']);
  if (r.error) throw new Error(`${FFMPEG} could not start: ${r.error.message}`);
  const m = String(r.stderr).match(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g);
  if (!m) throw new Error(`could not measure loudness of ${f}`);
  return Number(m[m.length - 1].match(/-?\d+(?:\.\d+)?/)[0]);
}

try {
  const voiceSec = duration(voice);
  const total = +(voiceSec + TAIL_SEC).toFixed(2);
  const fadeOutAt = Math.max(0, total - 3);
  const musicLufs = lufs(track);
  const gain = +((VOICE_LUFS - under) - musicLufs).toFixed(1);

  const graph = [
    `[0:a]loudnorm=I=${VOICE_LUFS}:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo,apad,asplit=2[vo][key]`,
    `[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${gain}dB,afade=t=in:d=1.5,afade=t=out:st=${fadeOutAt}:d=3[bed]`,
    '[bed][key]sidechaincompress=threshold=0.05:ratio=2.5:attack=60:release=600[ducked]',
    '[vo][ducked]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[out]',
  ].join(';');

  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', voice, '-stream_loop', '-1', '-i', track,
    '-filter_complex', graph, '-map', '[out]', '-t', String(total), '-c:a', 'libmp3lame', '-b:a', '192k', out], { stdio: 'inherit' });

  const rel = f => path.relative(root, f).split(path.sep).join('/');
  const info = {
    durationSec: +duration(out).toFixed(3), voiceSec: +voiceSec.toFixed(3), tailSec: TAIL_SEC,
    track: rel(track).startsWith('..') ? track : rel(track), underDb: under, voiceLufs: VOICE_LUFS, musicLufs, bedGainDb: gain,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(out.replace(/\.mp3$/i, '') + '.json', JSON.stringify(info, null, 2) + '\n');
  console.log(JSON.stringify({ out: rel(out), ...info, totalSec: info.durationSec }));   // totalSec: the pre-sidecar key
} catch (e) {
  console.error(`mix failed: ${String(e.message || e).split('\n')[0]}`);
  process.exit(1);
}
