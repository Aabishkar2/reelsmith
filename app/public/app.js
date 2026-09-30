'use strict';
/* video-gen-v2 — teleprompter · recorder · take review. Vanilla JS, no build step.
 * Talks to app/server.js (docs/spec.md §5). All mutable UI state lives in `state`. */

// ════════════════════════════ 1. State ════════════════════════════

const READ_LINE = 0.40;                      // reading band position (fraction of viewport height)
const FONT_MIN = 28, FONT_MAX = 72, FONT_STEP = 4;
const WPM_MIN = 80, WPM_MAX = 260;
const MIC_FLAT_DB = -70, MIC_FLAT_MS = 3000;  // meter peak below this for this long → "no audio from mic" warning

const state = {
  view: 'picker',
  videos: [],
  name: null,
  script: null,          // GET /script → { meta, scenes, raw, parser }
  blocks: [],            // display blocks: { kind:'scene'|'sentence'|'cue', scene, id?, text, words, el }
  take: null,            // take.json (§4)
  busy: false,           // overlay op in flight
  prompter: { fontSize: 44, wpm: 150, mirror: false, running: false, pos: 0, total: 0, segs: [], lastTs: 0, elapsed: 0, raf: 0, curIdx: -1 },
  countdown: null,       // { timer, reject } while a 3-2-1 is on screen
  mic: { stream: null, ctx: null, analyser: null, buf: null, raf: 0, label: '', lastSignal: 0, flat: false },
  rec: { recorder: null, chunks: [], recording: false, startedAt: 0, mime: '', lastBlob: null, kind: 'take', timer: 0 },
  review: { cur: 0, playing: null, audio: null, rr: null, clipWords: {}, anyway: false, finalized: null, ab: 'orig', clean: {} },
  settings: { denoise: true },   // GET /settings (per video)
};

try {
  const saved = JSON.parse(localStorage.getItem('vg2.prompter') || '{}');
  if (saved.fontSize) state.prompter.fontSize = clamp(saved.fontSize, FONT_MIN, FONT_MAX);
  state.prompter.mirror = !!saved.mirror;
} catch { /* storage unavailable */ }

function savePrefs() {
  try { localStorage.setItem('vg2.prompter', JSON.stringify({ fontSize: state.prompter.fontSize, mirror: state.prompter.mirror })); } catch { /* ignore */ }
}

// ════════════════════════════ 2. Utils ════════════════════════════

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
const enc = encodeURIComponent;

/** Tiny element builder: h('div', {class:'x', onclick}, 'text', childEl) */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

/** Append text to el, rendering `backticked` spans as <code>. */
function appendRich(el, text) {
  String(text).split('`').forEach((part, i) => { if (part) el.append(i % 2 ? h('code', {}, part) : part); });
  return el;
}

function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '—';
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
const fmtSec = (s) => (Number.isFinite(s) ? s.toFixed(2) + 's' : '—');
const countWords = (t) => String(t).replace(/`/g, '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

// ════════════════════ 3. API, toasts, overlay ════════════════════

async function api(method, url, body, headers = {}) {
  const opts = { method, headers: { ...headers } };
  if (body instanceof Blob) { opts.body = body; opts.headers['content-type'] = body.type || 'application/octet-stream'; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  let res;
  try { res = await fetch(url, opts); } catch (e) { throw new Error(`network error (${e.message}) — is app/server.js running?`); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || `${res.status} ${res.statusText}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}
const vurl = (op) => `/api/videos/${enc(state.name)}/${op}`;

function toast(msg, kind = 'error', ms = kind === 'error' ? 9000 : 4000) {
  const el = h('div', { class: `toast ${kind}`, role: 'status', onclick: () => el.remove() }, msg);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
  if (kind === 'error') console.warn('[toast]', msg);
}

let overlayTimer = 0;
function showOverlay(msg, sub = '') {
  state.busy = true;
  $('#overlay-msg').textContent = msg;
  $('#overlay-sub').textContent = sub;
  const t0 = performance.now();
  clearInterval(overlayTimer);
  $('#overlay-timer').textContent = '0s';
  overlayTimer = setInterval(() => { $('#overlay-timer').textContent = `${Math.round((performance.now() - t0) / 1000)}s`; }, 500);
  $('#overlay').hidden = false;
}
function hideOverlay() { state.busy = false; clearInterval(overlayTimer); $('#overlay').hidden = true; }

// ════════════════════════ 4. Views & routing ════════════════════════

function show(view) {
  state.view = view;
  for (const v of ['picker', 'prompter', 'review']) $(`#view-${v}`).hidden = v !== view;
  document.body.dataset.view = view;
  $('#crumb').textContent = state.name && view !== 'picker' ? `›  ${state.name}  ›  ${view === 'prompter' ? 'teleprompter' : 'review'}` : '';
  const hash = view === 'picker' ? '' : `#${view}/${state.name}`;
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname);
  if (view === 'prompter') requestAnimationFrame(layoutPrompter);
}

function goHome() {
  if (state.rec.recording) { toast('Stop the take first (Esc).', 'info'); return; }
  stopScroll(true); stopPlayback(); closeRerecord(); disarmMic();
  state.name = null; state.take = null; state.script = null;
  show('picker'); loadVideos();
}

/** Parse `#prompter/<name>` | `#teleprompter/<name>` (alias) | `#review/<name>` → { view, name }, or null. */
function parseHash() {
  const m = /^#(prompter|teleprompter|review)\/([a-z0-9_-]+)$/i.exec(location.hash);
  if (!m) return null;
  return { view: m[1].toLowerCase() === 'teleprompter' ? 'prompter' : m[1].toLowerCase(), name: m[2] };
}

/** Re-run the router from the current location.hash (initial load + hashchange, §4). */
function routeFromHash() {
  const r = parseHash();
  if (!r || !state.videos.some((v) => v.name === r.name)) return;
  if (state.name === r.name && state.view === r.view) return;    // already there — avoid double-render
  if (state.rec.recording) { toast('Stop the take first (Esc) before navigating.', 'info'); return; }
  openVideo(r.name, r.view);
}

// ════════════════════════════ 5. Picker ════════════════════════════

async function loadVideos() {
  try { state.videos = await api('GET', '/api/videos'); }
  catch (e) { toast(`Could not list videos: ${e.message}`); state.videos = []; }
  renderPicker();
}

const STATUS_BADGE = { analyzed: 'warn', 'needs-rerecord': 'bad', ready: 'good', cut: 'good', script: 'info', empty: '', silent: 'bad', 'no-speech': 'bad' };

