#!/usr/bin/env node
// tools/check-sync.js  (`reelsmith lint` runs it together with validate-sync.js)
//
// Pre-render lint: flags hand-picked second-based delays in a video's
// index.html that should be bound to useWordCue() instead, and anything that
// makes a frame depend on the wall clock (Math.random, timers, rAF, CSS
// transitions/animations). See .claude/skills/html-animation/SKILL.md.
//
// Usage:
//   node tools/check-sync.js videos/<name>/index.html     (a video folder or name works too)
//
// Exit code 0 if clean, 1 if any violations.
//
// A line is OK if:
//   - the delay number is <= 0.6 (intro flourish allowance), OR
//   - the line contains the token `useWordCue` or a variable starting with
//     `cue` (case-insensitive), OR
//   - the line (or line above) contains the magic comment `// sync-ok`.

const fs = require('fs');
const path = require('path');

const THRESHOLD = 0.6;

let file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/check-sync.js <path/to/index.html | video dir>');
  process.exit(2);
}
if (!file.endsWith('.html')) {                 // a video folder, or a name under videos/
  let dir = file;
  if (!fs.existsSync(dir)) { try { dir = require('../core/project').resolveVideo(file); } catch (_) { /* reported below */ } }
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) file = path.join(dir, 'index.html');
}
if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(2);
}

const src = fs.readFileSync(file, 'utf8');
const lines = src.split('\n');

// Patterns to catch numeric delays
const patterns = [
  // localTime - 7.5   (inside slideUp/fade calls)
  { re: /localTime\s*-\s*(\d+(?:\.\d+)?)\b/g, label: 'localTime - N' },
  // delay={0.8} or delay={1.4}
  { re: /delay\s*=\s*\{\s*(\d+(?:\.\d+)?)\s*\}/g, label: 'delay={N}' },
  // delay: 0.5  (object literal form)
  { re: /\bdelay\s*:\s*(\d+(?:\.\d+)?)\b/g, label: 'delay: N' },
];

// Determinism: every frame must be a pure function of time. Anything driven by
// the wall clock or an unseeded RNG renders differently on every run.
const nondeterministic = [
  { re: /\bMath\.random\s*\(/,                 label: 'Math.random() — use seededRandom(seed)' },
  { re: /\b(setTimeout|setInterval)\s*\(/,     label: 'timer — derive from localTime instead' },
  { re: /\brequestAnimationFrame\s*\(/,        label: 'requestAnimationFrame — derive from localTime instead' },
  { re: /\b(Date\.now|performance\.now)\s*\(|\bnew Date\s*\(\s*\)/, label: 'wall clock — derive from localTime instead' },
  { re: /\btransition\s*:/,                    label: 'CSS transition — animate from localTime instead' },
  { re: /\banimation\s*:/,                     label: 'CSS animation — animate from localTime instead' },
];

const violations = [];

lines.forEach((line, i) => {
  const prev = lines[i - 1] || '';
  const okComment = /\/\/\s*sync-ok/.test(line) || /\/\/\s*sync-ok/.test(prev);
  if (okComment) return;

  for (const { re, label } of nondeterministic) {
    const m = line.match(re);
    if (m) {
      violations.push({ line: i + 1, col: m.index + 1, value: null, label, text: line.trim() });
    }
  }

  // Is this line "cue-aware"? The delay value references a cue variable or
  // useWordCue call inline.
  const cueAware = /\buseWordCue\s*\(/.test(line) || /\bcue[A-Z_]\w*/.test(line);

  for (const { re, label } of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const n = parseFloat(m[1]);
      if (n <= THRESHOLD) continue;
      if (cueAware) continue;
      violations.push({
        line: i + 1,
        col: m.index + 1,
        value: n,
        label,
        text: line.trim(),
      });
    }
  }

  // Rule: ...fade() spread on a line that looks like a text overlay.
  // fade() has a built-in fadeOut which hides text before the scene ends.
  // Text overlays must use ...slideUp() (enter-only).
  // Exception: full-cover scrim divs (inset: 0 without font props) and CTA cards.
  if (/\.\.\.(fade\s*\()/.test(line)) {
    const isCTA      = /CTACard|cta[-_]end/i.test(line);
    const isInsetCover = /inset:\s*0/.test(line) && !/fontFamily|fontSize|fontWeight/.test(line);
    if (!isCTA && !isInsetCover) {
      // Check ±6-line window for text-style props
      const wStart   = Math.max(0, i - 6);
      const wEnd     = Math.min(lines.length, i + 6);
      const hasText  = lines.slice(wStart, wEnd).join('\n');
      if (/fontFamily|fontSize|fontWeight/.test(hasText)) {
        violations.push({
          line: i + 1,
          col: line.indexOf('fade') + 1,
          value: null,
          label: '...fade() on text overlay',
          text: line.trim(),
        });
      }
    }
  }
});

const rel = path.relative(process.cwd(), file);

if (violations.length === 0) {
  console.log(`✓ sync-check ok — ${rel}`);
  process.exit(0);
}

console.error(`✗ sync-check FAILED — ${rel}`);
console.error(`  ${violations.length} violation(s) found.\n`);
for (const v of violations) {
  if (v.value !== null) {
    console.error(`  ${rel}:${v.line}  ${v.label} = ${v.value}`);
  } else {
    console.error(`  ${rel}:${v.line}  ${v.label}`);
  }
  console.error(`      ${v.text}`);
}
console.error(`\nFix:`);
console.error(`  - Hand-picked delays: replace with a useWordCue(sceneIdx, "phrase") value.`);
console.error(`  - fade() on text: replace ...fade(localTime, duration) with ...slideUp(Math.max(0, localTime - cue), 0.5).`);
console.error(`  - fade() is only for background scrims and CTA cards.`);
console.error(`  - Nondeterminism: compute from localTime (spring/track/interpolate), seed randomness with seededRandom().`);
console.error(`See .claude/skills/html-animation/SKILL.md. Add // sync-ok on the line to whitelist a deliberate exception.`);
process.exit(1);
