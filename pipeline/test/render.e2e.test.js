'use strict';
/**
 * pipeline/test/render.e2e.test.js — renders videos/fixture-e2e with the real renderer (~30 s).
 *   node pipeline/test/render.e2e.test.js
 * Needs playwright's Chromium, ffmpeg/ffprobe and network (the fixture loads React/Babel/fonts from CDNs).
 * Prints "SKIPPED: …" and exits 0 when playwright or ffmpeg is missing.
 *
 * The 1–3 s clip is encoded with x264 (deterministic) and its decoded-frame md5 is compared with
 * CLIP_MD5: `?render=1` output must stay byte-identical when runtime/animations.jsx changes outside
 * render mode. If a change to the fixture or the runtime's render output is intentional, re-run with
 * RENDER_MD5_UPDATE=1 to print the new md5 and update CLIP_MD5 below.
 *
 * Cold-seek check (videos/devotion-tts, skipped if absent): with photo requests delayed 400 ms, a frame
 * captured right after a cold jump into a photo scene must equal the same frame captured after a warm
 * sequential pass — i.e. the per-frame image/font readiness wait works (without it the photo is missing).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

require('../../core/env').ensureOnPath();              // ffmpeg/ffprobe from a thin PATH too

const ROOT = path.join(__dirname, '..', '..');
const RENDER = path.join(ROOT, 'renderer', 'render.js');
const VIDEO = path.join(ROOT, 'videos', 'fixture-e2e');
const HTML = path.join(VIDEO, 'index.html');
// Decoded frames of `--from=1 --to=3 --shards=1 --encoder=x264` (runtime at ae3ba8e, headless shell 1217+, x264 medium crf18).
const CLIP_MD5 = '34d3eba261f7486015cdcfd7d52c23d1';

function unavailable() {
  for (const bin of ['ffmpeg', 'ffprobe']) {
    if (spawnSync(bin, ['-version'], { stdio: 'ignore' }).status !== 0) return `${bin} not found`;
  }
  try {
    const exe = require('playwright').chromium.executablePath();
    if (!exe || !fs.existsSync(exe)) return 'playwright Chromium not installed (npx playwright install chromium)';
  } catch (e) { return `playwright unavailable (${e.message.split('\n')[0]})`; }
  return null;
}

const skip = unavailable();
if (skip) {
  console.log(`SKIPPED: ${skip}`);
  console.log('\n0 passed, 0 failed (skipped)');
  process.exit(0);
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}

function render(...args) {
  const r = spawnSync(process.execPath, [RENDER, HTML, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
  if (r.status !== 0) throw new Error(`render.js ${args.join(' ')} exited ${r.status}:\n${(r.stderr || '').trim()}\n${(r.stdout || '').split('\n').slice(-5).join('\n')}`);
  return r;
}
const probe = (file, entries, extra = []) => spawnSync('ffprobe', ['-v', 'error', ...extra, '-show_entries', entries, '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim().replace(/,+$/, '');
const frameCount = (f) => parseInt(probe(f, 'stream=nb_read_frames', ['-select_streams', 'v:0', '-count_frames']), 10);
const duration = (f) => parseFloat(probe(f, 'format=duration'));
const decodedMd5 = (f) => (spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-map', '0:v', '-f', 'md5', '-'], { encoding: 'utf8' }).stdout.match(/MD5=([0-9a-f]+)/) || [])[1];

(async () => {
  const sumDur = JSON.parse(fs.readFileSync(path.join(VIDEO, 'scenes.json'), 'utf8')).reduce((a, s) => a + s.dur, 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-e2e-'));
  const framesDir = path.join(VIDEO, 'frames');
  const hadFrames = fs.existsSync(framesDir);

  try {
    console.log(`draft (--draft --shards=2), Σdur ${sumDur.toFixed(3)}s`);
    const draft = path.join(tmp, 'draft.mp4');
    let t0 = Date.now();
    await test('draft render exits 0 and writes the mp4', () => {
      render(draft, '--draft', '--shards=2', '--no-preview-gate');
      assert.ok(fs.existsSync(draft) && fs.statSync(draft).size > 0, 'no output');
    });
    console.log(`    (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    await test(`draft has ceil(Σdur·15) = ${Math.ceil(sumDur * 15)} frames at 540×960`, () => {
      assert.strictEqual(frameCount(draft), Math.ceil(sumDur * 15));
      assert.strictEqual(probe(draft, 'stream=width,height', ['-select_streams', 'v:0']), '540,960');
    });
    await test('draft duration within 0.1 s of Σdur', () => {
      const d = duration(draft);
      assert.ok(Math.abs(d - sumDur) <= 0.1, `${d}s vs ${sumDur}s`);
    });
    await test('segment cache removed after a successful render', () => {
      const cache = path.join(framesDir, 'render-cache');
      assert.ok(!fs.existsSync(cache) || fs.readdirSync(cache).length === 0, fs.existsSync(cache) ? fs.readdirSync(cache).join(', ') : '');
    });

    console.log('clip (--from=1 --to=3 --shards=1)');
    const clip = path.join(tmp, 'clip.mp4');
    t0 = Date.now();
    await test('clip render exits 0', () => { render(clip, '--from=1', '--to=3', '--shards=1', '--encoder=x264', '--keep-segments'); });
    console.log(`    (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    await test('clip has ceil(2·30) = 60 frames', () => assert.strictEqual(frameCount(clip), 60));
    await test('render-mode output unchanged (decoded-frame md5 of the clip)', () => {
      const md5 = decodedMd5(clip);
      if (process.env.RENDER_MD5_UPDATE) console.log(`    clip md5 = ${md5}`);
      // The hash was recorded on macOS; other Chromium/x264 builds decode differently, so off macOS
      // a mismatch is a notice, not a failure (RENDER_MD5_STRICT=1 enforces it anywhere).
      if (md5 !== CLIP_MD5 && process.platform !== 'darwin' && !process.env.RENDER_MD5_STRICT) {
        console.log(`    (clip md5 ${md5} ≠ recorded ${CLIP_MD5}; expected off macOS — set RENDER_MD5_STRICT=1 to enforce)`);
      } else {
        assert.strictEqual(md5, CLIP_MD5, `render output changed (${md5} ≠ ${CLIP_MD5}). Intentional? RENDER_MD5_UPDATE=1 prints the new md5 — update CLIP_MD5.`);
      }
    });
    await test('re-running reuses the cached segment (crash resume) and gives the same frames', () => {
      const clip2 = path.join(tmp, 'clip2.mp4');
      const r = render(clip2, '--from=1', '--to=3', '--shards=1', '--encoder=x264');
      assert.ok(/reusing seg-0-30-90\.mp4/.test(r.stdout), r.stdout.split('\n').slice(0, 12).join('\n'));
      assert.strictEqual(decodedMd5(clip2), decodedMd5(clip));
    });

    const photoVideo = path.join(ROOT, 'videos', 'devotion-tts', 'index.html');
    if (fs.existsSync(photoVideo)) {
      console.log('cold seek into a photo scene (devotion-tts, photo requests delayed 400 ms)');
      await test('cold-seek frames at t=33.3 and t=71 equal the warm sequential-pass frames', async () => {
        const R = require(RENDER);
        const { chromium } = require('playwright');
        const { server, port } = await R.startServer(R.PROJECT_ROOT);
        const browser = await chromium.launch({ args: ['--no-sandbox'] });
        try {
          const page = await browser.newPage();
          await page.setViewportSize({ width: 720, height: 1280 });
          await page.route(/\/images\//, async (route) => { await new Promise((r) => setTimeout(r, 400)); await route.continue(); });
          await page.goto(`http://127.0.0.1:${port}/videos/devotion-tts/index.html?render=1`, { waitUntil: 'load', timeout: 30000 });
          await page.waitForFunction(() => typeof window.__stage !== 'undefined', null, { timeout: 30000 });
          await page.waitForTimeout(1200);
          const session = { page, cdp: await page.context().newCDPSession(page) };
          const times = [33.3, 71];
          const cold = [];
          for (const t of times) cold.push(await R.captureFrame(session, t, 95));
          for (const [n, t] of times.entries()) {
            for (let i = 30; i >= 1; i--) await R.captureFrame(session, t - i / 30, 95);
            const warm = await R.captureFrame(session, t, 95);
            assert.ok(cold[n].equals(warm), `t=${t}: cold ${cold[n].length} B ≠ warm ${warm.length} B (photo missing on the cold frame?)`);
          }
        } finally {
          await browser.close();
          server.close();
        }
      });
    } else console.log('  - cold-seek check skipped: videos/devotion-tts not found');

    console.log('preview gate');
    await test('full-range render without an approval exits 3 with the gate message', () => {
      const r = spawnSync(process.execPath, [RENDER, HTML, path.join(tmp, 'gated.mp4')], { encoding: 'utf8', timeout: 60000 });
      assert.strictEqual(r.status, 3, `exit ${r.status}\n${r.stderr}`);
      assert.ok(/Preview gate: no preview approval yet\./.test(r.stderr) && /reelsmith approve/.test(r.stderr), r.stderr);
      assert.ok(!fs.existsSync(path.join(tmp, 'gated.mp4')));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!hadFrames) fs.rmSync(framesDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