function renderPicker() {
  const list = $('#video-list');
  list.replaceChildren();
  if (!state.videos.length) {
    list.append(h('div', { class: 'empty' }, 'No videos yet. In Claude Code, research a topic and write ', h('code', {}, 'videos/<name>/script.md'), ' (script-writing skill), then hit Refresh.'));
    return;
  }
  for (const v of state.videos) {
    const s = v.summary;
    const badges = h('div', { class: 'badges' },
      h('span', { class: `badge ${STATUS_BADGE[v.status] ?? ''}` }, v.status),
      v.hasScript ? h('span', { class: 'badge good' }, 'script.md') : h('span', { class: 'badge warn' }, 'no script.md'),
      v.takes?.length ? h('span', { class: 'badge' }, `${v.takes.length} take${v.takes.length > 1 ? 's' : ''}`) : null,
      s ? h('span', { class: `badge ${s.bad || s.missing ? 'bad' : 'good'}` }, `${s.ok ?? 0} ok · ${s.warn ?? 0} warn · ${(s.bad ?? 0) + (s.missing ?? 0)} bad`) : null,
      v.hasCut ? h('span', { class: 'badge good' }, 'voiceover.mp3') : null);
    const card = h('div', { class: `vcard ${v.hasScript ? 'clickable' : ''}`, onclick: () => v.hasScript && openVideo(v.name, 'prompter') },
      h('div', { class: 'vcard-name' }, v.name),
      v.title ? h('div', { class: 'vcard-title' }, v.title) : null,
      badges,
      v.hasScript ? null : h('div', { class: 'noscript' }, 'No script.md yet. In Claude Code: “write the script for ', h('code', {}, v.name), '” (script-writing skill) → ', h('code', {}, `videos/${v.name}/script.md`), ', then Refresh.'),
      v.hasScript ? h('div', { class: 'vcard-actions' },
        h('button', { class: 'primary', onclick: (e) => { e.stopPropagation(); openVideo(v.name, 'prompter'); } }, '🎙 Teleprompter'),
        v.hasTake ? h('button', { onclick: (e) => { e.stopPropagation(); openVideo(v.name, 'review'); } }, '☰ Review take') : null) : null);
    list.append(card);
  }
}

async function openVideo(name, view = 'prompter') {
  state.name = name; state.take = null; state.script = null;
  state.review = { ...state.review, cur: 0, rr: null, clipWords: {}, anyway: false, finalized: null, ab: 'orig', clean: {} };
  api('GET', vurl('settings')).then((st) => { state.settings = st; renderDenoiseControls(); }).catch(() => {});
  try { state.script = await api('GET', vurl('script')); }
  catch (e) { toast(`${name}: ${e.message}${e.data?.hint ? ' — ' + e.data.hint : ''}`); if (state.view !== 'picker') show('picker'); return; }
  if (state.script.parser === 'fallback') console.info('script parsed with server fallback parser (pipeline/script.js unavailable)');
  buildBlocks();
  renderPrompter();
  const meta = state.videos.find((v) => v.name === name);
  state.take = meta?.hasTake ? await api('GET', vurl('take.json')).catch(() => null) : null;
  renderTakeSelect();
  if (view === 'review' && state.take) openReview();
  else { show('prompter'); resetScroll(); }
}

async function refreshVideoMeta() {
  try { state.videos = await api('GET', '/api/videos'); } catch { /* non-fatal */ }
  renderTakeSelect();
}

// ═══════════════════════ 6. Script → display blocks ═══════════════════════

/** Parse raw script.md for display (keeps `>` cue lines, which the pipeline strips). Ids follow §3: s<scene>.<line>. */
function buildBlocks() {
  const { raw = '', scenes = [], meta = {} } = state.script;
  const lines = raw.replace(/^﻿/, '').split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === '---') { i = 1; while (i < lines.length && lines[i].trim() !== '---') i++; i++; }
  const blocks = [];
  let scene = null, line = 0;
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    const sh = /^###\s+Scene\s+(\d+)/i.exec(t);
    if (sh) { scene = Number(sh[1]); line = 0; blocks.push({ kind: 'scene', scene, text: `Scene ${scene}` }); continue; }
    if (/^#{1,6}\s/.test(t)) { scene = null; continue; }
    if (scene == null || !t) continue;
    if (t.startsWith('>')) { blocks.push({ kind: 'cue', scene, text: t.replace(/^>\s?/, '') }); continue; }
    line++;
    blocks.push({ kind: 'sentence', scene, id: `s${scene}.${line}`, text: t });
  }
  if (!blocks.some((b) => b.kind === 'sentence')) {            // raw unusable → use parsed scenes
    for (const sc of scenes) {
      blocks.push({ kind: 'scene', scene: sc.idx, text: `Scene ${sc.idx}` });
      for (const s of sc.sentences || []) blocks.push({ kind: 'sentence', scene: sc.idx, id: s.id, text: s.text });
    }
  }
  for (const b of blocks) b.words = b.kind === 'sentence' ? countWords(b.text) : 0;
  state.blocks = blocks;
  state.prompter.wpm = clamp(Number(meta.wpm) || 150, WPM_MIN, WPM_MAX);
}

const sentenceBlock = (id) => state.blocks.find((b) => b.id === id);
const cuesFor = (id) => {
  const k = state.blocks.findIndex((b) => b.id === id);
  const out = [];
  for (let j = k - 1; j >= 0 && state.blocks[j].kind === 'cue'; j--) out.unshift(state.blocks[j].text);
  for (let j = k + 1; j < state.blocks.length && state.blocks[j].kind === 'cue'; j++) out.push(state.blocks[j].text);
  return out;
};

// ═════════════════════ 7. Teleprompter render + scroll engine ═════════════════════
// Each block is a scroll segment [top, bottom) in content px. Speed inside a sentence =
// its height / (words / wpm) so wrapped long sentences scroll at speaking pace; scene
// labels and cues pass quickly. `pos` = content y currently at the reading band.

function renderPrompter() {
  const text = $('#prompter-text');
  text.replaceChildren();
  for (const b of state.blocks) {
    b.el = appendRich(h('div', { class: `pl pl-${b.kind}`, dataset: b.id ? { id: b.id } : {} }), b.text);
    text.append(b.el);
  }
  if (!state.blocks.length) text.append(h('div', { class: 'pl pl-cue' }, 'script.md has no “### Scene N” blocks with sentences.'));
  applyPrompterStyle();
}

function applyPrompterStyle() {
  const p = state.prompter;
  document.documentElement.style.setProperty('--pfont', `${p.fontSize}px`);
  $('#prompter-mirror').classList.toggle('mirrored', p.mirror);
  $('#btn-mirror').classList.toggle('on', p.mirror);
  $('#font-val').textContent = p.fontSize;
  $('#wpm-val').textContent = p.wpm;
  layoutPrompter();
}

function blockDuration(b) {
  if (b.kind === 'sentence') return Math.max(0.6, (b.words / state.prompter.wpm) * 60);
  return b.kind === 'scene' ? 0.7 : 0.5;
}

function layoutPrompter() {
  const p = state.prompter, text = $('#prompter-text'), vp = $('#prompter-viewport');
  if (state.view !== 'prompter' || !vp.clientHeight) return;
  // Remember progress as (segment index, fraction) so font changes keep our place.
  const k = segIndexAt(p.pos), old = p.segs[k];
  const frac = old ? (p.pos - old.top) / Math.max(1, old.bottom - old.top) : 0;
  const padTop = vp.clientHeight * READ_LINE;   // content y == pos sits on the band's centre line
  text.style.paddingTop = `${padTop}px`;
  text.style.paddingBottom = `${vp.clientHeight * (1 - READ_LINE)}px`;
  const els = state.blocks.map((b) => b.el);
  p.segs = state.blocks.map((b, j) => {
    const top = els[j].offsetTop - padTop;
    const bottom = j + 1 < els.length ? els[j + 1].offsetTop - padTop : top + els[j].offsetHeight;
    return { top, bottom: Math.max(bottom, top + 1), block: b };
  });
  p.total = p.segs.length ? p.segs[p.segs.length - 1].bottom : 0;
  const seg = p.segs[k];
  p.pos = seg ? clamp(seg.top + frac * (seg.bottom - seg.top), 0, p.total) : 0;
  p.curIdx = -1;
  applyPos();
  updateHud();
}

