#!/usr/bin/env node
/**
 * tools/contact-sheet.js — Captures a grid of frames from a video's index.html so the
 * agent can LOOK at its own work before a full render (`reelsmith sheet`).
 *
 * Usage:
 *   reelsmith sheet <video> [--stills]
 *   node tools/contact-sheet.js videos/<name>
 *   node tools/contact-sheet.js videos/<name> --per-scene=3 --cols=4 --times=1.2,7.5
 *   node tools/contact-sheet.js videos/<name> --stills     (also write full-size JPEGs)
 *
 * Output: videos/<name>/frames/contact-sheet.png (gitignored). With --stills,
 * every sampled frame is also written full-size to frames/stills/*.jpg — these
 * are what the human reviews at the preview gate (see approve-preview.js). Thumbnails are
 * ~phone size at arm's length, so text that is hard to read here is hard to
 * read on a phone. Each thumbnail is labelled with scene, time and the words
 * being spoken at that moment, so sync can be judged from the sheet alone.
 *
 * Frames sampled:
 *   - hook: 0.3s, 1.0s, 2.0s (the first 2 seconds decide the swipe)
 *   - per scene: --per-scene evenly spaced frames inside the scene's audio span
 *   - any extra --times=a,b,c (seconds)
 *
 * The page is served over HTTP from the video's PROJECT ROOT (core/project.rootFor, core/serve.js),
 * so ../../runtime/animations.jsx and ../../styles/<pack>/kit.jsx load in clone and package mode.
 *
 * Page errors (uncaught exceptions) and console errors are collected and printed at the end
 * as `PAGE ERROR: …` lines (repeats counted once). They do not change the exit code.
 *
 * Requires: playwright (npm install && npx playwright install chromium)
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const project = require('../core/project');
const serve = require('../core/serve');

// ── CLI ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
if (!target || args.includes('--help')) {
  console.log('Usage: node tools/contact-sheet.js videos/<name> [--per-scene=3] [--cols=4] [--times=1.2,7.5] [--out=path.png] [--stills]');
  process.exit(target ? 0 : 2);
}

const getFlag = (name, def) => {
  const found = args.find(a => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : def;
};

function targetHtml(t) {
  if (t.endsWith('.html')) return path.resolve(t);
  if (fs.existsSync(t)) return path.join(path.resolve(t), 'index.html');
  try { return path.join(project.resolveVideo(t), 'index.html'); } catch (_) { return path.join(path.resolve(t), 'index.html'); }
}
const htmlPath  = targetHtml(target);
const videoDir  = path.dirname(htmlPath);
const PROJECT_ROOT = project.rootFor(videoDir);
const scenesPath = path.join(videoDir, 'scenes.json');
const PER_SCENE = Math.max(1, Number(getFlag('per-scene', 3)));
const COLS      = Math.max(1, Number(getFlag('cols', 4)));
const EXTRA     = (getFlag('times', '') || '').split(',').filter(Boolean).map(Number);
const outPath   = path.resolve(getFlag('out', path.join(videoDir, 'frames', 'contact-sheet.png')));
const STILLS    = args.includes('--stills');
const stillsDir = path.join(videoDir, 'frames', 'stills');
const WIDTH = 720, HEIGHT = 1280, THUMB_W = 252;

for (const [p, what] of [[htmlPath, 'HTML'], [scenesPath, 'scenes.json']]) {
  if (!fs.existsSync(p)) { console.error(`${what} not found: ${p}`); process.exit(2); }
}

// ── Frame plan ─────────────────────────────────────────────────────────────────

const scenes = JSON.parse(fs.readFileSync(scenesPath, 'utf8')).sort((a, b) => a.idx - b.idx);
const total  = scenes.reduce((a, s) => a + s.dur, 0);

// Absolute word timings (scene-local word times + scene audio start)
const words = [];
let cum = 0;
for (const s of scenes) {
  for (const w of s.words || []) words.push({ word: w.word, start: cum + w.start, end: cum + w.end });
  s._audioStart = cum;
  cum += s.dur;
}

const plan = [];
for (const t of [0.3, 1.0, 2.0]) if (t < total) plan.push({ t, label: 'hook' });
for (const s of scenes) {
  for (let i = 0; i < PER_SCENE; i++) {
    const t = s._audioStart + s.dur * (i + 0.5) / PER_SCENE;
    plan.push({ t, label: `scene ${s.idx}` });
  }
}
for (const t of EXTRA) if (t >= 0 && t <= total) plan.push({ t, label: 'extra' });
plan.sort((a, b) => a.t - b.t);

function spokenAround(t) {
  const near = words.filter(w => w.end >= t - 1.0 && w.start <= t + 0.3);
  return near.map(w => (w.start <= t && w.end >= t ? `[${w.word}]` : w.word)).join(' ');
}

// ── Server: the project root (core/serve.js, same as renderer/render.js) ───────

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Main ───────────────────────────────────────────────────────────────────────

// Safe area: no text line may sit within SAFE_MARGIN px of the left/right edge, or
// run wider than MAX_LINE px (~72% of the frame): edge-to-edge text looks cramped on a
// phone (creator feedback on devotion-tts). Subtitles ([data-subtitle]) and deliberate
// decorative bleeds ([data-bleed], e.g. a giant "?") are exempt, as are 1–2 char glyphs.
const SAFE_MARGIN = 48;
const MAX_LINE = 520;

/** Runs in the page: visible text lines (per rendered line box) that break the safe area. */
function findTightText({ W, margin, maxLine }) {
  const out = [];
  const seen = new Set();
  const visible = (el) => {
    let op = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      op *= parseFloat(cs.opacity || '1');
    }
    return op > 0.05;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (text.replace(/[^A-Za-z0-9]/g, '').length < 3) continue;
    if (!el || el.closest('[data-subtitle], [data-bleed], script, style') || !visible(el)) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    for (const b of r.getClientRects()) {
      if (b.width < 2 || b.bottom < 0 || b.top > 1280) continue;
      const tooClose = b.left < margin || b.right > W - margin;
      const tooWide = b.width > maxLine;
      if (!(tooClose || tooWide)) continue;
      const key = text.slice(0, 48);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: key, left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) });
    }
  }
  return out;
}

