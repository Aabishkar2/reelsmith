'use strict';
/**
 * pipeline/test/run-tests.js — end-to-end pipeline test.
 *   node pipeline/test/run-tests.js [--force-tts] [--whisper-model=base]
 *
 * 1. unit tests (align.test.js, attempts.test.js, denoise.test.js, tts.test.js, plugins.test.js, performance.test.js,
 *    render.test.js — no whisper, no network)
 *    + render.e2e.test.js (real render of videos/fixture-e2e; skipped when playwright/ffmpeg are missing)
 * 2. make-fixture (edge-tts; needs network — if it fails only step 1 runs)
 * 3. `cli.js analyze` on the clean + bad takes (whisper base, --no-jev)
 * 4. `cli.js cut` on the clean take → scenes.json / voiceover.mp3 checks
 * 5. `cli.js rerecord` the skipped sentence of the bad take, then cut it
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const audio = require('../audio');

const CLI = path.join(__dirname, '..', 'cli.js');
const model = (process.argv.find(a => a.startsWith('--whisper-model=')) || '--whisper-model=base').split('=')[1];
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: Boolean(cond), detail });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && detail ? `\n      ${detail}` : ''}`);
}
function cli(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && r.status !== 2) throw new Error(`cli ${args.join(' ')} failed:\n${r.stderr}`);
  return r;
}
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const flags = (take, type) => take.sentences.flatMap(s => s.flags.filter(f => f.type === type).map(f => ({ ...f, sid: s.id })));

function checkScenes(dir, label, expectScenes) {
  const scenes = readJson(path.join(dir, 'scenes.json'));
  const total = audio.duration(path.join(dir, 'voiceover.mp3'));
  const sum = scenes.reduce((a, s) => a + s.dur, 0);
  check(`${label}: scenes.json has ${expectScenes} scenes`, scenes.length === expectScenes, `got ${scenes.length}`);
  check(`${label}: Σdur ${sum.toFixed(2)}s within ±1.5s of voiceover.mp3 ${total.toFixed(2)}s`, Math.abs(sum - total) <= 1.5);
  for (const s of scenes) {
    const w = s.words;
    const mono = w.every((x, i) => x.end >= x.start && (i === 0 || x.start >= w[i - 1].start));
    check(`${label}: scene ${s.idx} words 0-based (first ${w[0] ? w[0].start : 'n/a'}s) & monotonic, ${w.length} words, dur ${s.dur}s`,
      w.length > 0 && w[0].start < 1.0 && mono && w[w.length - 1].end <= s.dur + 0.05 && fs.existsSync(path.join(dir, s.file)) &&
      s.file === `voiceover/s${s.idx}.mp3`);
  }
  return scenes;
}

(function main() {
  console.log('1. unit tests (align, attempts, denoise, tts, plugins, performance, render, render e2e)');
  for (const f of ['align.test.js', 'attempts.test.js', 'denoise.test.js', 'tts.test.js', 'plugins.test.js', 'performance.test.js', 'publish.test.js', 'render.test.js', 'render.e2e.test.js']) {
    const u = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
    const skipped = (u.stdout.match(/^SKIPPED: (.*)$/m) || [])[1];
    if (skipped && u.status === 0) { console.log(`  - ${f} skipped: ${skipped}`); continue; }
    const um = (u.stdout.match(/(\d+) passed, (\d+) failed/) || []);
    check(`${f}: ${um[1] || '?'} passed, ${um[2] || '?'} failed`, u.status === 0, u.stdout.split('\n').filter(l => l.includes('✗')).join(' | '));
  }

  console.log('2. fixture (edge-tts)');
  let fx;
  try { fx = require('./make-fixture').make({ force: process.argv.includes('--force-tts') }); check('fixture generated', true); }
  catch (e) {
    console.log(`  ! edge-tts unavailable (${e.message.split('\n')[0]}) — only the pure-JS tests ran`);
    return summary();
  }

  console.log(`3. analyze (whisper ${model}, --no-jev)`);
  cli('analyze', fx.clean, `--whisper-model=${model}`, '--no-jev', '--json');
  const clean = readJson(path.join(fx.clean, 'take.json'));
  const cleanBad = clean.sentences.filter(s => s.status === 'bad' || s.status === 'missing');
  check(`clean: ${clean.sentences.length} sentences all ok/warn (ok ${clean.summary.ok}, warn ${clean.summary.warn})`,
    cleanBad.length === 0 && clean.sentences.length === 10, cleanBad.map(s => `${s.id}:${s.status} ${JSON.stringify(s.flags)}`).join(' | '));
  check('clean: no filler/stutter flags', flags(clean, 'filler').length + flags(clean, 'stutter').length === 0,
    JSON.stringify([...flags(clean, 'filler'), ...flags(clean, 'stutter')]));

  cli('analyze', fx.bad, `--whisper-model=${model}`, '--no-jev', '--json');
  const bad = readJson(path.join(fx.bad, 'take.json'));
  const S = id => bad.sentences.find(s => s.id === id);
  check('bad: skipped s2.3 is missing', S('s2.3').status === 'missing', S('s2.3').status);
  check('bad: s2.2 (900→600) has dropped-key or mismatch',
    S('s2.2').status === 'bad' && S('s2.2').flags.some(f => f.type === 'dropped-key' || f.type === 'mismatch'), JSON.stringify(S('s2.2').flags));
  const fl = flags(bad, 'filler');
  check(`bad: ≥2 filler flags (got ${fl.length}: ${fl.map(f => f.detail).join(', ')})`, fl.length >= 2);
  const stut = flags(bad, 'stutter');
  const repeat = stut.filter(f => /^repeat/.test(f.detail)), restart = stut.filter(f => /^restart/.test(f.detail));
  check(`bad: ≥1 stutter flag (got ${stut.length}: ${stut.map(f => `${f.sid} ${f.detail}`).join('; ')})`, stut.length >= 1);
  // whisper may or may not transcribe the repeated "the" (base does, turbo in full-take context doesn't)
  const spoken = bad.words.filter(w => /[a-z0-9]/i.test(w.word));
  const heardRepeat = spoken.some((w, i) => i > 0 && /^\W*the\W*$/i.test(w.word) && /^\W*the\W*$/i.test(spoken[i - 1].word));
  if (heardRepeat) check('bad: "the, the" repeat detected in s3.3', repeat.some(f => f.sid === 's3.3'), JSON.stringify(S('s3.3').flags));
  else console.log('  - skipped "the, the" check: whisper did not transcribe the repeated word');
  const s11 = S('s1.1'), s3w = bad.words.filter(w => /^S3/.test(w.word));
  check('bad: restart in s1.1 → later attempt kept, abandoned attempt cut',
    restart.some(f => f.sid === 's1.1') && ['ok', 'warn'].includes(s11.status) && s3w.length >= 2 && s11.range.start >= s3w[1].start - 0.01 &&
    bad.cuts.some(c => c.start <= s3w[0].start + 0.01 && c.end >= s3w[0].end - 0.01), JSON.stringify({ range: s11.range, s3w, flags: s11.flags }));
  const pauses = flags(bad, 'pause');
  check(`bad: ≥1 pause flag (got ${pauses.length}: ${pauses.map(f => `${f.sid} ${f.detail}`).join('; ')})`, pauses.some(f => f.sid === 's3.3'));
  check(`bad: take status needs-rerecord, est. clean ${bad.summary.estimatedCleanSec}s < ${bad.audio.durationSec}s`,
    bad.status === 'needs-rerecord' && bad.summary.estimatedCleanSec < bad.audio.durationSec - 3);

  console.log('4. cut (clean take)');
  cli('cut', fx.clean, '--json');
  checkScenes(fx.clean, 'clean cut', 4);
  const cleanTake = readJson(path.join(fx.clean, 'take.json'));
  check(`clean cut: take.status = cut, voiceover ${cleanTake.cut.totalSec}s vs estimate ${clean.summary.estimatedCleanSec}s`,
    cleanTake.status === 'cut' && Math.abs(cleanTake.cut.totalSec - clean.summary.estimatedCleanSec) < 3);

  console.log('5. rerecord + cut (bad take)');
  const rr = JSON.parse(cli('rerecord', fx.bad, '--sentence=s2.3', `--clip=${fx.rerecordClip}`, `--whisper-model=${model}`, '--no-jev', '--json').stdout);
  check(`rerecord s2.3 accepted → status ${rr.sentence.status}`, rr.ok && rr.sentence.status === 'rerecorded' && rr.sentence.source.kind === 'rerecord', rr.reason);
  const wrong = JSON.parse(cli('rerecord', fx.bad, '--sentence=s1.2', `--clip=${fx.rerecordClip}`, `--whisper-model=${model}`, '--no-jev', '--json').stdout);
  check(`rerecord with the wrong clip for s1.2 is rejected (${wrong.reason})`, !wrong.ok && readJson(path.join(fx.bad, 'take.json')).sentences.find(s => s.id === 's1.2').status !== 'rerecorded');
  cli('cut', fx.bad, '--json');
  const badScenes = checkScenes(fx.bad, 'bad cut', 4);
  const s2 = badScenes.find(s => s.idx === 2);
  check('bad cut: scene 2 contains the re-recorded sentence words', s2 && s2.words.some(w => /delay/i.test(w.word)));
  const allWords = badScenes.flatMap(s => s.words.map(w => w.word.toLowerCase().replace(/[^a-z']/g, '')));
  check('bad cut: no "um"/"uh" left in output words', !allWords.some(w => ['um', 'uh'].includes(w)), allWords.join(' '));

  summary();
})();

function summary() {
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} assertions passed${failed.length ? `, FAILED: ${failed.map(f => f.name).join(' | ')}` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
}
