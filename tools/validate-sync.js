#!/usr/bin/env node
// tools/validate-sync.js  (`reelsmith lint` runs it together with check-sync.js)
//
// Post-generation validator for index.html sync correctness.
// Runs three checks (the third — SubtitleRail presence on every narrated
// scene — is described at "Check 3" below):
//
//   1. useWordCue phrase validation — every useWordCue(N, "phrase") call is
//      tested against the actual scenes.json word tokens. If a phrase doesn't
//      match (even via the first-word fallback) it will return Infinity at
//      runtime and the overlay will never appear. The phrase is read as a JS
//      string literal ("let's build", 'say "hi"', escapes), like the runtime.
//
//   2. fade() on text overlays — ...fade( spread on a style object that
//      contains text-style props (fontFamily / fontSize / fontWeight) causes
//      the text to fade OUT before the scene ends. Text overlays must use
//      ...slideUp() which is enter-only. Only CTA / background divs should
//      use fade().
//
// Usage:
//   node tools/validate-sync.js videos/<name>/index.html [videos/<name>/scenes.json]
//   If scenes.json is not provided, defaults to same directory as index.html.
//   A video folder or name works in place of the html path.
//
// Exit code 0 = clean (or warnings only), 1 = errors found, 2 = usage error.
//
// Output is machine-readable for the correction loop in the html-animation skill:
//   ISSUE:<type>:line <N>: <message>
//
// Add  // sync-ok  on the line (or the line above) to whitelist a deliberate
// exception for either check.

'use strict';

const fs   = require('fs');
const path = require('path');

// ── CLI ───────────────────────────────────────────────────────────────────────

let htmlFile     = process.argv[2];
const scenesArg  = process.argv[3];

if (!htmlFile) {
  console.error('Usage: node tools/validate-sync.js <index.html | video dir> [scenes.json]');
  process.exit(2);
}
if (!htmlFile.endsWith('.html')) {             // a video folder, or a name under videos/
  let dir = htmlFile;
  if (!fs.existsSync(dir)) { try { dir = require('../core/project').resolveVideo(htmlFile); } catch (_) { /* reported below */ } }
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) htmlFile = path.join(dir, 'index.html');
}
if (!fs.existsSync(htmlFile)) {
  console.error(`File not found: ${htmlFile}`);
  process.exit(2);
}

const scenesPath = scenesArg || path.join(path.dirname(htmlFile), 'scenes.json');
if (!fs.existsSync(scenesPath)) {
  console.error(`scenes.json not found: ${scenesPath}`);
  process.exit(2);
}

// ── Load data ─────────────────────────────────────────────────────────────────

const src    = fs.readFileSync(htmlFile, 'utf8');
const lines  = src.split('\n');
const scenes = JSON.parse(fs.readFileSync(scenesPath, 'utf8'));

