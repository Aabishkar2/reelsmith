#!/usr/bin/env node
'use strict';
/**
 * tools/build-site.js — render README.md and docs/*.md into the static docs site.
 *
 * Usage:
 *   node tools/build-site.js            writes site/docs/<name>.html (README.md → site/docs/index.html)
 *   node tools/build-site.js --quiet    no per-page log lines
 *
 * No dependencies. A small markdown renderer covers what the docs use: ATX headings (with GitHub-style
 * ids), paragraphs, nested ul/ol (task-list checkboxes too), fenced code with a language class, inline
 * code, bold/italic, links, images, autolinks, GFM tables (with \| escapes), blockquotes and hr. Raw HTML
 * in the markdown is escaped, never passed through.
 *
 * Links: a relative link to a rendered page becomes <slug>.html (anchors kept); any other relative
 * link (a folder, a source file, an unrendered doc) points at the file on GitHub.
 *
 * Excluded from the site: docs/framework-spec.md, docs/spec.md, docs/learnings.md.
 * The output (site/docs/*.html) is gitignored; the GitHub Pages workflow runs this script.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'site', 'docs');
const REPO = 'https://github.com/Aabishkar2/reelsmith';
const BRANCH = 'main';
const EXCLUDE = new Set(['framework-spec.md', 'spec.md', 'learnings.md']);
const QUIET = process.argv.includes('--quiet');

// Sidebar order. Docs not listed here are appended to the last group.
const NAV = [
  { group: 'Start', pages: [
    ['README.md', 'index', 'Overview'],
    ['docs/getting-started.md', 'getting-started', 'Getting started'],
    ['docs/tutorials.md', 'tutorials', 'Tutorials'],
    ['docs/concepts.md', 'concepts', 'Concepts'],
  ] },
  { group: 'Guides', pages: [
    ['docs/script-format.md', 'script-format', 'Script format'],
    ['docs/voice.md', 'voice', 'Voice'],
    ['docs/animation.md', 'animation', 'Animation'],
    ['docs/styles.md', 'styles', 'Styles'],
    ['docs/plugins.md', 'plugins', 'Plugins'],
    ['docs/publishing.md', 'publishing', 'Publishing'],
    ['docs/agent-workflow.md', 'agent-workflow', 'Agent workflow'],
  ] },
  { group: 'Reference', pages: [
    ['docs/cli.md', 'cli', 'CLI reference'],
    ['docs/architecture.md', 'architecture', 'Architecture'],
    ['docs/fast-render.md', 'fast-render', 'Fast render'],
    ['docs/faq.md', 'faq', 'FAQ'],
  ] },
];

// ── helpers ──────────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const indentOf = (line) => (line.match(/^ */) || [''])[0].length;
const detab = (line) => line.replace(/\t/g, '    ');

/** GitHub-style heading id: strip markup, lowercase, drop punctuation, one hyphen per space. */
function slugify(md) {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/ /g, '-');
}

// ── inline markdown ──────────────────────────────────────────────────────────

