'use strict';
/**
 * pipeline/analyze.js — take audio + script.md → take.json (docs/spec.md §4, §6).
 *
 * analyze(videoDir, { take, whisperModel, useJev, forceWhisper, words, keepRerecords }) → Promise<take>
 *   take:         'takes/take-01' (default: highest-numbered takes/take-NN)
 *   whisperModel: default $WHISPER_MODEL || 'turbo'
 *   useJev:       default true; Jev only runs if OPENROUTER_API_KEY is set
 *   words:        inject whisper words (tests) instead of running whisper
 *   keepRerecords: default true — re-analyzing the SAME take keeps sentences
 *                 already accepted as 'rerecorded' (same text)
 *
 * Pipeline: ensure wav/hq.wav → whisper words → refine word edges with
 * silencedetect → tokenize + align (align.js) → classify every inserted token
 * (filler / stutter / restart / extra / out-of-sentence) → per-sentence flags
 * → cuts[] → summary. Deterministic rules decide; Jev is consulted only for
 * ambiguous inserted words (like/so/right/okay/well) and for borderline warn
 * sentences (WER in [jev.reviewWerMin, jev.reviewWerMax]) that might need a
 * re-record. Any Jev failure → rules only, take.jev = null.
 *
 * analyzeWords() is the reusable core (splice.js runs it on a single-sentence
 * re-record clip). Additive fields beyond §4: sentence.heard, word.role/sid,
 * flag.where, summary.rerecorded. Flags use only §6 types; restarts are
 * reported as type 'stutter' with detail "restart …".
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const audio = require('./audio');
const whisper = require('./whisper');
const scriptMod = require('./script');
const A = require('./align');
const jev = require('./jev');
const ATT = require('./attempts');

const r3 = x => Math.round(x * 1000) / 1000;
const fmt = x => x.toFixed(2);

// ── take resolution ──────────────────────────────────────────────────────────
function resolveTake(videoDir, take) {
  if (take) return take.replace(/\.(hq\.wav|wav|webm|mp3|json)$/i, '').replace(/^\.?\//, '');
  const dir = path.join(videoDir, 'takes');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const nums = names.map(n => n.match(/^take-(\d+)\.(webm|wav|mp3|m4a|ogg)$/i)).filter(Boolean).map(m => m[1]);
  if (!nums.length) throw new Error(`no takes/take-NN.(webm|wav) in ${videoDir}`);
  const best = nums.sort((a, b) => parseInt(b, 10) - parseInt(a, 10))[0];
  return `takes/take-${best}`;
}

// ── word refinement ──────────────────────────────────────────────────────────
/** Whisper word edges often bleed into silence; clip them to silencedetect intervals. */
function refineWords(words, silences) {
  return words.map(w => {
    let { start, end } = w;
    for (const s of silences) {
      if (s.start > end) break;
      if (start > s.start && start < s.end && s.end < end - 0.02) start = s.end;
      if (end > s.start && end < s.end && s.start > start + 0.02) end = s.start;
    }
    return { ...w, start: r3(start), end: r3(Math.max(end, start)) };
  });
}

function silenceNoiseDb(meanDb, th) {
  const guess = (meanDb ?? -20) - th.silenceBelowMeanDb;
  return Math.max(th.silenceFloorDb, Math.min(th.silenceCeilDb, guess));
}

// ── attempts (docs/spec.md §7a) ──────────────────────────────────────────────
function ownerOf(st, m) {
  const o = new Int32Array(m).fill(-1);
  for (const x of st) if (x.tFirst !== null) for (let t = x.tFirst; t <= x.tLast; t++) o[t] = x.k;
  return o;
}

/**
 * For each found sentence: the adopted span plus every other span between the
 * previous and next found sentence that the sentence fits with coverage ≥
 * attempts.minCoverage. Candidate starts = unowned inserted tokens equal to the
 * sentence's 1st or 2nd token; the fit window is ≤ maxSpanFactor·N+4 tokens.
 * Scores every attempt (attempts.js), picks one (manual pick of a take attempt
 * > score), and re-anchors the sentence onto it in `al` when it isn't the
 * adopted one. Returns updated { st, owner }, per-sentence attempt records and
 * the spans of the non-chosen attempts (to be cut).
 */
