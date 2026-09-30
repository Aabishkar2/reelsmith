'use strict';
/**
 * pipeline/attempts.js — best-attempt selection for repeated sentences (docs/spec.md §7a).
 *
 * A creator often says a line more than once: a full retake inside the long
 * take ("…peaceful lives. And there are people… — And there are people…"), or
 * a per-sentence re-record clip (takes/rr-sX.Y-N). Every complete saying of a
 * sentence is an ATTEMPT; the best one is kept and the others are cut.
 * Deterministic signals only (no Jev).
 *
 *  measure(p)                 raw metrics of one attempt, from its script-token ops
 *  reference(metrics[])       take reference: median speech dB / wpm / conf of the
 *                             adopted attempts (what "normal" sounds like in this take)
 *  score(m, ref, cfg)         { score, breakdown } — weighted mean of 5 components in [0,1]:
 *      accuracy   1 − WER vs script − fuzzyPenalty·(fuzzy matches / N) (dominant weight)
 *      fluency    1 − penalties for fillers, repeats/internal restarts, long pauses
 *      confidence mean whisper per-word `conf` (null → take median → 1)
 *      audio      speech RMS vs take median (quieter than median − slack loses,
 *                 clipping loses clipPenalty)
 *      pace       |wpm − take median wpm| / median, scaled by paceRange
 *  entry(m, ref, cfg, extra)  take.json attempt record (§4 sentence.attempts[])
 *  choose(attempts, pick)     manual pick wins; else non-bad beats bad; else best
 *                             score, and anything within tieEpsilon of the best →
 *                             the LATEST attempt wins (= the pre-attempts behaviour)
 *  applyChoice(s, cfg)        take-vs-rerecord resolution on a take.json sentence:
 *                             copies the chosen attempt's analysis onto the sentence
 *                             (rerecord → status 'rerecorded' + sentence.take =
 *                             take analysis), marks `chosen`, refreshes the info flag
 *  noteFlag(...)              { type:'attempts', severity:'info', detail:"3 attempts — kept #1 (score 0.91 vs 0.84, 0.62)" }
 *
 * Unscored attempts (take.json written before this feature) keep the old
 * behaviour: an unscored re-record always wins, an unscored take attempt always
 * loses against a scored one.
 */
const A = require('./align');
const audio = require('./audio');

const r3 = x => Math.round(x * 1000) / 1000;
const r2 = x => Math.round(x * 100) / 100;
const clamp01 = x => Math.max(0, Math.min(1, x));

function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Raw metrics of one attempt.
 * @param p { S, T, range:{a,b}, ops: per-script-token {op,t,t2?,fuzzy} (take-token indices),
 *            t0, t1 (transcript token span), words (refined whisper words), pcm|null, cfg }
 */