// Build per-scene word lookup (scene idx → [{word, start, end}])
const sceneWords = {};
for (const scene of scenes) {
  if (Array.isArray(scene.words) && scene.words.length) {
    sceneWords[scene.idx] = scene.words;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Returns { matched, start?, fallback?, reason? }
function phraseMatchesScene(sceneIdx, phrase) {
  const words = sceneWords[sceneIdx];
  if (!words) {
    return { matched: false, reason: `scene ${sceneIdx} has no word data in scenes.json` };
  }

  const tokens = String(phrase).trim().split(/\s+/).map(norm).filter(Boolean);
  if (!tokens.length) return { matched: false, reason: 'empty phrase' };

  const flat = words.map(w => ({ n: norm(w.word), start: w.start, raw: w.word }));

  // Exact consecutive match
  for (let i = 0; i <= flat.length - tokens.length; i++) {
    let hit = true;
    for (let j = 0; j < tokens.length; j++) {
      if (flat[i + j].n !== tokens[j]) { hit = false; break; }
    }
    if (hit) return { matched: true, start: flat[i].start };
  }

  // First-word fallback
  const firstIdx = flat.findIndex(f => f.n === tokens[0]);
  if (firstIdx !== -1) {
    return {
      matched: true,
      start: flat[firstIdx].start,
      fallback: true,
      note: `only first word "${flat[firstIdx].raw}" matched (multi-word phrase not consecutive in scene ${sceneIdx})`,
    };
  }

  const sample = flat.slice(0, 8).map(f => f.raw).join(', ');
  return {
    matched: false,
    reason: `phrase "${phrase}" not found in scene ${sceneIdx} words (first 8 words: ${sample})`,
  };
}

// Line number (1-based) of a character offset in the source
function lineOf(offset) {
  return src.slice(0, offset).split('\n').length;
}

// Is a line (0-based) whitelisted by // sync-ok on itself or the line above?
function isSyncOk(lineIdx) {
  const cur  = lines[lineIdx]     || '';
  const prev = lines[lineIdx - 1] || '';
  return /\/\/\s*sync-ok/.test(cur) || /\/\/\s*sync-ok/.test(prev);
}

// ── Check 1: useWordCue phrase validation ─────────────────────────────────────

const issues = []; // { type, severity, line, message }

// Reads the JS string literal that starts at src[start] (a " or '). Returns its value, or null
// when there is no literal there or it is unterminated on that line. A double-quoted string may
// contain ' ("let's build") and a single-quoted one " ; \" \' \\ and the usual escapes work.
const ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
function readStringLiteral(text, start) {
  const q = text[start];
  if (q !== '"' && q !== "'") return null;
  let out = '';
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === q) return out;
    if (c === '\n') return null;
    if (c === '\\') {
      const e = text[++i];
      if (e === undefined) return null;
      if (e === '\n') continue;                    // line continuation
      const hex = e === 'x' ? /^[0-9a-fA-F]{2}/.exec(text.slice(i + 1))
        : e === 'u' ? /^(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})/.exec(text.slice(i + 1)) : null;
      const cp = hex ? parseInt(hex[0].replace(/[{}]/g, ''), 16) : -1;
      if (hex && cp <= 0x10FFFF) {
        out += String.fromCodePoint(cp);
        i += hex[0].length;
        continue;
      }
      out += Object.prototype.hasOwnProperty.call(ESC, e) ? ESC[e] : e;
      continue;
    }
    out += c;
  }
  return null;
}

