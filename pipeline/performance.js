'use strict';
/**
 * pipeline/performance.js — `tts --mode=performance`: the whole script voiced in ONE TTS call
 * with a direction prompt (docs/framework-spec.md §5.2, §11). Writes the same contract as
 * sentence mode (pipeline/tts.js) and cut.js: voiceover/sN.mp3, voiceover.mp3, scenes.json.
 *
 * synthesize(videoDir, opts) → { mode: 'performance', scenes, totalSec, provider, model, voice, speed,
 *                                timings, apiCalls, cached, sentences, matched, unmatched, … }
 *
 * 1. Prompt (performance-prompt.md):
 *      # <title>
 *      <PERFORMANCE block: the direction file (frontmatter tts_performance: <path>, else
 *       reelsmith.config.json tts.performance.directionFile = config/voice/performance.md)
 *       from its line `PERFORMANCE` to the end>
 *      CONTEXT\n\n<script.md `## Voice direction` section>      (omitted when that section is empty)
 *      TRANSCRIPT\n<spoken lines: a scene's sentences joined by a space, scenes by a blank line;
 *                   `>` cue lines excluded>
 *    sections separated by a blank line, trailing newline.
 * 2. Cache: voiceover/source/performance.meta.json { provider, model, voice, mode, hash, format,
 *    sampleRate, seconds, at } with hash = sha1(model|voice|prompt) next to performance.wav
 *    → no API call ("cached"). Else one provider.synthesizePerformance({ prompt, voice, model }):
 *    raw audio → performance.{pcm|mp3|src.wav}, performance.wav (mono s16le; 24 kHz for
 *    OpenRouter PCM). A performance.json that holds that meta (the pre-rename layout) is moved to
 *    performance.meta.json first: performance.json belongs to whisper (words of performance.wav).
 *    opts.offline refuses the API call and says why the cache missed; opts.force re-generates.
 *    (legacyPrompt(): audio cached by the first, one-off builder is recognised too — see there.)
 * 3. Word timings: the stt provider on the 1× wav (mode 'whole', no prompt; whisper caches the
 *    words at performance.json + performance.whisper.json). Fragments whisper splits off
 *    ("always" "-on", "3" ".11") are glued back onto the previous word.
 * 4. Scenes: script sentences are aligned to the words with pipeline/align.js — the take
 *    pipeline's tokenizer, costs and sentence mapping (numbers, merges like "ClaudeCode" ↔
 *    "Claude Code", fuzzy matches like "RealSmith" ↔ "Reelsmith"). Each sentence's first/last
 *    matched word → each scene's span. Fewer than tts.performance.minMatched (80 %) of the
 *    sentences found → error listing the missing ids. The cut between two scenes is the middle of
 *    the pause between scene N's last matched word and scene N+1's first (if unmatched words sit
 *    between them, the middle of the longest pause there; a scene with no matched sentence at all
 *    is placed on the longest pauses between its neighbours). Cut times are computed in 1× time,
 *    then divided by the speed.
 * 5. Speed: voiceover/source/performance-x<speed>.wav = ffmpeg aresample=44100,atempo=<speed>
 *    (mono s16; padded and trimmed to exactly 1× length / speed). No sentence gaps or scene
 *    tails are inserted: the natural pauses stay.
 *    Scene wavs are sliced from it sample-exactly (audio.readWav/writeWav) → voiceover/sN.mp3;
 *    voiceover.mp3 is encoded from the concatenated scene wavs, so Σdur matches it.
 * 6. scenes.json (bare array [{ idx, dur, file, words }]): every whisper word, times / speed,
 *    assigned to the scene its span falls in (a word straddling a cut goes to the scene it overlaps
 *    most), scene-relative, clamped to [0, dur], monotonic. With tts.performance.respell (default)
 *    a matched word whisper misspelled takes the script's spelling ("RealSmith" → "Reelsmith",
 *    "ClaudeCode" → "Claude" "Code"); exact matches keep whisper's form ("150", "script.md").
 *    voiceover/tts/meta.json = { provider, model, voice, speed, mode: 'performance', timings:
 *    'whisper', sentences, matched, unmatched, totalSec, at }.
 *
 * opts: { provider, model, voice, speed, force, offline, whisperModel, ctaSec, quiet, log,
 *         config / configPath / root, fetch, retryDelayMs,
 *         ttsProvider / sttProvider (plugin objects; stubs in tests), registry }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const audio = require('./audio');
const A = require('./align');
const { loadConfig } = require('./config');
const tts = require('./tts');
const env = require('../core/env');
const project = require('../core/project');

const OUT_SR = 44100;
const r3 = x => Math.round(x * 1000) / 1000;
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── prompt ───────────────────────────────────────────────────────────────────

/** Body of the markdown section `## <name>` (up to the next `## ` heading or the end), trimmed. */
function section(md, name, flags = 'mi') {
  const m = String(md).match(new RegExp(`^## ${escapeRe(name)}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, flags));
  return m ? m[1].trim() : '';
}

/** The PERFORMANCE block of a direction file: from the line `PERFORMANCE` to the end. */
function performanceBlock(text) {
  const lines = String(text || '').split(/\r?\n/);
  const i = lines.findIndex(l => l.trim() === 'PERFORMANCE');
  if (i >= 0) return lines.slice(i).join('\n').trim();
  const body = String(text || '').trim();
  return body ? `PERFORMANCE\n\n${body}` : '';            // a file without the marker line is all direction
}

/** Spoken lines: a scene's sentences joined by a space, scenes separated by a blank line. */
function transcriptOf(scenes) {
  return scenes.map(sc => sc.sentences.map(s => s.text).join(' ')).join('\n\n');
}

function buildPrompt({ title, performance, context, transcript }) {
  const head = [`# ${title}`];
  if (performance) head.push(performance);
  if (context) head.push(`CONTEXT\n\n${context}`);
  return `${head.join('\n\n')}\n\nTRANSCRIPT\n${transcript}\n`;
}

/**
 * The prompt exactly as the first, one-off performance builder (2026-09-30) made it. That builder
 * took the PERFORMANCE block from the first "PERFORMANCE" *substring* of the direction file, which
 * in config/voice/performance.md sits mid-sentence in the explanatory paragraph above the marker
 * line, so the paragraph went into the prompt too. The tutorial videos were voiced that way; this
 * only exists so their cached audio is recognised (hash match) instead of re-generated. New audio
 * always uses buildPrompt(). Safe to delete once no cache made by that builder is left.
 */
function legacyPrompt(md, directionText) {
  const i = String(directionText || '').indexOf('PERFORMANCE');
  const title = (String(md).match(/^title:\s*(.*)$/m) || [])[1];
  if (i < 0 || title === undefined) return null;
  const scenes = section(md, 'Script', 'm').split(/^### Scene \d+\s*$/m).map(s => s.trim()).filter(Boolean);
  const transcript = scenes.map(s => s.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('>')).join(' ')).join('\n\n');
  return `# ${title}\n\n${directionText.slice(i).trim()}\n\nCONTEXT\n\n${section(md, 'Voice direction', 'm')}\n\nTRANSCRIPT\n${transcript}\n`;
}

/** Direction file: frontmatter tts_performance (video dir, then project root), else the config default. */
function directionFile(videoDir, S) {
  const fmPath = S.fm.tts_performance;
  if (fmPath) {
    const p = String(fmPath);
    const tries = path.isAbsolute(p) ? [p] : [path.resolve(videoDir, p), path.resolve(S.root, p)];
    const f = tries.find(isFile);
    if (!f) throw new Error(`tts_performance: ${p} not found (tried ${tries.join(', ')})`);
    return f;
  }
  const rel = (S.tcfg.performance && S.tcfg.performance.directionFile) || 'config/voice/performance.md';
  const tries = path.isAbsolute(rel) ? [rel] : [path.resolve(S.root, rel), path.resolve(project.FRAMEWORK_ROOT, 'config/voice/performance.md')];
  return tries.find(isFile) || null;
}

function makePrompts(videoDir, S) {
  const file = directionFile(videoDir, S);
  const text = file ? fs.readFileSync(file, 'utf8') : '';
  const md = S.parsed.raw;
  const prompt = buildPrompt({
    title: String(S.fm.title || path.basename(videoDir)),
    performance: performanceBlock(text),
    context: section(md, 'Voice direction'),
    transcript: transcriptOf(S.parsed.scenes),
  });
  return { prompt, legacy: text ? legacyPrompt(md, text) : null, directionFile: file };
}

/** Which parts of the prompt differ (for "why is this not cached"). */
function promptDiff(oldPrompt, newPrompt) {
  if (typeof oldPrompt !== 'string') return 'the prompt changed (no performance-prompt.md to compare)';
  const parts = p => {
    const t = p.indexOf('\n\nTRANSCRIPT\n'), c = p.indexOf('\n\nCONTEXT\n\n'), f = p.indexOf('PERFORMANCE');
    const end = t >= 0 ? t : p.length;
    return {
      title: p.split('\n')[0],
      'PERFORMANCE (direction file)': f >= 0 ? p.slice(f, c >= 0 && c > f ? c : end) : '',
      'CONTEXT (## Voice direction)': c >= 0 ? p.slice(c, end) : '',
      'TRANSCRIPT (script lines)': t >= 0 ? p.slice(t) : p,
    };
  };
  const a = parts(oldPrompt), b = parts(newPrompt);
  const changed = Object.keys(a).filter(k => a[k] !== b[k]);
  return `the prompt changed: ${changed.length ? changed.join(', ') : 'whitespace'} (compare voiceover/source/performance-prompt.md)`;
}

// ── cache ────────────────────────────────────────────────────────────────────

function cacheFiles(videoDir) {
  const src = path.join(videoDir, 'voiceover', 'source');
  return {
    src,
    prompt: path.join(src, 'performance-prompt.md'),
    meta: path.join(src, 'performance.meta.json'),
    wav: path.join(src, 'performance.wav'),
    words: path.join(src, 'performance.json'),             // whisper's cache (pipeline/whisper.js cachePath)
    wordsMeta: path.join(src, 'performance.whisper.json'),
  };
}

/** performance.json holding the meta (it collides with whisper's cache name) → performance.meta.json. */
function migrateMeta(F, log) {
  const j = readJson(F.words);
  if (!j || Array.isArray(j) || j.mode !== 'performance') return false;
  const dest = fs.existsSync(F.meta) ? path.join(F.src, 'performance.meta.old.json') : F.meta;
  fs.renameSync(F.words, dest);
  log(`  moved the performance meta out of whisper's cache name: performance.json → ${path.basename(dest)}`);
  return true;
}

function cacheState(F, { providerId, model, voice, prompt, legacy }) {
  if (!fs.existsSync(F.wav)) return { hit: false, why: 'no cached performance.wav' };
  const meta = readJson(F.meta);
  if (!meta) return { hit: false, why: 'performance.wav has no performance.meta.json' };
  if (meta.provider && meta.provider !== providerId) return { hit: false, meta, why: `the cached audio is from provider ${meta.provider}, not ${providerId}` };
  if (meta.hash === sha1(`${model}|${voice}|${prompt}`)) return { hit: true, meta, prompt, legacy: false };
  if (legacy && meta.hash === sha1(`${model}|${voice}|${legacy}`)) return { hit: true, meta, prompt: legacy, legacy: true };
  const why = [];
  if (meta.model && meta.model !== model) why.push(`model ${meta.model} → ${model}`);
  if (meta.voice && meta.voice !== voice) why.push(`voice ${meta.voice} → ${voice}`);
  if (!why.length) {
    let old = null;
    try { old = fs.readFileSync(F.prompt, 'utf8'); } catch (_) { /* none */ }
    why.push(promptDiff(old, prompt));
  }
  return { hit: false, meta, why: why.join(', ') };
}

async function generate(F, { ttsP, providerId, model, voice, prompt, opts, log }) {
  if (typeof ttsP.synthesizePerformance !== 'function') {
    throw new Error(`tts provider ${ttsP.name} has no synthesizePerformance(), so it can't do performance mode — use --mode=sentence`);
  }
  log(`  tts performance (${providerId} ${model}, ${voice}): one call, ${prompt.length} prompt chars`);
  const r = await ttsP.synthesizePerformance({ prompt, voice, model, fetch: opts.fetch, retryDelayMs: opts.retryDelayMs });
  if (!r || !Buffer.isBuffer(r.audio) || !r.audio.length) throw new Error(`${ttsP.name}.synthesizePerformance returned no audio`);
  const fmt = r.format === 'pcm' ? 'pcm' : r.format === 'mp3' ? 'mp3' : 'wav';
  fs.mkdirSync(F.src, { recursive: true });
  // new audio: every derived file of the old one is stale (whisper words, sped copies, raw of another format)
  for (const f of fs.readdirSync(F.src)) {
    if (/^performance(\.(pcm|mp3|src\.wav|json|whisper\.json)|-x[\d.]+\.wav)$/.test(f)) fs.rmSync(path.join(F.src, f), { force: true });
  }
  const raw = path.join(F.src, fmt === 'wav' ? 'performance.src.wav' : `performance.${fmt}`);
  fs.writeFileSync(raw, r.audio);
  const input = fmt === 'pcm' ? ['-f', 's16le', '-ar', String(r.sampleRate || 24000), '-ac', '1'] : [];
  audio.ffmpeg(['-loglevel', 'error', ...input, '-i', raw, '-ac', '1', '-c:a', 'pcm_s16le', F.wav]);
  const seconds = audio.duration(F.wav);
  if (seconds < 0.5) throw new Error(`the TTS returned ${seconds.toFixed(2)} s of audio for the whole script`);
  const meta = {
    provider: providerId, model, voice, mode: 'performance', hash: sha1(`${model}|${voice}|${prompt}`),
    format: fmt, sampleRate: audio.sampleRate(F.wav), seconds: Math.round(seconds * 100) / 100, at: new Date().toISOString(),
  };
  fs.writeFileSync(F.meta, JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

// ── words + alignment ────────────────────────────────────────────────────────

// A ".env"/".md" fragment after one of these is a standalone dotfile or extension ("live in .env"), not a suffix.
const NOT_A_STEM = new Set(['a', 'an', 'the', 'in', 'into', 'on', 'of', 'to', 'from', 'at', 'by', 'for', 'with', 'and', 'or',
  'your', 'my', 'our', 'their', 'its', 'this', 'that', 'each', 'every', 'any', 'no']);

/**
 * Glue fragments whisper splits off ("always" "-on", "3" ".11", "text" "-to" "-speech", "script" ".md")
 * back onto the previous word, as the one-off build-voice.js did — except a "."-fragment after a
 * function word ("in" ".env" stays two words).
 */
function glueFragments(words) {
  const out = [];
  for (const w of words || []) {
    const word = String((w && w.word) || '').trim();
    if (!word) continue;
    const start = Number(w.start), end = Math.max(Number(w.end), Number(w.start));
    const prev = out.length ? out[out.length - 1].word.toLowerCase().replace(/[^a-z']/g, '') : '';
    if (out.length && (word[0] === '-' || (word[0] === '.' && !(/^\.[a-z]/i.test(word) && NOT_A_STEM.has(prev))))) {
      const p = out[out.length - 1];
      p.word += word;
      p.end = Math.max(p.end, end);
      continue;
    }
    out.push({ word, start, end });
  }
  return out;
}

/** Align script sentences to words with the take pipeline's tokenizer, costs and sentence mapping. */
function alignSentences(sentences, words, pcfg = loadConfig()) {
  const fillers = new Set(pcfg.fillers.map(s => s.toLowerCase()));
  const amb = new Set(pcfg.ambiguous.map(s => s.toLowerCase()));
  const T = A.tokenizeWords(words.map(w => w.word)).map(t => ({ ...t, filler: fillers.has(t.t) || amb.has(t.t) }));
  const { tokens: S, ranges } = A.tokenizeSentences(sentences);
  const alignOpts = { costs: pcfg.alignCosts, similarity: pcfg.thresholds.similarityMatch };
  const al = A.align(S, T, alignOpts);
  const map = A.mapSentences(ranges, S, T, al, { thresholds: pcfg.thresholds, ...alignOpts });
  const result = sentences.map((s, k) => {
    const st = map.sentences[k];
    if (st.missing || st.tFirst === null) return { id: s.id, scene: s.scene, text: s.text, matched: false, coverage: 0 };
    return { id: s.id, scene: s.scene, text: s.text, matched: true, coverage: st.coverage, first: T[st.tFirst].w0, last: T[st.tLast].w1 };
  });
  return { sentences: result, S, T, al };
}

const core = w => String(w).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * Script spelling for matched words whisper wrote differently (subtitles + useWordCue, which
 * matches the script's words one by one). The TTS read the script, so where the alignment is
 * sure, the script's form wins; times stay whisper's (split by letter count when one word
 * becomes several):
 *   glued       "npx-realsmith-init" ↔ "npx" "reelsmith" "init," (separate script words)
 *               → "npx" "reelsmith" "init"; "text-to-speech" ↔ "text to speech" likewise. When the
 *               script has ONE word ("always-on"), the glued form stays.
 *   fuzzy 1:1   "RealSmith." ↔ "Reelsmith" → "Reelsmith." ("installed" ↔ "install" → "install"),
 *               in place inside a glued word; not when the extra letters are a glued fragment
 *               ("script.md" ↔ "script" stays)
 *   merge 2:1   "ClaudeCode." ↔ "Claude" "Code" → "Claude" "Code."
 *   merge 1:2   "open" "router" ↔ "OpenRouter" → "OpenRouter" over both spans
 * Exact token matches keep whisper's form ("150" for "one hundred and fifty", "script.md"), and
 * numbers are never touched. Whisper's trailing punctuation is kept.
 */
function respell(words, sentences, { S, T, al }) {
  const raws = sentences.map(s => A.splitWords(s.text));
  const scriptWord = tok => core(raws[tok.sent][tok.src]);
  const tokCount = new Map();                    // "sent:src" → tokens of that script raw word
  for (const t of S) tokCount.set(`${t.sent}:${t.src}`, (tokCount.get(`${t.sent}:${t.src}`) || 0) + 1);
  const single = tok => tokCount.get(`${tok.sent}:${tok.src}`) === 1;
  const tokensOf = new Map();                    // whisper word index → its T token indices
  T.forEach((t, ti) => { for (let j = t.w0; j <= t.w1; j++) { if (!tokensOf.has(j)) tokensOf.set(j, []); tokensOf.get(j).push(ti); } });
  const own = (j, ti) => T[ti].w0 === j && T[ti].w1 === j;
  const tailOf = w => (w.match(/[^\p{L}\p{N}]+$/u) || [''])[0];
  const pieces = (w, parts) => {               // one whisper word → several, time split by length
    const total = parts.reduce((a, p) => a + Math.max(1, p.length), 0);
    let t = w.start;
    return parts.map((p, q) => {
      const d = (w.end - w.start) * (Math.max(1, p.length) / total);
      const o = { word: q === parts.length - 1 ? p + tailOf(w.word) : p, start: t, end: q === parts.length - 1 ? w.end : t + d };
      t += d;
      return o;
    });
  };
  const plain = x => x && !x.num && !x.numWord;

  const out = words.map(w => ({ ...w }));
  const drop = new Set(), repl = new Map();

  // glued compound whose pieces are consecutive, separate script words
  for (const [j, ts] of tokensOf) {
    if (ts.length < 2 || !ts.every(ti => own(j, ti) && plain(T[ti]))) continue;
    const ss = ts.map(ti => (al.trans[ti] && al.trans[ti].op === 'match' ? al.trans[ti].s : null));
    if (ss.some(x => x === null || !plain(S[x]) || !single(S[x]) || (al.script[x] && al.script[x].merge))) continue;
    const toks = ss.map(x => S[x]);
    if (!toks.every((x, q) => x.sent === toks[0].sent && x.src === toks[0].src + q)) continue;
    const parts = toks.map(scriptWord);
    if (parts.some(p => !p)) continue;
    repl.set(j, pieces(out[j], parts));
  }

  al.script.forEach((op, i) => {
    if (!op || op.op !== 'match' || op.t === null || op.t === undefined) return;
    const s = S[i], t = T[op.t], j = t.w0;
    if (!plain(s) || !plain(t) || t.w0 !== t.w1 || repl.has(j)) return;
    if (op.merge && op.t2 !== undefined) {                         // 1 script word ↔ 2 whisper words
      const t2 = T[op.t2];
      if (!single(s) || !plain(t2) || t2.w0 !== t2.w1 || t2.w0 !== j + 1 || repl.has(t2.w0) ||
        tokensOf.get(j).length !== 1 || tokensOf.get(t2.w0).length !== 1) return;
      const a = out[j], b = out[t2.w0];
      repl.set(j, [{ word: scriptWord(s) + tailOf(b.word), start: a.start, end: Math.max(a.end, b.end) }]);
      drop.add(t2.w0);
      return;
    }
    if (op.merge) {                                                // 2 script words ↔ 1 whisper word
      const prev = al.script[i - 1];
      if (!prev || !prev.merge || prev.t !== op.t || prev.t2 !== undefined) return;   // handled on the 2nd of the pair
      const s1 = S[i - 1];
      if (!plain(s1) || s1.sent !== s.sent || s1.src === s.src || !single(s1) || !single(s) || tokensOf.get(j).length !== 1) return;
      repl.set(j, pieces(out[j], [scriptWord(s1), scriptWord(s)]));
      return;
    }
    if (!op.fuzzy || !single(s)) return;                           // fuzzy 1:1
    const w = out[j];
    if ((s.t.startsWith(t.t) || t.t.startsWith(s.t)) && /[\p{L}\p{N}][.-][\p{L}\p{N}]/u.test(w.word)) return;
    const at = w.word.toLowerCase().replace(/[‘’ʼ]/g, "'").indexOf(t.t);
    const r = scriptWord(s);
    if (at < 0 || !r) return;
    out[j] = { ...w, word: w.word.slice(0, at) + r + w.word.slice(at + t.t.length) };
  });
  return out.flatMap((w, j) => (drop.has(j) ? [] : repl.has(j) ? repl.get(j) : [w]));
}

// ── scenes ───────────────────────────────────────────────────────────────────

/**
 * Cut times (1× seconds) between consecutive scenes. anchors[i] = { first, last } word indices of
 * scene i's matched sentences, or null. Between two located scenes the cut is the middle of the
 * longest pause from the last word of one to the first word of the next (with nothing in
 * between: exactly the pause between them); unlocated scenes take the longest pauses of the
 * stretch between their located neighbours.
 */
function sceneCuts(words, anchors, scenes) {
  const n = anchors.length;
  const cuts = new Array(Math.max(0, n - 1)).fill(null);
  const known = anchors.map((a, i) => (a ? i : -1)).filter(i => i >= 0);
  if (!known.length) throw new Error('no scene could be located in the transcript');
  for (let q = 0; q + 1 < known.length; q++) {
    const a = anchors[known[q]], b = anchors[known[q + 1]];
    if (a.last >= b.first) {
      throw new Error(`scene ${scenes[known[q + 1]].idx} starts before scene ${scenes[known[q]].idx} ends in the transcript ` +
        `(words ${b.first} ≤ ${a.last}) — the voice did not follow the script order`);
    }
  }
  const place = (lo, hi, from, count) => {
    const gaps = [];
    for (let j = lo; j < hi; j++) gaps.push({ j, len: words[j + 1].start - words[j].end });
    if (gaps.length < count) {
      const ids = scenes.slice(from, from + count + 1).map(s => s.idx).join(', ');
      throw new Error(`can't place the boundaries around scene(s) ${ids}: not enough words were heard there`);
    }
    gaps.sort((x, y) => y.len - x.len || x.j - y.j).slice(0, count).sort((x, y) => x.j - y.j)
      .forEach((g, k) => { cuts[from + k] = (words[g.j].end + words[g.j + 1].start) / 2; });
  };
  if (known[0] > 0) place(0, anchors[known[0]].first, 0, known[0]);
  for (let q = 0; q + 1 < known.length; q++) place(anchors[known[q]].last, anchors[known[q + 1]].first, known[q], known[q + 1] - known[q]);
  const z = known[known.length - 1];
  if (z < n - 1) place(anchors[z].last, words.length - 1, z, n - 1 - z);
  return cuts;
}

/**
 * Sped-up words → per-scene, scene-relative lists. A word goes to the scene its span falls in,
 * or, straddling a cut, to the scene it overlaps most; times are clamped into [0, dur] and made
 * monotonic.
 */
function assignWords(words, bounds) {
  const out = bounds.map(() => []);
  const last = bounds.length - 1;
  for (const w of words) {
    let i = bounds.findIndex(b => w.start < b.off + b.dur);
    if (i < 0) i = last;
    const b = bounds[i];
    if (i < last && w.end > b.off + b.dur) {
      const n = bounds[i + 1];
      if (Math.min(w.end, n.off + n.dur) - n.off > b.off + b.dur - Math.max(w.start, b.off)) i++;
    }
    out[i].push(w);
  }
  return out.map((ws, i) => {
    const { off, dur } = bounds[i];
    const D = r3(dur);
    let prev = 0;
    return ws.map(w => {
      const start = Math.min(Math.max(r3(w.start - off), prev, 0), D);
      const end = Math.min(Math.max(r3(w.end - off), start), D);
      prev = start;
      return { word: w.word, start, end };
    });
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function synthesize(videoDir, opts = {}) {
  env.ensureOnPath();
  const log = opts.log || (opts.quiet ? () => {} : (...a) => console.error(...a));
  const S = tts.resolveSettings(videoDir, opts);
  const { parsed, model, voice, speed, tcfg } = S;
  const pc = tcfg.performance || {};
  if (!parsed.scenes.length) throw new Error('script.md has no ### Scene blocks');
  const { tts: ttsP, stt, sttError, providerId } = tts.providers(S, opts);
  tts.requireVoice(S, ttsP);
  const F = cacheFiles(videoDir);
  fs.mkdirSync(F.src, { recursive: true });
  migrateMeta(F, log);

  // 1–2. Prompt + cached audio (or one API call).
  const { prompt, legacy, directionFile: dirFile } = makePrompts(videoDir, S);
  if (!dirFile) log('  warning: no direction file (config/voice/performance.md or tts_performance:) — the prompt has no PERFORMANCE block');
  const state = opts.force ? { hit: false, why: '--force' } : cacheState(F, { providerId, model, voice, prompt, legacy });
  let apiCalls = 0, usedPrompt = prompt, meta = state.meta;
  if (state.hit) {
    usedPrompt = state.prompt;
    log(`  performance audio cached (${providerId} ${model}, ${voice}${state.legacy ? '; prompt from the first performance builder' : ''}) — no API call`);
  } else {
    if (opts.offline) throw new Error(`performance audio is not cached (${state.why}); refusing to call the TTS API (--offline)`);
    if (fs.existsSync(F.wav)) log(`  performance audio re-generated: ${state.why}`);
    meta = await generate(F, { ttsP, providerId, model, voice, prompt, opts, log });
    apiCalls = 1;
  }
  let onDisk = null;
  try { onDisk = fs.readFileSync(F.prompt, 'utf8'); } catch (_) { /* none yet */ }
  if (onDisk !== usedPrompt) fs.writeFileSync(F.prompt, usedPrompt);

  // 3. Word timings on the 1× voice.
  if (!stt) throw new Error(`performance mode needs word timings, but the stt provider is unavailable: ${sttError}`);
  let heard;
  try { heard = await stt.transcribe({ wavPath: F.wav, mode: 'whole', prompt: '', model: S.whisperModel, quiet: opts.quiet }); }
  catch (e) { throw new Error(`performance mode needs word timings from the stt provider (${stt.name}): ${e.message.split('\n')[0]}`); }
  const words = glueFragments(heard);
  if (!words.length) throw new Error('the stt provider heard no words in performance.wav');

  // 4. Align sentences → scene spans → cuts (1× time).
  const sentences = parsed.sentences;
  const al = alignSentences(sentences, words);
  const found = al.sentences.filter(s => s.matched);
  const unmatched = al.sentences.filter(s => !s.matched).map(s => ({ id: s.id, text: s.text }));
  const minMatched = pc.minMatched !== undefined ? Number(pc.minMatched) : 0.8;
  if (found.length < minMatched * sentences.length) {
    throw new Error(`performance mode: only ${found.length}/${sentences.length} script sentences were found in the transcript ` +
      `(need ${Math.round(minMatched * 100)} %). Not found:\n` +
      unmatched.map(s => `  ${s.id}  ${s.text}`).join('\n') +
      `\nheard: ${words.map(w => w.word).join(' ').slice(0, 400)}`);
  }
  for (const s of unmatched) log(`  warning: ${s.id} not found in the transcript: ${s.text}`);
  const anchors = parsed.scenes.map(sc => {
    const ss = found.filter(s => s.scene === sc.idx);
    return ss.length ? { first: Math.min(...ss.map(s => s.first)), last: Math.max(...ss.map(s => s.last)) } : null;
  });
  const cuts1x = sceneCuts(words, anchors, parsed.scenes);

  // 5. Speed + slice.
  // atempo drops its last partial window (~20 ms); pad first and trim to exactly 1× length / speed,
  // so the sped-up timeline is the 1× timeline divided by the speed, end included.
  const sped = path.join(F.src, `performance-x${speed}.wav`);
  const want = audio.duration(F.wav) / speed;
  if (opts.force || !fs.existsSync(sped) || fs.statSync(sped).mtimeMs < fs.statSync(F.wav).mtimeMs || Math.abs(audio.duration(sped) - want) > 0.002) {
    const end = want.toFixed(6);
    audio.ffmpeg(['-loglevel', 'error', '-i', F.wav, '-af', `aresample=${OUT_SR},apad=pad_dur=0.25,atempo=${speed},atrim=end=${end}`,
      '-ac', '1', '-ar', String(OUT_SR), '-c:a', 'pcm_s16le', sped]);
  }
  const pcm = audio.readWav(sped);
  const SR = pcm.sampleRate, N = pcm.samples.length;
  const edges = [0, ...cuts1x.map(t => Math.round((t / speed) * SR)), N];
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] <= edges[i - 1]) throw new Error(`scene ${parsed.scenes[i - 1].idx} came out empty (cut at ${(edges[i] / SR).toFixed(3)} s)`);
  }
  const scenes = parsed.scenes.map((sc, i) => ({
    idx: sc.idx, off: edges[i] / SR, dur: (edges[i + 1] - edges[i]) / SR, file: `voiceover/s${sc.idx}.mp3`,
    wav: path.join(F.src, `s${sc.idx}.wav`), samples: pcm.samples.subarray(edges[i], edges[i + 1]),
  }));
  const ctaSec = Number(opts.ctaSec || 0);
  if (ctaSec > 0) {
    const idx = scenes[scenes.length - 1].idx + 1;
    scenes.push({ idx, off: N / SR, dur: Math.round(ctaSec * SR) / SR, file: `voiceover/s${idx}.mp3`, wav: path.join(F.src, `s${idx}.wav`),
      samples: new Int16Array(Math.round(ctaSec * SR)), cta: true });
  }

  // 6. Words (display spelling, sped-up time) → scenes.
  const display = pc.respell === false ? words : respell(words, sentences, al);
  const spedWords = display.map(w => ({ word: w.word, start: w.start / speed, end: w.end / speed }));
  const spoken = scenes.filter(s => !s.cta);
  const perScene = assignWords(spedWords, spoken.map(s => ({ off: s.off, dur: s.dur })));

  const out = [];
  scenes.forEach((s, i) => {
    audio.writeWav(s.wav, { sampleRate: SR, samples: s.samples });
    audio.wavToMp3(s.wav, path.join(videoDir, s.file));
    const ws = s.cta ? [] : perScene[i];
    out.push({ idx: s.idx, dur: r3(s.dur), file: s.file, words: ws });
    log(`  s${s.idx}\t${s.off.toFixed(2)}+${s.dur.toFixed(2)}\t${s.cta ? '(cta, silent)' : ws.map(w => w.word).join(' ').slice(0, 100)}`);
  });
  // voiceover.mp3 = the scene wavs back to back. They partition the sped-up file sample-exactly,
  // so without a CTA scene that file IS their concatenation (no second 4 MB copy).
  if (ctaSec > 0) {
    const voiceWav = path.join(F.src, `performance-voice-x${speed}.wav`);
    audio.concatWavs(scenes.map(s => s.wav), voiceWav);
    audio.wavToMp3(voiceWav, path.join(videoDir, 'voiceover.mp3'));
    fs.rmSync(voiceWav, { force: true });
  } else audio.wavToMp3(sped, path.join(videoDir, 'voiceover.mp3'));
  fs.writeFileSync(path.join(videoDir, 'scenes.json'), JSON.stringify(out, null, 2) + '\n');

  const totalSec = r3(out.reduce((a, s) => a + s.dur, 0));
  fs.mkdirSync(path.dirname(S.metaFile), { recursive: true });
  fs.writeFileSync(S.metaFile, JSON.stringify({
    provider: providerId, model, voice, speed, mode: 'performance', timings: 'whisper',
    sentences: sentences.length, matched: found.length, unmatched: unmatched.map(s => s.id), totalSec, at: new Date().toISOString(),
  }, null, 2) + '\n');

  return {
    mode: 'performance', scenes: out, totalSec, provider: providerId, model, voice, speed, timings: 'whisper',
    apiCalls, cached: apiCalls === 0, legacyPrompt: Boolean(state.hit && state.legacy), sourceSec: meta ? meta.seconds : null,
    sentences: sentences.length, matched: found.length, unmatched,
    promptFile: path.relative(videoDir, F.prompt), cuts: cuts1x.map(t => r3(t / speed)),
  };
}

module.exports = {
  synthesize, buildPrompt, performanceBlock, transcriptOf, section, legacyPrompt, makePrompts, cacheState, cacheFiles,
  glueFragments, alignSentences, respell, sceneCuts, assignWords, migrateMeta, sha1,
};