function segIndexAt(pos) {
  const segs = state.prompter.segs;
  for (let j = 0; j < segs.length; j++) if (pos < segs[j].bottom) return j;
  return Math.max(0, segs.length - 1);
}

function applyPos() {
  const p = state.prompter;
  $('#prompter-text').style.transform = `translate3d(0, ${-p.pos}px, 0)`;
  const k = segIndexAt(p.pos);
  if (k === p.curIdx) return;
  p.curIdx = k;
  let cur = p.segs.findIndex((s, j) => j >= k && s.block.kind === 'sentence');
  p.segs.forEach((s, j) => {
    s.block.el.classList.toggle('past', s.bottom <= p.pos - 2);
    s.block.el.classList.toggle('current', j === cur);
  });
}

function tick(ts) {
  const p = state.prompter;
  if (!p.running) return;
  const dt = p.lastTs ? Math.min(0.1, (ts - p.lastTs) / 1000) : 0;
  p.lastTs = ts;
  p.elapsed += dt;
  const seg = p.segs[segIndexAt(p.pos)];
  if (seg) p.pos += dt * (seg.bottom - seg.top) / blockDuration(seg.block);
  if (p.pos >= p.total) {
    p.pos = p.total; applyPos(); pauseScroll();
    setStatus(state.rec.recording ? 'End of script — press Esc / Stop take to finish recording' : 'End of script', state.rec.recording);
    return;
  }
  applyPos();
  updateHud();
  p.raf = requestAnimationFrame(tick);
}

function resumeScroll() {
  const p = state.prompter;
  if (p.running || !p.segs.length) return;
  if (p.pos >= p.total - 1) resetScroll();
  p.running = true; p.lastTs = 0;
  p.raf = requestAnimationFrame(tick);
  setStatus(state.rec.recording ? 'Recording · Space pauses scroll only (recording continues)' : 'Rehearsal (not recording) · Space pauses', state.rec.recording);
  updateControls();
}
function pauseScroll() {
  const p = state.prompter;
  if (!p.running) return;
  p.running = false; cancelAnimationFrame(p.raf);
  setStatus(state.rec.recording ? 'Recording · scroll paused — Space resumes' : 'Paused — Space resumes · Esc resets', state.rec.recording);
  updateControls();
}
function resetScroll() {
  const p = state.prompter;
  p.pos = 0; p.elapsed = 0; p.curIdx = -1;
  if (p.segs.length) applyPos();
  updateHud();
}
function stopScroll(reset) { pauseScroll(); if (reset) resetScroll(); }

function nudge(lines) {
  const p = state.prompter;
  p.pos = clamp(p.pos + lines * p.fontSize * 1.38, 0, p.total);
  applyPos();
}
function setWpm(v) { state.prompter.wpm = clamp(v, WPM_MIN, WPM_MAX); $('#wpm-val').textContent = state.prompter.wpm; updateHud(); }
function setFont(v) { state.prompter.fontSize = clamp(v, FONT_MIN, FONT_MAX); savePrefs(); applyPrompterStyle(); }
function toggleMirror() { state.prompter.mirror = !state.prompter.mirror; savePrefs(); applyPrompterStyle(); }

function updateHud() {
  const p = state.prompter;
  $('#elapsed').textContent = fmtTime(p.elapsed);
  $('#est').textContent = fmtTime(state.blocks.reduce((a, b) => a + blockDuration(b), 0));
}
function setStatus(msg, live = false) { const el = $('#p-status'); el.textContent = msg; el.classList.toggle('live', live); }

function updateControls() {
  const armed = !!state.mic.stream, rec = state.rec.recording, p = state.prompter;
  $('#btn-arm').textContent = armed ? `🎙 Armed ✓` : '🎙 Arm mic';
  $('#btn-arm').classList.toggle('on', armed);
  $('#btn-arm').title = armed ? `${state.mic.label || 'mic'} — click to disarm` : 'Allow microphone + show input level';
  $('#btn-arm').disabled = rec;
  $('#btn-start').textContent = p.running ? '❚❚ Pause' : rec ? '▶ Resume scroll' : armed ? '● Record take' : '▶ Rehearse';
  $('#btn-stop').disabled = !(rec && state.rec.kind === 'take');
  $('#btn-open-take').disabled = rec || !$('#take-select').value;
  $('#take-select').disabled = rec;
}

// ═══════════════════════ 8. Mic, level meter, recorder ═══════════════════════

async function armMic() {
  if (state.mic.stream) return true;
  if (!navigator.mediaDevices?.getUserMedia) { toast('getUserMedia unavailable — open the app via http://localhost:4310.'); return false; }
  if (!window.MediaRecorder) { toast('MediaRecorder is not supported in this browser.'); return false; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const track = stream.getAudioTracks()[0];
    state.mic = { stream, ctx, analyser, buf: new Float32Array(analyser.fftSize), raf: 0, label: track?.label || '', lastSignal: performance.now(), flat: false };
    if (track) track.onended = () => { toast('Microphone disconnected.'); if (state.rec.recording) stopTake(); disarmMic(); };
    meterLoop();
    toast(`Mic armed: ${state.mic.label || 'default input'} — check the level meter.`, 'ok', 3500);
    setStatus('Armed · Space starts a 3-2-1 countdown, then recording + scroll');
    updateControls();
    return true;
  } catch (e) {
    toast(`Mic unavailable: ${e.name === 'NotAllowedError' ? 'permission denied (allow the microphone for localhost)' : e.name === 'NotFoundError' ? 'no input device found' : e.message}`);
    return false;
  }
}

function disarmMic() {
  const m = state.mic;
  if (state.rec.recording) return;
  cancelAnimationFrame(m.raf);
  m.stream?.getTracks().forEach((t) => t.stop());
  m.ctx?.close().catch(() => {});
  state.mic = { stream: null, ctx: null, analyser: null, buf: null, raf: 0, label: '', lastSignal: 0, flat: false };
  $$('.mic-warn').forEach((el) => { el.hidden = true; });
  $$('.meter').forEach((el) => el.style.setProperty('--lvl', '0%'));
  $$('.meter-db').forEach((el) => { el.textContent = '— dB'; });
  updateControls();
}