function findAttempts({ S, T, ranges, al, st, owner, words, pcm, cfg, alignOpts, sentences, picks, attemptRef }) {
  const ac = cfg.attempts, m = T.length;
  st = st.slice();
  const found = st.filter(x => !x.missing).sort((a, b) => a.tFirst - b.tFirst);
  const claimed = new Uint8Array(m);
  const cand = new Array(st.length).fill(null);
  const shift = (o, t) => (o.t === null ? o : { ...o, t: o.t + t, ...(o.t2 !== undefined ? { t2: o.t2 + t } : {}) });
  found.forEach((x, i) => {
    const k = x.k, rg = ranges[k];
    const measure = (ops, t0, t1) => ATT.measure({ S, T, range: rg, ops, t0, t1, words, pcm, cfg });
    const list = [{ m: measure(al.script.slice(rg.a, rg.b + 1), x.tFirst, x.tLast), adopted: true }];
    const lo = i > 0 ? found[i - 1].tLast + 1 : 0, hi = i + 1 < found.length ? found[i + 1].tFirst - 1 : m - 1;
    // right to left: the fit window of an earlier start then stops before a later attempt
    for (const [r0, r1] of [[lo, x.tFirst - 1], [x.tLast + 1, hi]]) {
      for (let t = r1; t >= r0; t--) {
        if (claimed[t] || owner[t] !== -1 || al.trans[t].op !== 'ins' || T[t].filler) continue;
        if (!A.looseEq(T[t].t, S[rg.a].t) && !(rg.b > rg.a && A.looseEq(T[t].t, S[rg.a + 1].t))) continue;
        let e = Math.min(r1, t + Math.ceil(x.N * ac.maxSpanFactor) + 4);
        for (let j = t + 1; j <= e; j++) if (claimed[j]) { e = j - 1; break; }
        let trial = A.fit(S, T, rg, t, e, al, alignOpts, false);
        if (!trial || trial.coverage < ac.minCoverage) continue;
        // a start on the 2nd token (or a stray repeat) may sit just after the real start: prefer an
        // earlier unclaimed start within 3 tokens that fits at least as well
        for (let t2 = t - 1; t2 >= Math.max(r0, t - 3); t2--) {
          if (claimed[t2] || owner[t2] !== -1 || al.trans[t2].op !== 'ins') break;
          if (!A.looseEq(T[t2].t, S[rg.a].t)) continue;
          const tr2 = A.fit(S, T, rg, t2, e, al, alignOpts, false);
          if (tr2 && tr2.coverage >= trial.coverage) { trial = tr2; t = t2; }
        }
        const ops = trial.sub.script.map(o => shift(o, t));
        const ts = ops.flatMap(o => (o.t === null ? [] : o.t2 !== undefined ? [o.t, o.t2] : [o.t]));
        const s0 = Math.min(...ts), s1 = Math.max(...ts);
        let clash = false;
        for (let j = s0; j <= s1; j++) if (claimed[j] || owner[j] !== -1) { clash = true; break; }
        if (clash) continue;
        list.push({ m: measure(ops, s0, s1), win: [t, e] });
        for (let j = s0; j <= s1; j++) claimed[j] = 1;
      }
    }
    list.sort((a, b) => a.m.t0 - b.m.t0);
    cand[k] = list;
  });

  const ref = attemptRef || ATT.reference(cand.filter(Boolean).map(l => l.find(c => c.adopted).m));
  const attempts = new Array(st.length).fill(null), altSpans = [];
  for (let k = 0; k < st.length; k++) {
    const list = cand[k];
    if (!list) continue;
    const atts = list.map(c => ATT.entry(c.m, ref, cfg, { source: 'take' }));
    atts.forEach((a, i) => { a.n = i + 1; });
    const pick = picks[sentences[k].id];
    const { idx } = ATT.choose(atts, pick && pick.source === 'take' ? pick : null, cfg);
    const adopted = list.findIndex(c => c.adopted);
    if (idx !== adopted) {
      A.release(al, st[k]);
      A.fit(S, T, ranges[k], list[idx].win[0], list[idx].win[1], al, alignOpts, true);
      st[k] = { ...A.sentenceStats(k, ranges[k], al), order: st[k].order, missing: false, attemptSwitched: true };
    }
    list.forEach((c, i) => { if (i !== idx) altSpans.push({ k, t0: c.m.t0, t1: c.m.t1 }); });
    atts.forEach((a, i) => { a.chosen = i === idx; a.aligned = i === idx; });
    attempts[k] = atts;
  }
  return { st, owner: ownerOf(st, m), attempts, altSpans, ref };
}

// ── core ─────────────────────────────────────────────────────────────────────
/**
 * @param {object} p
 *   sentences: [{id, scene, line, text}]      script sentences to find
 *   words:     [{word,start,end,conf}]        transcript (refined) for this audio
 *   audioFile: mono s16 wav for loudness stats (null → skip loudness)
 *   durationSec, cfg, useJev
 * @returns {Promise<{ sentences, cuts, words, fillers, jev }>}
 */