function measure({ S, T, range, ops, t0, t1, words, pcm, cfg }) {
  const th = cfg.thresholds, pad = cfg.cut.paddingSec;
  const N = range.b - range.a + 1;
  const used = new Map();                          // transcript token → script token
  let match = 0, fuzzy = 0, sub = 0, del = 0, keyMiss = 0;
  ops.forEach((o, i) => {
    const tok = S[range.a + i];
    if (!o || o.t === null || o.t === undefined) { del++; if (tok.key) keyMiss++; return; }
    used.set(o.t, range.a + i); if (o.t2 !== undefined) used.set(o.t2, range.a + i);
    if (o.op === 'match') { match++; if (o.fuzzy) fuzzy++; if (tok.key && tok.num && o.fuzzy) keyMiss++; } else { sub++; if (tok.key) keyMiss++; }
  });

  // unmatched tokens inside the span: fillers, repeats (stutter / internal restart runs), extras
  let fillers = 0, repeats = 0, extra = 0;
  const removed = new Set();
  let run = [];
  const scriptIdx = j => used.get(j);
  const flush = next => {
    if (!run.length) return;
    const len = run.length;
    const within = s0 => [...Array(len).keys()].map(i => s0 + i).filter(s => s >= range.a && s <= range.b);
    let prev; for (let j = run[0] - 1; j >= t0; j--) if (used.has(j)) { prev = j; break; }
    const nextSeq = next !== undefined ? within(scriptIdx(next)) : [];
    const prevSeq = prev !== undefined ? within(scriptIdx(prev) - len + 1) : [];
    let rep = A.repeats(T, S, run, nextSeq) >= 0.6 || A.repeats(T, S, run, prevSeq) >= 0.6;
    if (!rep && len === 1 && next !== undefined) {
      const a = T[run[0]].t, b = T[next].t;
      rep = a.length >= 2 && a.length < b.length && b.startsWith(a);
    }
    if (rep) { repeats++; for (const j of run) removed.add(j); } else extra += len;
    run = [];
  };
  for (let j = t0; j <= t1; j++) {
    if (used.has(j)) { flush(j); continue; }
    if (T[j].filler) { fillers++; removed.add(j); continue; }
    run.push(j);
  }
  flush(undefined);

  // whisper words of the span: kept = carries a matched or extra token
  const w0 = T[t0].w0, w1 = T[t1].w1;
  const keptW = new Set(), removedW = new Set();
  for (let j = t0; j <= t1; j++) for (let wi = T[j].w0; wi <= T[j].w1; wi++) (removed.has(j) ? removedW : keptW).add(wi);
  for (const wi of keptW) removedW.delete(wi);
  const kept = [...keptW].sort((a, b) => a - b).map(wi => words[wi]);
  let pauses = 0, excess = 0;
  for (let i = 1; i < kept.length; i++) {
    const g = kept[i].start - kept[i - 1].end;
    if (g > th.pauseInsideSec) { pauses++; excess += g - th.pauseTrimInsideSec; }
  }
  const start = words[w0].start, end = words[w1].end;
  const removedSec = [...removedW].reduce((a, wi) => a + Math.max(0, words[wi].end - words[wi].start), 0);
  const spokenSec = Math.max(0.01, end - start - removedSec - excess);
  const wpm = Math.round(kept.length / (spokenSec + cfg.cut.sentenceGapSec + 2 * pad) * 60);
  const confs = kept.map(w => w.conf).filter(Number.isFinite);
  const conf = confs.length ? r3(confs.reduce((a, b) => a + b, 0) / confs.length) : null;
  const v = pcm ? audio.pcmStats(pcm, start, end, { clipDb: th.clippingMaxDb }) : { meanVolumeDb: null, maxVolumeDb: null, clipping: false };
  const wer = N ? (sub + del + extra) / N : 0;
  const bad = wer > th.mismatchWer || keyMiss > 0 || fillers >= th.fillerBadCount || v.clipping ||
    (v.meanVolumeDb !== null && v.meanVolumeDb < th.loudnessMinDb);
  return { t0, t1, fuzzyRate: N ? r3(fuzzy / N) : 0, range: [r3(start), r3(end)], wordIdx: [w0, w1], N, match, coverage: N ? match / N : 0,
    wer: r3(wer), fuzzy, sub, del, extra, keyMiss, fillers, repeats, pauses, conf, wpm,
    meanVolumeDb: v.meanVolumeDb, maxVolumeDb: v.maxVolumeDb, clipping: v.clipping, bad };
}

/** Take reference levels from the adopted attempts' metrics. */
function reference(ms) {
  return { speechDb: median(ms.map(m => m.meanVolumeDb)), wpm: median(ms.map(m => m.wpm)), conf: median(ms.map(m => m.conf)) };
}

function score(m, ref, cfg) {
  const c = cfg.attempts, w = c.weights, fp = c.fluencyPenalty;
  ref = ref || {};
  const parts = {
    // fuzzy matches ("values" for "value") pass WER but still cost half a word here
    accuracy: clamp01(1 - (m.wer || 0) - c.fuzzyPenalty * (m.fuzzyRate || 0)),
    fluency: clamp01(1 - fp.filler * (m.fillers || 0) - fp.repeat * (m.repeats || 0) - fp.pause * (m.pauses || 0)),
    confidence: clamp01(Number.isFinite(m.conf) ? m.conf : Number.isFinite(ref.conf) ? ref.conf : 1),
    audio: !Number.isFinite(m.meanVolumeDb) || !Number.isFinite(ref.speechDb) ? (m.clipping ? 1 - c.clipPenalty : 1)
      : clamp01(1 - Math.max(0, ref.speechDb - c.audioSlackDb - m.meanVolumeDb) / c.audioRangeDb - (m.clipping ? c.clipPenalty : 0)),
    pace: !m.wpm || !ref.wpm ? 1 : clamp01(1 - Math.abs(m.wpm - ref.wpm) / ref.wpm / c.paceRange),
  };
  const wsum = Object.keys(parts).reduce((a, k) => a + (w[k] || 0), 0) || 1;
  const s = Object.keys(parts).reduce((a, k) => a + (w[k] || 0) * parts[k], 0) / wsum;
  const breakdown = {};
  for (const k of Object.keys(parts)) breakdown[k] = r3(parts[k]);
  return { score: r3(s), breakdown };
}

