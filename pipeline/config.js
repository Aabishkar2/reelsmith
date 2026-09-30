'use strict';
/**
 * pipeline/config.js — shared config + env loading for the pipeline.
 *
 *  - loadEnv(): loads <repo>/.env via dotenv (falls back to a tiny parser if
 *    node_modules isn't installed yet). Never overrides existing env vars.
 *  - loadConfig(): config/fillers.json deep-merged over built-in defaults, so a
 *    missing/partial fillers.json never breaks the pipeline.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'fillers.json');

let envLoaded = false;
function loadEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const envPath = path.join(ROOT, '.env');
  try {
    require('dotenv').config({ path: envPath, quiet: true });
    return;
  } catch (_) { /* dotenv not installed yet — fall through */ }
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const DEFAULTS = {
  fillers: ['um', 'umm', 'uhm', 'uh', 'uhh', 'er', 'erm', 'ah', 'ahh', 'eh', 'hmm', 'hm', 'mm', 'mhm',
    'basically', 'actually', 'literally'],
  fillerPhrases: [['you', 'know'], ['sort', 'of'], ['kind', 'of'], ['i', 'mean']],
  ambiguous: ['like', 'so', 'right', 'okay', 'ok', 'well'],
  ambiguousDefaultIsFiller: true,
  whisper: {
    script: 'pipeline',
    prompt: "Umm, let me think like, hmm... Okay, here's what I'm, like, thinking. So, uh, I-I mean, we, we should, you know, try it.",
    mode: 'chunked',            // 'chunked' (VAD chunks, interleaved windows — docs/spec.md §7b) | 'whole'
    threads: 0,                 // torch threads (0 = torch default)
    chunk: { minSilenceSec: 0.25, vadFrac: 0.5, lowFrac: 0.3, minCoreSec: 0.12, floorPct: 10, speechPct: 70, padSec: 0.35, minChunkSec: 0.3, packSec: 24, sepSec: 1.0 },
    net: { enabled: true, longWordSec: 1.0, ratio: 3, speechFrac: 0.6, subSilenceSec: 0.12, subBelowDb: 12 },
  },
  thresholds: {
    fillerBadCount: 3, mismatchWer: 0.15, missingCoverage: 0.34, orderMinCoverage: 0.6,
    similarityMatch: 0.7,
    pauseInsideSec: 1.2, pauseBetweenSec: 2.0, pauseTrimInsideSec: 0.35, pauseTrimBetweenSec: 0.6,
    paceMinWpm: 110, paceMaxWpm: 200, paceMinWords: 5, paceMinSec: 1.5,
    loudnessMinDb: -30, clippingMaxDb: -0.5, edgeGuardSec: 0.8,
    silenceMinSec: 0.3, silenceFloorDb: -50, silenceCeilDb: -30, silenceBelowMeanDb: 18,
  },
  cut: { paddingSec: 0.04, sentenceGapSec: 0.25, sceneTailSec: 0.3, fadeMs: 5, mp3Bitrate: '128k' },
  jev: { timeoutMs: 10000, reviewWerMin: 0.05, reviewWerMax: 0.15, rerecordProb: 0.7, fillerProb: 0.5 },
  alignCosts: { exact: 0, fuzzy: 0.35, sub: 1.0, del: 1.0, ins: 0.6, insFiller: 0.3 },
  // best-attempt selection (pipeline/attempts.js, docs/spec.md §7a)
  attempts: {
    minCoverage: 0.8, maxSpanFactor: 1.5, tieEpsilon: 0.02,
    weights: { accuracy: 0.5, fluency: 0.2, confidence: 0.1, audio: 0.1, pace: 0.1 },
    fluencyPenalty: { filler: 0.15, repeat: 0.2, pause: 0.15 },
    fuzzyPenalty: 0.5, audioSlackDb: 2, audioRangeDb: 12, clipPenalty: 0.5, paceRange: 0.5,
  },
  // background-noise removal for the cut (pipeline/denoise.js, docs/spec.md §7c)
  denoise: {
    enabled: true, engine: 'deepfilternet', get python() { return require('../core/env').python() || 'python3'; }, attenLimitDb: 35, timeoutSec: 600,
    fallback: { highpassHz: 80, lowpassHz: 12000, nr: 12, nf: -50, trackNoise: true },
    gate: { enabled: true, aboveRoomDb: 18, padSec: 0.12, frameSec: 0.01 },
  },
  // silent-take guards (analyze.js / splice.js)
  silence: {
    maxDb: -60,
    hallucinations: ['thank you', 'thanks for watching', 'thank you for watching', 'thank you so much for watching',
      'thanks for watching and see you next time', 'please subscribe', 'subscribe to my channel', 'like and subscribe',
      'see you next time', 'bye', 'you', 'subtitles by the amara org community', 'transcription by castingwords'],
    hallucinationFrac: 0.6, hallucinationMaxFound: 0.1,
  },
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = (k in base && typeof base[k] === 'object' && !Array.isArray(base[k])) ? merge(base[k], v) : v;
  }
  return out;
}

function loadConfig(overrides) {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { /* use defaults */ }
  return merge(merge(DEFAULTS, file), overrides || {});
}

module.exports = { ROOT, CONFIG_PATH, loadEnv, loadConfig, DEFAULTS };
