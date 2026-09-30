'use strict';
/**
 * pipeline/jev.js — Jev (TypeSafe "System One" decision model) via OpenRouter.
 *
 * Jev is NOT a chat model: it only serves OpenRouter's Decisions API
 *   POST https://openrouter.ai/api/alpha/decisions
 *   { model, state, questions: { <id>: { type: 'noul'|'choice'|'score', instructions, criteria } } }
 * and answers with typed probabilities (noul = P(yes)), no free text / reasoning.
 * So instead of chat-completions + JSON mode (spec §8 wording) we ask typed
 * `noul` questions and derive { verdict, reason } from the probability.
 * (Details + pricing: docs/learnings.md "Jev model".)
 *
 * Every call is optional and fail-safe: no OPENROUTER_API_KEY, a timeout
 * (default 10 s), a non-200 or a malformed answer → the function returns null
 * and the caller falls back to deterministic rules. Nothing here ever throws.
 *
 *  verifySlug(slug?)                       → { ok, slug, model?, closest?, error? }
 *  reviewSentence({scriptText, heardText, flags}) → { verdict: 'keep'|'rerecord', reason, prob } | null
 *  classifyInsertions([{before, token, after}])   → [{ isFiller, prob }] | null  (one call per ≤25 items)
 *  classifyInsertion(item)                 → { isFiller, prob } | null
 *  usage()                                 → { calls, cost } accumulated this process
 */
const { loadEnv, loadConfig } = require('./config');

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
// Jev's output modality is "decisions", so the default /models listing (text
// output only) omits it — output_modalities=all is required to see it.
const MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=all';
const DEFAULT_MODEL = 'typesafe/jev-1.13';

const stats = { calls: 0, cost: 0, errors: [] };

function model() { loadEnv(); return process.env.JEV_MODEL || DEFAULT_MODEL; }
function available() { loadEnv(); return Boolean(process.env.OPENROUTER_API_KEY); }
function timeoutMs() { return loadConfig().jev.timeoutMs || 10000; }

async function fetchJson(url, init = {}, ms = timeoutMs()) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { /* non-JSON */ }
    return { status: r.status, body, text };
  } finally { clearTimeout(timer); }
}

function lev(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Check the slug exists on OpenRouter; returns model info or closest matches. */
async function verifySlug(slug = model()) {
  try {
    const { status, body } = await fetchJson(MODELS_URL);
    if (status !== 200 || !body || !Array.isArray(body.data)) return { ok: false, slug, error: `models list HTTP ${status}` };
    const found = body.data.find(m => m.id === slug || m.canonical_slug === slug);
    const pick = m => m && ({ id: m.id, name: m.name, context_length: m.context_length, pricing: m.pricing,
      modality: m.architecture && m.architecture.modality, description: m.description });
    if (found) return { ok: true, slug, model: pick(found) };
    const closest = body.data
      .map(m => ({ m, d: /jev|typesafe/i.test(m.id) ? -1 : lev(m.id, slug) }))
      .sort((a, b) => a.d - b.d).slice(0, 3).map(x => pick(x.m));
    return { ok: false, slug, closest };
  } catch (e) {
    return { ok: false, slug, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

/** Raw Decisions call → answers object, or null on any failure. */
async function decide(state, questions) {
  if (!available()) return null;
  try {
    stats.calls++;
    const { status, body, text } = await fetchJson(DECISIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json',
        'X-Title': 'video-gen-v2' },
      body: JSON.stringify({ model: model(), state, questions }),
    });
    if (status !== 200 || !body || typeof body.answers !== 'object') {
      stats.errors.push(`HTTP ${status}: ${(body && body.error && body.error.message) || String(text).slice(0, 120)}`);
      return null;
    }
    if (body.usage && Number.isFinite(body.usage.cost)) stats.cost += body.usage.cost;
    return body.answers;
  } catch (e) {
    stats.errors.push(e.name === 'AbortError' ? 'timeout' : e.message);
    return null;
  }
}

const noul = a => (a && a.type === 'noul' && Number.isFinite(a.noul) ? a.noul : null);

/** Borderline sentence: keep (harmless paraphrase / ASR noise) or re-record (meaning changed)? */
async function reviewSentence({ scriptText, heardText, flags = [] }) {
  const answers = await decide(
    {
      script_line: scriptText,
      heard_transcript: heardText,
      automatic_flags: flags.map(f => `${f.type}: ${f.detail || ''}`.trim()),
      context: 'A creator read the script line aloud for a voiceover. heard_transcript is an automatic speech-to-text ' +
        'transcript, so spelling, punctuation, number formatting (digits vs words) and filler words are NOT errors.',
    },
    {
      rerecord: {
        type: 'noul',
        instructions: 'Should this line be re-recorded because what was said differs from the script in a way a viewer would notice?',
        criteria: {
          true: 'Meaning changed, a fact/number/name/technical term is wrong or missing, or words are garbled or cut off.',
          false: 'Same meaning: only harmless paraphrase, a small function-word difference, or transcription noise.',
        },
      },
    },
  );
  const p = noul(answers && answers.rerecord);
  if (p === null) return null;
  const th = loadConfig().jev.rerecordProb;
  return { verdict: p >= th ? 'rerecord' : 'keep', reason: `Jev P(rerecord)=${p.toFixed(2)}`, prob: p };
}

/** Batch-classify ambiguous inserted tokens (like/so/right/okay/well) as filler or meaningful. */
async function classifyInsertions(batch) {
  if (!Array.isArray(batch) || !batch.length || !available()) return batch && batch.length ? null : [];
  const CHUNK = 25;
  const th = loadConfig().jev.fillerProb;
  const chunks = [];
  for (let i = 0; i < batch.length; i += CHUNK) chunks.push(batch.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map(async chunk => {
    const items = {}, questions = {};
    chunk.forEach((it, i) => {
      const id = `w${i}`;
      items[id] = { before: it.before || '', word: it.token, after: it.after || '' };
      questions[id] = {
        type: 'noul',
        instructions: `In items.${id}, the speaker said "${it.token}" between "before" and "after", and that word is NOT in their ` +
          'script. Is it a verbal filler (hesitation / discourse filler that can be cut without changing the meaning)?',
        criteria: {
          true: 'Filler: a hesitation or verbal tic; cutting it loses no meaning.',
          false: 'Meaningful: it carries content (comparison, consequence, agreement) and cutting it changes the sentence.',
        },
      };
    });
    const answers = await decide({ items, context: 'Transcribed voiceover takes of a tech explainer video.' }, questions);
    if (!answers) return null;
    return chunk.map((_, i) => {
      const p = noul(answers[`w${i}`]);
      return p === null ? null : { isFiller: p >= th, prob: p };
    });
  }));
  if (results.some(r => r === null)) return null;
  const flat = results.flat();
  return flat.some(r => r === null) ? null : flat;
}

async function classifyInsertion(item) {
  const r = await classifyInsertions([item]);
  return r ? r[0] : null;
}

function usage() { return { calls: stats.calls, cost: stats.cost, errors: stats.errors.slice(-5) }; }

module.exports = { verifySlug, reviewSentence, classifyInsertions, classifyInsertion, decide, available, model, usage,
  DECISIONS_URL, MODELS_URL, DEFAULT_MODEL };

if (require.main === module) {
  // `node pipeline/jev.js` — verify the slug and print what OpenRouter reports.
  verifySlug().then(r => console.log(JSON.stringify(r, null, 2)));
}