async function analyzeWords({ sentences, words, audioFile, durationSec, cfg, useJev, picks = {}, attemptRef = null }) {
  const th = cfg.thresholds;
  const pad = cfg.cut.paddingSec;
  const pcm = audioFile ? audio.readWav(audioFile) : null;
  const fillerSet = new Set(cfg.fillers.map(s => s.toLowerCase()));
  const ambSet = new Set(cfg.ambiguous.map(s => s.toLowerCase()));

  // Tokenize
  const T = A.tokenizeWords(words.map(w => w.word)).map(t => ({ ...t, filler: fillerSet.has(t.t) || ambSet.has(t.t) }));
  const { tokens: S, ranges } = A.tokenizeSentences(sentences);
  const alignOpts = { costs: cfg.alignCosts, similarity: th.similarityMatch };
  const al = A.align(S, T, alignOpts);
  const map = A.mapSentences(ranges, S, T, al, { thresholds: th, ...alignOpts });
  const m = T.length;

  // 0. attempts (docs/spec.md §7a): every complete saying of a sentence in the
  // unowned spans next to it is an attempt; the best one is (re-)anchored.
  const { st, owner, attempts, altSpans, ref } = findAttempts({ S, T, ranges, al, st: map.sentences, owner: map.owner,
    words, pcm, cfg, alignOpts, sentences, picks, attemptRef });

  // Transcript order of found sentences → region ownership.
  const seq = st.filter(x => !x.missing).sort((a, b) => a.tFirst - b.tFirst).map(x => x.k);
  const cls = new Array(m).fill(null);          // anchor|extra|filler|stutter|restart|gap
  const tokSent = new Int32Array(m).fill(-1);   // sentence a token is reported under
  const where = new Array(m).fill(null);        // inside|before|after
  for (let j = 0; j < m; j++) {
    if (owner[j] >= 0) { tokSent[j] = owner[j]; where[j] = 'inside'; if (al.trans[j].op !== 'ins') cls[j] = 'anchor'; }
  }
  const gaps = [];                              // [{ t0, t1, lead: k|null, after: k|null }]
  let prevT = -1;
  seq.forEach((k, i) => {
    gaps.push({ t0: prevT + 1, t1: st[k].tFirst - 1, lead: k, after: i > 0 ? seq[i - 1] : null });
    prevT = st[k].tLast;
  });
  gaps.push({ t0: prevT + 1, t1: m - 1, lead: null, after: seq.length ? seq[seq.length - 1] : null });
  for (const g of gaps) for (let j = g.t0; j <= g.t1; j++) {
    tokSent[j] = g.lead !== null ? g.lead : (g.after !== null ? g.after : -1);
    where[j] = g.lead !== null ? 'before' : 'after';
  }
  // non-chosen complete attempts: cut like restarts, reported under their own sentence
  for (const a of altSpans) for (let j = a.t0; j <= a.t1; j++) {
    if (owner[j] >= 0) continue;
    cls[j] = 'attempt'; tokSent[j] = a.k; where[j] = j < st[a.k].tFirst ? 'before' : 'after';
  }

  // 1. fillers (phrases, words), ambiguous candidates
  const isIns = j => cls[j] !== 'anchor';
  for (let j = 0; j < m; j++) {
    if (!isIns(j) || cls[j]) continue;
    const ph = cfg.fillerPhrases.find(p => p.every((w, i) => j + i < m && isIns(j + i) && !cls[j + i] && T[j + i].t === w));
    if (ph) { for (let i = 0; i < ph.length; i++) cls[j + i] = 'filler'; continue; }
    if (fillerSet.has(T[j].t)) cls[j] = 'filler';
  }
  const amb = [];
  for (let j = 0; j < m; j++) if (isIns(j) && !cls[j] && ambSet.has(T[j].t)) amb.push(j);
  const jevNotes = [];
  let jevUsed = false;
  if (amb.length) {
    let res = null;
    if (useJev) {
      const ctx = j => ({
        before: words.slice(Math.max(0, T[j].w0 - 5), T[j].w0).map(w => w.word).join(' '),
        token: words[T[j].w0].word,
        after: words.slice(T[j].w1 + 1, T[j].w1 + 6).map(w => w.word).join(' '),
      });
      res = await jev.classifyInsertions(amb.map(ctx));
      if (res) { jevUsed = true; jevNotes.push(`classified ${amb.length} ambiguous insertion(s)`); } else jevNotes.push('insertion classification failed → rules');
    }
    amb.forEach((j, i) => {
      const isF = res ? res[i].isFiller : cfg.ambiguousDefaultIsFiller;
      if (isF) cls[j] = 'filler';
      if (res) T[j].jevProb = res[i].prob;
    });
  }

  // 2. inside runs → stutter / restart / extra
  for (const k of seq) {
    const x = st[k];
    let run = [];
    const flush = nextAnchorT => {
      if (!run.length) return;
      const prevAnchorT = [...Array(run[0] - x.tFirst).keys()].map(i => run[0] - 1 - i).find(t => cls[t] === 'anchor');
      const len = run.length;
      const sIdxRange = s0 => [...Array(len).keys()].map(i => s0 + i).filter(s => s >= ranges[k].a && s <= ranges[k].b);
      const nextSeq = nextAnchorT !== undefined ? sIdxRange(al.trans[nextAnchorT].s) : [];
      const prevSeq = prevAnchorT !== undefined ? sIdxRange(al.trans[prevAnchorT].s - len + 1) : [];
      let c = 'extra';
      if (A.repeats(T, S, run, nextSeq) >= 0.6 || A.repeats(T, S, run, prevSeq) >= 0.6) c = len <= 2 ? 'stutter' : 'restart';
      else if (len === 1 && nextAnchorT !== undefined) {
        const a = T[run[0]].t, b = T[nextAnchorT].t;
        if (a.length < b.length && b.startsWith(a) && (a.length >= 2 || /-$/.test(T[run[0]].raw))) c = 'stutter';
      }
      for (const j of run) cls[j] = c;
      run = [];
    };
    for (let j = x.tFirst; j <= x.tLast; j++) {
      if (cls[j] === 'anchor') { flush(j); continue; }
      if (cls[j] === 'filler') continue;          // fillers are transparent inside a run
      run.push(j);
    }
    flush(undefined);
  }

  // 3. gaps → abandoned restarts of the following sentence, else out-of-sentence
  for (const g of gaps) {
    const U = [];
    for (let j = g.t0; j <= g.t1; j++) if (!cls[j]) U.push(j);
    if (g.lead !== null) {
      const first = ranges[g.lead].a;
      let rem = U;
      for (;;) {
        let found = -1;
        for (let p = rem.length - 1; p >= 0; p--) {
          const suffix = rem.slice(p);
          const from = s0 => [...Array(suffix.length).keys()].map(i => s0 + i).filter(s => s <= ranges[g.lead].b);
          if (A.looseEq(T[rem[p]].t, S[first].t) && A.repeats(T, S, suffix, from(first)) >= 0.6) { found = p; break; }
          // an abandoned attempt whose 1st word whisper dropped ("Depends on how…" for "It depends on how…")
          if (suffix.length >= 3 && first < ranges[g.lead].b && A.looseEq(T[rem[p]].t, S[first + 1].t) &&
            !(p > 0 && A.looseEq(T[rem[p - 1]].t, S[first].t)) && A.repeats(T, S, suffix, from(first + 1)) >= 0.6) { found = p; break; }
        }
        if (found < 0) break;
        for (const j of rem.slice(found)) cls[j] = 'restart';
        rem = rem.slice(0, found);
      }
    }
    for (const j of U) if (!cls[j]) cls[j] = 'gap';
  }

  // 4. word roles (a whisper word may carry several tokens)
  const outWords = words.map((w, i) => ({ i, word: w.word, start: w.start, end: w.end, conf: w.conf ?? null, role: 'gap', sid: null,
    ...(w.suspect ? { suspect: true } : {}) }));
  const rank = { anchor: 5, extra: 4, stutter: 3, restart: 2, attempt: 2, filler: 1, gap: 0 };
  const wordTok = new Map();
  T.forEach((t, j) => {
    for (let wi = t.w0; wi <= t.w1; wi++) {
      const cur = wordTok.get(wi);
      if (cur === undefined || rank[cls[j]] > rank[cls[cur]]) wordTok.set(wi, j);
    }
  });
  for (const [wi, j] of wordTok) {
    outWords[wi].role = cls[j] === 'attempt' ? 'restart' : cls[j];     // a non-chosen attempt is cut exactly like a restart
    if (cls[j] === 'attempt') outWords[wi]._attempt = true;
    outWords[wi].sid = tokSent[j] >= 0 ? sentences[tokSent[j]].id : null;
    outWords[wi]._where = where[j];
  }
  // punctuation-only whisper words ("-", "—") have no tokens: never cut on their own
  outWords.forEach((w, i) => { if (!wordTok.has(i)) { w.role = 'punct'; const nb = outWords[i - 1] || outWords[i + 1]; w.sid = nb ? nb.sid : null; } });
  const kept = w => w.role === 'anchor' || w.role === 'extra';   // (roles: anchor extra filler stutter restart gap punct)

  // 5. per-sentence ranges
  const res = sentences.map((s, k) => {
    const x = st[k];
    const base = { id: s.id, scene: s.scene, line: s.line, text: s.text };
    if (x.missing) return { ...base, status: 'missing', range: null, wordIdx: null, wer: 1, wpm: null, flags: [], source: { kind: 'take' }, heard: '', attempts: [] };
    const w0 = T[x.tFirst].w0, w1 = T[x.tLast].w1;
    return { ...base, status: 'ok', range: { start: outWords[w0].start, end: outWords[w1].end }, wordIdx: [w0, w1], wer: 0, wpm: null, flags: [],
      source: { kind: 'take' }, attempts: attempts[k] || [] };
  });

  // 5b. edge guard: whisper can drop a soft first/last word of a line ("But I don't…" heard as
  // "I don't…"). Untranscribed speech energy (energy VAD, no whisper word at all) running
  // into a sentence's first word / out of its last word is kept, up to edgeGuardSec.
  if (pcm && th.edgeGuardSec > 0) {
    const vad = audio.energyVad(pcm, cfg.whisper.chunk ? { minSilenceSec: cfg.whisper.chunk.minSilenceSec, frac: cfg.whisper.chunk.vadFrac,
      lowFrac: cfg.whisper.chunk.lowFrac, minCoreSec: cfg.whisper.chunk.minCoreSec } : {});
    const wordEdges = outWords.filter(w => w.role !== 'punct');
    res.forEach(r => {
      if (!r.range) return;
      const before = wordEdges.filter(w => w.end <= r.range.start + 1e-6).reduce((a, w) => Math.max(a, w.end), 0);
      const after = wordEdges.filter(w => w.start >= r.range.end - 1e-6).reduce((a, w) => Math.min(a, w.start), durationSec);
      const segIn = vad.speech.find(sp => sp.start < r.range.start - 0.06 && sp.end >= r.range.start - 0.15);
      if (segIn) {
        const ns = Math.max(segIn.start, before + 0.05, (before + r.range.start) / 2, r.range.start - th.edgeGuardSec);
        if (ns < r.range.start - 0.06) { r.edgeGuard = { ...(r.edgeGuard || {}), head: r3(r.range.start - ns) }; r.range = { ...r.range, start: r3(ns) }; }
      }
      const segOut = vad.speech.find(sp => sp.end > r.range.end + 0.06 && sp.start <= r.range.end + 0.15);
      if (segOut) {
        const ne = Math.min(segOut.end, after - 0.05, (r.range.end + after) / 2, r.range.end + th.edgeGuardSec);
        if (ne > r.range.end + 0.06) { r.edgeGuard = { ...(r.edgeGuard || {}), tail: r3(ne - r.range.end) }; r.range = { ...r.range, end: r3(ne) }; }
      }
    });
  }

  // 6. cuts: removed words (clamped to kept neighbours), pauses, gaps, pre/post-roll
  const cuts = [];
  const keptIdx = outWords.filter(kept).map(w => w.i);
  const prevKeptEnd = i => { let lo = 0; for (const k of keptIdx) { if (k >= i) break; lo = outWords[k].end; } return lo; };
  const nextKeptStart = i => { for (const k of keptIdx) if (k > i) return outWords[k].start; return durationSec; };
  let groupStart = null;
  outWords.forEach((w, i) => {
    if (kept(w) || w.role === 'punct') return;
    const nx = outWords.slice(i + 1).find(v => v.role !== 'punct');
    const nextIsSame = w.role === 'restart' && nx && nx.role === 'restart' && !!nx._attempt === !!w._attempt;
    if (groupStart === null) groupStart = i;
    if (nextIsSame) return;
    const a = outWords[groupStart];
    cuts.push({ start: Math.max(a.start - pad, prevKeptEnd(groupStart)), end: Math.min(w.end + pad, nextKeptStart(i)),
      reason: w.role === 'gap' ? 'extra' : `${w._attempt ? 'attempt' : w.role}:${A.normalize(a.word).join(' ') || a.word}` });
    groupStart = null;
  });

  const found = seq.map(k => ({ k, r: res[k] }));
  const gapSec = Math.min(cfg.cut.sentenceGapSec, th.pauseTrimBetweenSec);
  if (found.length) {
    cuts.push({ start: 0, end: Math.max(0, found[0].r.range.start - pad), reason: 'pre-roll' });
    cuts.push({ start: Math.min(durationSec, found[found.length - 1].r.range.end + pad + cfg.cut.sceneTailSec), end: durationSec, reason: 'post-roll' });
  } else cuts.push({ start: 0, end: durationSec, reason: 'no-speech' });
  for (let i = 1; i < found.length; i++) {
    const a = found[i - 1].r, b = found[i].r;
    const newScene = a.scene !== b.scene;
    const head = newScene ? cfg.cut.sceneTailSec : gapSec / 2, tail = newScene ? 0 : gapSec / 2;
    const c0 = a.range.end + pad + head, c1 = b.range.start - pad - tail;
    if (c1 > c0) cuts.push({ start: c0, end: c1, reason: 'gap' });
    const silence = b.range.start - a.range.end;
    if (silence > th.pauseBetweenSec) {
      b.flags.push({ type: 'pause', severity: 'warn', where: 'before',
        detail: `${fmt(silence)}s pause before sentence (auto-trimmed)`, range: { start: r3(a.range.end), end: r3(b.range.start) } });
    }
  }

  // 7. per-sentence flags
  const jevReviews = [];
  let fillerTotal = 0;
  sentences.forEach((s, k) => {
    const r = res[k], x = st[k];
    if (x.missing) { r.flags.push({ type: 'missing', severity: 'missing', detail: 'sentence not found in the take' }); return; }
    const mine = outWords.filter(w => w.sid === s.id && w.role !== 'punct');

    // fillers / stutters / restarts reported under this sentence
    let insideFillers = 0;
    const fillerFlags = [];
    for (let i = 0; i < mine.length; i++) {
      const w = mine[i];
      if (w.role === 'filler') {
        const f = { type: 'filler', severity: 'warn', where: w._where,
          detail: `"${w.word.replace(/[.,!?]+$/, '')}" @${fmt(w.start)}-${fmt(w.end)}`, range: { start: r3(w.start), end: r3(w.end) } };
        fillerFlags.push(f); r.flags.push(f);
        if (w._where === 'inside') insideFillers++;
      } else if ((w.role === 'stutter' || w.role === 'restart') && !w._attempt) {
        let j = i;
        while (j + 1 < mine.length && mine[j + 1].role === w.role && !mine[j + 1]._attempt) j++;
        const txt = mine.slice(i, j + 1).map(v => v.word).join(' ');
        r.flags.push({ type: 'stutter', severity: 'warn', where: w._where,
          detail: `${w.role === 'restart' ? 'restart' : 'repeat'} "${txt}" @${fmt(w.start)}-${fmt(mine[j].end)} (auto-cut)`,
          range: { start: r3(w.start), end: r3(mine[j].end) } });
        i = j;
      }
    }
    fillerTotal += fillerFlags.length;
    if (insideFillers >= th.fillerBadCount) for (const f of fillerFlags) if (f.where === 'inside') f.severity = 'bad';

    // WER
    const extras = mine.filter(w => w.role === 'extra' && w._where === 'inside').length;
    const errs = x.counts.sub + x.counts.del + extras;
    r.wer = r3(x.N ? errs / x.N : 0);
    if (r.wer > th.mismatchWer) {
      r.flags.push({ type: 'mismatch', severity: 'bad', detail: `WER ${fmt(r.wer)} (${x.counts.sub} sub, ${x.counts.del} missing, ${extras} extra)` });
    }

    // dropped key terms
    const dropped = new Map();
    for (let si = ranges[k].a; si <= ranges[k].b; si++) {
      const tok = S[si], op = al.script[si];
      if (!tok.key) continue;
      const bad = op.op === 'del' || op.op === 'sub' || (tok.num && op.fuzzy);
      if (!bad) continue;
      const e = dropped.get(tok.src) || { expected: tok.raw.replace(/[.,;:!?]+$/, ''), heard: new Set() };
      if (op.t !== null) e.heard.add(words[T[op.t].w0].word.replace(/[.,;:!?]+$/, ''));
      dropped.set(tok.src, e);
    }
    for (const e of dropped.values()) {
      r.flags.push({ type: 'dropped-key', severity: 'bad',
        detail: e.heard.size ? `"${e.expected}" heard as "${[...e.heard].join(' ')}"` : `"${e.expected}" not heard` });
    }

    // order
    if (x.order) r.flags.push({ type: 'order', severity: 'bad', detail: 'spoken out of script order' });

    // whisper safety net (whisper_words.py): a long word over continuous speech it could not resolve
    for (const w of mine) {
      if (!w.suspect || !kept(w) || w._where !== 'inside') continue;
      r.flags.push({ type: 'stutter', severity: 'warn', where: 'inside',
        detail: `possible hidden repeat @${fmt(w.start)}-${fmt(w.end)} ("${w.word.replace(/[.,!?]+$/, '')}" lasts ${fmt(w.end - w.start)}s over continuous speech — Whisper may have merged two attempts; listen, re-record if doubled)`,
        range: { start: r3(w.start), end: r3(w.end) } });
    }

    // inner pauses between kept words
    const inner = mine.filter(w => kept(w) && w._where === 'inside').sort((a, b) => a.start - b.start);
    for (let i = 1; i < inner.length; i++) {
      const g = inner[i].start - inner[i - 1].end;
      if (g > th.pauseInsideSec) {
        const keepHalf = th.pauseTrimInsideSec / 2;
        cuts.push({ start: inner[i - 1].end + keepHalf, end: inner[i].start - keepHalf, reason: 'pause' });
        r.flags.push({ type: 'pause', severity: 'warn', where: 'inside', detail: `${fmt(g)}s pause @${fmt(inner[i - 1].end)} (auto-trimmed to ${th.pauseTrimInsideSec}s)`,
          range: { start: r3(inner[i - 1].end), end: r3(inner[i].start) } });
      }
    }

    // pace
    const cutInRange = audio.mergeRanges(cuts).reduce((acc, c) => acc + Math.max(0, Math.min(c.end, r.range.end) - Math.max(c.start, r.range.start)), 0);
    // Pace over the sentence as it will play in the cut: spoken time + the
    // normalized inter-sentence gap (pure word-to-word time overstates WPM ~25%).
    const spokenSec = Math.max(0.01, r.range.end - r.range.start - cutInRange);
    const nWords = inner.length;
    r.wpm = Math.round(nWords / (spokenSec + cfg.cut.sentenceGapSec + 2 * pad) * 60);
    if (nWords >= th.paceMinWords && spokenSec >= th.paceMinSec && (r.wpm < th.paceMinWpm || r.wpm > th.paceMaxWpm)) {
      r.flags.push({ type: 'pace', severity: 'warn', detail: `${r.wpm} wpm (${r.wpm < th.paceMinWpm ? 'slow' : 'fast'}; target ${th.paceMinWpm}-${th.paceMaxWpm})` });
    }

    // loudness
    if (pcm) {
      const v = audio.pcmStats(pcm, r.range.start, r.range.end, { clipDb: th.clippingMaxDb });
      r.meanVolumeDb = v.meanVolumeDb;
      if (v.meanVolumeDb !== null && v.meanVolumeDb < th.loudnessMinDb) r.flags.push({ type: 'loudness', severity: 'bad', detail: `too quiet (${fmt(v.meanVolumeDb)} dBFS mean)` });
      if (v.clipping) r.flags.push({ type: 'loudness', severity: 'bad', detail: `clipping (peak ${fmt(v.maxVolumeDb)} dBFS)` });
    }

    // attempts: one info note (never changes status) when the line was said more than once
    const ci = r.attempts.findIndex(a => a.chosen);
    if (r.attempts.length >= 2 && ci >= 0) r.flags.push(ATT.noteFlag(r.attempts, ci, ATT.matchPick(r.attempts, picks[s.id]) === ci));

    r.heard = inner.map(w => w.word).join(' ');
    const worst = r.flags.some(f => f.severity === 'bad') ? 'bad' : r.flags.some(f => f.severity === 'warn') ? 'warn' : 'ok';
    r.status = worst;
    if (ci >= 0) r.attempts[ci].breakdown.bad = worst === 'bad';
    if (useJev && r.status !== 'bad' && r.wer >= cfg.jev.reviewWerMin && r.wer <= cfg.jev.reviewWerMax) jevReviews.push(k);
  });

  // 8. Jev tie-break for borderline sentences (warn → bad only)
  if (jevReviews.length) {
    const out = await Promise.all(jevReviews.map(k => jev.reviewSentence({ scriptText: res[k].text, heardText: res[k].heard, flags: res[k].flags })));
    let ok = 0;
    out.forEach((v, i) => {
      if (!v) return;
      ok++;
      const r = res[jevReviews[i]];
      r.jev = { verdict: v.verdict, prob: r3(v.prob) };
      if (v.verdict === 'rerecord') {
        r.flags.push({ type: 'mismatch', severity: 'bad', detail: `Jev: wording changes the meaning (${v.reason})` }); r.status = 'bad';
        const ca = r.attempts.find(a => a.chosen); if (ca) ca.breakdown.bad = true;
      }
    });
    if (ok) jevUsed = true;
    jevNotes.push(`reviewed ${ok}/${jevReviews.length} borderline sentence(s)`);
  }

  for (const w of outWords) { delete w._where; delete w._attempt; }
  const merged = audio.mergeRanges(cuts.map(c => ({ ...c, start: Math.max(0, c.start), end: Math.min(durationSec, c.end) })))
    .map(c => ({ start: r3(c.start), end: r3(c.end), reason: c.reason }));
  return { sentences: res, cuts: merged, words: outWords, fillers: fillerTotal, attemptRef: ref,
    jev: jevUsed ? { notes: jevNotes.join('; ') } : null };
}