function makeInline(ctx) {
  function emphasis(s) {
    return s
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
      .replace(/(^|[^\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>');
  }

  return function inline(text) {
    const slots = [];
    const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;
    let s = String(text);

    // code spans first: nothing inside them is markdown
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, ticks, code) => {
      const body = /^ [\s\S]* $/.test(code) && code.trim() ? code.slice(1, -1) : code;
      return hold(`<code>${esc(body)}</code>`);
    });
    // backslash escapes
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|>~<])/g, (m, ch) => hold(esc(ch)));
    // autolinks <https://…>
    s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (m, url) => hold(`<a href="${esc(url)}">${esc(url)}</a>`));
    // images, then links (text keeps emphasis; href is rewritten and protected)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, alt, src, title) =>
      hold(`<img src="${esc(ctx.href(src))}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">`));
    s = s.replace(/\[((?:[^\[\]]|\u0000\d+\u0000)+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, label, href, title) => {
      const url = ctx.href(href);
      const ext = /^https?:/.test(url) && !url.startsWith(REPO) ? ' rel="noopener"' : '';
      return hold(`<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ''}${ext}>${emphasis(esc(label))}</a>`);
    });
    // bare URLs
    s = s.replace(/\bhttps?:\/\/[^\s<\u0000]*[^\s<\u0000.,:;"')\]]/g, (url) => hold(`<a href="${esc(url)}" rel="noopener">${esc(url)}</a>`));

    s = emphasis(esc(s));
    // restore (slots may nest: a link label can hold a code span)
    for (let i = 0; i < 3 && s.includes('\u0000'); i++) s = s.replace(/\u0000(\d+)\u0000/g, (m, n) => slots[Number(n)]);
    return s;
  };
}

// ── block markdown ───────────────────────────────────────────────────────────

const RE = {
  fence: /^( {0,3})(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/,
  heading: /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
  quote: /^ {0,3}>\s?/,
  list: /^( *)([-*+]|\d{1,9}[.)])(\s+|$)/,
  tableSep: /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
};

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const isTableStart = (lines, i) => i + 1 < lines.length && lines[i].includes('|') && RE.tableSep.test(lines[i + 1]) && lines[i + 1].includes('-');

function startsBlock(lines, i) {
  const l = lines[i];
  return RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || RE.list.test(l) || isTableStart(lines, i);
}

function renderBlocks(lines, ctx, { tight = false } = {}) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m;
    if ((m = line.match(RE.fence))) {
      const [, ind, fence, lang] = m;
      const body = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[0].repeat(fence.length)) && lines[i].trim().replace(new RegExp(`^\\${fence[0]}+`), '').trim() === '')) {
        body.push(lines[i].slice(Math.min(ind.length, indentOf(lines[i]))));
        i++;
      }
      i++; // closing fence
      const cls = lang ? ` class="language-${esc(lang)}"` : '';
      out.push(`<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code${cls}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    if ((m = line.match(RE.heading))) {
      const level = m[1].length;
      const id = ctx.uniqueId(slugify(m[2]));
      if (level === 1 && !ctx.title) ctx.title = m[2].replace(/[`*_]/g, '');
      const anchor = level > 1 ? `<a class="anchor" href="#${id}" aria-hidden="true">#</a>` : '';
      out.push(`<h${level} id="${id}">${ctx.inline(m[2])}${anchor}</h${level}>`);
      i++;
      continue;
    }

    if (RE.hr.test(line)) { out.push('<hr>'); i++; continue; }

    if (RE.quote.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim() && RE.quote.test(lines[i])) body.push(lines[i].replace(RE.quote, '')), i++;
      out.push(`<blockquote>\n${renderBlocks(body, ctx)}\n</blockquote>`);
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(lines[i]);
      const aligns = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i])), i++;
      const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${ctx.inline(c || '')}</${tag}>`;
      out.push(
        '<div class="table-wrap"><table>\n<thead><tr>' + head.map((c, k) => cell('th', c, k)).join('') + '</tr></thead>\n<tbody>\n' +
        rows.map((r) => '<tr>' + head.map((_, k) => cell('td', r[k], k)).join('') + '</tr>').join('\n') +
        '\n</tbody></table></div>');
      continue;
    }

    if ((m = line.match(RE.list))) {
      const res = renderList(lines, i, ctx);
      out.push(res.html);
      i = res.next;
      continue;
    }

    // paragraph
    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines, i))) para.push(lines[i].trim()), i++;
    const html = ctx.inline(para.join('\n'));
    out.push(tight ? html : `<p>${html}</p>`);
  }
  return out.join('\n');
}

function renderList(lines, start, ctx) {
  const first = lines[start].match(RE.list);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let loose = false;
  let i = start;

  while (i < lines.length) {
    const m = lines[i].match(RE.list);
    if (!m || m[1].length !== baseIndent || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = m[0].length && m[3] ? baseIndent + m[2].length + Math.min(m[3].length, 4) : baseIndent + m[2].length + 1;
    const body = [lines[i].slice(m[0].length)];
    let hadBlank = false;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && indentOf(lines[j]) >= contentIndent) { body.push(''); hadBlank = true; i++; continue; }
        if (j < lines.length) {
          const n = lines[j].match(RE.list);
          if (n && n[1].length === baseIndent && /\d/.test(n[2]) === ordered) { loose = true; i = j; }
        }
        break;
      }
      const ind = indentOf(l);
      if (ind >= contentIndent) { body.push(l.slice(contentIndent)); i++; continue; }
      if (ind > baseIndent && RE.list.test(l)) { body.push(l.slice(ind > contentIndent ? contentIndent : ind)); i++; continue; }
      const last = body[body.length - 1];
      if (last && last.trim() && !RE.list.test(l) && !startsBlock(lines, i)) { body.push(l.trim()); i++; continue; }
      break;
    }
    if (hadBlank) loose = true;
    items.push(body);
  }

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  const lis = items.map((body) => {
    let task = '';
    const tm = body[0].match(/^\[([ xX])\]\s+/);
    if (tm) { task = `<input type="checkbox" disabled${tm[1] !== ' ' ? ' checked' : ''}> `; body[0] = body[0].slice(tm[0].length); }
    const inner = renderBlocks(body, ctx, { tight: !loose });
    return `<li${task ? ' class="task"' : ''}>${task}${inner}</li>`;
  });
  return { html: `<${tag}${startAttr}>\n${lis.join('\n')}\n</${tag}>`, next: i };
}

// ── pages ────────────────────────────────────────────────────────────────────

function collectPages() {
  const pages = [];
  for (const g of NAV) for (const [src, slug, label] of g.pages) {
    if (fs.existsSync(path.join(ROOT, src))) pages.push({ src, slug, label, group: g.group });
  }
  const listed = new Set(pages.map((p) => p.src));
  const extra = fs.readdirSync(path.join(ROOT, 'docs'))
    .filter((f) => f.endsWith('.md') && !EXCLUDE.has(f) && !listed.has(`docs/${f}`))
    .sort();
  for (const f of extra) {
    const md = fs.readFileSync(path.join(ROOT, 'docs', f), 'utf8');
    const h1 = (md.match(/^#\s+(.+)$/m) || [])[1];
    pages.push({ src: `docs/${f}`, slug: f.replace(/\.md$/, ''), label: h1 ? h1.replace(/[`*_]/g, '') : f, group: NAV[NAV.length - 1].group });
  }
  return pages;
}