const cueRe = /useWordCue\(\s*(\d+)\s*,\s*(?=["'])/g;
let m;
while ((m = cueRe.exec(src)) !== null) {
  const sceneIdx = parseInt(m[1], 10);
  const phrase   = readStringLiteral(src, m.index + m[0].length);
  if (phrase === null) continue;
  const lineNum  = lineOf(m.index);
  const lineIdx  = lineNum - 1;

  if (isSyncOk(lineIdx)) continue;

  const result = phraseMatchesScene(sceneIdx, phrase);

  if (!result.matched) {
    issues.push({
      type: 'unmatched-cue',
      severity: 'error',
      line: lineNum,
      message: `useWordCue(${sceneIdx}, "${phrase}") — ${result.reason}`,
    });
  } else if (result.fallback) {
    issues.push({
      type: 'partial-cue',
      severity: 'warn',
      line: lineNum,
      message: `useWordCue(${sceneIdx}, "${phrase}") — ${result.note}`,
    });
  }
}

// ── Check 2: ...fade() spread on text overlay elements ────────────────────────
// Heuristic: if a line contains ...fade( AND within a ±6-line window there is
// a fontFamily/fontSize/fontWeight style prop, it's likely a text overlay.
// Exceptions: lines containing `inset: 0` without text props (full-cover
// background/scrim divs) and CTACard context are skipped.

const fadeRe = /\.\.\.(fade\s*\()/g;
while ((m = fadeRe.exec(src)) !== null) {
  const lineNum = lineOf(m.index);
  const lineIdx = lineNum - 1;
  const line    = lines[lineIdx] || '';

  if (isSyncOk(lineIdx)) continue;

  // CTA / background-overlay exceptions
  const isCTA = /CTACard|cta[-_]end/i.test(line);
  if (isCTA) continue;

  // Full-cover scrim divs: position: absolute, inset: 0, background: ...
  // These legitimately fade. Detect: inset:0 on the same line and no font props.
  const isInsetCover = /inset:\s*0/.test(line) && !/fontFamily|fontSize|fontWeight/.test(line);
  if (isInsetCover) continue;

  // Check surrounding window for text-style props
  const windowStart = Math.max(0, lineIdx - 6);
  const windowEnd   = Math.min(lines.length, lineIdx + 6);
  const window      = lines.slice(windowStart, windowEnd).join('\n');
  const hasTextStyle = /fontFamily|fontSize|fontWeight/.test(window);

  if (hasTextStyle) {
    issues.push({
      type: 'fade-on-text',
      severity: 'error',
      line: lineNum,
      message: `...fade() spread on what appears to be a text overlay (line ${lineNum}). ` +
               `fade() has a fadeOut that hides text before the scene ends. ` +
               `Use ...slideUp() for text overlays (enter-only). ` +
               `Add // sync-ok to whitelist if this is intentional.`,
    });
  }
}

// ── Check 3: SubtitleRail presence ───────────────────────────────────────────
// Every narrated scene Sprite must have a <SubtitleRail sceneIdx={N} />.
// Heuristic: find all useSceneWindow(N) calls, check each N has a matching
// SubtitleRail sceneIdx={N}. Only silent scenes — no `words` (or an empty
// array) in scenes.json, e.g. a wordless CTA — are exempt. Position doesn't
// matter: a narrated last scene (CTA line spoken over it) needs its rail too.

const sceneWindowRe = /useSceneWindow\(\s*(\d+)\s*[,)]/g;
while ((m = sceneWindowRe.exec(src)) !== null) {
  const sceneIdx = parseInt(m[1], 10);
  // Skip silent scenes (sceneWords only holds scenes with words.length > 0)
  if (!sceneWords[sceneIdx]) continue;

  // Check if SubtitleRail with this sceneIdx exists anywhere in the file
  const railPattern = new RegExp(`SubtitleRail[^}]*sceneIdx\\s*=\\s*\\{?\\s*${sceneIdx}(?!\\d)\\s*\\}?`);
  if (!railPattern.test(src)) {
    issues.push({
      type: 'missing-subtitle',
      severity: 'warn',
      line: lineOf(m.index),
      message: `Scene ${sceneIdx} has no <SubtitleRail sceneIdx={${sceneIdx}} />. Every narrated scene must have SubtitleRail (see config/components.md).`,
    });
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

const rel    = path.relative(process.cwd(), htmlFile);
const errors = issues.filter(i => i.severity === 'error');
const warns  = issues.filter(i => i.severity === 'warn');

if (issues.length === 0) {
  console.log(`✓ validate-sync ok — ${rel}`);
  process.exit(0);
}

const exitCode = errors.length > 0 ? 1 : 0;

if (errors.length > 0) {
  console.error(`✗ validate-sync FAILED — ${rel}`);
  console.error(`  ${errors.length} error(s), ${warns.length} warning(s)\n`);
} else {
  console.log(`⚠ validate-sync warnings — ${rel}`);
  console.log(`  ${warns.length} warning(s)\n`);
}

for (const issue of issues) {
  const tag    = issue.severity === 'error' ? '✗' : '⚠';
  const stream = issue.severity === 'error' ? console.error : console.log;
  // Machine-readable prefix for the correction loop
  stream(`ISSUE:${issue.type}:line ${issue.line}: ${issue.message}`);
  stream(`  ${tag}  ${rel}:${issue.line}`);
}

if (errors.length > 0) {
  console.error(
    `\nFix guidance:\n` +
    `  - unmatched-cue: update the phrase to match actual words in scenes.json.\n` +
    `    Run: reelsmith lint <video> (or node tools/validate-sync.js <html>) to re-check after fixing.\n` +
    `  - fade-on-text:  replace ...fade(localTime, duration) with ...slideUp(Math.max(0, localTime - cue), 0.5)\n` +
    `    on text overlay elements. fade() is only for background scrims and CTA cards.\n` +
    `  Add // sync-ok on the line to whitelist a deliberate exception.`
  );
}

process.exit(exitCode);
