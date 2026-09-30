'use strict';
/**
 * pipeline/align.js — script ↔ transcript alignment (docs/spec.md §7).
 *
 * WHAT IS IMPLEMENTED
 *
 * 1. normalize(token) → string[]
 *    lowercase; curly quotes folded; punctuation stripped (inner apostrophes
 *    kept); hyphen/slash split ("cold-start" → cold start, "$0.30/hour" →
 *    thirty cents per hour); "EC-2"/"S-3" re-joined to ec2/s3; mixed
 *    alphanumerics kept as-is (s3, ec2, k8s); numerals expanded:
 *      900ms → nine hundred milliseconds    $0.30 → thirty cents
 *      $5M → five million dollars            15% → fifteen percent
 *      1.5 → one point five   3 → three   1st → first   10x → ten times
 *      2026 → twenty twenty six (1100–9999 read year-style, value-based)
 *    Standalone unit abbreviations right after a number ("900 ms") expand too.
 *    tokenize() also canonicalizes runs of number WORDS by value ("one thousand
 *    five hundred" ≡ "fifteen hundred" ≡ "1500"), so digits vs words never
 *    matter — both sides converge on the same canonical spelling.
 *
 * 2. align(S, T) — global Needleman–Wunsch, O(n·m) time/memory (typed arrays).
 *    Costs (config/fillers.json alignCosts): exact 0, fuzzy 0.35 (Levenshtein
 *    ratio ≥ 0.7, both ≥3 chars), sub 1.0, del 1.0, ins 0.6, filler ins 0.3.
 *    Insertions are cheap (fillers cheapest) and deletions dear, so extra
 *    speech never displaces script words; out-of-order speech costs a full
 *    del+ins of the sentence (then recovered by pass C below).
 *    Number tokens (derived from digits, or number words) never fuzzy-match:
 *    million≠billion, fifteen≠fifty. Merge ops (cost 0) align one token to two
 *    ("dynamodb" ↔ "dynamo db") in either direction.
 *    Tie-break: backpointers prefer diagonal > merge > ins > del. Traceback
 *    runs from the end, so among equal-cost paths each script token takes the
 *    LATEST transcript token → earlier duplicates (stutters, restarts,
 *    retakes of a line) become insertions and the later attempt is kept.
 *
 * 3. mapSentences() — per-sentence mapping + post-passes:
 *    A. anchors = script tokens with op match/sub; range = first..last anchor;
 *       insertions strictly between a sentence's anchors belong to it.
 *    B. missing: coverage (matched tokens / tokens) < missingCoverage (0.34)
 *       → sentence is missing, its stray anchors are released as insertions.
 *    C. restart re-anchor: if an insertion run INSIDE a sentence repeats the
 *       tokens anchored before it (the speaker restarted mid-sentence and the
 *       DP stitched two attempts), the sentence is re-aligned against the
 *       transcript from that run onward; the later attempt is adopted when its
 *       coverage is ≥ the stitched coverage − 0.15. Everything before it
 *       becomes an abandoned attempt (analyze cuts + flags it as a restart).
 *       The run may also start on the sentence's 2nd token when whisper dropped
 *       the 1st word of the retake, if ≥3 inserted tokens there repeat the opening.
 *    D. order recovery: each missing sentence is fitted (same DP) against every
 *       unowned transcript gap; a fit with coverage ≥ orderMinCoverage (0.6)
 *       is adopted, and flagged `order` if it sits outside its script slot.
 *    F. split (runs before D): a span that swallowed an insertion run plus a few
 *       scattered anchors borrowed from the next line's retake is re-fitted to
 *       the part before (or after) the run when that cuts its errors by ≥ 2.
 *    E. edge compaction: an edge anchor tied to a far duplicate ("over you, and
 *       you feel you") moves to the identical inserted token next to the body.
 *
 * 4. Attempts (pipeline/attempts.js, run by analyze.js after mapSentences):
 *    the tie-break above keeps the LATEST complete saying of a line; analyze
 *    then fits the sentence (fit(), exported) against every unowned span next to
 *    it, scores each complete attempt (coverage ≥ attempts.minCoverage) and
 *    re-anchors the sentence to the best one — see docs/spec.md §7a.
 */

// ── numbers → words ──────────────────────────────────────────────────────────
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
const NUM_WORDS = new Set([...ONES, ...TENS.filter(Boolean), 'hundred', 'thousand', 'million', 'billion', 'trillion']);