function summarize(sentences, cuts, durationSec) {
  const count = s => sentences.filter(x => x.status === s).length;
  const fillers = sentences.reduce((a, s) => a + s.flags.filter(f => f.type === 'filler').length, 0);
  const cutSec = cuts.reduce((a, c) => a + (c.end - c.start), 0);
  return { ok: count('ok'), warn: count('warn'), bad: count('bad'), missing: count('missing'), rerecorded: count('rerecorded'),
    fillers, estimatedCleanSec: r3(Math.max(0, durationSec - cutSec)) };
}

function takeStatus(sentences) {
  return sentences.some(s => s.status === 'bad' || s.status === 'missing') ? 'needs-rerecord' : 'ready';
}

// ── silent-take guards ───────────────────────────────────────────────────────
const SILENT_MSG = "Take is silent — the mic delivered no audio. Check the browser's mic permission / input device.";

/** True when volumedetect says the file never rises above silence.maxDb (or has no audio at all). */
function isSilent(stats, cfg) {
  return stats.maxVolumeDb === null || stats.maxVolumeDb < cfg.silence.maxDb;
}

/**
 * Whisper invents "Thank you." / "Thanks for watching" on silence or noise.
 * Returns { frac, hits:[{phrase,count}], message } when those phrases cover
 * ≥ silence.hallucinationFrac of the transcript tokens, else null.
 */