function meterLoop() {
  const m = state.mic;
  if (!m.analyser) return;
  m.analyser.getFloatTimeDomainData(m.buf);
  let sum = 0, peak = 0;
  for (let i = 0; i < m.buf.length; i++) { const v = m.buf[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  const rms = Math.sqrt(sum / m.buf.length);
  // Flat-meter guard: a mic that delivers digital silence (permission quirk, wrong input
  // device) records a silent take Whisper then hallucinates on. Warn after MIC_FLAT_MS.
  const now = performance.now();
  if (peak > 0 && 20 * Math.log10(peak) >= MIC_FLAT_DB) m.lastSignal = now;
  const flat = now - m.lastSignal >= MIC_FLAT_MS;
  if (flat !== m.flat) { m.flat = flat; $$('.mic-warn').forEach((el) => { el.hidden = !flat; }); }
  const db = rms > 1e-7 ? 20 * Math.log10(rms) : -Infinity;
  const pct = Number.isFinite(db) ? clamp(((db + 60) / 60) * 100, 0, 100) : 0;
  for (const el of $$('.meter')) {
    el.style.setProperty('--lvl', `${pct}%`);
    el.classList.toggle('hot', db > -6);
    el.classList.toggle('warm', db > -16 && db <= -6);
  }
  for (const el of $$('.meter-db')) el.textContent = Number.isFinite(db) ? `${db.toFixed(0)} dB` : '−∞ dB';
  m.raf = requestAnimationFrame(meterLoop);
}

function pickMime() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm']) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return '';
}

/** Start MediaRecorder on the armed stream (1s timeslices). Returns false + toasts on failure. */
function startRecorder(kind) {
  const r = state.rec;
  try {
    const mime = pickMime();
    const rec = new MediaRecorder(state.mic.stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined);
    r.chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) r.chunks.push(e.data); };
    rec.onerror = (e) => toast(`Recorder error: ${e.error?.message || e.error?.name || 'unknown'}`);
    rec.start(1000);
    Object.assign(r, { recorder: rec, recording: true, startedAt: performance.now(), mime: rec.mimeType || mime || 'audio/webm', kind });
    clearInterval(r.timer);
    r.timer = setInterval(updateRecIndicator, 250);
    updateRecIndicator(); updateControls();
    return true;
  } catch (e) {
    toast(`Could not start recording: ${e.message}`);
    return false;
  }
}

function stopRecorder() {
  const r = state.rec;
  return new Promise((resolve) => {
    const finish = () => {
      clearInterval(r.timer);
      Object.assign(r, { recorder: null, recording: false });
      updateRecIndicator(); updateControls();
      resolve(new Blob(r.chunks, { type: 'audio/webm' }));
    };
    const rec = r.recorder;
    if (!rec || rec.state === 'inactive') return finish();
    rec.onstop = finish;
    try { rec.stop(); } catch { finish(); }
  });
}

function updateRecIndicator() {
  const r = state.rec, on = r.recording;
  const t = fmtTime((performance.now() - r.startedAt) / 1000);
  for (const id of ['#rec-ind', '#top-rec']) { $(id).hidden = !on; $('.rec-time', $(id)).textContent = t; }
  const rt = $('.rr-timer'); if (rt) rt.textContent = on ? `● ${t}` : '';
}

/** Full-screen 3-2-1. onTick(k) runs at each number; rejects if cancelled (Esc). */
function countdown(n, onTick) {
  return new Promise((resolve, reject) => {
    const box = $('#countdown'), num = $('#countdown-num');
    let k = n;
    const step = () => {
      if (k === 0) { box.hidden = true; state.countdown = null; resolve(); return; }
      num.textContent = k;
      num.classList.remove('pulse'); void num.offsetWidth; num.classList.add('pulse');
      try { if (onTick?.(k) === false) throw new Error('aborted'); } catch (e) { box.hidden = true; state.countdown = null; reject(e); return; }
      k--;
      state.countdown.timer = setTimeout(step, 1000);
    };
    state.countdown = { timer: 0, reject };
    box.hidden = false;
    step();
  });
}
function cancelCountdown() {
  const c = state.countdown;
  if (!c) return false;
  clearTimeout(c.timer); $('#countdown').hidden = true; state.countdown = null;
  c.reject(new Error('cancelled'));
  return true;
}

// ═══════════════════════ 9. Full take: record → upload → analyze ═══════════════════════

async function onStartKey() {
  if (state.countdown || state.busy) return;
  const p = state.prompter;
  if (state.rec.recording) { p.running ? pauseScroll() : resumeScroll(); return; }
  if (p.running) { pauseScroll(); return; }
  if (!state.mic.stream) { resumeScroll(); return; }          // not armed → rehearsal scroll only
  if (!confirmFlatMic()) return;
  // Armed → a new full take always starts from the top.
  resetScroll();
  try {
    // Recorder starts on "1" so the first word never gets clipped (pre-roll is cut by analyze).
    await countdown(3, (k) => (k === 1 ? startRecorder('take') : true));
  } catch {
    if (state.rec.recording) await stopRecorder();
    state.rec.chunks = [];
    setStatus('Countdown cancelled');
    return;
  }
  resumeScroll();
}

/** The level meter has been flat for MIC_FLAT_MS → ask before recording a silent take. */
function confirmFlatMic() {
  if (!state.mic.flat) return true;
  return confirm(`No audio from the mic — the level meter has been flat for ${MIC_FLAT_MS / 1000}s (${state.mic.label || 'default input'}).\n\nCheck the input device and the browser's mic permission. Record anyway?`);
}

async function stopTake() {
  if (!state.rec.recording || state.rec.kind !== 'take') return;
  pauseScroll();
  const blob = await stopRecorder();
  setStatus(`Take stopped (${fmtTime(state.prompter.elapsed)} scrolled)`);
  if (blob.size < 1000) { toast('Recording is empty — check the mic level meter and try again.'); return; }
  state.rec.lastBlob = blob;
  await uploadAndAnalyze();
}

async function uploadAndAnalyze() {
  const blob = state.rec.lastBlob;
  if (!blob) return;
  let up;
  showOverlay('Uploading take…', `${(blob.size / 1024 / 1024).toFixed(1)} MB · converting to WAV`);
  try {
    up = await api('POST', vurl('take'), blob, { 'x-take-kind': 'take' });
    state.rec.lastBlob = null;
  } catch (e) {
    hideOverlay();
    toast(`Upload failed: ${e.message}. Your recording is kept in this tab — click “Retry upload”.`);
    $('#btn-retry-upload').hidden = false;
    return;
  }
  $('#btn-retry-upload').hidden = true;
  hideOverlay();
  await refreshVideoMeta();
  $('#take-select').value = up.take;
  updateControls();
  await analyzeTake(up.take);
}

async function analyzeTake(take) {
  showOverlay('Transcribing with Whisper…', `${take} · this takes 10–60s`);
  try {
    state.take = await api('POST', vurl('analyze'), { take });
    hideOverlay();
    await refreshVideoMeta();
    openReview();
  } catch (e) {
    hideOverlay();
    if (e.data?.code === 'SILENT_TAKE') {
      toast(`${take}: ${e.message}`, 'error', 15000);
      setStatus(`${take} is silent — check the mic input device / permission, then record again`);
      await refreshVideoMeta();
      return;
    }
    toast(`Analyze failed: ${e.message}. The take is saved as ${take} — retry from “Previous takes”.`);
  }
}

function renderTakeSelect() {
  const sel = $('#take-select');
  const v = state.videos.find((x) => x.name === state.name);
  const takes = v?.takes || [];
  const cur = state.take?.take;
  sel.replaceChildren(h('option', { value: '' }, takes.length ? 'Previous takes…' : 'No previous takes'));
  for (const t of takes) sel.append(h('option', { value: t }, `${t.replace('takes/', '')}${t === cur ? ' — analyzed ✓' : ''}`));
  if (cur && takes.includes(cur)) sel.value = cur;
  updateControls();
}

async function openSelectedTake() {
  const t = $('#take-select').value;
  if (!t || state.busy) return;
  if (state.take?.take === t) { openReview(); return; }
  await analyzeTake(t);
}

// ═══════════════════════ 10. Review: heard words + render (diff in diff.js) ═══════════════════════