// Browser-side errors worth surfacing: uncaught exceptions + console.error, minus Babel's
// "You are using the in-browser Babel transformer" notice (expected: there is no build step).
const pageErrors = new Map(); // message → count
const IGNORED = [/in-browser Babel transformer/i];
function notePageError(msg) {
  const text = String(msg == null ? '' : msg).trim();
  if (!text || IGNORED.some(re => re.test(text))) return;
  pageErrors.set(text, (pageErrors.get(text) || 0) + 1);
}
function printPageErrors() {
  if (!pageErrors.size) return;
  console.log(`\n${pageErrors.size} page error(s) (uncaught exceptions / console.error in ${path.relative(process.cwd(), htmlPath)}):`);
  for (const [text, n] of pageErrors) {
    const lines = text.split('\n').map((l, i) => (i ? l.trim() : l));
    const head = lines.slice(0, 6).join('\n    ') + (lines.length > 6 ? '\n    …' : '');
    console.log(`PAGE ERROR: ${head}${n > 1 ? `  (×${n})` : ''}`);
  }
}

(async () => {
  const { server, url: urlOf } = await serve.start(PROJECT_ROOT);
  const url = `${urlOf(htmlPath)}?render=1`;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => notePageError(err && err.stack ? err.stack : err && err.message ? err.message : err));
    page.on('console', (msg) => { if (msg.type() === 'error') notePageError(msg.text()); });
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => typeof window.__stage !== 'undefined', { timeout: 30000 });
    await page.waitForTimeout(1200); // fonts + images

    console.log(`Capturing ${plan.length} frames from ${path.relative(process.cwd(), htmlPath)} (${total.toFixed(2)}s)...`);
    const shots = [];
    const crowded = new Map(); // text → { text, left, right, width, times[] }
    if (STILLS) { fs.rmSync(stillsDir, { recursive: true, force: true }); fs.mkdirSync(stillsDir, { recursive: true }); }
    for (const [n, f] of plan.entries()) {
      await page.evaluate((time) => window.__stage.setTime(time), f.t);
      // Two rAF cycles — first processes React's setState, second paints
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const buf = await page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      if (STILLS) {
        const name = `${String(n + 1).padStart(2, '0')}-${f.label.replace(/\s+/g, '')}-${f.t.toFixed(1)}s.jpg`;
        await page.screenshot({ path: path.join(stillsDir, name), type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      }
      const tight = await page.evaluate(findTightText, { W: WIDTH, margin: SAFE_MARGIN, maxLine: MAX_LINE });
      for (const x of tight) {
        const k = x.text;
        if (!crowded.has(k)) crowded.set(k, { ...x, times: [] });
        crowded.get(k).times.push(f.t);
      }
      shots.push({ ...f, src: `data:image/png;base64,${buf.toString('base64')}`, spoken: spokenAround(f.t), tight: tight.length });
    }

    const cells = shots.map(s => `
      <figure>
        <img src="${s.src}">
        <figcaption><b>${esc(s.label)} · ${s.t.toFixed(2)}s</b>${s.tight ? ` <span style="color:#f5a623">⚠ ${s.tight} edge-to-edge</span>` : ''}<br>${esc(s.spoken) || '<i>silence</i>'}</figcaption>
      </figure>`).join('');

    const sheet = await browser.newPage();
    await sheet.setViewportSize({ width: COLS * (THUMB_W + 16) + 16, height: 800 });
    await sheet.setContent(`<!DOCTYPE html><html><head><style>
      body { margin: 0; padding: 8px; background: #1a1a1a; font: 12px/1.35 system-ui, sans-serif; color: #ddd; }
      .grid { display: grid; grid-template-columns: repeat(${COLS}, ${THUMB_W}px); gap: 16px; padding: 8px; }
      figure { margin: 0; }
      img { width: ${THUMB_W}px; display: block; border: 1px solid #333; }
      figcaption { margin-top: 4px; min-height: 3em; }
      b { color: #fff; }
    </style></head><body><div class="grid">${cells}</div></body></html>`, { waitUntil: 'load' });

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await sheet.screenshot({ path: outPath, fullPage: true });
    console.log(`✓ contact sheet → ${path.relative(process.cwd(), outPath)}`);
    if (STILLS) console.log(`✓ ${plan.length} full-size stills → ${path.relative(process.cwd(), stillsDir)}/`);
    if (crowded.size) {
      console.log(`\n⚠ ${crowded.size} text line(s) run too close to the frame edge or too wide (margin ${SAFE_MARGIN}px, max line ${MAX_LINE}px). Fix before render (styles/<style>/STYLE.md "Safe area"):`);
      for (const c of crowded.values()) {
        console.log(`  "${c.text}"  left ${c.left}px · right ${WIDTH - c.right}px · width ${c.width}px  @ ${c.times.map(t => t.toFixed(1) + 's').join(', ')}`);
      }
    } else {
      console.log(`\n✓ safe area: no text line within ${SAFE_MARGIN}px of an edge or wider than ${MAX_LINE}px`);
    }
    console.log(`\nNow LOOK at it and score 1–10 (see .claude/skills/html-animation/SKILL.md, "Self-critique loop"):`);
    console.log(`  hook · phone readability · breathing room · motion quality · variety · brand accuracy · sync`);
  } finally {
    printPageErrors();
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