function silenceHallucination(words, cfg) {
  const toks = A.tokenizeWords(words.map(w => w.word)).map(t => t.t);
  if (!toks.length) return null;
  const phrases = cfg.silence.hallucinations.map(p => A.tokenize(p).map(t => t.t)).filter(p => p.length).sort((a, b) => b.length - a.length);
  const hits = new Map();
  let covered = 0;
  for (let i = 0; i < toks.length;) {
    const ph = phrases.find(p => p.every((w, k) => toks[i + k] === w));
    if (!ph) { i++; continue; }
    covered += ph.length; i += ph.length;
    const key = ph.join(' ');
    hits.set(key, (hits.get(key) || 0) + 1);
  }
  const frac = covered / toks.length;
  if (frac < cfg.silence.hallucinationFrac) return null;
  const list = [...hits].sort((a, b) => b[1] - a[1]).map(([phrase, count]) => ({ phrase, count }));
  const said = list.map(h => `"${h.phrase}" ×${h.count}`).join(', ');
  return { frac: r3(frac), hits: list,
    message: `Whisper heard only ${said} — a known Whisper hallucination on silence/noise. The take has no usable speech: check the mic input device / permission and record again.` };
}

function silentDoc({ videoDir, take, script, durationSec, hq, stats, cfg }) {
  const sentences = script.sentences.map(s => ({ id: s.id, scene: s.scene, line: s.line, text: s.text, status: 'missing', range: null,
    wordIdx: null, wer: 1, wpm: null, heard: '', source: { kind: 'take' }, attempts: [],
    flags: [{ type: 'missing', severity: 'missing', detail: 'not transcribed — the take is silent' }] }));
  const cuts = [{ start: 0, end: r3(durationSec), reason: 'no-speech' }];
  return {
    version: 1, video: path.basename(videoDir), take, status: 'silent', analyzedAt: new Date().toISOString(), whisperModel: null,
    problem: { kind: 'silent', message: SILENT_MSG, maxVolumeDb: stats.maxVolumeDb, meanVolumeDb: stats.meanVolumeDb, thresholdDb: cfg.silence.maxDb },
    audio: { durationSec: r3(durationSec), sampleRate: audio.sampleRate(hq), meanVolumeDb: stats.meanVolumeDb, maxVolumeDb: stats.maxVolumeDb, clipping: false },
    words: [], sentences, cuts, summary: summarize(sentences, cuts, durationSec), jev: null,
  };
}