/** take.json attempt record. Raw metrics live in breakdown so a later analyze can re-score. */
function entry(m, ref, cfg, extra = {}) {
  const { score: sc, breakdown } = score(m, ref, cfg);
  return {
    n: 0, source: 'take', ...extra,
    range: m.range, wer: m.wer, wpm: m.wpm, conf: m.conf, score: sc,
    breakdown: { ...breakdown, fuzzyRate: m.fuzzyRate || 0, fillers: m.fillers, repeats: m.repeats, pauses: m.pauses,
      meanVolumeDb: m.meanVolumeDb, clipping: !!m.clipping, bad: !!m.bad },
    chosen: false,
  };
}

/** Metrics back out of a stored attempt record (for re-scoring against a new reference). */
function metricsOf(a) {
  const b = a.breakdown || {};
  return { wer: a.wer, wpm: a.wpm, conf: a.conf, fuzzyRate: b.fuzzyRate, fillers: b.fillers, repeats: b.repeats, pauses: b.pauses,
    meanVolumeDb: b.meanVolumeDb, clipping: b.clipping, bad: b.bad };
}

function rescore(a, ref, cfg) {
  if (a.legacy || !a.breakdown) return a;
  const { score: sc, breakdown } = score(metricsOf(a), ref, cfg);
  return { ...a, score: sc, breakdown: { ...a.breakdown, ...breakdown } };
}

/** Number attempts chronologically: take attempts by start time, then re-records in recording order. */
function renumber(atts) {
  const take = atts.filter(a => a.source === 'take').sort((a, b) => (a.range ? a.range[0] : 0) - (b.range ? b.range[0] : 0));
  const rr = atts.filter(a => a.source !== 'take');
  const out = [...take, ...rr];
  out.forEach((a, i) => { a.n = i + 1; });
  return out;
}

/** Index of the attempt a manual pick refers to, or -1. */
function matchPick(atts, pick) {
  if (!pick) return -1;
  if (pick.source === 'rerecord') return atts.findIndex(a => a.source === 'rerecord' && a.clip === pick.clip);
  const takes = atts.map((a, i) => ({ a, i })).filter(x => x.a.source === 'take' && x.a.range);
  if (Number.isFinite(pick.start)) {
    const near = takes.filter(x => Math.abs(x.a.range[0] - pick.start) < 0.35).sort((p, q) => Math.abs(p.a.range[0] - pick.start) - Math.abs(q.a.range[0] - pick.start));
    if (near.length) return near[0].i;
  }
  const byN = takes.find(x => x.a.n === pick.n);
  return byN ? byN.i : -1;
}

/**
 * Choose among attempts (chronological order). Returns { idx, picked }.
 * pick → that attempt; else non-bad pool (if any); best effective score; ties within
 * tieEpsilon → the latest. Unscored: re-record = +∞ (legacy: accepted re-record wins), take = −∞.
 */
function choose(atts, pick, cfg) {
  if (!atts.length) return { idx: -1, picked: false };
  const pi = matchPick(atts, pick);
  if (pi >= 0) return { idx: pi, picked: true };
  const eff = a => (Number.isFinite(a.score) ? a.score : a.source === 'rerecord' ? Infinity : -Infinity);
  const isBad = a => !!(a.breakdown && a.breakdown.bad);
  let pool = atts.map((a, i) => ({ a, i })).filter(x => !isBad(x.a));
  if (!pool.length) pool = atts.map((a, i) => ({ a, i }));
  const best = Math.max(...pool.map(x => eff(x.a)));
  const eps = cfg.attempts.tieEpsilon;
  const near = pool.filter(x => eff(x.a) >= best - eps || eff(x.a) === best);
  return { idx: near[near.length - 1].i, picked: false };
}

const fmtScore = a => (Number.isFinite(a.score) ? a.score.toFixed(2) : '—');

