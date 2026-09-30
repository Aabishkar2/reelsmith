#!/usr/bin/env node
'use strict';
/**
 * tools/approve-preview.js — record that the human approved a video's preview (`reelsmith approve`).
 *
 * The final render takes a while, so it is gated on a human looking at the draft, the contact
 * sheet and the full-size stills first (`reelsmith draft`, `reelsmith sheet --stills`). Run this
 * ONLY after the user has explicitly approved them, never on the agent's own judgment.
 *
 *   reelsmith approve videos/<name> --by="<who approved>"
 *   node tools/approve-preview.js videos/<name> [--by="<who>"]
 *   node tools/approve-preview.js videos/<name> --check     (exit 0 if approved and current, else 1)
 *
 * Writes videos/<name>/preview-approved.json { v, fingerprint, by, at }. The fingerprint (v3)
 * hashes everything that decides what a frame looks like:
 *   index.html, scenes.json, the runtime (<project>/runtime/animations.jsx), every LOCAL script
 *   index.html loads (<script src="…"> that is not http(s)/data/protocol-relative, resolved
 *   against the video folder — e.g. ../../styles/motion/kit.jsx), and the images (the video
 *   folder root and images/**).
 * Paths are named relative to the project root (core/project.rootFor), so in clone mode (the
 * framework repo) and package mode (runtime/ and styles/ are symlinks) the same files give the
 * same fingerprint. renderer/render.js refuses a final render (exit 3) when the approval is
 * missing, from an older fingerprint version, or no longer matches: any edit after approval
 * needs a fresh preview and a fresh approval.
 *
 * Versions: v1 root images only · v2 + images/** · v3 + local scripts (style kits). Approvals
 * older than v3 are stale (re-approve).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const project = require('../core/project');

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
const FINGERPRINT_VERSION = 3;

const rootOf = videoDir => project.rootFor(videoDir);

/** The runtime the page loads: <root>/runtime/animations.jsx (a symlink in package mode), else the framework's. */
function runtimeFile(root) {
  const own = path.join(root, 'runtime', 'animations.jsx');
  return fs.existsSync(own) ? own : path.join(project.FRAMEWORK_ROOT, 'runtime', 'animations.jsx');
}

/** Image files that can appear in a frame: video root, plus images/** from v2 on. */
function imageFiles(videoDir, version = FINGERPRINT_VERSION) {
  const top = fs.readdirSync(videoDir).filter(f => IMAGE_EXT.test(f)).sort().map(f => path.join(videoDir, f));
  if (version < 2) return top;
  const walk = d => fs.readdirSync(d, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : IMAGE_EXT.test(e.name) ? [path.join(d, e.name)] : []));
  const sub = path.join(videoDir, 'images');
  return [...top, ...(fs.existsSync(sub) ? walk(sub).sort() : [])];
}

/** Local <script src> files of index.html (document order, absolute paths; remote/data URLs skipped). */
function scriptFiles(videoDir, root = rootOf(videoDir)) {
  const html = path.join(videoDir, 'index.html');
  if (!fs.existsSync(html)) return [];
  const src = fs.readFileSync(html, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  const re = /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (let m; (m = re.exec(src));) {
    const ref = String(m[1] ?? m[2] ?? m[3] ?? '').trim().split(/[?#]/)[0];
    if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) continue;
    let file;
    try { file = decodeURIComponent(ref); } catch (_) { file = ref; }
    file = file.startsWith('/') ? path.join(root, file) : path.resolve(videoDir, file);
    if (!out.includes(file)) out.push(file);
  }
  return out;
}

/** Every file the fingerprint of `version` covers, in hashing order. */
function fingerprintFiles(videoDir, version = FINGERPRINT_VERSION) {
  const root = rootOf(videoDir);
  const runtime = runtimeFile(root);
  const files = [path.join(videoDir, 'index.html'), path.join(videoDir, 'scenes.json'), runtime];
  if (version >= 3) {
    const rt = project.real(runtime);
    for (const f of scriptFiles(videoDir, root)) if (project.real(f) !== rt && !files.includes(f)) files.push(f);
  }
  return [...files, ...imageFiles(videoDir, version)];
}

function fingerprint(videoDir, version = FINGERPRINT_VERSION) {
  const dir = path.resolve(videoDir);
  const root = rootOf(dir);
  const h = crypto.createHash('sha256');
  for (const f of fingerprintFiles(dir, version)) {
    if (!fs.existsSync(f)) throw new Error(`missing ${path.relative(root, f)}`);
    h.update(path.relative(root, f).split(path.sep).join('/')).update('\0').update(fs.readFileSync(f)).update('\0');
  }
  return h.digest('hex');
}

const approvalPath = videoDir => path.join(videoDir, 'preview-approved.json');

/** → { ok: true, approval } | { ok: false, reason } */
function checkApproval(videoDir) {
  const f = approvalPath(videoDir);
  if (!fs.existsSync(f)) return { ok: false, reason: 'no preview approval yet' };
  let saved;
  try { saved = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return { ok: false, reason: `preview-approved.json is unreadable (${e.message})` }; }
  if ((saved.v || 1) < FINGERPRINT_VERSION) {
    return { ok: false, reason: `the approval is from fingerprint v${saved.v || 1}; v${FINGERPRINT_VERSION} also covers the style kit and other local scripts, so the preview needs a fresh approval` };
  }
  let now;
  try { now = fingerprint(videoDir, FINGERPRINT_VERSION); } catch (e) { return { ok: false, reason: e.message }; }
  if (saved.fingerprint !== now) return { ok: false, reason: 'the video changed since the preview was approved' };
  return { ok: true, approval: saved };
}

/** Write preview-approved.json for the current state of the video. */
function approve(videoDir, by) {
  const record = { v: FINGERPRINT_VERSION, fingerprint: fingerprint(videoDir), by: String(by || 'unknown'), at: new Date().toISOString() };
  fs.writeFileSync(approvalPath(videoDir), JSON.stringify(record, null, 2) + '\n');
  return { ...record, path: approvalPath(videoDir) };
}

module.exports = { fingerprint, fingerprintFiles, scriptFiles, checkApproval, approve, approvalPath, imageFiles, FINGERPRINT_VERSION };

if (require.main === module) {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('--'));
  if (!target || args.includes('--help')) {
    console.log('Usage: node tools/approve-preview.js videos/<name> [--by="<who>"] [--check]   (or: reelsmith approve <video> --by=<who>)');
    process.exit(target ? 0 : 2);
  }
  let videoDir = path.resolve(target.endsWith('.html') ? path.dirname(target) : target);
  if (!fs.existsSync(videoDir)) {
    try { videoDir = project.resolveVideo(target); } catch (e) { console.error(e.message); process.exit(2); }
  }
  if (args.includes('--check')) {
    const r = checkApproval(videoDir);
    console.log(r.ok ? `✓ preview approved (${r.approval.by}, ${r.approval.at})` : `✗ ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  }
  const by = (args.find(a => a.startsWith('--by=')) || '--by=unknown').slice(5);
  try {
    const rec = approve(videoDir, by);
    console.log(`✓ preview approved by ${rec.by} → ${path.relative(process.cwd(), rec.path)}`);
  } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}