// ── entry point ──────────────────────────────────────────────────────────────
/**
 * Previous take.json state worth keeping when the SAME take is re-analyzed
 * (same sentence id + text): manual picks, accepted re-record attempts (legacy
 * take.json: a 'rerecorded' sentence becomes an unscored re-record attempt),
 * and the re-record history.
 */
function carryOver(videoDir, take, script, opts) {
  const prevPath = path.join(videoDir, 'take.json');
  const carry = {};
  if (opts.keepRerecords === false || !fs.existsSync(prevPath)) return carry;
  let prev;
  try { prev = JSON.parse(fs.readFileSync(prevPath, 'utf8')); } catch (_) { return carry; }     // unreadable → start fresh
  if (!prev || prev.take !== take) return carry;
  for (const p of prev.sentences || []) {
    if (!script.sentences.some(x => x.id === p.id && x.text === p.text)) continue;
    let rr = (p.attempts || []).filter(a => a.source === 'rerecord');
    if (!rr.length && p.status === 'rerecorded' && p.source && p.source.kind === 'rerecord') rr = [ATT.legacyRerecord(p)];
    carry[p.id] = { pick: p.pick || null, rr, rerecords: p.rerecords };
  }
  return carry;
}

async function analyze(videoDir, opts = {}) {
  const cfg = loadConfig(opts.config);
  videoDir = path.resolve(videoDir);
  const script = scriptMod.load(videoDir);
  if (!script.sentences.length) throw new Error(`${videoDir}/script.md has no sentences`);
  const take = resolveTake(videoDir, opts.take);
  const { wav, hq } = audio.ensureWavs(path.join(videoDir, take));
  const durationSec = audio.duration(hq);
  const stats = audio.volumeStats(hq, undefined, undefined, { clipDb: cfg.thresholds.clippingMaxDb });

  // Silent take (mic delivered digital silence): fail fast, never run whisper on it.
  if (isSilent(stats, cfg)) {
    const doc = silentDoc({ videoDir, take, script, durationSec, hq, stats, cfg });
    fs.writeFileSync(path.join(videoDir, 'take.json'), JSON.stringify(doc, null, 2));
    const e = new Error(`${SILENT_MSG} (${take}: max ${stats.maxVolumeDb} dBFS < ${cfg.silence.maxDb} dBFS; Whisper not run)`);
    e.code = 'SILENT_TAKE'; e.take = doc;
    throw e;
  }

  const rawWords = opts.words || whisper.transcribe(wav, { model: opts.whisperModel, force: opts.forceWhisper, quiet: opts.quiet });
  const sil = audio.silences(hq, { noiseDb: silenceNoiseDb(stats.meanVolumeDb, cfg.thresholds), minSec: cfg.thresholds.silenceMinSec });
  const words = refineWords(rawWords, sil);
  const useJev = opts.useJev !== false && jev.available();

  const carry = carryOver(videoDir, take, script, opts);
  const picks = Object.fromEntries(Object.entries(carry).filter(([, c]) => c.pick).map(([id, c]) => [id, c.pick]));
  const out = await analyzeWords({ sentences: script.sentences, words, audioFile: hq, durationSec, cfg, useJev, picks });

  // take vs re-record: every sentence resolves across all its attempts (attempts.js)
  for (const s of out.sentences) {
    const c = carry[s.id];
    if (c) {
      if (c.rerecords) s.rerecords = c.rerecords;
      if (c.pick) s.pick = c.pick;
      if (c.rr.length) s.attempts = ATT.renumber([...s.attempts.filter(a => a.source === 'take'), ...c.rr.map(a => ATT.rescore(a, out.attemptRef, cfg))]);
    }
    ATT.applyChoice(s, cfg);
  }

  // Whisper hallucinating on a (near-)silent take: say so instead of "all missing".
  const found = out.sentences.filter(s => s.status !== 'missing').length;
  const halluc = found <= cfg.silence.hallucinationMaxFound * out.sentences.length ? silenceHallucination(rawWords, cfg) : null;
  if (halluc) for (const s of out.sentences) for (const f of s.flags) if (f.type === 'missing') f.detail = 'sentence not found — the transcript is only Whisper silence hallucinations';

  const doc = {
    version: 1,
    video: path.basename(videoDir),
    take,
    status: halluc ? 'no-speech' : takeStatus(out.sentences),
    analyzedAt: new Date().toISOString(),
    whisperModel: opts.words ? 'injected' : (opts.whisperModel || process.env.WHISPER_MODEL || 'turbo'),
    ...(halluc ? { problem: { kind: 'hallucination', message: halluc.message, frac: halluc.frac, hits: halluc.hits } } : {}),
    audio: { durationSec: r3(durationSec), sampleRate: audio.sampleRate(hq), meanVolumeDb: stats.meanVolumeDb,
      maxVolumeDb: stats.maxVolumeDb, clipping: stats.clipping },
    attemptRef: out.attemptRef,
    words: out.words,
    sentences: out.sentences,
    cuts: out.cuts,
    summary: summarize(out.sentences, out.cuts, durationSec),
    jev: out.jev ? { model: jev.model(), reviewedAt: new Date().toISOString(), notes: out.jev.notes } : null,
  };
  fs.writeFileSync(path.join(videoDir, 'take.json'), JSON.stringify(doc, null, 2));
  return doc;
}

module.exports = { analyze, analyzeWords, resolveTake, refineWords, silenceNoiseDb, summarize, takeStatus, isSilent,
  silenceHallucination, SILENT_MSG };
