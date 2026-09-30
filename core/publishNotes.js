'use strict';
/**
 * core/publishNotes.js — read videos/<name>/publish.md and the publish/<target>.json result
 * files (docs/framework-spec.md §5.5). Node built-ins only. Used by the publish-* plugins and by
 * `reelsmith publish --notes` (skeleton()).
 *
 *   parse(text) → { title, description, tags[], hashtags[], pinnedComment, notes, meta, sections, raw }
 *       Tolerant: `##` or `###` headings, case-insensitive, synonyms (Caption → description,
 *       Notes → posting notes, Pinned → pinned comment, Keywords → tags), ``` fences unwrapped,
 *       <!-- comments --> and skeleton placeholders ("<title, …>") dropped. An optional frontmatter
 *       block (--- key: value ---) may set any field plus extras kept in `meta` (publicUrl, privacy,
 *       categoryId, madeForKids, file, fbTitle, …). Sections win over frontmatter for the text
 *       fields. Hashtags fall back to the #tags found in the description.
 *   load(videoDir, { fallbackTitle = true }) → parse() of publish.md plus { path, exists,
 *       titleSource: 'publish.md' | 'script.md' | null }. Missing publish.md → empty notes with
 *       exists: false; with fallbackTitle the script.md frontmatter `title` fills an empty title.
 *   caption(notes, { maxLength }) → description with any hashtags it lacks appended (Meta, Discord).
 *   skeleton(name, { title }) → publish.md template text (the section names the plugins parse).
 *   writeSkeleton(videoDir, { force, title }) → { path, written } (never overwrites unless force).
 *
 *   resultPath(videoDir, target)          videos/<n>/publish/<target>.json
 *   readResult(videoDir, target)          parsed result or null (for youtube also the legacy
 *                                         youtube-upload.json, mapped to { id, url, legacy: true })
 *   writeResult(videoDir, target, data)   writes it (creates publish/), returns the path
 *   publishedId(videoDir, target)         the recorded id or null (re-upload guard)
 */
const fs = require('fs');
const path = require('path');

const SECTION_KEYS = [
  ['title', /^(title|youtube title|video title)$/],
  ['description', /^(description|caption|caption \(as posted\)|body)$/],
  ['hashtags', /^(hashtags?|hash tags)$/],
  ['tags', /^(tags|keywords|youtube tags)$/],
  ['pinnedComment', /^(pinned comment|pinned|comment)$/],
  ['notes', /^(posting notes|notes|posting)$/],
];

const isPlaceholder = (line) => /^\s*<[^<>]*>\s*$/.test(line);

function stripComments(text) {
  return String(text).replace(/<!--[\s\S]*?-->/g, '');
}