function heardWords(s) {
  if (Array.isArray(s.heardWords)) return s.heardWords;
  if (s.source?.kind === 'rerecord') {
    if (Array.isArray(s.words)) return s.words;
    const cw = state.review.clipWords[s.source.clip];
    if (cw === undefined) { loadClipWords(s.source.clip); return undefined; }
    if (!cw) return null;
    const r = s.source.range;
    return r ? cw.filter((w) => w.end > r.start - 0.05 && w.start < r.end + 0.05) : cw;
  }
  if (!Array.isArray(s.wordIdx) || !state.take?.words) return null;
  return state.take.words.slice(s.wordIdx[0], s.wordIdx[1] + 1);
}

async function loadClipWords(clip) {
  state.review.clipWords[clip] = null;                  // mark in-flight/failed
  try {
    const j = await api('GET', `/videos/${enc(state.name)}/${clip}.json?optional=1`);
    state.review.clipWords[clip] = Array.isArray(j) ? j : Array.isArray(j?.words) ? j.words : null;
  } catch { state.review.clipWords[clip] = null; }
  renderReviewList();
}

const sentences = () => state.take?.sentences || [];
const sentenceById = (id) => sentences().find((s) => s.id === id);
const blockingCount = () => sentences().filter((s) => s.status === 'bad' || s.status === 'missing').length;

function openReview() {
  if (!state.take) { toast('No analyzed take yet.', 'info'); return; }
  stopScroll(false);
  const firstFlag = sentences().findIndex((s) => s.status === 'bad' || s.status === 'missing');
  state.review.cur = Math.max(0, firstFlag);
  state.review.finalized = null;
  renderReview();
  show('review');
  if (state.take.status === 'cut') loadExistingCut();
}

async function loadExistingCut() {
  try {
    const scenes = await api('GET', `/videos/${enc(state.name)}/scenes.json?optional=1`);
    if (!Array.isArray(scenes)) return;
    state.review.finalized = { scenes, totalSec: scenes.reduce((a, s) => a + (Number(s.dur) || 0), 0), existing: true };
    renderFinalize();
  } catch { /* not cut yet */ }
}

function renderReview() {
  const t = state.take, sm = t.summary || {};
  $('#review-title').textContent = `${state.name} · ${t.take || ''} · ${t.status || ''}`;
  const n = (st) => sentences().filter((s) => s.status === st).length;   // counts from rows, so they stay fresh after re-records
  const chips = [['ok', n('ok')], ['warn', n('warn')], ['bad', n('bad')], ['missing', n('missing')], ['rerecorded', n('rerecorded')], ['fillers', sm.fillers]]
    .filter(([k, v]) => v != null && (v > 0 || ['ok', 'bad', 'missing'].includes(k)))
    .map(([k, v]) => h('span', { class: `chip ${k}` }, h('b', {}, v), k));
  chips.push(h('span', { class: 'chip' }, `clean ~${fmtTime(sm.estimatedCleanSec)} / raw ${fmtTime(t.audio?.durationSec)}`));
  if (t.audio?.clipping) chips.push(h('span', { class: 'chip bad' }, h('b', {}, '!'), 'clipping'));
  if (Number.isFinite(t.audio?.meanVolumeDb)) chips.push(h('span', { class: 'chip' }, `mean ${t.audio.meanVolumeDb.toFixed(1)} dB`));
  if (t.problem && ['silent', 'no-speech'].includes(t.status)) chips.unshift(h('div', { class: 'problem-banner' }, h('b', {}, t.status === 'silent' ? 'Silent take' : 'No speech'), t.problem.message));
  $('#summary-chips').replaceChildren(...chips);
  updateFinalizeControls();
  renderReviewList();
  renderFinalize();
  renderDenoiseControls();
}

function renderDenoiseControls() {
  const ab = $('#btn-ab'), on = $('#denoise-on');
  if (!ab || !on) return;
  on.checked = !!state.settings.denoise;
  ab.textContent = state.review.ab === 'clean' ? 'A/B: cleaned' : 'A/B: original';
  ab.classList.toggle('ab-clean', state.review.ab === 'clean');
}

async function setDenoise(on) {
  try {
    state.settings = await api('POST', vurl('settings'), { denoise: on });
    toast(on ? 'Denoise on — finalize removes background noise' : 'Denoise off — finalize uses the original audio', 'ok');
    if (state.review.finalized) toast('Finalize again to apply it to voiceover.mp3.', 'info');
  } catch (e) { toast(`Could not save the denoise setting: ${e.message}`); }
  renderDenoiseControls();
}

function toggleAB() {
  state.review.ab = state.review.ab === 'clean' ? 'orig' : 'clean';
  const was = state.review.playing;
  stopPlayback();
  renderDenoiseControls();
  if (was && !was.includes('#')) playSentence(was);           // replay the same sentence on the other side
}

/** Denoised sibling of a takes/*.hq.wav (made on first use by POST /denoise, then cached). */
function cleanSrc(src) {
  const c = state.review.clean;
  if (!c[src]) {
    c[src] = api('POST', vurl('denoise'), { src }).then((r) => {
      if (r.warning) toast(r.warning, 'info', 9000);
      return r.clean;
    }).catch((e) => { delete c[src]; throw e; });
  }
  return c[src];
}

function updateFinalizeControls() {
  const blocking = blockingCount();
  $('#anyway-wrap').hidden = blocking === 0;
  $('#finalize-anyway').checked = state.review.anyway;
  $('#btn-finalize').disabled = blocking > 0 && !state.review.anyway;
  $('#btn-finalize').title = blocking ? `${blocking} bad/missing sentence(s) left` : 'Enter';
}

function renderReviewList() {
  const list = $('#review-list');
  const keepScroll = list.scrollTop;
  list.replaceChildren();
  let scene = null;
  sentences().forEach((s, k) => {
    const sc = s.scene ?? Number(String(s.id).slice(1).split('.')[0]);
    if (sc !== scene) { scene = sc; list.append(h('div', { class: 'scene-h' }, `Scene ${scene}`)); }
    list.append(renderRow(s, k));
  });
  if (!sentences().length) list.append(h('div', { class: 'empty' }, 'take.json has no sentences.'));
  list.scrollTop = keepScroll;
}

