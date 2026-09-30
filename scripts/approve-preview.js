#!/usr/bin/env node
/**
 * approve-preview.js — record that the human approved a video's preview stills.
 *
 * The full render takes a long time, so it is gated on a human looking at the
 * contact sheet + full-size stills (scripts/contact-sheet.js --stills) first.
 * Run this ONLY after the user has explicitly approved those stills — never on
 * the agent's own judgment.
 *
 *   node scripts/approve-preview.js videos/<name> [--by="<who approved>"]
 *   node scripts/approve-preview.js videos/<name> --check     (exit 0 if approved and current)
 *
 * Writes videos/<name>/preview-approved.json with a fingerprint of everything
 * that decides what a frame looks like (index.html, scenes.json, the shared
 * runtime, and the images: the video folder root AND images/** — photo-led
 * videos like devotion-tts keep their photos in images/ with a CREDITS.md).
 * renderer/render.js refuses to run when that file is missing or the
 * fingerprint no longer matches, so any edit after approval needs a fresh
 * preview and a fresh approval.
 *
 * Approvals carry "v": 2 (root + images/**). An older approval without "v" is
 * checked against the v1 fingerprint (root images only), so approvals given
 * before images/ was hashed stay valid; re-approve to cover images/.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME = path.join(ROOT, 'runtime', 'animations.jsx');
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;

const FINGERPRINT_VERSION = 2;

/** Image files that can appear in a frame: video root, plus images/** from v2 on. */
function imageFiles(videoDir, version) {
  const root = fs.readdirSync(videoDir).filter(f => IMAGE_EXT.test(f)).sort().map(f => path.join(videoDir, f));
  if (version < 2) return root;
  const walk = d => fs.readdirSync(d, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : IMAGE_EXT.test(e.name) ? [path.join(d, e.name)] : []));
  const sub = path.join(videoDir, 'images');
  return [...root, ...(fs.existsSync(sub) ? walk(sub).sort() : [])];
}

function fingerprint(videoDir, version = FINGERPRINT_VERSION) {
  const files = [path.join(videoDir, 'index.html'), path.join(videoDir, 'scenes.json'), RUNTIME, ...imageFiles(videoDir, version)];
  const h = crypto.createHash('sha256');
  for (const f of files) {
    if (!fs.existsSync(f)) throw new Error(`missing ${path.relative(ROOT, f)}`);
    h.update(path.relative(ROOT, f)).update('\0').update(fs.readFileSync(f)).update('\0');
  }
  return h.digest('hex');
}

const approvalPath = videoDir => path.join(videoDir, 'preview-approved.json');

/** → { ok: true } | { ok: false, reason } */
function checkApproval(videoDir) {
  const f = approvalPath(videoDir);
  if (!fs.existsSync(f)) return { ok: false, reason: 'no preview approval yet' };
  const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (saved.fingerprint !== fingerprint(videoDir, saved.v || 1)) return { ok: false, reason: 'the video changed since the preview was approved' };
  return { ok: true, approval: saved };
}

module.exports = { fingerprint, checkApproval, approvalPath, imageFiles, FINGERPRINT_VERSION };

if (require.main === module) {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('--'));
  if (!target) {
    console.log('Usage: node scripts/approve-preview.js videos/<name> [--by="<who>"] [--check]');
    process.exit(2);
  }
  const videoDir = path.resolve(target.endsWith('.html') ? path.dirname(target) : target);
  if (args.includes('--check')) {
    const r = checkApproval(videoDir);
    console.log(r.ok ? `✓ preview approved (${r.approval.by}, ${r.approval.at})` : `✗ ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  }
  const by = (args.find(a => a.startsWith('--by=')) || '--by=unknown').slice(5);
  const record = { v: FINGERPRINT_VERSION, fingerprint: fingerprint(videoDir), by, at: new Date().toISOString() };
  fs.writeFileSync(approvalPath(videoDir), JSON.stringify(record, null, 2) + '\n');
  console.log(`✓ preview approved by ${by} → ${path.relative(process.cwd(), approvalPath(videoDir))}`);
}
