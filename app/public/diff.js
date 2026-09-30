'use strict';
/* video-gen-v2 — heard-text diff for the Review view (pure functions, no DOM/state).
 * Aligns a sentence's script text against the words Whisper heard so the UI can show
 * inserted/filler words (amber strike-through), substitutions (red) and dropped script
 * words (wavy underline). This is a display aid only — take.json flags are the truth.
 * Loaded before app.js; exposes globals: FILLERS, normWord, similar, diffSentence. */

const FILLERS = new Set(['um', 'uh', 'uhm', 'umm', 'er', 'erm', 'ah', 'hmm', 'mm', 'like', 'basically', 'actually', 'literally', 'right', 'okay', 'ok', 'so']);

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numWords(n) {
  if (n < 20) return [ONES[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
  if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? numWords(n % 100) : [])];
  for (const [v, w] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= v) return [...numWords(Math.floor(n / v)), w, ...(n % v ? numWords(n % v) : [])];
  }
  return [String(n)];
}
const UNITS = { ms: 'milliseconds', s: 'seconds', gb: 'gigabytes', mb: 'megabytes', kb: 'kilobytes', tb: 'terabytes', k: 'thousand', '%': 'percent' };

/** Normalize one raw word into comparable sub-tokens (lowercase, no punctuation, digits → words). */
function normWord(raw) {
  const w = String(raw).toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'%$.\-]/gu, '');
  const out = [];
  for (let part of w.split('-')) {
    part = part.replace(/^[.']+|[.']+$/g, '');
    if (!part) continue;
    const m = /^\$?(\d{1,12})(?:\.\d+)?([a-z%]*)$/.exec(part);
    if (m && !/^[a-z]+\d/.test(part)) {
      out.push(...numWords(Number(m[1])));
      if (m[2]) out.push(UNITS[m[2]] || m[2]);
      if (part.startsWith('$')) out.push('dollars');
    } else out.push(part.replace(/[%$.]/g, ''));
  }
  return out.filter(Boolean);
}

function similar(a, b) {
  if (a === b) return true;
  const L = Math.max(a.length, b.length);
  if (L < 4) return false;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return 1 - d[b.length] / L >= 0.7;
}

/** LCS-align script tokens vs heard tokens → per-word classes for display. */
function diffSentence(scriptText, heard, flags) {
  const sTok = scriptText.split(/\s+/).filter(Boolean).map((raw, i) => ({ raw, i, sub: normWord(raw.replace(/`/g, '')) }));
  const a = [], b = [];
  sTok.forEach((t) => t.sub.forEach((x) => a.push({ x, t: t.i })));
  heard.forEach((w, i) => normWord(w.word).forEach((x) => b.push({ x, t: i })));
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = similar(a[i].x, b[j].x) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const sMatched = new Set(), hMatched = new Set(), gaps = [];
  let i = 0, j = 0, gap = { d: [], ins: [] };
  while (i < n || j < m) {
    if (i < n && j < m && similar(a[i].x, b[j].x) && dp[i][j] === dp[i + 1][j + 1] + 1) {
      sMatched.add(a[i].t); hMatched.add(b[j].t); gaps.push(gap); gap = { d: [], ins: [] }; i++; j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { gap.ins.push(b[j].t); j++; }
    else { gap.d.push(a[i].t); i++; }
  }
  gaps.push(gap);
  const flagRanges = (flags || []).filter((f) => f.range && /filler|stutter/.test(f.type)).map((f) => f.range);
  const hClass = heard.map((w, k) => {
    if (w.op === 'match') return '';
    const inFlag = flagRanges.some((r) => w.start < r.end && w.end > r.start);
    if (w.op === 'ins' || inFlag || FILLERS.has(normWord(w.word).join(' '))) return hMatched.has(k) && !inFlag ? '' : 'w-ins';
    if (w.op === 'sub') return 'w-sub';
    return hMatched.has(k) ? '' : null;       // null = unmatched, resolved below
  });
  for (const g of gaps) {                        // pair unmatched heard words with dropped script words → substitutions
    let subs = new Set(g.d).size;
    for (const k of new Set(g.ins)) {
      if (hClass[k] !== null) continue;
      hClass[k] = subs > 0 ? 'w-sub' : 'w-ins';
      if (subs > 0) subs--;
    }
  }
  return { sClass: sTok.map((t) => (sMatched.has(t.i) || !t.sub.length ? '' : 'w-del')), sTok, hClass: hClass.map((c) => c || '') };
}

/* ─── role-based classification (pipeline-driven, no re-diffing) ───
 * take.json's words[] already carry the pipeline's own verdict per word
 * (pipeline/analyze.js §4 word roles: 'anchor' = aligned to script — matched
 * or an accepted substitution (align.js normalizes numbers/currency/units, so
 * e.g. script "$0.30" heard as "30 cents" aligns exactly and is 'anchor', not
 * a diff-time substitution); 'filler'/'extra'/'stutter'/'restart'/'gap' =
 * heard but not the matched script wording; 'punct' = punctuation-only token).
 * Use these instead of re-diffing whenever every word carries a `.role`
 * (see heardWords() in app.js — rerecord clip words never do, since
 * pipeline/splice.js strips role/sid before saving sentence.source.words). */
const INSERTED_ROLES = new Set(['filler', 'extra', 'stutter', 'restart', 'gap']);

/**
 * Classify already-role-tagged heard `words` for display, using the
 * sentence's own `flags` (take.json §6) to best-effort pair a substituted or
 * fully-dropped key script token with the heard word that replaced it.
 * Returns { hClass, hNote, dangling } parallel to `words`:
 *   hClass[i]   — '' | 'w-ins' | 'w-sub' css class for heard word i
 *   hNote[i]    — dim script-token label to show beside heard word i, or null
 *   dangling    — expected script tokens with no heard counterpart at all
 *                 ("X not heard" — nothing to sit beside, shown as trailing chips)
 */
function roleDiff(words, flags) {
  const hClass = words.map((w) => (INSERTED_ROLES.has(w.role) ? 'w-ins' : ''));
  const hNote = words.map(() => null);
  const dangling = [];
  const clean = (w) => String(w).toLowerCase().replace(/[.,;:!?]+$/, '');
  const used = new Set();
  for (const f of flags || []) {
    if (f.type !== 'dropped-key') continue;
    const subM = /^"(.+)" heard as "(.+)"$/.exec(f.detail || '');
    if (!subM) { const missM = /^"(.+)" not heard$/.exec(f.detail || ''); if (missM) dangling.push(missM[1]); continue; }
    const [, expected, heard] = subM;
    const heardToks = heard.toLowerCase().split(/\s+/).map((t) => t.replace(/[.,;:!?]+$/, ''));
    let hit = -1, len = 1;
    for (let i = 0; i <= words.length - heardToks.length; i++) {          // contiguous phrase first
      if (used.has(i)) continue;
      if (heardToks.every((t, k) => !used.has(i + k) && clean(words[i + k].word) === t)) { hit = i; len = heardToks.length; break; }
    }
    if (hit < 0) for (let i = 0; i < words.length; i++) {                 // else any single matching word
      if (!used.has(i) && heardToks.includes(clean(words[i].word))) { hit = i; len = 1; break; }
    }
    if (hit < 0) { dangling.push(expected); continue; }
    for (let k = 0; k < len; k++) { hClass[hit + k] = 'w-sub'; used.add(hit + k); }
    hNote[hit + len - 1] = expected;
  }
  return { hClass, hNote, dangling };
}