/** Section body → clean text: fences unwrapped, placeholders dropped, trimmed. */
function cleanBody(body) {
  const out = [];
  for (const line of String(body).split('\n')) {
    if (/^\s*```/.test(line)) continue; // unwrap code fences, keep their content
    if (isPlaceholder(line)) continue;
    out.push(line.replace(/\s+$/, ''));
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}

function unquote(s) {
  const t = String(s).trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")) || (t[0] === '`' && t.endsWith('`')))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Minimal frontmatter: `key: value`, `key: [a, b]`, `key:` + `- item` lines, booleans, numbers. */
function parseFrontmatter(text) {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let listKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) { meta[listKey].push(unquote(item[1])); continue; }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    listKey = null;
    if (value === '') { meta[key] = []; listKey = key; continue; }
    if (/^\[.*\]$/.test(value.trim())) {
      meta[key] = value.trim().slice(1, -1).split(',').map(unquote).filter(Boolean);
    } else if (/^(true|false)$/i.test(value.trim())) {
      meta[key] = value.trim().toLowerCase() === 'true';
    } else if (/^-?\d+(\.\d+)?$/.test(value.trim()) && !/^0\d/.test(value.trim())) {
      meta[key] = Number(value.trim());
    } else {
      meta[key] = unquote(value);
    }
  }
  // An empty `key:` with no list items is an empty string, not an empty list.
  for (const k of Object.keys(meta)) if (Array.isArray(meta[k]) && meta[k].length === 0) meta[k] = '';
  return { meta, body: text.slice(m[0].length) };
}

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

function hashtagsFrom(text) {
  return [...new Set((String(text).match(HASHTAG_RE) || []))];
}

/** "#a #b", "a, b", "- a\n- #b" → ['#a', '#b'] */
function toHashtags(value) {
  if (Array.isArray(value)) value = value.join(' ');
  const s = String(value || '');
  const found = hashtagsFrom(s);
  if (found.length) return found;
  return [...new Set(s.split(/[\s,]+/).map((w) => w.replace(/^[-*]+/, '').trim()).filter(Boolean)
    .map((w) => `#${w.replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((w) => w.length > 1))];
}

/** "a, b\nc" / "- a\n- b" / ['a','b'] → ['a','b','c'] (no '#', trimmed, deduped) */
function toTags(value) {
  const parts = Array.isArray(value) ? value : String(value || '').split(/[\n,]+/);
  const out = [];
  for (const p of parts) {
    const t = String(p).replace(/^\s*[-*]\s+/, '').replace(/^#/, '').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function firstLine(text) {
  return (String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '');
}

function parse(text) {
  const raw = String(text == null ? '' : text);
  const { meta, body } = parseFrontmatter(raw);
  const sections = {};
  let current = null;
  let buf = [];
  const flush = () => {
    if (current != null) sections[current] = (sections[current] ? `${sections[current]}\n` : '') + buf.join('\n');
    buf = [];
  };
  let inFence = false;
  for (const line of stripComments(body).split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence && /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      current = h[2].trim().toLowerCase().replace(/[:：]$/, '');
      continue;
    }
    if (current != null) buf.push(line);
  }
  flush();
  // No headings at all (a bare caption file): the whole body is the description.
  if (!Object.keys(sections).length && stripComments(body).trim()) {
    sections.description = stripComments(body).replace(/^#\s+.*\n/, '');
  }

  const pick = {};
  for (const [name, content] of Object.entries(sections)) {
    const key = (SECTION_KEYS.find(([, re]) => re.test(name)) || [])[0];
    if (key && pick[key] == null) pick[key] = cleanBody(content);
  }

  const description = pick.description != null ? pick.description : typeof meta.description === 'string' ? meta.description : '';
  const title = unquote(firstLine(pick.title != null ? pick.title : meta.title || ''));
  const tags = toTags(pick.tags != null ? pick.tags : meta.tags || []);
  let hashtags = toHashtags(pick.hashtags != null ? pick.hashtags : meta.hashtags || []);
  if (!hashtags.length) hashtags = hashtagsFrom(description);

  const extras = { ...meta };
  for (const k of ['title', 'description', 'tags', 'hashtags', 'pinnedComment', 'notes']) delete extras[k];
  return {
    title,
    description,
    tags,
    hashtags,
    pinnedComment: pick.pinnedComment != null ? pick.pinnedComment : typeof meta.pinnedComment === 'string' ? meta.pinnedComment : '',
    notes: pick.notes != null ? pick.notes : typeof meta.notes === 'string' ? meta.notes : '',
    meta: extras,
    sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, cleanBody(v)])),
    raw,
  };
}

function scriptTitle(videoDir) {
  try {
    const { meta } = parseFrontmatter(fs.readFileSync(path.join(videoDir, 'script.md'), 'utf8'));
    return typeof meta.title === 'string' ? meta.title.trim() : '';
  } catch (_) { return ''; }
}

function load(videoDir, { fallbackTitle = true } = {}) {
  const file = path.join(videoDir, 'publish.md');
  const exists = fs.existsSync(file);
  const notes = parse(exists ? fs.readFileSync(file, 'utf8') : '');
  let titleSource = notes.title ? 'publish.md' : null;
  if (!notes.title && fallbackTitle) {
    const t = scriptTitle(videoDir);
    if (t) { notes.title = t; titleSource = 'script.md'; }
  }
  return { ...notes, path: file, exists, titleSource };
}

/** Description + the hashtags it doesn't already contain, capped at maxLength characters. */
function caption(notes, { maxLength = Infinity, hashtags = true } = {}) {
  let text = String(notes.description || '').trim();
  if (hashtags) {
    const have = new Set(hashtagsFrom(text).map((h) => h.toLowerCase()));
    const missing = (notes.hashtags || []).filter((h) => !have.has(h.toLowerCase()));
    if (missing.length) text = `${text}${text ? '\n\n' : ''}${missing.join(' ')}`;
  }
  if ([...text].length > maxLength) text = [...text].slice(0, Math.max(0, maxLength - 1)).join('') + '…';
  return text;
}

function skeleton(name, { title = '' } = {}) {
  return `# Publish — ${name}

## Title
${title || '<title, 45 characters or fewer preferred, 60 hard max>'}

## Description
<line 1: the takeaway, with the keyword phrase>
<line 2: the best source link>

<music credit line, if the video has a music bed>

## Hashtags
<#tag1 #tag2 #tag3>

## Tags
<tag one, tag two, tag three>

## Pinned comment
<suggestion>

## Posting notes
<cadence, series, anything the creator should know>
`;
}

function writeSkeleton(videoDir, { force = false, title } = {}) {
  const file = path.join(videoDir, 'publish.md');
  if (fs.existsSync(file) && !force) return { path: file, written: false };
  fs.writeFileSync(file, skeleton(path.basename(videoDir), { title: title != null ? title : scriptTitle(videoDir) }));
  return { path: file, written: true };
}

// ── result files ──────────────────────────────────────────────────────────────

const resultPath = (videoDir, target) => path.join(videoDir, 'publish', `${target}.json`);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function readResult(videoDir, target) {
  const r = readJson(resultPath(videoDir, target));
  if (r) return r;
  if (target === 'youtube') {
    const legacy = readJson(path.join(videoDir, 'youtube-upload.json'));
    if (legacy && (legacy.video_id || legacy.id)) {
      return { target: 'youtube', id: legacy.video_id || legacy.id, url: legacy.url, legacy: true, file: 'youtube-upload.json' };
    }
  }
  return null;
}

function writeResult(videoDir, target, data) {
  const file = resultPath(videoDir, target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return file;
}

function publishedId(videoDir, target) {
  const r = readResult(videoDir, target);
  return r && r.id ? String(r.id) : null;
}

module.exports = {
  parse, load, caption, skeleton, writeSkeleton, parseFrontmatter, toTags, toHashtags, hashtagsFrom,
  resultPath, readResult, writeResult, publishedId,
};