function renderRow(s, k) {
  const rv = state.review;
  const words = heardWords(s);
  // Prefer the pipeline's own per-word roles (take.json §4) over re-diffing —
  // that's what analyze.js already decided matched (see diff.js roleDiff()).
  // Rerecord clip words never carry `.role` (pipeline/splice.js strips it), so
  // they fall back to the naive diff below.
  const hasRoles = Array.isArray(words) && words.length > 0 && words[0].role !== undefined;
  const rd = hasRoles ? roleDiff(words, s.flags) : null;
  const d = words && words.length && !hasRoles ? diffSentence(s.text, words, s.flags) : null;
  const scriptEl = h('div', { class: 'script-text' });
  if (d) d.sTok.forEach((t, i) => { scriptEl.append(appendRich(h('span', { class: d.sClass[i] }), t.raw), ' '); });
  else appendRich(scriptEl, s.text);
  let heardEl;
  if (words === undefined) heardEl = h('div', { class: 'heard none' }, 'loading…');
  else if (!words || !words.length) heardEl = h('div', { class: 'heard none' }, s.source?.kind === 'rerecord' ? '— re-recorded clip (no transcript saved) —' : '— not heard —');
  else if (rd) {
    const dim = { style: 'color:var(--faint); font-style:italic;' };
    heardEl = h('div', { class: 'heard' },
      ...words.flatMap((w, i) => [
        h('span', { class: rd.hClass[i], title: `${fmtSec(w.start)}–${fmtSec(w.end)}` }, w.word.trim()),
        rd.hNote[i] ? h('span', dim, ` (${rd.hNote[i]})`) : null,
        ' ',
      ]),
      ...rd.dangling.map((t) => h('span', dim, `[missing: ${t}] `)));
  }
  else heardEl = h('div', { class: 'heard' }, ...words.flatMap((w, i) => [h('span', { class: d.hClass[i], title: `${fmtSec(w.start)}–${fmtSec(w.end)}` }, w.word.trim()), ' ']));
  const src = s.source?.kind === 'rerecord' ? `re-record ${s.source.clip.replace('takes/', '')}` : null;
  const meta = [
    Number.isFinite(s.wer) ? `wer ${Math.round(s.wer * 100)}%` : null,
    Number.isFinite(s.wpm) ? `${Math.round(s.wpm)} wpm` : null,
    s.range ? `${fmtSec(s.range.start)}–${fmtSec(s.range.end)}` : null, src,
  ].filter(Boolean).join(' · ');
  const flags = (s.flags || []).map((f) => h('span', { class: `flag ${f.severity || ''}`, title: f.detail || '' }, h('b', {}, f.type), f.detail || ''));
  const playing = rv.playing === s.id;
  const row = h('div', { class: `srow st-${s.status || 'missing'} ${k === rv.cur ? 'current' : ''}`, dataset: { id: s.id }, onclick: (e) => { if (!e.target.closest('button, .rr-panel')) setCur(k); } },
    h('div', { class: 'srow-main' },
      h('div', { class: 'srow-top' }, h('span', { class: 'sid' }, s.id), h('span', { class: 'spill' }, s.status), meta ? h('span', { class: 'smeta' }, meta) : null),
      scriptEl, heardEl, flags.length ? h('div', { class: 'flags' }, flags) : null, renderAttempts(s)),
    h('div', { class: 'srow-actions' },
      h('button', { class: `play ${playing ? 'playing' : ''}`, dataset: { play: s.id }, onclick: () => { setCur(k); playSentence(s.id); } }, playing ? '■ Stop' : '▶ Play'),
      h('button', { class: 'rr', onclick: () => { setCur(k); openRerecord(s.id); } }, '🎙 Re-record')));
  if (rv.rr?.id === s.id) row.append(renderRerecordPanel(s));
  return row;
}

/** Attempts list (docs/spec.md §7a) for a line said ≥2 times: score, breakdown, ▶, “Use this”. */
function renderAttempts(s) {
  const atts = s.attempts || [];
  if (atts.length < 2) return null;
  const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}` : '—');
  return h('div', { class: 'attempts' },
    ...atts.map((a) => {
      const b = a.breakdown || {};
      const key = `${s.id}#${a.n}`, on = state.review.playing === key;
      const notes = [
        Number.isFinite(a.wer) ? `wer ${Math.round(a.wer * 100)}%` : null,
        Number.isFinite(a.conf) ? `conf ${a.conf.toFixed(2)}` : null,
        Number.isFinite(a.wpm) ? `${a.wpm} wpm` : null,
        b.fillers ? `${b.fillers} filler${b.fillers > 1 ? 's' : ''}` : null,
        b.repeats ? `${b.repeats} repeat${b.repeats > 1 ? 's' : ''}` : null,
        b.pauses ? `${b.pauses} long pause${b.pauses > 1 ? 's' : ''}` : null,
        b.clipping ? 'clipping' : null, b.bad ? 'bad' : null,
      ].filter(Boolean).join(' · ');
      const title = `accuracy ${pct(b.accuracy)} · fluency ${pct(b.fluency)} · confidence ${pct(b.confidence)} · audio ${pct(b.audio)} · pace ${pct(b.pace)}`
        + (Number.isFinite(b.meanVolumeDb) ? ` · ${b.meanVolumeDb} dB` : '');
      const src = a.source === 'rerecord' ? `re-record ${String(a.clip || '').replace('takes/', '')}` : `take @${a.range ? fmtSec(a.range[0]) : '—'}`;
      return h('div', { class: `attempt ${a.chosen ? 'chosen' : ''}`, title },
        h('span', { class: 'att-n' }, `#${a.n}`),
        h('span', { class: 'att-src' }, src),
        h('span', { class: 'att-score' }, Number.isFinite(a.score) ? a.score.toFixed(2) : '—'),
        h('span', { class: 'att-bd' }, notes),
        h('button', { class: `sq play ${on ? 'playing' : ''}`, dataset: { play: key, short: '1' }, title: 'Play this attempt', onclick: () => playAttempt(s, a) }, on ? '■' : '▶'),
        a.chosen ? h('span', { class: 'att-kept' }, s.pick ? 'kept · your pick' : 'kept')
          : h('button', { class: 'att-use', onclick: () => pickAttempt(s.id, a.n) }, 'Use this'));
    }),
    s.pick ? h('button', { class: 'ghost att-auto', onclick: () => pickAttempt(s.id, 'auto') }, '↺ Auto-pick best') : null);
}

async function pickAttempt(id, n) {
  if (state.busy || state.review.rr) return;
  stopPlayback();
  showOverlay(n === 'auto' ? 'Back to the best-scoring attempt…' : `Using attempt #${n}…`, `${id} · re-running the cut plan (no Whisper)`);
  try {
    state.take = await api('POST', vurl('pick'), n === 'auto' ? { sentenceId: id, source: 'auto' } : { sentenceId: id, n });
    hideOverlay();
    state.review.finalized = null;
    renderReview();
    toast(n === 'auto' ? `${id}: auto-pick restored` : `${id}: using attempt #${n}`, 'ok');
    refreshVideoMeta();
  } catch (e) {
    hideOverlay();
    toast(`Pick failed: ${e.message}`);
  }
}