function hrefRewriter(page, bySource) {
  return (href) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return href;
    const [p, hash] = href.split('#');
    if (!p) return href;
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(page.src), p));
    const target = bySource.get(rel.replace(/\/$/, ''));
    if (target) return `${target.slug}.html${hash ? `#${hash}` : ''}`;
    const clean = rel.replace(/\/$/, '');
    const abs = path.join(ROOT, clean);
    const isDir = p.endsWith('/') || (fs.existsSync(abs) && fs.statSync(abs).isDirectory());
    return `${REPO}/${isDir ? 'tree' : 'blob'}/${BRANCH}/${clean}${hash ? `#${hash}` : ''}`;
  };
}

function describe(html) {
  const m = html.match(/<p>([\s\S]*?)<\/p>/);
  const text = m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  return text.length > 160 ? `${text.slice(0, 157).replace(/\s+\S*$/, '')}…` : text;
}

function sidebar(pages, current) {
  const groups = [];
  for (const g of NAV) {
    const items = pages.filter((p) => p.group === g.group);
    if (!items.length) continue;
    groups.push(`<div class="nav-group"><p class="nav-title">${esc(g.group)}</p><ul>` +
      items.map((p) => `<li><a href="${p.slug}.html"${p === current ? ' aria-current="page"' : ''}>${esc(p.label)}</a></li>`).join('') +
      '</ul></div>');
  }
  groups.push(`<div class="nav-group nav-extra"><ul><li><a href="../index.html">Home</a></li><li><a href="${REPO}">GitHub</a></li></ul></div>`);
  return groups.join('\n');
}

function shell({ page, pages, body, title, description, prev, next }) {
  const pager = [
    prev ? `<a class="pager-link prev" href="${prev.slug}.html"><span>Previous</span>${esc(prev.label)}</a>` : '<span></span>',
    next ? `<a class="pager-link next" href="${next.slug}.html"><span>Next</span>${esc(next.label)}</a>` : '<span></span>',
  ].join('\n');
  const source = `${REPO}/blob/${BRANCH}/${page.src}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Reelsmith docs</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/docs.css">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="topbar">
  <a class="brand" href="../index.html" aria-label="Reelsmith home"><img src="../assets/logo.svg" alt="" width="28" height="28"><span>Reelsmith</span></a>
  <span class="crumb">Docs</span>
  <nav class="toplinks" aria-label="Site">
    <a href="getting-started.html">Get started</a>
    <a href="${REPO}">GitHub</a>
  </nav>
  <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="sidebar">Menu</button>
</header>
<div class="layout">
  <nav id="sidebar" class="sidebar" aria-label="Documentation">
${sidebar(pages, page)}
  </nav>
  <main id="content" class="content">
    <article class="prose">
${body}
    </article>
    <nav class="pager" aria-label="Pages">
${pager}
    </nav>
    <p class="edit"><a href="${source}">View this page on GitHub</a></p>
  </main>
</div>
<footer class="footer">
  <p>Reelsmith is MIT licensed. <a href="../index.html">Home</a> · <a href="index.html">Docs</a> · <a href="${REPO}">GitHub</a></p>
</footer>
<script>
(function () {
  var b = document.querySelector('.nav-toggle'), s = document.getElementById('sidebar');
  if (!b || !s) return;
  b.addEventListener('click', function () {
    var open = s.classList.toggle('open');
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.textContent = open ? 'Close' : 'Menu';
  });
})();
</script>
</body>
</html>
`;
}

function build() {
  const pages = collectPages();
  const bySource = new Map(pages.map((p) => [p.src, p]));
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.html')) fs.unlinkSync(path.join(OUT, f));

  pages.forEach((page, k) => {
    const md = fs.readFileSync(path.join(ROOT, page.src), 'utf8').replace(/\r\n?/g, '\n');
    const ids = new Map();
    const ctx = {
      title: null,
      href: hrefRewriter(page, bySource),
      uniqueId(base) {
        const b = base || 'section';
        const n = ids.get(b) || 0;
        ids.set(b, n + 1);
        return n ? `${b}-${n}` : b;
      },
    };
    ctx.inline = makeInline(ctx);
    const body = renderBlocks(md.split('\n').map(detab), ctx);
    const title = page.slug === 'index' ? 'Overview' : (ctx.title || page.label);
    const html = shell({ page, pages, body, title, description: describe(body), prev: pages[k - 1], next: pages[k + 1] });
    fs.writeFileSync(path.join(OUT, `${page.slug}.html`), html);
    if (!QUIET) console.log(`  ${page.src} → site/docs/${page.slug}.html`);
  });
  console.log(`built ${pages.length} pages into ${path.relative(process.cwd(), OUT) || OUT}`);
}

if (require.main === module) {
  try { build(); } catch (e) { console.error(`build-site: ${e.message}`); process.exit(1); }
}

module.exports = { slugify, renderBlocks, makeInline };
