#!/usr/bin/env node
/**
 * mix-music.js — lay a background music bed under voiceover.mp3 (config/music.md).
 *
 * Usage:
 *   node scripts/mix-music.js videos/<name> --track=music/clean-soul.mp3 [--under=6] [--voice=voiceover.mp3] [--out=voiceover-mix.mp3]
 *
 * The bed is set RELATIVE to the voice: the voice is loudnormed to -16 LUFS, the
 * track's own loudness is measured (ebur128), and the bed is gained to sit
 * --under dB (default 6, the creator's pick) below the voice. A gentle sidechain
 * duck dips it a little more under speech. Fades in 1.5 s, out over the last 3 s,
 * with a 2.5 s music tail after the voice. Voice timing is not shifted, so
 * scenes.json stays valid — render with --audio=<out>.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const FFMPEG = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
const FFPROBE = fs.existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe';
const VOICE_LUFS = -16;
const TAIL_SEC = 2.5;

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const dirArg = args.find(a => !a.startsWith('--'));
if (!dirArg || !flag('track')) {
  console.error('Usage: node scripts/mix-music.js videos/<name> --track=music/<file>.mp3 [--under=6] [--voice=voiceover.mp3] [--out=voiceover-mix.mp3]');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const videoDir = path.resolve(dirArg);
const resolve = (p, base) => (path.isAbsolute(p) ? p : fs.existsSync(path.join(base, p)) ? path.join(base, p) : path.join(root, p));
const voice = resolve(flag('voice', 'voiceover.mp3'), videoDir);
const track = resolve(flag('track'), videoDir);
const out = path.join(videoDir, flag('out', 'voiceover-mix.mp3'));
const under = Number(flag('under', '6'));

for (const f of [voice, track]) if (!fs.existsSync(f)) { console.error(`not found: ${f}`); process.exit(1); }
if (!Number.isFinite(under)) { console.error('--under must be a number (dB)'); process.exit(1); }

const duration = f => Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

/** Integrated loudness (LUFS) of the first 120 s — enough for a looping bed. */
function lufs(f) {
  // ebur128 prints its summary on stderr; the last "I:" line is the integrated value.
  const log = spawnSync(FFMPEG, ['-hide_banner', '-t', '120', '-i', f, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-']).stderr.toString();
  const m = log.match(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g);
  if (!m) throw new Error(`could not measure loudness of ${f}`);
  return Number(m[m.length - 1].match(/-?\d+(?:\.\d+)?/)[0]);
}

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

console.log(JSON.stringify({ out: path.relative(root, out), voiceSec, totalSec: duration(out), musicLufs, underDb: under, bedGainDb: gain }));