function under1000(n) {
  const out = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)], 'hundred'); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)]); if (n % 10) out.push(ONES[n % 10]); } else if (n > 0 || !out.length) out.push(ONES[n]);
  return out;
}

/** Canonical spelling of a non-negative integer (value-based, so words and digits converge). */
function intToWords(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return ['zero'];
  if (n >= 1100 && n <= 9999 && n % 1000 !== 0) {            // "fifteen hundred", "twenty twenty six"
    const hi = Math.floor(n / 100), lo = n % 100;
    if (lo === 0) return [...under1000(hi), 'hundred'];
    if (n >= 2001 && n <= 2009) return ['two', 'thousand', ONES[lo]];
    if (lo >= 10) return [...under1000(hi), ...under1000(lo)];
  }
  const out = [];
  for (const [v, name] of SCALES) {
    if (n >= v) { out.push(...intToWords(Math.floor(n / v)), name); n %= v; }
  }
  if (n > 0) out.push(...under1000(n));
  return out;
}

/** "1.5" → one point five; "0.30" → zero point three zero; "1,000" → one thousand. */
function numberToWords(str) {
  const s = String(str).replace(/,/g, '');
  const [int, frac] = s.split('.');
  const out = intToWords(parseInt(int || '0', 10));
  if (frac !== undefined && frac.length) out.push('point', ...frac.split('').map(d => ONES[+d]));
  return out;
}

function ordinal(words) {
  const w = words[words.length - 1];
  const irregular = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
  const last = irregular[w] || (w.endsWith('y') ? w.slice(0, -1) + 'ieth' : w + 'th');
  return [...words.slice(0, -1), last];
}

const UNITS = {
  ms: ['milliseconds'], msec: ['milliseconds'], s: ['seconds'], sec: ['seconds'], secs: ['seconds'],
  min: ['minutes'], mins: ['minutes'], h: ['hours'], hr: ['hours'], hrs: ['hours'], us: ['microseconds'], ns: ['nanoseconds'],
  kb: ['kilobytes'], mb: ['megabytes'], gb: ['gigabytes'], tb: ['terabytes'], pb: ['petabytes'],
  kib: ['kibibytes'], mib: ['mebibytes'], gib: ['gibibytes'], tib: ['tebibytes'],
  kbps: ['kilobits', 'per', 'second'], mbps: ['megabits', 'per', 'second'], gbps: ['gigabits', 'per', 'second'],
  hz: ['hertz'], khz: ['kilohertz'], mhz: ['megahertz'], ghz: ['gigahertz'],
  k: ['thousand'], m: ['million'], b: ['billion'], bn: ['billion'], t: ['trillion'],
  x: ['times'], '%': ['percent'], rps: ['requests', 'per', 'second'], qps: ['queries', 'per', 'second'],
};
// Standalone unit tokens only expand right after a number ("900 ms"); ambiguous ones excluded.
const STANDALONE_UNITS = new Set(['ms', 'msec', 'sec', 'secs', 'kb', 'mb', 'gb', 'tb', 'pb', 'gib', 'mib',
  'kbps', 'mbps', 'gbps', 'ghz', 'mhz', 'khz', 'hz', '%', 'k', 'x', 'rps', 'qps']);
const CURRENCY = { $: ['dollar', 'dollars'], '€': ['euro', 'euros'], '£': ['pound', 'pounds'] };
const SYNONYMS = { ok: ['okay'], alright: ['all', 'right'], percent: ['percent'] };
const MULT = { k: 'thousand', m: 'million', b: 'billion', bn: 'billion', t: 'trillion' };

function moneyToWords(sym, amount, mult) {
  const [one, many] = CURRENCY[sym];
  const s = amount.replace(/,/g, '');
  if (mult) return [...numberToWords(s), MULT[mult.toLowerCase()], many];
  const v = parseFloat(s);
  const [int, frac = ''] = s.split('.');
  if (!frac || /^0+$/.test(frac)) { const n = parseInt(int, 10); return [...intToWords(n), n === 1 ? one : many]; }
  const centsStr = (frac + '00').slice(0, 2) + (frac.length > 2 ? '.' + frac.slice(2) : '');
  const cents = numberToWords(centsStr.replace(/^0(\d)/, '$1'));
  const centWord = parseFloat(centsStr) === 1 ? 'cent' : 'cents';
  if (v < 1) return [...cents, centWord];
  const n = parseInt(int, 10);
  return [...intToWords(n), n === 1 ? one : many, ...cents, centWord];
}

