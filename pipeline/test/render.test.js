'use strict';
/**
 * pipeline/test/render.test.js — pure tests for renderer/render.js planning (no browser, no ffmpeg).
 *   node pipeline/test/render.test.js
 */
const assert = require('assert');
const os = require('os');
const path = require('path');
const R = require('../../renderer/render');

const GB = 1024 ** 3, MB = 1024 ** 2;
const FIXTURE = path.join(__dirname, '..', '..', 'videos', 'fixture-e2e', 'index.html');
const FAKE = path.join(os.tmpdir(), 'render-test-video', 'index.html'); // never touched on disk
const DUR = 98.076; // devotion-tts

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}

function assertCovers(ranges, from, to) {
  assert.ok(ranges.length > 0, 'no ranges');
  assert.strictEqual(ranges[0].a, from, `first range starts at ${ranges[0].a}`);
  assert.strictEqual(ranges[ranges.length - 1].b, to, `last range ends at ${ranges[ranges.length - 1].b}`);
  ranges.forEach((r, i) => {
    assert.ok(r.b > r.a, `range ${i} is empty: ${JSON.stringify(r)}`);
    if (i) assert.strictEqual(r.a, ranges[i - 1].b, `gap/overlap between range ${i - 1} and ${i}`);
  });
  const sizes = ranges.map(r => r.b - r.a);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `sizes differ by more than 1: ${sizes}`);
}