function setCur(k, scroll = false) {
  const n = sentences().length;
  if (!n) return;
  state.review.cur = clamp(k, 0, n - 1);
  $$('.srow').forEach((el, i) => el.classList.toggle('current', i === state.review.cur));
  if (scroll) $$('.srow')[state.review.cur]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderFinalize() {
  const box = $('#finalize-result'), r = state.review.finalized;
  box.hidden = !r;
  if (!r) return;
  const scenes = r.scenes || [];
  box.replaceChildren(
    h('h3', {}, `${r.existing ? 'Already finalized' : 'Finalized'} ✓ — ${scenes.length} scenes · ${fmtTime(r.totalSec)} (${fmtSec(r.totalSec)})`),
    h('table', {}, h('tr', {}, h('th', {}, 'scene'), h('th', {}, 'dur'), h('th', {}, 'words'), h('th', {}, 'file')),
      ...scenes.map((s) => h('tr', {}, h('td', {}, s.idx), h('td', {}, fmtSec(Number(s.dur))), h('td', {}, Array.isArray(s.words) ? s.words.length : '—'), h('td', { class: 'mono' }, s.file || '')))),
    h('audio', { controls: true, preload: 'metadata', src: `/videos/${enc(state.name)}/voiceover.mp3?t=${Date.now()}` }),
    h('div', { class: 'next-step' }, 'Now in Claude Code: write ', h('code', {}, 'index.html'), ' (html-animation skill), then ',
      h('code', {}, `node scripts/preview.js videos/${state.name}`), ' and render.'));
}

// ═══════════════════════ 11. Review: playback ═══════════════════════

function playSentence(id) {
  const s = sentenceById(id);
  if (!s) return;
  const rr = s.source?.kind === 'rerecord';
  const range = rr ? s.source.range : s.range;
  if (!rr && !range && state.review.playing !== id) { toast(`${id} was not heard in the take — nothing to play.`, 'info'); return; }
  playRange(id, rr ? `${s.source.clip}.hq.wav` : `${state.take.take}.hq.wav`, range);
}

function playAttempt(s, a) {
  const range = a.range ? { start: a.range[0], end: a.range[1] } : null;
  playRange(`${s.id}#${a.n}`, a.source === 'rerecord' ? `${a.clip}.hq.wav` : `${state.take.take}.hq.wav`, range);
}

/** Play [range] of a take/clip wav (whole file if no range); `key` identifies the ▶ button. */
async function playRange(key, src, range) {
  const rv = state.review, id = key;
  if (rv.playing === key) { stopPlayback(); return; }
  if (rv.ab === 'clean') {
    rv.playing = key; renderPlayButtons();
    try { src = await cleanSrc(src); } catch (e) { rv.playing = null; renderPlayButtons(); toast(`Denoise failed: ${e.message}`); return; }
    if (rv.playing !== key) return;                            // stopped while denoising
  }
  const q = new URLSearchParams({ src });
  if (range) { q.set('start', Math.max(0, range.start - 0.12).toFixed(2)); q.set('end', (range.end + 0.18).toFixed(2)); }
  const url = `${vurl('audio')}?${q}`;
  stopPlayback();
  const a = rv.audio || (rv.audio = new Audio());
  a.onended = () => { rv.playing = null; renderPlayButtons(); };
  a.onerror = () => {
    if (rv.playing !== id) return;
    rv.playing = null; renderPlayButtons();
    fetch(url).then((r) => (r.ok ? null : r.json())).then((j) => toast(`Playback failed: ${j?.error || 'unsupported audio'}`)).catch((e) => toast(`Playback failed: ${e.message}`));
  };
  a.src = url;
  rv.playing = id; renderPlayButtons();
  a.play().catch((e) => { if (e.name !== 'AbortError' && rv.playing === id) { rv.playing = null; renderPlayButtons(); if (e.name !== 'NotSupportedError') toast(`Playback failed: ${e.message}`); } });
}

function stopPlayback() {
  const rv = state.review;
  if (rv.audio) { rv.audio.pause(); rv.audio.removeAttribute('src'); rv.audio.load(); }
  if (rv.playing) { rv.playing = null; renderPlayButtons(); }
}

function renderPlayButtons() {
  for (const b of $$('button[data-play]')) {
    const on = b.dataset.play === state.review.playing;
    b.classList.toggle('playing', on);
    b.textContent = b.dataset.short ? (on ? '■' : '▶') : (on ? '■ Stop' : '▶ Play');
  }
}

// ═══════════════════════ 12. Review: per-sentence re-record ═══════════════════════
// Phases: idle → countdown → recording → uploading → checking → idle (result shown).

function openRerecord(id) {
  if (state.rec.recording || state.busy) return;
  stopPlayback();
  state.review.rr = { id, phase: 'idle', msg: 'Arm the mic, then Record (Space). Read just this sentence.', msgKind: '' };
  renderReviewList();
  $('.rr-panel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function closeRerecord() {
  const rr = state.review.rr;
  if (!rr) return;
  if (state.countdown) cancelCountdown();
  if (state.rec.recording && state.rec.kind === 'rerecord') { await stopRecorder(); state.rec.chunks = []; }
  state.review.rr = null;
  if (state.view === 'review') renderReviewList();
}

function setRR(patch) {
  Object.assign(state.review.rr, patch);
  const panel = $('.rr-panel');
  const s = sentenceById(state.review.rr.id);
  if (panel && s) panel.replaceWith(renderRerecordPanel(s)); else renderReviewList();
}

function renderRerecordPanel(s) {
  const rr = state.review.rr, armed = !!state.mic.stream, ph = rr.phase;
  const text = sentenceBlock(s.id)?.text || s.text;
  const busy = ph === 'uploading' || ph === 'checking' || ph === 'countdown';
  return h('div', { class: 'rr-panel' },
    ...cuesFor(s.id).map((c) => h('div', { class: 'rr-cue' }, c)),
    appendRich(h('div', { class: 'rr-text' }), text),
    h('div', { class: 'rr-controls' },
      armed ? null : h('button', { onclick: async () => { if (await armMic()) setRR({}); } }, '🎙 Arm mic'),
      h('div', { class: 'meter' }, h('div', { class: 'meter-fill' })), h('span', { class: 'meter-db' }, '— dB'),
      h('span', { class: 'mic-warn', hidden: !state.mic.flat }, '⚠ No audio from mic — check input device / permissions'),
      ph === 'recording'
        ? h('button', { class: 'danger', onclick: rrToggle }, '■ Stop & check (Space)')
        : h('button', { class: 'primary', disabled: busy, onclick: rrToggle }, rr.tries ? '● Try again (Space)' : '● Record (Space)'),
      h('span', { class: 'rr-timer rec-ind' }),
      h('button', { class: 'ghost', disabled: ph === 'uploading' || ph === 'checking', onclick: closeRerecord }, 'Cancel (Esc)')),
    h('div', { class: `rr-msg ${rr.msgKind || ''}` }, rr.msg || ''));
}

async function rrToggle() {
  const rr = state.review.rr;
  if (!rr || state.busy) return;
  if (rr.phase === 'recording') return rrStopAndCheck();
  if (rr.phase !== 'idle') return;
  if (!(await armMic())) return;
  if (!confirmFlatMic()) return;
  setRR({ phase: 'countdown', msg: 'Get ready…', msgKind: '' });
  try {
    await countdown(3, (k) => (k === 1 ? startRecorder('rerecord') : true));
  } catch {
    if (state.rec.recording) await stopRecorder();
    if (state.review.rr) setRR({ phase: 'idle', msg: 'Cancelled.' });
    return;
  }
  setRR({ phase: 'recording', msg: 'Recording — read the sentence, then Space / Stop.', msgKind: '' });
}

async function rrStopAndCheck() {
  const rr = state.review.rr, id = rr.id;
  const blob = await stopRecorder();
  rr.tries = (rr.tries || 0) + 1;
  if (blob.size < 500) { setRR({ phase: 'idle', msg: 'Nothing was recorded — check the level meter.', msgKind: 'bad' }); return; }
  setRR({ phase: 'uploading', msg: 'Uploading clip…' });
  let clip;
  try {
    clip = (await api('POST', vurl('take'), blob, { 'x-take-kind': 'rerecord', 'x-sentence-id': id })).take;
  } catch (e) { setRR({ phase: 'idle', msg: `Upload failed: ${e.message}`, msgKind: 'bad' }); toast(`Re-record upload failed: ${e.message}`); return; }
  setRR({ phase: 'checking', msg: `Checking ${clip.replace('takes/', '')} with Whisper…` });
  showOverlay('Checking re-record with Whisper…', `${id} · ${clip}`);
  try {
    const r = await api('POST', vurl('rerecord'), { sentenceId: id, clip });
    hideOverlay();
    applyRerecordResult(id, r);
    const s = sentenceById(id);
    if (!state.review.rr) return;
    if (r.ok && s?.status === 'rerecorded') {
      toast(`${id} replaced with ${clip.replace('takes/', '')} ✓`, 'ok');
      state.review.rr = null;
      renderReview();
    } else if (r.ok) {                       // clip accepted as an attempt, but a take attempt scored higher
      toast(`${id}: ${r.reason || 'kept the take'}`, 'info', 9000);
      state.review.rr = null;
      renderReview();
    } else {
      const why = r.reason || (s?.flags || []).filter((f) => f.severity !== 'warn' && f.severity !== 'info').map((f) => `${f.type}${f.detail ? ': ' + f.detail : ''}`).join(' · ') || 'still flagged';
      Object.assign(state.review.rr, { phase: 'idle', msg: `Still ${s?.status || 'bad'} — ${why}. Try again.`, msgKind: 'bad' });
      renderReview();
    }
  } catch (e) {
    hideOverlay();
    setRR({ phase: 'idle', msg: `Check failed: ${e.message}`, msgKind: 'bad' });
    toast(`Re-record check failed: ${e.message}`);
  }
}

function applyRerecordResult(id, r) {
  if (r?.take && Array.isArray(r.take.sentences)) state.take = r.take;
  else if (r?.sentence) {
    const k = sentences().findIndex((s) => s.id === id);
    if (k >= 0) state.take.sentences[k] = r.sentence;
  }
  if (r?.summary) state.take.summary = r.summary;
}

// ═══════════════════════ 13. Finalize ═══════════════════════

async function finalize() {
  if (state.busy || state.review.rr) return;
  const blocking = blockingCount();
  if (blocking && !state.review.anyway) { toast(`${blocking} sentence(s) are bad/missing — re-record them, or tick “finalize anyway”.`, 'info'); return; }
  stopPlayback();
  showOverlay('Finalizing voiceover…', 'cutting fillers + silence · writing voiceover/sN.mp3, voiceover.mp3, scenes.json');
  try {
    const r = await api('POST', vurl('finalize'));
    hideOverlay();
    state.review.finalized = r;
    state.take = await api('GET', vurl('take.json')).catch(() => state.take);
    renderReview();
    $('#finalize-result').scrollIntoView({ block: 'nearest' });
    toast(`Finalized: ${r.scenes?.length ?? 0} scenes, ${fmtTime(r.totalSec)}`, 'ok');
    refreshVideoMeta();
  } catch (e) {
    hideOverlay();
    toast(`Finalize failed: ${e.message}`);
  }
}

// ═══════════════════════ 14. Keyboard + wiring ═══════════════════════

function prompterKey(e) {
  const k = e.key;
  if (k === ' ' || k === 'Spacebar') { if (!e.repeat) onStartKey(); return true; }
  if (k === 'Escape') {
    if (cancelCountdown()) return true;
    if (state.rec.recording) stopTake(); else stopScroll(true), setStatus('Stopped · back at the top');
    return true;
  }
  if (k === 'ArrowUp') { nudge(-1); return true; }
  if (k === 'ArrowDown') { nudge(1); return true; }
  if (k === 'ArrowLeft') { setWpm(state.prompter.wpm - 5); return true; }
  if (k === 'ArrowRight') { setWpm(state.prompter.wpm + 5); return true; }
  if (k === '+' || k === '=' || e.code === 'NumpadAdd') { setFont(state.prompter.fontSize + FONT_STEP); return true; }
  if (k === '-' || k === '_' || e.code === 'NumpadSubtract') { setFont(state.prompter.fontSize - FONT_STEP); return true; }
  if (k === 'm' || k === 'M') { toggleMirror(); return true; }
  return false;
}

function reviewKey(e) {
  const k = e.key, rv = state.review;
  if (rv.rr) {
    if (k === ' ') { if (!e.repeat) rrToggle(); return true; }
    if (k === 'Escape') { if (!cancelCountdown()) closeRerecord(); return true; }
    return false;
  }
  if (state.busy) return false;
  const cur = sentences()[rv.cur];
  if (k === 'j' || k === 'J' || k === 'ArrowDown') { setCur(rv.cur + 1, true); return true; }
  if (k === 'k' || k === 'K' || k === 'ArrowUp') { setCur(rv.cur - 1, true); return true; }
  if ((k === 'p' || k === 'P' || k === ' ') && cur) { playSentence(cur.id); return true; }
  if ((k === 'r' || k === 'R') && cur) { openRerecord(cur.id); return true; }
  if (k === 'Enter' && !e.repeat) { finalize(); return true; }
  if (k === 'Escape') { stopPlayback(); return true; }
  return false;
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, select, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (state.busy && e.key !== 'Escape') { if (e.key === ' ' || e.key === 'Enter') e.preventDefault(); return; }
  const handled = state.view === 'prompter' ? prompterKey(e) : state.view === 'review' ? reviewKey(e) : false;
  if (handled) e.preventDefault();
});

// Buttons must not keep focus, or Space/Enter would re-trigger the last clicked one.
document.addEventListener('click', (e) => { const b = e.target.closest?.('button'); if (b) b.blur(); });

function wire() {
  const on = (id, fn) => $(id).addEventListener('click', fn);
  on('#nav-home', goHome);
  on('#picker-refresh', loadVideos);
  on('#btn-arm', () => (state.mic.stream ? disarmMic() : armMic()));
  on('#btn-start', onStartKey);
  on('#btn-stop', stopTake);
  on('#btn-retry-upload', uploadAndAnalyze);
  on('#wpm-down', () => setWpm(state.prompter.wpm - 5));
  on('#wpm-up', () => setWpm(state.prompter.wpm + 5));
  on('#font-down', () => setFont(state.prompter.fontSize - FONT_STEP));
  on('#font-up', () => setFont(state.prompter.fontSize + FONT_STEP));
  on('#btn-mirror', toggleMirror);
  on('#btn-open-take', openSelectedTake);
  on('#btn-back-prompter', () => { stopPlayback(); closeRerecord(); show('prompter'); resetScroll(); setStatus(state.mic.stream ? 'Armed · Space records a fresh full take' : 'Space to rehearse · Arm mic to record a new take'); });
  on('#btn-finalize', finalize);
  on('#btn-ab', toggleAB);
  $('#denoise-on').addEventListener('change', (e) => { setDenoise(e.target.checked); e.target.blur(); });
  $('#take-select').addEventListener('change', (e) => { updateControls(); e.target.blur(); });
  $('#finalize-anyway').addEventListener('change', (e) => { state.review.anyway = e.target.checked; updateFinalizeControls(); e.target.blur(); });
  $('#prompter-viewport').addEventListener('wheel', (e) => {
    const p = state.prompter;
    p.pos = clamp(p.pos + e.deltaY, 0, p.total); applyPos();
  }, { passive: true });
  let rz = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(layoutPrompter); });
  window.addEventListener('beforeunload', (e) => { if (state.rec.recording || state.rec.lastBlob) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('unhandledrejection', (e) => { toast(`Unexpected error: ${e.reason?.message || e.reason}`); });
}

// ═══════════════════════ 15. Boot ═══════════════════════

(async function boot() {
  wire();
  updateControls();
  await loadVideos();
  const r = parseHash();
  if (r && state.videos.some((v) => v.name === r.name)) openVideo(r.name, r.view);
  else show('picker');
  window.addEventListener('hashchange', routeFromHash);
})();
