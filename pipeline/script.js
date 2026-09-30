'use strict';
/**
 * pipeline/script.js — parse script.md (docs/spec.md §3).
 *
 * parse(md) → {
 *   meta,                                   // frontmatter key/values (numbers coerced)
 *   scenes: [{ idx, sentences: [{ id, scene, line, text, cues }] }],
 *   sentences,                              // same sentence objects, flat, in order
 * }
 * - `### Scene N` starts a scene (N taken from the heading).
 * - Every non-blank line inside a scene is one sentence; id = `s<scene>.<line>`.
 * - `>` lines are teleprompter cues: never spoken/aligned; attached to the NEXT
 *   sentence as `cues` (cues after the last sentence go on `scene.cues`).
 * - Anything outside scene blocks (title, `## Script`, prose) is ignored.
 *
 * load(videoDir) reads <videoDir>/script.md and returns parse() + { raw }.
 */
const fs = require('fs');
const path = require('path');

function parseFrontmatter(md) {
  const m = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (!kv) continue;
    let v = kv[2].replace(/\s+#.*$/, '').trim();           // strip trailing `# comment`
    v = v.replace(/^(['"])(.*)\1$/, '$2');
    meta[kv[1]] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return { meta, body: md.slice(m[0].length) };
}

function parse(md) {
  const { meta, body } = parseFrontmatter(String(md || ''));
  const scenes = [];
  const sentences = [];
  let scene = null;
  let pendingCues = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    const head = line.match(/^#{1,6}\s*scene\s+(\d+)\b/i);
    if (head) {
      if (scene && pendingCues.length) scene.cues.push(...pendingCues);
      pendingCues = [];
      scene = { idx: Number(head[1]), sentences: [], cues: [] };
      scenes.push(scene);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {                          // any other heading ends the scene
      if (scene && pendingCues.length) scene.cues.push(...pendingCues);
      pendingCues = [];
      scene = null;
      continue;
    }
    if (!scene || !line) continue;
    if (line.startsWith('>')) { pendingCues.push(line.replace(/^>\s?/, '')); continue; }
    const lineNo = scene.sentences.length + 1;
    const s = { id: `s${scene.idx}.${lineNo}`, scene: scene.idx, line: lineNo, text: line, cues: pendingCues };
    pendingCues = [];
    scene.sentences.push(s);
    sentences.push(s);
  }
  if (scene && pendingCues.length) scene.cues.push(...pendingCues);

  const warnings = [];
  scenes.forEach((s, i) => {
    if (s.idx !== i + 1) warnings.push(`scene numbering not contiguous: expected ${i + 1}, got ${s.idx}`);
    if (!s.sentences.length) warnings.push(`scene ${s.idx} has no sentences`);
  });
  return { meta, scenes, sentences, warnings };
}

function load(videoDir) {
  const file = path.join(videoDir, 'script.md');
  const raw = fs.readFileSync(file, 'utf8');
  return { ...parse(raw), raw };
}

module.exports = { parse, load, parseFrontmatter };