(async () => {
  console.log('module');
  await test('require() exports the planning API and does not run the CLI', () => {
    for (const k of ['planShards', 'pickShards', 'encoderArgs', 'resolveMode']) assert.strictEqual(typeof R[k], 'function', k);
  });

  console.log('planShards');
  await test('planShards(2943, 4) → 4 contiguous ranges covering [0, 2943), sizes within 1', () => {
    const r = R.planShards(2943, 4);
    assert.strictEqual(r.length, 4);
    assertCovers(r, 0, 2943);
  });
  await test('planShards(5, 8) → 5 shards of 1 frame (never an empty shard)', () => {
    const r = R.planShards(5, 8);
    assert.strictEqual(r.length, 5);
    assert.ok(r.every(x => x.b - x.a === 1), JSON.stringify(r));
    assertCovers(r, 0, 5);
  });
  await test('planShards with an offset (range mode) covers [360, 720)', () => {
    const r = R.planShards(360, 2, 360);
    assert.deepStrictEqual(r, [{ a: 360, b: 540 }, { a: 540, b: 720 }]);
  });
  await test('planShards(7, 1) → one range; planShards(0, 4) → none', () => {
    assert.deepStrictEqual(R.planShards(7, 1), [{ a: 0, b: 7 }]);
    assert.deepStrictEqual(R.planShards(0, 4), []);
  });

  console.log('pickShards');
  await test('{cpus:2} → 1', () => assert.strictEqual(R.pickShards({ cpus: 2 }), 1));
  await test('{cpus:8, freeMem:16 GB} → 4', () => assert.strictEqual(R.pickShards({ cpus: 8, freeMem: 16 * GB }), 4));
  await test('{cpus:8, freeMem:500 MB} → 1', () => assert.strictEqual(R.pickShards({ cpus: 8, freeMem: 500 * MB }), 1));
  await test('{cpus:8, freeMem:50 MB} → 1 (never below 1)', () => assert.strictEqual(R.pickShards({ cpus: 8, freeMem: 50 * MB }), 1));
  await test('{cpus:8, requested:6} → 6', () => assert.strictEqual(R.pickShards({ cpus: 8, requested: 6 }), 6));
  await test('{cpus:4, requested:6} → 3 (capped by cores)', () => assert.strictEqual(R.pickShards({ cpus: 4, requested: 6 }), 3));
  await test('{cpus:8, requested:"2"} (CLI string) → 2', () => assert.strictEqual(R.pickShards({ cpus: 8, requested: '2' }), 2));

  console.log('encoderArgs');
  await test('videotoolbox available → h264_videotoolbox -q:v 75', () => {
    const e = R.encoderArgs({ encoder: 'auto', draft: false, available: true });
    assert.strictEqual(e.name, 'videotoolbox');
    assert.deepStrictEqual(e.args, ['-c:v', 'h264_videotoolbox', '-q:v', '75']);
  });
  await test('videotoolbox not available → libx264 -preset medium -crf 18', () => {
    const e = R.encoderArgs({ encoder: 'auto', draft: false, available: false });
    assert.strictEqual(e.name, 'x264');
    assert.deepStrictEqual(e.args, ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18']);
  });
  await test('draft variants: videotoolbox -q:v 50, x264 veryfast crf 23', () => {
    assert.deepStrictEqual(R.encoderArgs({ draft: true, available: true }).args, ['-c:v', 'h264_videotoolbox', '-q:v', '50']);
    assert.deepStrictEqual(R.encoderArgs({ draft: true, available: false }).args, ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']);
  });
  await test('--encoder=x264 forces x264 even when videotoolbox exists', () => {
    const e = R.encoderArgs({ encoder: 'x264', draft: false, available: true });
    assert.strictEqual(e.name, 'x264');
    assert.strictEqual(e.args[1], 'libx264');
  });
  await test('`available` may be the `ffmpeg -encoders` listing', () => {
    const listing = ' V....D libx264   libx264 H.264\n V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)\n';
    assert.strictEqual(R.encoderArgs({ available: listing }).name, 'videotoolbox');
    assert.strictEqual(R.encoderArgs({ available: ' V....D libx264   libx264 H.264\n' }).name, 'x264');
  });
  await test('--encoder=videotoolbox without it, or an unknown encoder, throws', () => {
    assert.throws(() => R.encoderArgs({ encoder: 'videotoolbox', available: false }), /videotoolbox/);
    assert.throws(() => R.encoderArgs({ encoder: 'nvenc', available: true }), /unknown --encoder/);
  });

  console.log('resolveMode');
  await test('--draft → gate off, fps 15, 540×960, q80, out draft.mp4', () => {
    const m = R.resolveMode([FAKE, '--draft'], { duration: DUR });
    assert.strictEqual(m.gate, false);
    assert.strictEqual(m.fps, 15);
    assert.strictEqual(m.width, 540);
    assert.strictEqual(m.height, 960);
    assert.strictEqual(m.quality, 80);
    assert.strictEqual(m.outputPath, path.join(path.dirname(FAKE), 'draft.mp4'));
    assert.strictEqual(m.frameEnd - m.frameStart, Math.ceil(DUR * 15));
  });
  await test('--from=12 --to=24 → gate off, out clip-12s-24s.mp4, frames [360, 720)', () => {
    const m = R.resolveMode([FAKE, '--from=12', '--to=24'], { duration: DUR });
    assert.strictEqual(m.gate, false);
    assert.strictEqual(m.range, true);
    assert.strictEqual(m.outputPath, path.join(path.dirname(FAKE), 'clip-12s-24s.mp4'));
    assert.strictEqual(m.frameStart, 360);
    assert.strictEqual(m.frameEnd, 720);
  });
  await test('plain → gate on, 720×1280 @ 30, q95, out output.mp4, exactly ceil(duration·fps) frames', () => {
    const m = R.resolveMode([FAKE], { duration: DUR });
    assert.strictEqual(m.gate, true);
    assert.strictEqual(m.draft, false);
    assert.strictEqual(m.range, false);
    assert.deepStrictEqual([m.fps, m.width, m.height, m.quality], [30, 720, 1280, 95]);
    assert.strictEqual(m.outputPath, path.join(path.dirname(FAKE), 'output.mp4'));
    assert.strictEqual(m.totalFrames, 2943);
    assert.deepStrictEqual([m.frameStart, m.frameEnd], [0, 2943]);
  });
  await test('--no-preview-gate turns the gate off; explicit output path wins', () => {
    const m = R.resolveMode([FAKE, '/tmp/x/out.mp4', '--no-preview-gate', '--fps=30', '--audio=a.mp3'], { duration: DUR });
    assert.strictEqual(m.gate, false);
    assert.strictEqual(m.outputPath, '/tmp/x/out.mp4');
    assert.strictEqual(m.audio, path.resolve('a.mp3'));
  });
  await test('explicit --fps/--width/--height/--quality win over draft defaults', () => {
    const m = R.resolveMode([FAKE, '--draft', '--fps=24', '--width=360', '--height=640', '--quality=70'], { duration: DUR });
    assert.deepStrictEqual([m.fps, m.width, m.height, m.quality, m.gate], [24, 360, 640, 70, false]);
  });
  await test('range clamps to [0, duration]; one-sided ranges work', () => {
    const a = R.resolveMode([FAKE, '--from=-5', '--to=500'], { duration: 10 });
    assert.deepStrictEqual([a.from, a.to, a.frameStart, a.frameEnd], [0, 10, 0, 300]);
    const b = R.resolveMode([FAKE, '--from=8'], { duration: 10 });
    assert.deepStrictEqual([b.frameStart, b.frameEnd, path.basename(b.outputPath)], [240, 300, 'clip-8s-10s.mp4']);
    const c = R.resolveMode([FAKE, '--to=2.5', '--draft'], { duration: 10 });
    assert.deepStrictEqual([c.frameStart, c.frameEnd, path.basename(c.outputPath)], [0, 38, 'clip-0s-2.5s-draft.mp4']);
  });
  await test('empty or inverted range throws', () => {
    assert.throws(() => R.resolveMode([FAKE, '--from=5', '--to=5'], { duration: 10 }), /empty range/);
    assert.throws(() => R.resolveMode([FAKE, '--from=12', '--to=3'], { duration: 10 }), /empty range/);
  });
  await test('--from=1 --to=3 → ceil(2·30) = 60 frames (float-safe)', () => {
    const m = R.resolveMode([FAKE, '--from=1', '--to=3'], { duration: 34.879 });
    assert.strictEqual(m.frameEnd - m.frameStart, 60);
    const f = R.resolveMode([FAKE, '--from=0.1', '--to=0.7'], { duration: 34.879 });
    assert.strictEqual(f.frameEnd - f.frameStart, 18);
  });
  await test('duration comes from scenes.json when --duration is absent', () => {
    const m = R.resolveMode([FIXTURE]);
    assert.strictEqual(m.durationSource, 'scenes.json');
    assert.ok(Math.abs(m.duration - 34.879) < 1e-6, String(m.duration));
    assert.strictEqual(R.resolveMode([FIXTURE, '--duration=5']).totalFrames, 150);
  });
  await test('no scenes.json and no --duration → clear error', () => {
    assert.throws(() => R.resolveMode([FAKE]), /cannot determine video length/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