function noteFlag(atts, idx, picked) {
  const c = atts[idx];
  const others = atts.filter((_, i) => i !== idx).map(fmtScore).join(', ');
  const src = c.source === 'rerecord' ? ` (re-record ${String(c.clip || '').replace(/^takes\//, '')})` : '';
  return { type: 'attempts', severity: 'info',
    detail: `${atts.length} attempts — kept #${c.n}${src} (score ${fmtScore(c)} vs ${others})${picked ? ' · your pick' : ''}; others auto-cut` };
}

const TAKE_FIELDS = ['status', 'range', 'wordIdx', 'wer', 'wpm', 'flags', 'heard', 'meanVolumeDb'];

/**
 * Resolve a take.json sentence across all its attempts (take + rerecord) and
 * copy the chosen one's analysis onto it. Returns { chosen, needsReanalyze }.
 * A pick of a take attempt the take alignment doesn't use yet (no `aligned`)
 * needs analyze() to re-align — until then the aligned take attempt is used.
 */
function applyChoice(s, cfg) {
  const atts = s.attempts || [];
  const onRR = !!(s.source && s.source.kind === 'rerecord');
  const takeState = onRR ? s.take : Object.fromEntries(TAKE_FIELDS.map(k => [k, s[k]]));
  if (!atts.length) return { chosen: null, needsReanalyze: false };
  let { idx, picked } = choose(atts, s.pick, cfg);
  let needsReanalyze = false;
  if (atts[idx].source === 'take' && !atts[idx].aligned) {
    const al = atts.findIndex(a => a.source === 'take' && a.aligned);
    if (al >= 0 && al !== idx) { needsReanalyze = true; idx = al; picked = false; }
  }
  const c = atts[idx];
  atts.forEach((a, i) => { a.chosen = i === idx; });
  if (c.source === 'rerecord' && c.result) {
    Object.assign(s, c.result, { status: 'rerecorded', take: takeState });
  } else if (c.source === 'take' && takeState) {
    Object.assign(s, takeState, { source: { kind: 'take' } });
    delete s.take; delete s.clipStatus;
  }
  s.flags = (s.flags || []).filter(f => f.type !== 'attempts');
  if (atts.length >= 2) s.flags.push(noteFlag(atts, idx, picked));
  return { chosen: c, needsReanalyze };
}

/** Attempt record for an accepted re-record clip, from analyzeWords() on the clip. */
function rerecordEntry(r, out, clip) {
  const c = (r.attempts || []).find(a => a.chosen) || {};
  return {
    n: 0, source: 'rerecord', clip,
    range: r.range ? [r.range.start, r.range.end] : null,
    wer: c.wer ?? r.wer, wpm: c.wpm ?? r.wpm, conf: c.conf ?? null, score: c.score ?? null,
    breakdown: c.breakdown ? { ...c.breakdown, bad: r.status === 'bad' } : null,
    clipAttempts: (r.attempts || []).length,
    chosen: false,
    result: {
      wer: r.wer, wpm: r.wpm, flags: r.flags.filter(f => f.type !== 'attempts'), heard: r.heard, clipStatus: r.status,
      meanVolumeDb: r.meanVolumeDb,
      source: { kind: 'rerecord', clip, range: r.range, cuts: out.cuts,
        words: out.words.filter(w => w.sid === r.id && (w.role === 'anchor' || w.role === 'extra'))
          .map(w => ({ word: w.word, start: w.start, end: w.end })) },
    },
  };
}

/** Unscored attempt records for take.json files written before attempts existed. */
function legacyRerecord(p) {
  return { n: 0, source: 'rerecord', clip: p.source.clip, range: p.source.range ? [p.source.range.start, p.source.range.end] : null,
    wer: p.wer, wpm: p.wpm, conf: null, score: null, breakdown: null, legacy: true, chosen: false,
    result: { wer: p.wer, wpm: p.wpm, flags: p.flags, heard: p.heard, clipStatus: p.clipStatus, meanVolumeDb: p.meanVolumeDb, source: p.source } };
}
function legacyTake(t) {
  return { n: 0, source: 'take', range: t.range ? [t.range.start, t.range.end] : null, wer: t.wer, wpm: t.wpm, conf: null,
    score: null, breakdown: { bad: t.status === 'bad' }, legacy: true, aligned: true, chosen: false };
}

module.exports = { measure, reference, score, entry, rescore, renumber, choose, matchPick, noteFlag, applyChoice,
  rerecordEntry, legacyRerecord, legacyTake, median, r2 };