// ── normalize ────────────────────────────────────────────────────────────────
const FOLD = [[/[‘’ʼ′]/g, "'"], [/[“”″]/g, '"'], [/…/g, ' ']];
const DASHES = /[‒–—―]|--+/;

function clean(t) {
  return t.replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
}

/**
 * Normalize one raw word → { toks: string[], num: bool, unitAfterNumber?: bool }.
 * `prevNumeric` enables standalone unit expansion ("900 ms").
 */
function normalizeWord(raw, prevNumeric = false) {
  let w = String(raw);
  for (const [re, rep] of FOLD) w = w.replace(re, rep);
  w = w.trim().replace(/^[("'\[{<*_¿¡`]+/, '').replace(/[)"'\]}>*_.,;:!?`]+$/, '');
  if (!w) return { toks: [], num: false };
  const lw = w.toLowerCase();

  if (prevNumeric && STANDALONE_UNITS.has(lw)) return { toks: UNITS[lw].slice(), num: true };
  if (lw === '&') return { toks: ['and'], num: false };
  if (lw === '+') return { toks: ['plus'], num: false };
  if (lw === '%') return { toks: ['percent'], num: true };

  // money: $0.30, $5, $1,200.50, $5M, optionally /unit
  let m = w.match(/^([$€£])(\d[\d,]*(?:\.\d+)?)(k|m|b|bn|t)?(?:\/(\w+))?$/i);
  if (m) {
    const toks = moneyToWords(m[1], m[2], m[3]);
    if (m[4]) toks.push('per', ...normalizeWord(m[4]).toks);
    return { toks, num: true };
  }
  // number + unit/suffix: 900ms, 15%, 10x, 1st, 5GB, 2.5s, 10k
  m = w.match(/^(\d[\d,]*(?:\.\d+)?)(st|nd|rd|th|[a-z%]+)?(?:\/(\w+))?$/i);
  if (m) {
    const suf = (m[2] || '').toLowerCase();
    let toks;
    if (!suf) toks = numberToWords(m[1]);
    else if (['st', 'nd', 'rd', 'th'].includes(suf) && !m[1].includes('.')) toks = ordinal(numberToWords(m[1]));
    else if (suf === 's' && /^(\d{2}|\d{4})$/.test(m[1]) && m[1].endsWith('0')) {        // 1990s / 90s → decades
      const ws = numberToWords(m[1]); const l = ws.pop(); toks = [...ws, l.endsWith('y') ? l.slice(0, -1) + 'ies' : l + 's'];
    }
    else if (UNITS[suf]) toks = [...numberToWords(m[1]), ...UNITS[suf]];
    else return { toks: [clean(lw)].filter(Boolean), num: true };              // "3d", "5g": keep as-is
    if (m[3]) toks.push('per', ...normalizeWord(m[3]).toks);
    return { toks, num: true };
  }
  // letter-prefix + number with hyphen: EC-2, S-3, GPT-4 → ec2 / s3 / gpt4
  m = lw.match(/^([a-z]{1,4})-(\d{1,3}[a-z]?)$/);
  if (m) return { toks: [m[1] + m[2]], num: true };

  // split on hyphens / slashes / dots between letters, then clean each part
  const parts = lw.split(/[-/\u2010-\u2015]+|(?<=[a-z])\.(?=[a-z]{3,})/).filter(Boolean);
  if (parts.length > 1) {
    const toks = [];
    let num = false;
    for (const p of parts) { const r = normalizeWord(p); toks.push(...r.toks); num = num || r.num; }
    return { toks, num };
  }
  const c = clean(lw);
  if (SYNONYMS[c]) return { toks: SYNONYMS[c].slice(), num: false };
  return { toks: c ? [c] : [], num: /\d/.test(c) };
}

/** Public: normalize(token) → string[] (possibly several tokens, possibly none). */
function normalize(token) { return normalizeWord(token).toks; }

// ── number-word run canonicalization ─────────────────────────────────────────
const UNIT_V = Object.fromEntries(ONES.map((w, i) => [w, i]));
const TENS_V = Object.fromEntries(TENS.map((w, i) => [w, i * 10]).filter(([w]) => w));
const SCALE_V = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

function kindOf(w) {
  if (w in UNIT_V) return UNIT_V[w] === 0 ? 'zero' : UNIT_V[w] < 10 ? 'unit' : 'teen';
  if (w in TENS_V) return 'tens';
  if (w === 'hundred') return 'hundred';
  if (w in SCALE_V) return 'scale';
  return null;
}

/** Split a run of number words into values: [{ value, from, to }] (indices into run). */
function parseNumberRun(words) {
  const out = [];
  let total = 0, group = 0, last = null, start = 0;
  const flush = end => { if (last !== null) out.push({ value: total + group, from: start, to: end }); total = 0; group = 0; last = null; };
  words.forEach((w, i) => {
    if (w === 'and') return;
    const k = kindOf(w);
    if (!k) return;
    const breakBefore =
      last === 'zero' || (k === 'zero' && last !== null) ||
      (k === 'unit' && (last === 'unit' || last === 'teen' || (last === 'tens' && group % 10 !== 0))) ||
      ((k === 'teen' || k === 'tens') && (last === 'unit' || last === 'teen' || last === 'tens')) ||
      (k === 'hundred' && (last === 'hundred' || group >= 100));
    if (breakBefore) flush(i - 1);
    if (last === null) start = i;
    if (k === 'unit' || k === 'teen' || k === 'tens') group += (UNIT_V[w] ?? TENS_V[w]);
    else if (k === 'hundred') group = (group || 1) * 100;
    else if (k === 'scale') { total += (group || 1) * SCALE_V[w]; group = 0; }
    last = k;
  });
  flush(words.length - 1);
  return out;
}

/** Replace runs of number words in a token list with their canonical spelling. */
function canonicalizeNumbers(tokens) {
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    if (!NUM_WORDS.has(tokens[i].t)) { out.push(tokens[i++]); continue; }
    let j = i;
    while (j < tokens.length && (NUM_WORDS.has(tokens[j].t) ||
      (tokens[j].t === 'and' && j > i && ['hundred', 'thousand', 'million', 'billion'].includes(tokens[j - 1].t) &&
        j + 1 < tokens.length && NUM_WORDS.has(tokens[j + 1].t) && !['hundred', 'thousand', 'million', 'billion'].includes(tokens[j + 1].t)))) j++;
    const run = tokens.slice(i, j);
    const words = run.map(t => t.t);
    const pieces = parseNumberRun(words);
    const canon = pieces.map(p => intToWords(p.value));
    const same = canon.flat().join(' ') === words.filter(w => w !== 'and').join(' ') && !words.includes('and');
    if (same || !pieces.length) { out.push(...run); i = j; continue; }
    pieces.forEach((p, pi) => {
      const src = run.slice(p.from, p.to + 1);
      const w0 = Math.min(...src.map(t => t.w0)), w1 = Math.max(...src.map(t => t.w1));
      const key = src.some(s => s.key), num = src.some(s => s.num);
      for (const t of canon[pi]) out.push({ ...src[0], t, w0, w1, num, key });
    });
    i = j;
  }
  return out;
}

// ── tokenize ─────────────────────────────────────────────────────────────────
const PRONOUN_I = new Set(['i', "i'm", "i've", "i'll", "i'd"]);

/**
 * Tokenize raw words (strings). Returns tokens:
 *   { t, w0, w1, num, key, raw }  — w0..w1 = raw word index span.
 * opts.keys = true marks dropped-key candidates (script side, spec §6):
 *   a raw word containing a digit, a backticked term, or a capitalized word
 *   that isn't sentence-initial (and isn't the pronoun I).
 */
function tokenizeWords(rawWords, { keys = false } = {}) {
  let toks = [];
  let prevNumeric = false;
  let inTick = false;
  rawWords.forEach((raw, wi) => {
    const r = String(raw);
    const ticked = inTick || r.startsWith('`');
    if ((r.match(/`/g) || []).length % 2 === 1) inTick = !inTick;
    const { toks: ts, num } = normalizeWord(r, prevNumeric);
    let key = false;
    if (keys) {
      const bare = r.replace(/^[("'\[{<*_`\u2018\u201c]+/, '');
      const prev = wi > 0 ? String(rawWords[wi - 1]) : '';
      const initial = wi === 0 || /[.!?:]["')\]\u2019\u201d]*$/.test(prev);
      key = /\d/.test(r) || ticked ||
        (!initial && /^\p{Lu}/u.test(bare) && !PRONOUN_I.has(bare.toLowerCase().replace(/[^a-z']/g, '')));
    }
    for (const t of ts) toks.push({ t, w0: wi, w1: wi, num: num || /\d/.test(r), key, raw: r });
    prevNumeric = /^[$\u20ac\u00a3]?\d[\d,]*(\.\d+)?[.,;:]?$/.test(r);
  });
  toks = canonicalizeNumbers(toks);
  for (const t of toks) if (NUM_WORDS.has(t.t)) t.numWord = true;
  return toks;
}

/** Split text into raw words (whitespace + dashes) then tokenize. */
function splitWords(text) {
  return String(text).split(/\s+/).flatMap(w => w.split(DASHES)).filter(w => w.length);
}
function tokenize(text, opts) { return tokenizeWords(splitWords(text), opts); }

// ── similarity ───────────────────────────────────────────────────────────────
function levenshtein(a, b) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  let prev = new Array(lb + 1), cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    for (let j = 1; j <= lb; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}
function levRatio(a, b) { const L = Math.max(a.length, b.length); return L ? 1 - levenshtein(a, b) / L : 1; }

// ── alignment ────────────────────────────────────────────────────────────────
const DEFAULT_COSTS = { exact: 0, fuzzy: 0.35, sub: 1.0, del: 1.0, ins: 0.6, insFiller: 0.3 };
const EPS = 1e-9;

function makePairCost(costs, simTh) {
  const cache = new Map();
  return function pairCost(a, b) {
    if (a.t === b.t) return { cost: costs.exact, fuzzy: false, same: true };
    if (a.num || b.num || a.numWord || b.numWord || a.t.length < 3 || b.t.length < 3) return { cost: costs.sub, fuzzy: false, same: false };
    const la = a.t.length, lb = b.t.length;
    if (Math.abs(la - lb) / Math.max(la, lb) > 1 - simTh) return { cost: costs.sub, fuzzy: false, same: false };
    const key = a.t + '\u0000' + b.t;
    let r = cache.get(key);
    if (r === undefined) { r = levRatio(a.t, b.t); cache.set(key, r); }
    return r >= simTh ? { cost: costs.fuzzy, fuzzy: true, same: true } : { cost: costs.sub, fuzzy: false, same: false };
  };
}

/**
 * Global alignment of script tokens S vs transcript tokens T.
 * Transcript tokens with `.filler` get the cheaper insertion cost.
 * Returns {
 *   script: [{ op: 'match'|'sub'|'del', t: tIdx|null, t2?: tIdx, fuzzy }],
 *   trans:  [{ op: 'match'|'sub'|'ins', s: sIdx|null }],
 *   cost
 * }
 */
function align(S, T, opts = {}) {
  const costs = { ...DEFAULT_COSTS, ...(opts.costs || {}) };
  const simTh = opts.similarity ?? 0.7;
  const pairCost = makePairCost(costs, simTh);
  const n = S.length, m = T.length, W = m + 1;
  const D = new Float64Array((n + 1) * W);
  const B = new Uint8Array((n + 1) * W);            // 1 diag 2 ins 3 del 4 merge(S1:T2) 5 merge(S2:T1)
  const insC = T.map(t => (t.filler ? costs.insFiller : costs.ins));
  for (let j = 1; j <= m; j++) { D[j] = D[j - 1] + insC[j - 1]; B[j] = 2; }
  for (let i = 1; i <= n; i++) { D[i * W] = D[(i - 1) * W] + costs.del; B[i * W] = 3; }
  for (let i = 1; i <= n; i++) {
    const s = S[i - 1];
    for (let j = 1; j <= m; j++) {
      const pc = pairCost(s, T[j - 1]);
      let best = D[(i - 1) * W + j - 1] + pc.cost, code = 1, v;
      if (j >= 2 && s.t.length > 3 && s.t === T[j - 2].t + T[j - 1].t && (v = D[(i - 1) * W + j - 2] + costs.exact) < best - EPS) { best = v; code = 4; }
      if (i >= 2 && T[j - 1].t.length > 3 && S[i - 2].t + s.t === T[j - 1].t && (v = D[(i - 2) * W + j - 1] + costs.exact) < best - EPS) { best = v; code = 5; }
      if ((v = D[i * W + j - 1] + insC[j - 1]) < best - EPS) { best = v; code = 2; }
      if ((v = D[(i - 1) * W + j] + costs.del) < best - EPS) { best = v; code = 3; }
      D[i * W + j] = best; B[i * W + j] = code;
    }
  }
  const script = new Array(n), trans = new Array(m);
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const code = B[i * W + j];
    if (code === 1) {
      const pc = pairCost(S[i - 1], T[j - 1]);
      const op = pc.same ? 'match' : 'sub';
      script[i - 1] = { op, t: j - 1, fuzzy: pc.fuzzy };
      trans[j - 1] = { op, s: i - 1 };
      i--; j--;
    } else if (code === 4) {
      script[i - 1] = { op: 'match', t: j - 2, t2: j - 1, fuzzy: false, merge: true };
      trans[j - 2] = { op: 'match', s: i - 1 }; trans[j - 1] = { op: 'match', s: i - 1 };
      i--; j -= 2;
    } else if (code === 5) {
      script[i - 2] = { op: 'match', t: j - 1, fuzzy: false, merge: true };
      script[i - 1] = { op: 'match', t: j - 1, fuzzy: false, merge: true };
      trans[j - 1] = { op: 'match', s: i - 2 };
      i -= 2; j--;
    } else if (code === 2) { trans[j - 1] = { op: 'ins', s: null }; j--; }
    else { script[i - 1] = { op: 'del', t: null, fuzzy: false }; i--; }
  }
  return { script, trans, cost: D[n * W + m] };
}

// ── sentence mapping ─────────────────────────────────────────────────────────

/**
 * Script-side tokenization for a list of sentences. Returns
 * { tokens, ranges: [{a,b}] } where tokens carry .sent (sentence index) and
 * .src (raw word index inside the sentence) and ranges are inclusive (b<a if empty).
 */
function tokenizeSentences(sentences) {
  const tokens = [], ranges = [];
  sentences.forEach((s, k) => {
    const a = tokens.length;
    for (const t of tokenize(s.text, { keys: true })) tokens.push({ ...t, sent: k, src: t.w0 });
    ranges.push({ a, b: tokens.length - 1 });
  });
  return { tokens, ranges };
}

function sentenceStats(k, range, al) {
  const anchors = [], dels = [];
  let match = 0, fuzzy = 0, sub = 0;
  for (let s = range.a; s <= range.b; s++) {
    const op = al.script[s];
    if (op && op.t !== null && op.t !== undefined) {
      anchors.push({ s, t: op.t, t2: op.t2, op: op.op, fuzzy: op.fuzzy });
      if (op.op === 'match') { match++; if (op.fuzzy) fuzzy++; } else sub++;
    } else dels.push(s);
  }
  const N = range.b - range.a + 1;
  const ts = anchors.flatMap(a => (a.t2 !== undefined ? [a.t, a.t2] : [a.t]));
  return {
    k, anchors, dels, N,
    counts: { match, fuzzy, sub, del: dels.length },
    coverage: N > 0 ? match / N : 0,
    tFirst: ts.length ? Math.min(...ts) : null,
    tLast: ts.length ? Math.max(...ts) : null,
  };
}

function release(al, st) {
  for (const a of st.anchors) {
    al.script[a.s] = { op: 'del', t: null, fuzzy: false };
    al.trans[a.t] = { op: 'ins', s: null };
    if (a.t2 !== undefined) al.trans[a.t2] = { op: 'ins', s: null };
  }
}

/** Fit script slice [a..b] into transcript slice [t0..t1]; writes into al if `apply`. */
function fit(S, T, range, t0, t1, al, opts, apply) {
  const Ss = S.slice(range.a, range.b + 1), Ts = T.slice(t0, t1 + 1);
  if (!Ss.length || !Ts.length) return null;
  const sub = align(Ss, Ts, opts);
  const N = Ss.length;
  const match = sub.script.filter(o => o.op === 'match').length;
  const res = { coverage: match / N, sub };
  if (apply) {
    sub.script.forEach((o, i) => {
      const s = range.a + i;
      al.script[s] = o.t === null ? { op: 'del', t: null, fuzzy: false }
        : { ...o, t: o.t + t0, ...(o.t2 !== undefined ? { t2: o.t2 + t0 } : {}) };
    });
    sub.trans.forEach((o, j) => { if (o.s !== null) al.trans[t0 + j] = { op: o.op, s: range.a + o.s }; });
  }
  return res;
}

function looseEq(a, b) {
  return a === b || (a.length >= 3 && b.length >= 3 && levRatio(a, b) >= 0.7) || (a.length >= 2 && a.length < b.length && b.startsWith(a));
}

/**
 * How much does insertion run R (transcript token indices) repeat the script
 * tokens sIdxs? LCS under loose equality (exact, fuzzy ≥0.7, or partial-word
 * prefix) divided by |R|. 1.0 = every inserted token is a repeat.
 */
function repeats(T, S, R, sIdxs) {
  if (!R.length || !sIdxs.length) return 0;
  const a = R.map(j => T[j].t), b = sIdxs.map(s => S[s].t);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let k = 1; k <= b.length; k++) {
    dp[i][k] = looseEq(a[i - 1], b[k - 1]) ? dp[i - 1][k - 1] + 1 : Math.max(dp[i - 1][k], dp[i][k - 1]);
  }
  return dp[a.length][b.length] / a.length;
}

/**
 * Map alignment to sentences, applying post-passes B–D (see header).
 * Returns { sentences: [stats + { missing, order, reanchored }], owner: Int32Array }
 * owner[t] = sentence index for anchors and insertions inside a sentence, else -1.
 */
function mapSentences(ranges, S, T, al, opts = {}) {
  const th = { missingCoverage: 0.34, orderMinCoverage: 0.6, ...(opts.thresholds || {}) };
  const K = ranges.length;
  let st = ranges.map((r, k) => sentenceStats(k, r, al));

  // B. missing
  for (const x of st) if (x.N === 0 || x.coverage < th.missingCoverage) { release(al, x); }
  st = ranges.map((r, k) => sentenceStats(k, r, al));

  // C. restart re-anchor: an inserted copy of the sentence's first token inside
  // its range = a second attempt; refit from there and keep it if it covers
  // the sentence about as well as the stitched alignment.
  for (let k = 0; k < K; k++) {
    const x = st[k];
    if (x.tFirst === null || x.anchors.length < 2) continue;
    const firstTok = S[ranges[k].a];
    const nextFirst = st.slice(k + 1).map(y => y.tFirst).find(v => v !== null);
    const t1 = nextFirst !== undefined ? nextFirst - 1 : T.length - 1;
    const secondTok = ranges[k].b > ranges[k].a ? S[ranges[k].a + 1] : null;
    for (let t = x.tFirst + 1; t <= x.tLast; t++) {
      if (al.trans[t].op !== 'ins' || T[t].filler) continue;
      if (!looseEq(T[t].t, firstTok.t)) {
        // whisper may drop the 1st word of the retake ("It depends…" → "Depends…"): a start on the
        // 2nd token counts only when a run of ≥3 inserted tokens there repeats the sentence's opening
        if (!secondTok || !looseEq(T[t].t, secondTok.t)) continue;
        const run = [];
        for (let j = t; j <= x.tLast && al.trans[j].op === 'ins'; j++) if (!T[j].filler) run.push(j);
        const open = [...Array(run.length).keys()].map(i => ranges[k].a + 1 + i).filter(q => q <= ranges[k].b);
        if (run.length < 3 || repeats(T, S, run, open) < 0.6) continue;
      }
      const trial = fit(S, T, ranges[k], t, t1, al, opts, false);
      if (trial && trial.coverage >= x.coverage - 0.15) {
        release(al, x);
        fit(S, T, ranges[k], t, t1, al, opts, true);
        st[k] = { ...sentenceStats(k, ranges[k], al), reanchored: true };
        break;
      }
    }
  }

  // F. split: a sentence whose span swallowed a run of insertions plus a few scattered late
  // (or early) anchors — whisper dropped a word, and the DP borrowed it from the next
  // line's retake ("…makes [devotion] meaningless either. Maybe devotion has a different
  // purpose.") — is re-fitted to the span ending (starting) at that run when that cuts its
  // errors (sub + del + inserted non-filler tokens inside the span) by ≥ 2.
  const errs = (sub, lo, hi) => {
    if (!sub) return Infinity;
    let e = 0;
    for (const o of sub.script) if (o.op !== 'match') e++;
    const used = new Set(sub.script.flatMap(o => (o.t === null ? [] : o.t2 !== undefined ? [o.t, o.t2] : [o.t])));
    if (!used.size) return Infinity;
    const a = Math.min(...used), b = Math.max(...used);
    for (let j = a; j <= b; j++) if (!used.has(j) && !T[lo + j].filler) e++;
    return e;
  };
  for (let k = 0; k < K; k++) {
    const x = st[k];
    if (x.tFirst === null || x.anchors.length < 3) continue;
    const cur = fit(S, T, ranges[k], x.tFirst, x.tLast, al, opts, false);
    const e0 = cur ? errs(cur.sub, x.tFirst) : Infinity;
    if (e0 < 3) continue;
    let best = null;
    for (let j = x.tFirst + 1; j < x.tLast;) {
      if (al.trans[j].op !== 'ins' || T[j].filler) { j++; continue; }
      let e = j;
      while (e + 1 < x.tLast && (al.trans[e + 1].op === 'ins')) e++;
      if (e - j + 1 >= 2) {
        for (const [a, b] of [[x.tFirst, e], [j, x.tLast]]) {
          const tr = fit(S, T, ranges[k], a, b, al, opts, false);
          if (!tr || tr.coverage < th.missingCoverage) continue;
          const v = errs(tr.sub, a);
          if (v <= e0 - 2 && (!best || v < best.v)) best = { v, a, b };
        }
      }
      j = e + 1;
    }
    if (best) {
      release(al, x);
      fit(S, T, ranges[k], best.a, best.b, al, opts, true);
      st[k] = { ...sentenceStats(k, ranges[k], al), split: true };
    }
  }

  // D. order recovery for missing sentences
  const owner = () => {
    const o = new Int32Array(T.length).fill(-1);
    st.forEach(x => { if (x.tFirst !== null) for (let t = x.tFirst; t <= x.tLast; t++) o[t] = x.k; });
    return o;
  };
  for (let k = 0; k < K; k++) {
    if (st[k].tFirst !== null || st[k].N === 0) continue;
    const o = owner();
    let best = null;
    for (let t = 0; t < T.length;) {
      if (o[t] !== -1 || al.trans[t].op !== 'ins') { t++; continue; }
      let e = t;
      while (e + 1 < T.length && o[e + 1] === -1 && al.trans[e + 1].op === 'ins') e++;
      if (e - t + 1 >= Math.max(2, Math.ceil(st[k].N * th.orderMinCoverage))) {
        const trial = fit(S, T, ranges[k], t, e, al, opts, false);
        if (trial && trial.coverage >= th.orderMinCoverage && (!best || trial.coverage > best.coverage)) best = { ...trial, t0: t, t1: e };
      }
      t = e + 1;
    }
    if (best) {
      fit(S, T, ranges[k], best.t0, best.t1, al, opts, true);
      st[k] = sentenceStats(k, ranges[k], al);
      const prev = st.slice(0, k).reverse().find(y => y.tFirst !== null);
      const next = st.slice(k + 1).find(y => y.tFirst !== null);
      st[k].order = !!((prev && prev.tLast > st[k].tFirst) || (next && next.tFirst < st[k].tLast));
      st[k].recovered = true;
    }
  }
  // E. edge compaction: the latest-token tie-break can anchor a sentence's last (first) token
  // to a later (earlier) duplicate, swallowing a run of insertions — e.g. "…watching over you,
  // and you feel you" anchoring "you" to the 3rd "you". Move an edge anchor to an identical
  // inserted token next to the sentence body.
  for (let k = 0; k < K; k++) {
    const x = st[k];
    if (x.tFirst === null || x.anchors.length < 2) continue;
    const An = x.anchors.filter(a => a.t2 === undefined).sort((a, b) => a.t - b.t);
    if (An.length < 2) continue;
    let moved = false;
    const move = (a, j) => {
      al.script[a.s] = { ...al.script[a.s], t: j };
      al.trans[j] = { op: al.script[a.s].op, s: a.s };
      al.trans[a.t] = { op: 'ins', s: null };
      moved = true;
    };
    const last = An[An.length - 1], prev = An[An.length - 2];
    for (let j = prev.t + 1; j < last.t; j++) if (al.trans[j].op === 'ins' && T[j].t === T[last.t].t) { move(last, j); break; }
    const first = An[0], next = An[1];
    for (let j = next.t - 1; j > first.t; j--) if (al.trans[j].op === 'ins' && T[j].t === T[first.t].t) { move(first, j); break; }
    if (moved) st[k] = { ...sentenceStats(k, ranges[k], al), order: x.order, recovered: x.recovered, reanchored: x.reanchored };
  }

  for (const x of st) {
    x.missing = x.tFirst === null;
    x.order = !!x.order;
  }
  return { sentences: st, owner: owner() };
}

module.exports = {
  looseEq, normalize, normalizeWord, tokenize, tokenizeWords, tokenizeSentences, splitWords,
  align, mapSentences, levRatio, levenshtein, numberToWords, intToWords, parseNumberRun, repeats,
  fit, sentenceStats, release, DEFAULT_COSTS, NUM_WORDS,
};
