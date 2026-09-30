// styles/motion/kit.jsx — the Reelsmith "motion" style kit.
//
// Bright, fast motion graphics for developer tutorials: terminals, code cards,
// file trees, diagrams, phone frames. Load it AFTER the runtime:
//
//   <script type="text/babel" src="../../runtime/animations.jsx"></script>
//   <script type="text/babel" src="../../styles/motion/kit.jsx"></script>
//
// Everything public is assigned to `window` at the bottom of this file (the API
// is documented with a snippet per component in styles/motion/STYLE.md).
//
// Clock contract (same for every component):
//   - A component reads the scene clock from useSprite().localTime, so render it
//     inside the scene's <Sprite {...useSceneWindow(N)}>. Pass `t` to use another
//     clock instead (rarely needed).
//   - Every time prop (`at`, rows[i].at, `until`, `outAt`, ...) is in seconds on
//     that same clock. Pass useWordCue(N, "phrase") results, never typed numbers.
//   - at = Infinity (a cue useWordCue could not find) keeps the element hidden.
//   - Elements only ENTER. Nothing fades out before its scene ends, except the
//     few props that exist to remove something (`outAt`, `cutAt`, `until`).
//   - Entry helpers take dt = localTime - at (negative = not yet) and return a
//     style object: enter.slideUp(dt), enter.pop(dt), enter.wipe(dt), ...
//
// Placement contract: components take optional `x` / `y` (canvas px). With
// neither they sit in normal flow (use them inside your own flex layout). With
// only `y` they are absolutely positioned at that top and centred horizontally.
// With both they sit at (x, y). `style` is merged into the component's box.
//
// Determinism: no timers, requestAnimationFrame, Math.random, Date or CSS
// transitions/animations. Every frame is a pure function of time; noise comes
// from seededRandom(seed). Decorative full-bleed layers carry data-bleed so the
// contact sheet's safe-area check ignores them.

(function motionKit() {
  'use strict';

  if (typeof window.spring !== 'function' || typeof window.useSprite !== 'function') {
    console.error('[motion kit] runtime/animations.jsx must be loaded before styles/motion/kit.jsx');
    return;
  }
  const { Easing, clamp, spring, track, seededRandom, useSprite } = window;

  // ── Palette + type ──────────────────────────────────────────────────────────
  const INK = '#0B0F19';
  const VIOLET = '#7C5CFF';
  const CYAN = '#22D3EE';
  const OK = '#34D399';
  const WARN = '#FBBF24';
  const DANGER = '#F87171';
  const TEXT = '#F5F7FF';
  const MUTED = 'rgba(245,247,255,0.62)';
  const FAINT = 'rgba(245,247,255,0.38)';
  const CARD = 'rgba(255,255,255,0.05)';
  const CARD_BORDER = 'rgba(255,255,255,0.10)';
  const CODE_BG = '#0F1524';
  const GRAD = `linear-gradient(90deg, ${VIOLET} 0%, ${CYAN} 100%)`;
  const GRAD_DIAG = `linear-gradient(135deg, ${VIOLET} 0%, ${CYAN} 100%)`;

  const DISPLAY = "'Sora', 'Inter', system-ui, sans-serif";
  const SANS = "'Inter', system-ui, sans-serif";
  const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";

  const SHADOW = '0 28px 70px rgba(0,0,0,0.50), 0 2px 10px rgba(0,0,0,0.30)';
  const TS = '0 2px 18px rgba(0,0,0,0.55)';
  const SNAPPY = { k: 320, d: 30 };
  const PUNCH = { k: 200, d: 14 };
  const CANVAS = { width: 720, height: 1280 };
  const SCENE_IN = 0.5; // = runtime SCENE_OVERLAP: scene entries run over the overlap

  // Syntax colours for CodeCard / Terminal (lighter tints of the palette).
  const CODE = {
    text: '#E6E9F5', kw: '#B69CFF', str: '#6EE7B7', num: '#FCD34D', fn: '#67E8F9',
    prop: '#93C5FD', tag: '#67E8F9', flag: '#67E8F9', head: '#B69CFF',
    cm: 'rgba(245,247,255,0.40)', punct: 'rgba(245,247,255,0.55)',
  };

  const TONES = {
    violet: VIOLET, cyan: CYAN, ok: OK, success: OK, warn: WARN, danger: DANGER,
    bad: DANGER, err: DANGER, error: DANGER, ghost: TEXT, text: TEXT,
  };
  const tone = (v) => TONES[v] || v || VIOLET;

  function hexRgb(h) {
    let s = String(h).replace('#', '');
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    const n = parseInt(s.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // alpha('#7C5CFF', 0.2) → 'rgba(124,92,255,0.2)'. Non-hex colours pass through.
  function alpha(c, a) {
    const col = tone(c);
    if (typeof col !== 'string' || col[0] !== '#') return col;
    const [r, g, b] = hexRgb(col);
    return `rgba(${r},${g},${b},${a})`;
  }
  // mix(VIOLET, CYAN, 0.5) → the colour halfway between (hex inputs).
  function mix(a, b, p) {
    const A = hexRgb(tone(a));
    const B = hexRgb(tone(b));
    const q = clamp(p, 0, 1);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * q)).join(',')})`;
  }

  // ── Time helpers ────────────────────────────────────────────────────────────
  function useLocalTime(t) {
    const s = useSprite();
    return t != null ? t : s.localTime;
  }
  const e3 = (p) => Easing.easeOutCubic(clamp(p, 0, 1));
  const eio = (p) => Easing.easeInOutCubic(clamp(p, 0, 1));
  // spring that is exactly 0 before its start and 1 once long settled (no NaN at ∞)
  const sp = (dt, k = SNAPPY.k, d = SNAPPY.d) => (!(dt > 0) ? 0 : dt > 8 ? 1 : spring(dt, k, d));
  const num = (v, d) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);
  // Seconds a typed string takes at `speed` characters per second.
  const typeDuration = (text, speed = 28) => String(text == null ? '' : text).length / speed;

  // ── Entry helpers: dt = localTime - at → style object (enter-only) ─────────
  const hidden = (extra) => ({ opacity: 0, ...extra });
  const enter = {
    none: () => ({}),
    fadeIn(dt, dur = 0.35) {
      if (!(dt >= 0)) return hidden();
      return { opacity: e3(dt / dur) };
    },
    slideUp(dt, dur = 0.45, dist = 26) {
      if (!(dt >= 0)) return hidden({ transform: `translateY(${dist}px)` });
      const p = e3(dt / dur);
      return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` };
    },
    rise(dt, dist = 70) {
      if (!(dt >= 0)) return hidden({ transform: `translateY(${dist}px)` });
      const s = sp(dt, SNAPPY.k, SNAPPY.d);
      return { opacity: clamp(dt / 0.2, 0, 1), transform: `translateY(${(1 - s) * dist}px) scale(${0.96 + 0.04 * s})` };
    },
    pop(dt, from = 0.55) {
      if (!(dt >= 0)) return hidden({ transform: `scale(${from})` });
      const s = sp(dt, PUNCH.k, PUNCH.d);
      return { opacity: clamp(dt / 0.12, 0, 1), transform: `scale(${from + (1 - from) * s})` };
    },
    wipe(dt, dur = 0.55, dir = 'right') {
      if (!(dt >= 0)) return hidden();
      const q = (1 - eio(dt / dur)) * 100;
      const clip = dir === 'left' ? `inset(0 0 0 ${q}%)` : dir === 'down' ? `inset(0 0 ${q}% 0)`
        : dir === 'up' ? `inset(${q}% 0 0 0)` : `inset(0 ${q}% 0 0)`;
      return { opacity: 1, clipPath: clip, WebkitClipPath: clip };
    },
    push(dt, dir = 'left', dist = 110) {
      const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir] || [-1, 0];
      if (!(dt >= 0)) return hidden({ transform: `translate(${v[0] * dist}px, ${v[1] * dist}px)` });
      const r = 1 - sp(dt, SNAPPY.k, SNAPPY.d);
      return { opacity: clamp(dt / 0.18, 0, 1), transform: `translate(${v[0] * dist * r}px, ${v[1] * dist * r}px)` };
    },
    blur(dt, dur = 0.5) {
      if (!(dt >= 0)) return hidden();
      const p = e3(dt / dur);
      return { opacity: p, filter: p < 1 ? `blur(${(1 - p) * 14}px)` : 'none', transform: `scale(${1.06 - 0.06 * p})` };
    },
    drop(dt, dist = 80) {
      if (!(dt >= 0)) return hidden({ transform: `translateY(${-dist}px)` });
      const s = sp(dt, 260, 17);
      return { opacity: clamp(dt / 0.12, 0, 1), transform: `translateY(${(1 - s) * -dist}px)` };
    },
    zoom(dt, dur = 0.5) {
      if (!(dt >= 0)) return hidden({ transform: 'scale(1.25)' });
      const p = e3(dt / dur);
      return { opacity: p, transform: `scale(${1.25 - 0.25 * p})` };
    },
  };
  // fromX = spring push in from that side; wipeX = clip reveal travelling toward X
  // ('wipe' alone travels right, i.e. reveals left → right).
  const ENTRY_ALIASES = {
    fromLeft: ['push', 'left'], fromRight: ['push', 'right'], fromTop: ['push', 'up'], fromBottom: ['push', 'down'],
    wipeRight: ['wipe', 'right'], wipeLeft: ['wipe', 'left'], wipeUp: ['wipe', 'up'], wipeDown: ['wipe', 'down'],
  };
  // entry('fromRight', dt) → style. `name` may also be a function dt → style.
  function entry(name, dt) {
    if (typeof name === 'function') return name(dt);
    if (ENTRY_ALIASES[name]) {
      const [fn, dir] = ENTRY_ALIASES[name];
      return fn === 'push' ? enter.push(dt, dir) : enter.wipe(dt, 0.55, dir);
    }
    return (enter[name] || enter.slideUp)(dt);
  }

  // ── Placement ───────────────────────────────────────────────────────────────
  function place(x, y, z) {
    if (x == null && y == null) return { position: 'relative', zIndex: z };
    if (x == null) {
      return { position: 'absolute', top: y, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: z };
    }
    return { position: 'absolute', left: x, top: y, zIndex: z };
  }

  // ── Icons (24×24 stroke paths, drawn by us, no icon font) ───────────────────
  const O = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  const ICONS = {
    check: 'M5 12.5l4.5 4.5L19 7.5',
    x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
    warn: 'M12 3.8L21.5 20H2.5L12 3.8zM12 10v4.6M12 17.4v.1',
    info: `${O(12, 12, 9)}M12 11v6M12 7.6v.1`,
    file: 'M6 2.8h8l5 5v13.4H6zM14 2.8v5h5',
    folder: 'M3 6.5h6.5l2 2.4H21v10.6H3z',
    mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.2',
    wave: 'M3 12h1.5M7 8.5v7M10.5 5v14M14 8v8M17.5 6.5v11M21 12h-.5',
    send: 'M3.5 11.3L21 3.5l-7.8 17.3-2.3-7.2z',
    lock: 'M5.5 11h13v10h-13zM8.5 11V7.8a3.5 3.5 0 0 1 7 0V11',
    play: 'M7.5 4.8v14.4L19.5 12z',
    eye: `M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z${O(12, 12, 3)}`,
    cog: `${O(12, 12, 3.2)}M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1`,
    bolt: 'M13.5 2.5L4.5 13.5H11l-1 8 9-11h-6.5z',
    palette: 'M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1.3-1-1.6-1-2.7 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11.5v.1M10 7.5v.1M15 7.5v.1',
    words: 'M4 6.5h16M4 12h11M4 17.5h14',
    terminal: 'M3 4.5h18v15H3zM7 9.5l3 2.5-3 2.5M12.5 15h4.5',
    code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
    sparkle: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z',
    arrow: 'M4 12h15M13 6l6 6-6 6',
    plus: 'M12 5v14M5 12h14',
    video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
    chat: 'M4 5h16v11H9.5L4 20z',
    globe: `${O(12, 12, 9)}M3 12h18M12 3c3 3.6 3 14.4 0 18M12 3c-3 3.6-3 14.4 0 18`,
    clock: `${O(12, 12, 9)}M12 7v5.2l3.2 2`,
    cloud: 'M7 18.5h10.2a4 4 0 0 0 .6-8 6 6 0 0 0-11.6 1.4A3.3 3.3 0 0 0 7 18.5z',
    plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
    user: `${O(12, 8, 4)}M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5`,
    key: `${O(8, 15, 4.5)}M11.3 11.7L20 3M16.5 6.5l3 3M14 9l2 2`,
    rec: O(12, 12, 6.5),
    dot: O(12, 12, 4),
  };
  const FILLED = { play: true, rec: true, dot: true };

  function Icon({ name, size = 28, color = 'currentColor', stroke = 2.2, fill, style }) {
    const d = ICONS[name];
    if (!d) return null;
    const filled = fill != null ? fill : FILLED[name];
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
        style={{ display: 'block', flexShrink: 0, overflow: 'visible', ...style }}
        fill={filled ? tone(color) : 'none'} stroke={filled ? 'none' : tone(color)}
        strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    );
  }

  // ── Scene root ──────────────────────────────────────────────────────────────
  // <SceneRoot idx={N} enter="wipe"> — background (ink + static violet/cyan glows,
  // dot grid, vignette), zIndex = idx so the incoming scene covers the outgoing
  // one during the 0.5 s overlap, and the scene transition (skipped for idx 1).
  function SceneRoot({ idx = 1, enter: en = 'fade', children, bg = INK, glow = true, pattern = 'dots',
    vignette = true, t, style }) {
    const lt = useLocalTime(t);
    const p = idx <= 1 || en === 'none' ? 1 : eio(lt / SCENE_IN);
    let inner = {};
    let edge = null;
    if (p < 1) {
      if (en === 'wipe') {
        inner = { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` };
        edge = (
          <div data-bleed="" style={{ position: 'absolute', top: 0, bottom: 0, left: p * 720 - 60, width: 120,
            opacity: Math.sin(Math.PI * p),
            background: `linear-gradient(90deg, ${alpha(CYAN, 0)}, ${alpha(CYAN, 0.75)}, ${alpha(VIOLET, 0)})`,
            filter: 'blur(10px)', mixBlendMode: 'screen', zIndex: 2 }} />
        );
      } else if (en === 'push') {
        inner = { transform: `translateX(${(1 - p) * 100}%)`, boxShadow: '-40px 0 80px rgba(0,0,0,0.6)' };
      } else if (en === 'up') {
        inner = { transform: `translateY(${(1 - p) * 100}%)`, boxShadow: '0 -40px 80px rgba(0,0,0,0.6)' };
      } else if (en === 'zoom') {
        inner = { opacity: p, transform: `scale(${1.12 - 0.12 * p})` };
      } else if (en === 'iris') {
        inner = { clipPath: `circle(${p * 78}% at 50% 45%)` };
      } else {
        inner = { opacity: p };
      }
    }
    const layers = [];
    if (glow) {
      layers.push(`radial-gradient(ellipse 75% 45% at 8% 6%, ${alpha(VIOLET, 0.20)} 0%, ${alpha(VIOLET, 0)} 70%)`);
      layers.push(`radial-gradient(ellipse 70% 42% at 94% 96%, ${alpha(CYAN, 0.12)} 0%, ${alpha(CYAN, 0)} 70%)`);
    }
    return (
      <div data-scene={idx} style={{ position: 'absolute', inset: 0, zIndex: idx, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: bg, ...inner, ...style }}>
          {layers.length > 0 && <div data-bleed="" style={{ position: 'absolute', inset: 0, background: layers.join(', ') }} />}
          {pattern === 'dots' && (
            <div data-bleed="" style={{ position: 'absolute', inset: 0, opacity: 0.55,
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.075) 1.2px, transparent 1.6px)',
              backgroundSize: '28px 28px', backgroundPosition: '14px 14px' }} />
          )}
          {pattern === 'grid' && (
            <div data-bleed="" style={{ position: 'absolute', inset: 0, opacity: 0.5,
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
              backgroundSize: '48px 48px', backgroundPosition: '0 0' }} />
          )}
          {vignette && (
            <div data-bleed="" style={{ position: 'absolute', inset: 0,
              background: 'radial-gradient(ellipse 90% 70% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.42) 100%)' }} />
          )}
          {children}
        </div>
        {edge}
      </div>
    );
  }

  // Static radial glow blob (decorative). `breathe` > 0 adds a slow t-driven pulse.
  function Glow({ x = 360, y = 520, r = 320, color = VIOLET, opacity = 0.32, breathe = 0, at, t }) {
    const lt = useLocalTime(t);
    const s = 1 + breathe * Math.sin(lt * 1.7);
    const o = at == null ? 1 : e3((lt - at) / 0.6);
    const R = r * s;
    return (
      <div data-bleed="" style={{ position: 'absolute', left: x - R, top: y - R, width: R * 2, height: R * 2,
        borderRadius: '50%', pointerEvents: 'none', opacity: o,
        background: `radial-gradient(circle, ${alpha(color, opacity)} 0%, ${alpha(color, opacity * 0.45)} 35%, ${alpha(color, 0)} 70%)` }} />
    );
  }

  // Giant faint background text (a numeral, a "$", a word). Decorative: data-bleed.
  function Watermark({ text, x = 360, y = 560, size = 560, color = VIOLET, opacity = 0.09, drift = 6, at = 0, t,
    font = DISPLAY }) {
    const lt = useLocalTime(t);
    const o = e3((lt - at) / 0.8);
    return (
      <div data-bleed="" style={{ position: 'absolute', left: x, top: y, pointerEvents: 'none',
        transform: `translate(-50%, -50%) translateY(${-lt * drift}px)`, fontFamily: font, fontWeight: 800,
        fontSize: size, lineHeight: 1, letterSpacing: '-0.05em', whiteSpace: 'nowrap', color: tone(color),
        opacity: opacity * o }}>{text}</div>
    );
  }

  // ── Text ────────────────────────────────────────────────────────────────────
  // Parse "Make *one* video|in a minute" → lines of words; *word* = accent.
  function parseWords(text) {
    return String(text == null ? '' : text).split(/\n|\|/).map((line) => line.trim().split(/\s+/).filter(Boolean)
      .map((w) => {
        const m = /^\*(.+)\*([.,!?:;]*)$/.exec(w);
        return m ? { w: m[1] + m[2], accent: true } : { w, accent: false };
      }));
  }

  // Display title, revealed word by word. `ats` = per-word cue times (optional).
  function Title({ text, children, at = 0, ats, stagger = 0.08, size = 64, weight = 800, color = TEXT, accent = 'gradient',
    align = 'center', width = 520, lineHeight = 1.08, enter: en = 'mask', font = DISPLAY, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const lines = parseWords(text != null ? text : children);
    let k = 0;
    let prevAt = at - stagger;
    const accentStyle = accent === 'gradient'
      ? { backgroundImage: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
      : { color: tone(accent) };
    return (
      <div style={{ ...place(x, y, z), pointerEvents: 'none' }}>
        <div style={{ width, textAlign: align, fontFamily: font, fontWeight: weight, fontSize: size, lineHeight,
          letterSpacing: '-0.025em', color, textWrap: 'balance', textShadow: TS, ...style }}>
          {lines.map((words, li) => (
            <div key={li}>
              {words.map((wd, wi) => {
                const i = k++;
                // per-word cue, else follow the previous word by `stagger`
                const wat = ats && ats[i] != null ? ats[i] : prevAt + stagger;
                prevAt = wat;
                const dt = lt - wat;
                const look = wd.accent ? { ...accentStyle, textShadow: 'none' } : null;
                if (en === 'mask') {
                  const p = dt >= 0 ? e3(dt / 0.5) : 0;
                  return (
                    <React.Fragment key={wi}>
                      {wi > 0 && ' '}
                      <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top',
                        padding: '0 0.04em 0.14em', margin: '0 -0.04em -0.14em' }}>
                        <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 105}%)`,
                          opacity: dt >= 0 ? 1 : 0, ...look }}>{wd.w}</span>
                      </span>
                    </React.Fragment>
                  );
                }
                return (
                  <React.Fragment key={wi}>
                    {wi > 0 && ' '}
                    <span style={{ display: 'inline-block', ...entry(en, dt), ...look }}>{wd.w}</span>
                  </React.Fragment>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Small uppercase label above a title: "EPISODE 01 · INSTALL".
  function Kicker({ children, label, at = 0, color = CYAN, size = 22, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const dt = lt - at;
    const bar = dt >= 0 ? e3(dt / 0.4) : 0;
    return (
      <div style={place(x, y, z)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: dt >= 0 ? 1 : 0, ...style }}>
          <div style={{ width: 34 * bar, height: 3, borderRadius: 2, background: GRAD }} />
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: size, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: tone(color), whiteSpace: 'nowrap', ...enter.wipe(dt - 0.08, 0.5) }}>
            {children != null ? children : label}
          </div>
        </div>
      </div>
    );
  }

  // Inline typewriter text. Use inside your own boxes (cards, prompts, labels).
  function Typed({ text = '', at = 0, speed = 28, cursor = true, cursorColor = CYAN, bar = false, t, style }) {
    const lt = useLocalTime(t);
    const s = String(text);
    const n = clamp(Math.floor((lt - at) * speed), 0, s.length);
    const typing = n < s.length;
    const on = lt >= at && (typing || Math.floor(lt * 2) % 2 === 0);
    return (
      <span style={{ whiteSpace: 'pre-wrap', ...style }}>
        {s.slice(0, n)}
        {cursor && (
          <span style={{ display: 'inline-block', width: bar ? 3 : '0.58em', height: '1.12em', marginLeft: bar ? 3 : 2,
            verticalAlign: '-0.2em', background: tone(cursorColor), opacity: on ? 1 : 0, borderRadius: bar ? 2 : 1 }} />
        )}
      </span>
    );
  }

  // ── Small pieces ────────────────────────────────────────────────────────────
  function Chip({ children, label, at = 0, icon, color = VIOLET, variant = 'soft', mono = false, size = 24,
    enter: en = 'pop', t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const c = tone(color);
    const looks = {
      soft: { background: alpha(c, 0.14), border: `1.5px solid ${alpha(c, 0.55)}` },
      solid: { background: c, border: `1.5px solid ${c}`, color: INK },
      outline: { background: 'rgba(11,15,25,0.6)', border: `1.5px solid ${alpha(c, 0.8)}` },
      ghost: { background: CARD, border: `1.5px solid ${CARD_BORDER}` },
    };
    return (
      <div style={place(x, y, z)}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.42),
          padding: `${Math.round(size * 0.36)}px ${Math.round(size * 0.8)}px`, borderRadius: 999,
          fontFamily: mono ? MONO : SANS, fontWeight: 600, fontSize: size, lineHeight: 1.15, color: TEXT,
          whiteSpace: 'nowrap', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', ...looks[variant], ...entry(en, lt - at), ...style }}>
          {icon && <Icon name={icon} size={Math.round(size * 1.05)} color={variant === 'solid' ? INK : c} />}
          <span>{children != null ? children : label}</span>
        </div>
      </div>
    );
  }

  // variant: violet | cyan | ok | warn | danger | ghost (or any hex colour)
  function Badge({ children, label, variant = 'violet', at = 0, icon, size = 22, mono = false, upper = true,
    enter: en = 'pop', t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const ghost = variant === 'ghost';
    const c = tone(variant);
    return (
      <div style={place(x, y, z)}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: `${Math.round(size * 0.3)}px ${Math.round(size * 0.55)}px`,
          borderRadius: 10, fontFamily: mono ? MONO : SANS, fontWeight: 600, fontSize: size, lineHeight: 1.1,
          letterSpacing: upper && !mono ? '0.08em' : 0, textTransform: upper && !mono ? 'uppercase' : 'none',
          whiteSpace: 'nowrap', color: ghost ? TEXT : mix(c, '#FFFFFF', 0.25),
          background: ghost ? 'rgba(255,255,255,0.04)' : alpha(c, 0.16),
          border: `1.5px solid ${ghost ? 'rgba(255,255,255,0.22)' : alpha(c, 0.5)}`, ...entry(en, lt - at), ...style }}>
          {icon && <Icon name={icon} size={Math.round(size * 1.05)} color={ghost ? TEXT : c} />}
          <span>{children != null ? children : label}</span>
        </div>
      </div>
    );
  }

  // Generic card (glass on ink). Most kit components use it; use it for your own content too.
  function Card({ children, at = 0, width, padding = 26, title, icon, color = VIOLET, glowAt, enter: en = 'slideUp',
    titleMono = false, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const g = glowAt != null && lt >= glowAt ? e3((lt - glowAt) / 0.35) : 0;
    return (
      <div style={place(x, y, z)}>
        <div style={{ width, padding, borderRadius: 22, background: CARD, position: 'relative',
          border: `1px solid ${g > 0 ? alpha(color, 0.25 + 0.45 * g) : CARD_BORDER}`,
          boxShadow: `${SHADOW}, inset 0 1px 0 rgba(255,255,255,0.05)${g > 0 ? `, 0 0 ${44 * g}px ${alpha(color, 0.35 * g)}` : ''}`,
          ...entry(en, lt - at), ...style }}>
          {title && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, fontFamily: titleMono ? MONO : SANS,
              fontWeight: 600, fontSize: titleMono ? 22 : 20, letterSpacing: titleMono ? 0 : '0.14em',
              textTransform: titleMono ? 'none' : 'uppercase', color: MUTED }}>
              {icon && <Icon name={icon} size={22} color={color} />}
              <span>{title}</span>
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }

  function Callout({ icon = 'info', color = CYAN, title, children, text, at = 0, width = 520, enter: en = 'wipe',
    t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const c = tone(color);
    return (
      <div style={place(x, y, z)}>
        <div style={{ width, display: 'flex', alignItems: 'flex-start', gap: 18, padding: '20px 24px', borderRadius: 18,
          background: `linear-gradient(90deg, ${alpha(c, 0.14)}, ${alpha(c, 0.04)})`, border: `1px solid ${alpha(c, 0.35)}`,
          boxShadow: `inset 4px 0 0 ${c}, 0 16px 40px rgba(0,0,0,0.3)`, ...entry(en, lt - at), ...style }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, flexShrink: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: alpha(c, 0.18) }}>
            {typeof icon === 'string' ? <Icon name={icon} size={30} color={c} /> : icon}
          </div>
          <div style={{ minWidth: 0, paddingTop: 2 }}>
            {title && <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 26, color: TEXT, lineHeight: 1.25 }}>{title}</div>}
            {(children != null || text != null) && (
              <div style={{ fontFamily: SANS, fontWeight: 400, fontSize: 24, color: MUTED, lineHeight: 1.4, marginTop: title ? 4 : 6 }}>
                {children != null ? children : text}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function Tile({ icon, title, sub, color = VIOLET, at = 0, activeAt, width = 250, height, enter: en = 'pop',
    t, x, y, z, style, children }) {
    const lt = useLocalTime(t);
    const c = tone(color);
    const a = activeAt != null && lt >= activeAt ? e3((lt - activeAt) / 0.3) : 0;
    return (
      <div style={place(x, y, z)}>
        <div style={{ width, height, padding: '22px 22px 20px', borderRadius: 22, background: CODE_BG,
          border: `1.5px solid ${alpha(c, 0.3 + 0.5 * a)}`,
          boxShadow: `${SHADOW}${a > 0 ? `, 0 0 ${40 * a}px ${alpha(c, 0.4 * a)}` : ''}`, ...entry(en, lt - at), ...style }}>
          {icon && (
            <div style={{ width: 54, height: 54, borderRadius: 15, display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: alpha(c, 0.18), marginBottom: 16 }}>
              {typeof icon === 'string' ? <Icon name={icon} size={30} color={c} /> : icon}
            </div>
          )}
          {title && <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, color: TEXT, lineHeight: 1.1 }}>{title}</div>}
          {sub && <div style={{ fontFamily: SANS, fontWeight: 400, fontSize: 22, color: MUTED, lineHeight: 1.35, marginTop: 8 }}>{sub}</div>}
          {children}
        </div>
      </div>
    );
  }

  // Rotated rubber stamp that punches in: "NOT SPOKEN", "EXPIRED", "NEVER".
  function Stamp({ children, label, at = 0, color = DANGER, rotate = -12, size = 44, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const dt = lt - at;
    const c = tone(color);
    if (!(dt >= 0)) return <div style={{ ...place(x, y, z), opacity: 0 }} />;
    const s = sp(dt, PUNCH.k, PUNCH.d);
    const scale = 2.3 - 1.3 * s;
    const ring = e3((dt - 0.1) / 0.55);
    return (
      <div style={place(x, y, z)}>
        <div style={{ position: 'relative', display: 'inline-block', transform: `rotate(${rotate}deg) scale(${scale})`,
          opacity: clamp(dt / 0.08, 0, 1), ...style }}>
          {dt > 0.1 && ring < 1 && (
            <div style={{ position: 'absolute', inset: -10, borderRadius: 18, border: `3px solid ${c}`,
              transform: `scale(${1 + ring * 0.5})`, opacity: 0.7 * (1 - ring) }} />
          )}
          <div style={{ padding: '8px 24px 10px', borderRadius: 14, border: `5px solid ${c}`, background: alpha(c, 0.1),
            boxShadow: `inset 0 0 0 3px ${INK}, inset 0 0 0 5px ${alpha(c, 0.7)}, 0 0 30px ${alpha(c, 0.25)}`,
            fontFamily: DISPLAY, fontWeight: 800, fontSize: size, letterSpacing: '0.08em', textTransform: 'uppercase',
            lineHeight: 1.1, color: c, whiteSpace: 'nowrap' }}>{children != null ? children : label}</div>
        </div>
      </div>
    );
  }

  // Strike-through that grows across its children at `at`; the text dims under it.
  function Strike({ children, at = 0, color = DANGER, thickness = 6, rotate = -3, dim = 0.5, dur = 0.4, t, style }) {
    const lt = useLocalTime(t);
    const p = lt >= at ? eio((lt - at) / dur) : 0;
    return (
      <span style={{ position: 'relative', display: 'inline-block', ...style }}>
        <span style={{ opacity: 1 - (1 - dim) * p }}>{children}</span>
        <span style={{ position: 'absolute', left: '-3%', top: '52%', height: thickness, width: `${p * 106}%`,
          marginTop: -thickness / 2, borderRadius: thickness, background: tone(color), transform: `rotate(${rotate}deg)`,
          transformOrigin: 'left center', boxShadow: `0 0 16px ${alpha(color, 0.6)}` }} />
      </span>
    );
  }

  // Count-up numeral: value (target), from (start value), at (start time), dur.
  function Counter({ value = 100, from = 0, at = 0, dur = 1.2, decimals = 0, prefix = '', suffix = '', format,
    size = 180, weight = 800, color = TEXT, gradient = false, font = DISPLAY, enter: en = 'blur', t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const n = from + (value - from) * e3((lt - at) / Math.max(0.01, dur));
    const txt = format ? format(n) : `${prefix}${decimals ? n.toFixed(decimals) : Math.round(n)}${suffix}`;
    const look = gradient
      ? { backgroundImage: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
      : { color: tone(color), textShadow: TS };
    return (
      <div style={place(x, y, z)}>
        <div style={{ fontFamily: font, fontWeight: weight, fontSize: size, lineHeight: 1, letterSpacing: '-0.04em',
          fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', ...look, ...entry(en, lt - at), ...style }}>{txt}</div>
      </div>
    );
  }

  // Fill from `at` (alias `from`) to `until` (alias `to`), both times. value = final fill 0..1.
  function ProgressBar({ at, until, from, to, value = 1, width = 520, height = 16, label, pct = true, color,
    ease = Easing.easeInOutSine, enter: en = 'slideUp', t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const a = num(at != null ? at : from, 0);
    const b = num(until != null ? until : to, a + 1.5);
    const p = value * ease(clamp((lt - a) / Math.max(0.01, b - a), 0, 1));
    const fill = color ? tone(color) : null;
    return (
      <div style={place(x, y, z)}>
        <div style={{ width, ...entry(en, lt - a), ...style }}>
          {(label || pct) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <span style={{ fontFamily: SANS, fontWeight: 500, fontSize: 24, color: TEXT }}>{label}</span>
              {pct && <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 24, color: CYAN,
                fontVariantNumeric: 'tabular-nums' }}>{Math.round(p * 100)}%</span>}
            </div>
          )}
          <div style={{ position: 'relative', height, borderRadius: height, background: 'rgba(255,255,255,0.08)',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p * 100}%`, borderRadius: height,
              background: fill || GRAD, boxShadow: `0 0 18px ${alpha(fill || CYAN, 0.55)}` }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: height, opacity: p < value ? 0.35 : 0,
                backgroundImage: 'repeating-linear-gradient(115deg, rgba(255,255,255,0.5) 0 10px, rgba(255,255,255,0) 10px 22px)',
                backgroundSize: '48px 100%', backgroundPosition: `${(lt * 60) % 48}px 0` }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Circular progress dial with centred children (e.g. a small <Counter>).
  function Ring({ at = 0, until, value = 1, size = 240, stroke = 16, color = CYAN, color2 = VIOLET, children,
    enter: en = 'pop', t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const gid = 'rg' + React.useId().replace(/[^a-zA-Z0-9]/g, '');
    const b = num(until, at + 1.2);
    const p = value * eio((lt - at) / Math.max(0.01, b - at));
    const r = (size - stroke) / 2;
    const C = 2 * Math.PI * r;
    return (
      <div style={place(x, y, z)}>
        <div style={{ position: 'relative', width: size, height: size, ...entry(en, lt - at), ...style }}>
          <svg width={size} height={size} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={tone(color2)} />
                <stop offset="100%" stopColor={tone(color)} />
              </linearGradient>
            </defs>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${gid})`} strokeWidth={stroke}
              strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - p)} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center' }}>{children}</div>
        </div>
      </div>
    );
  }

  // ── Windows ─────────────────────────────────────────────────────────────────
  function TitleBar({ title, icon, right, url }) {
    return (
      <div style={{ position: 'relative', height: 50, display: 'flex', alignItems: 'center', padding: '0 18px',
        background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <div key={c} style={{ width: 13, height: 13, borderRadius: '50%', background: c, opacity: 0.9 }} />
          ))}
        </div>
        {url != null ? (
          <div style={{ flex: 1, margin: '0 16px 0 18px', height: 32, borderRadius: 9, background: 'rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', fontFamily: MONO, fontSize: 18, color: MUTED,
            whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <Icon name="lock" size={16} color={FAINT} stroke={2.4} />
            <span>{url}</span>
          </div>
        ) : (
          <div style={{ position: 'absolute', left: 90, right: 90, top: 0, bottom: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 8, fontFamily: SANS, fontWeight: 500, fontSize: 20, color: MUTED,
            whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {icon && <Icon name={icon} size={18} color={FAINT} stroke={2.4} />}
            <span>{title}</span>
          </div>
        )}
        {right && <div style={{ marginLeft: 'auto', position: 'relative', zIndex: 1 }}>{right}</div>}
      </div>
    );
  }

  // macOS-style window chrome. Terminal, CodeCard and BrowserFrame are built on it.
  function Window({ title, icon, right, url, width = 580, height, children, accent = true, at = 0, enter: en = 'rise',
    padding = '22px 28px 26px', bodyStyle, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    return (
      <div style={place(x, y, z)}>
        <div style={{ width, borderRadius: 22, background: CODE_BG, border: `1px solid ${CARD_BORDER}`, position: 'relative',
          boxShadow: `${SHADOW}, inset 0 1px 0 rgba(255,255,255,0.05)`, overflow: 'hidden', ...entry(en, lt - at), ...style }}>
          {accent && <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 2, zIndex: 2,
            background: accent === true ? GRAD : tone(accent), opacity: 0.9 }} />}
          <TitleBar title={title} icon={icon} right={right} url={url} />
          <div style={{ position: 'relative', padding, height, ...bodyStyle }}>{children}</div>
        </div>
      </div>
    );
  }

  function BrowserFrame({ url = 'localhost:4310', width = 600, height = 560, children, at = 0, enter: en = 'rise',
    t, x, y, z, style }) {
    return (
      <Window url={url} width={width} height={height} at={at} enter={en} t={t} x={x} y={y} z={z} style={style}
        padding={0} bodyStyle={{ overflow: 'hidden', background: '#0C1120' }}>{children}</Window>
    );
  }

  // ── Terminal ────────────────────────────────────────────────────────────────
  const STATUS = {
    ok: { icon: 'check', color: OK }, warn: { icon: 'warn', color: WARN }, err: { icon: 'x', color: DANGER },
    bad: { icon: 'x', color: DANGER }, info: { icon: 'arrow', color: CYAN },
  };

  function Terminal({ title = 'zsh', command, at = 0, rows = [], steps, prompt = '$', speed = 28, width = 580,
    height, fontSize = 24, lineHeight = 1.5, showAt, finalPrompt = false, cursorColor = CYAN, enter: en = 'rise',
    accent = true, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    // Normalise to steps: [{ cmd, at } | { out, at, status, right, color, dim }]
    let list = null;
    if (steps) {
      let prevEnd = at;
      list = steps.map((st, i) => {
        const isCmd = st.cmd != null;
        const sa = st.at != null ? st.at : i === 0 ? at : prevEnd + (isCmd ? 0.4 : 0.18);
        prevEnd = isCmd ? sa + typeDuration(st.cmd, speed) : sa;
        return isCmd ? { ...st, cmd: String(st.cmd), at: sa } : { ...st, out: st.out != null ? st.out : st.text, at: sa };
      });
    } else {
      list = [];
      if (command != null) list.push({ cmd: String(command), at });
      const cmdEnd = command != null ? at + typeDuration(command, speed) : at;
      rows.forEach((r, i) => {
        const row = typeof r === 'string' ? { text: r } : r;
        list.push({ ...row, out: row.text != null ? row.text : row.out,
          at: row.at != null ? row.at : cmdEnd + 0.3 + i * 0.18 });
      });
    }
    const pad = 28;
    const lh = fontSize * lineHeight;
    const cpl = Math.max(8, Math.floor((width - pad * 2) / (fontSize * 0.6)));
    const first = list.length ? Math.min(...list.map((s) => num(s.at, Infinity))) : at;
    const open = showAt != null ? showAt : Math.max(0, first - 0.4);
    const visible = list.filter((s, i) => lt >= (i === 0 && s.cmd != null ? open : s.at));
    const lastStep = visible[visible.length - 1];
    const blink = Math.floor(lt * 2) % 2 === 0;
    const cursor = (on) => (
      <span style={{ display: 'inline-block', width: '0.6em', height: '1.15em', verticalAlign: '-0.22em', marginLeft: 1,
        background: tone(cursorColor), opacity: on ? 0.95 : 0, borderRadius: 2 }} />
    );
    const lines = visible.map((s, i) => {
      const dt = lt - s.at;
      if (s.cmd != null) {
        const n = clamp(Math.floor(dt * speed), 0, s.cmd.length);
        const typing = dt >= 0 && n < s.cmd.length;
        const mine = s === lastStep;
        return (
          <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', minHeight: lh }}>
            <span style={{ color: tone(s.promptColor || CYAN), fontWeight: 600 }}>{s.prompt != null ? s.prompt : prompt}</span>
            <span style={{ color: CODE.text }}>{' '}{s.cmd.slice(0, n)}</span>
            {mine && cursor(typing || blink)}
          </div>
        );
      }
      const st = STATUS[s.status];
      const text = String(s.out == null ? '' : s.out);
      const chars = text.length + (st ? 2 : 0) + (s.right ? String(s.right).length + 2 : 0);
      const nLines = Math.max(1, Math.ceil(chars / cpl));
      const g = e3(dt / 0.22);
      const color = s.color ? tone(s.color) : s.dim ? FAINT : st ? TEXT : MUTED;
      return (
        <div key={i} style={{ height: g < 1 ? nLines * lh * g : 'auto', overflow: g < 1 ? 'hidden' : 'visible' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5em', opacity: e3(dt / 0.25),
            transform: `translateY(${(1 - g) * 8}px)`, color, fontWeight: s.bold ? 600 : 400 }}>
            {st && (
              <span style={{ height: lh, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <Icon name={st.icon} size={Math.round(fontSize * 0.9)} color={st.color} stroke={2.8} />
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{text}</span>
            {s.right != null && <span style={{ flexShrink: 0, color: st ? st.color : FAINT, whiteSpace: 'nowrap' }}>{s.right}</span>}
          </div>
        </div>
      );
    });
    let tail = null;
    if (finalPrompt && lastStep) {
      const endAt = lastStep.at + (lastStep.cmd != null ? typeDuration(lastStep.cmd, speed) : 0) + 0.35;
      if (lt >= endAt && (lastStep !== list[list.length - 1] ? false : true)) {
        tail = (
          <div style={{ minHeight: lh }}>
            <span style={{ color: CYAN, fontWeight: 600 }}>{prompt}</span>{' '}{cursor(blink)}
          </div>
        );
      }
    }
    const body = (
      <div style={{ fontFamily: MONO, fontSize, lineHeight: `${lh}px`, color: CODE.text, minHeight: lh }}>
        {lines}
        {tail}
      </div>
    );
    return (
      <Window title={title} icon="terminal" width={width} at={open} enter={en} accent={accent} t={lt} x={x} y={y} z={z}
        style={style} padding={`20px ${pad}px 24px`}
        bodyStyle={height ? { height, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' } : null}>
        {height ? <div style={{ minHeight: height - 44 }}>{body}</div> : body}
      </Window>
    );
  }

  // Agent prompt box ("make me a video about prompt caching"), typed, then sent.
  function PromptBox({ text = '', at = 0, speed = 24, label = 'Claude Code', placeholder = 'Ask your agent…',
    width = 580, sendAt, showAt, fontSize = 26, enter: en = 'rise', t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const open = showAt != null ? showAt : Math.max(0, at - 0.4);
    const typedEnd = at + typeDuration(text, speed);
    const typing = lt >= at && lt < typedEnd;
    const sent = sendAt != null && lt >= sendAt;
    const press = sent ? 1 - 0.14 * Math.sin(Math.PI * clamp((lt - sendAt) / 0.25, 0, 1)) : 1;
    const ready = lt >= typedEnd;
    return (
      <div style={place(x, y, z)}>
        <div style={{ width, borderRadius: 26, background: CODE_BG, padding: '18px 22px 16px',
          border: `1.5px solid ${alpha(VIOLET, typing || ready ? 0.65 : 0.3)}`,
          boxShadow: `${SHADOW}, 0 0 ${typing ? 36 : 18}px ${alpha(VIOLET, typing ? 0.35 : 0.15)}`,
          ...entry(en, lt - open), ...style }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: SANS, fontWeight: 600, fontSize: 20,
            color: MUTED, marginBottom: 12 }}>
            <Icon name="sparkle" size={22} color={VIOLET} />
            <span>{label}</span>
          </div>
          <div style={{ display: 'flex', gap: 12, fontFamily: SANS, fontWeight: 500, fontSize, lineHeight: 1.4, minHeight: fontSize * 1.4 }}>
            <span style={{ color: CYAN, fontFamily: MONO, fontWeight: 600 }}>›</span>
            <span style={{ flex: 1, minWidth: 0, color: lt >= at ? TEXT : FAINT }}>
              {lt >= at ? <Typed text={text} at={at} speed={speed} t={lt} bar cursorColor={VIOLET} /> : placeholder}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: ready ? GRAD_DIAG : 'rgba(255,255,255,0.08)', transform: `scale(${press})`,
              boxShadow: sent ? `0 0 24px ${alpha(VIOLET, 0.6)}` : 'none' }}>
              <Icon name="send" size={22} color={ready ? '#FFFFFF' : FAINT} stroke={2.2} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Code ────────────────────────────────────────────────────────────────────
  const KW = /^(const|let|var|function|return|async|await|module|exports|require|import|from|export|default|new|if|else|for|of|in|while|class|extends|this|typeof)$/;
  const LIT = /^(true|false|null|undefined|NaN|Infinity)$/;
  const HASH_LANGS = /^(sh|bash|zsh|shell|console|yaml|yml|py|python|env|dotenv|toml|ini|conf|txt|text|gitignore)$/;

  function tokenizeMd(text) {
    if (/^\s*#{1,6}\s/.test(text)) return [{ s: text, c: CODE.head, b: true }];
    if (/^\s*>/.test(text)) return [{ s: text, c: CODE.cm, i: true }];
    if (/^\s*(---|\*\*\*)\s*$/.test(text)) return [{ s: text, c: CODE.cm }];
    const segs = [];
    let rest = text;
    const fm = /^([A-Za-z_][\w-]*)(:)(\s.*|$)/.exec(text);
    if (fm) {
      segs.push({ s: fm[1], c: CODE.prop }, { s: ':', c: CODE.punct });
      rest = fm[3];
    } else {
      const li = /^(\s*(?:[-*+]|\d+\.)\s)(.*)$/.exec(text);
      if (li) { segs.push({ s: li[1], c: CODE.fn }); rest = li[2]; }
    }
    const re = /(`[^`]*`)|(\*\*[^*]+\*\*)|([^`*]+|\*)/g;
    let m;
    while ((m = re.exec(rest))) {
      if (m[1]) segs.push({ s: m[1], c: CODE.fn });
      else if (m[2]) segs.push({ s: m[2], c: TEXT, b: true });
      else segs.push({ s: m[3], c: CODE.text });
    }
    return segs;
  }

  // tokenize(line, lang) → [{ s, c, b?, i? }] — a small, forgiving highlighter.
  function tokenize(text, lang) {
    const L = String(lang || '').toLowerCase();
    if (L === 'md' || L === 'markdown') return tokenizeMd(text);
    if (L === 'plain' || L === 'none') return [{ s: text, c: CODE.text }];
    const hash = HASH_LANGS.test(L);
    if (L === 'env' || L === 'dotenv' || L === 'ini') {
      const kv = /^(\s*)([A-Za-z_][\w.-]*)(\s*=\s*)(.*)$/.exec(text);
      if (kv && !/^\s*#/.test(text)) {
        return [{ s: kv[1] + kv[2], c: CODE.prop }, { s: kv[3], c: CODE.punct }, { s: kv[4], c: CODE.str }];
      }
    }
    const segs = [];
    const re = /(\/\/.*$)|(#.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(--?[A-Za-z][\w-]*)|(\b\d[\d_.]*\b)|(<\/?[A-Za-z][\w.-]*)|([A-Za-z_$][\w$]*)|(\s+)|([^\s])/g;
    let m;
    let first = true;
    while ((m = re.exec(text))) {
      const [tok, slash, hashC, str, flag, n, tag, id, ws] = m;
      const next = text.slice(re.lastIndex).match(/^\s*(\S)/);
      if (slash && !hash) segs.push({ s: tok, c: CODE.cm, i: true });
      else if (slash) { segs.push({ s: '/', c: CODE.punct }); re.lastIndex = m.index + 1; }
      else if (hashC && hash) segs.push({ s: tok, c: CODE.cm, i: true });
      else if (hashC) { segs.push({ s: '#', c: CODE.punct }); re.lastIndex = m.index + 1; }
      else if (str) segs.push({ s: tok, c: next && next[1] === ':' && !hash ? CODE.prop : CODE.str });
      else if (flag && (hash || L === '')) segs.push({ s: tok, c: CODE.flag });
      else if (flag) { segs.push({ s: tok[0], c: CODE.punct }); re.lastIndex = m.index + 1; }
      else if (n) segs.push({ s: tok, c: CODE.num });
      else if (tag) segs.push({ s: tok, c: CODE.tag });
      else if (id) {
        let c = CODE.text;
        if (KW.test(id) && !hash) c = CODE.kw;
        else if (LIT.test(id)) c = CODE.num;
        else if (hash && first) c = CODE.fn; // shell: the command itself
        else if (next && next[1] === '(') c = CODE.fn;
        else if (next && next[1] === ':' && !/^https?$/.test(id)) c = CODE.prop;
        else if (next && next[1] === '=' && (hash || (text[re.lastIndex] === '=' && text[re.lastIndex + 1] !== '='))) c = CODE.prop;
        segs.push({ s: tok, c });
      } else if (ws) segs.push({ s: tok, c: CODE.text });
      else segs.push({ s: tok, c: CODE.punct });
      if (!ws) first = false;
    }
    return segs;
  }

  const LANG_OF = { md: 'md', markdown: 'md', json: 'json', js: 'js', jsx: 'jsx', html: 'html', sh: 'sh', env: 'env',
    yml: 'yaml', yaml: 'yaml', py: 'py', txt: 'txt', ts: 'js', mjs: 'js', cjs: 'js', toml: 'toml' };
  function langOf(name) {
    const s = String(name || '');
    if (/(^|\/)\.env/.test(s)) return 'env';
    const m = /\.([A-Za-z0-9]+)$/.exec(s);
    return m ? LANG_OF[m[1].toLowerCase()] || m[1].toLowerCase() : '';
  }

  function Segs({ segs }) {
    return segs.map((g, i) => (
      <span key={i} style={{ color: g.c, fontWeight: g.b ? 600 : 400, fontStyle: g.i ? 'italic' : 'normal' }}>{g.s}</span>
    ));
  }

  // Code / file card. lines: string | { text, at, type, dim, color, segs, label }.
  // highlight: [lineIndex, ...] (glows once shown) or [{ line, at, until, color }].
  function CodeCard({ title = 'index.html', lang, lines = [], at = 0, stagger = 0.12, highlight = [], numbers = true,
    start = 1, fontSize = 24, lineHeight = 1.55, width = 600, speed = 30, badge, accent = true,
    enter: en = 'fromRight', t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const lg = lang != null ? lang : langOf(title);
    const hls = highlight.map((h) => (typeof h === 'number' ? { line: h } : h));
    const lh = Math.round(fontSize * lineHeight);
    const rows = lines.map((l, i) => {
      const L = typeof l === 'string' ? { text: l } : l;
      const la = L.at != null ? L.at : at + 0.25 + i * stagger;
      const dt = lt - la;
      const vis = dt >= 0;
      let hl = 0;
      let hc = VIOLET;
      for (const h of hls) {
        if (h.line !== i) continue;
        const ha = h.at != null ? h.at : la;
        const on = lt >= ha ? e3((lt - ha) / 0.25) : 0;
        const off = h.until != null && lt >= h.until ? e3((lt - h.until) / 0.25) : 0;
        const v = on * (1 - off);
        if (v > hl) { hl = v; hc = tone(h.color || VIOLET); }
      }
      const text = String(L.text == null ? '' : L.text);
      const shown = L.type ? text.slice(0, clamp(Math.floor(dt * speed), 0, text.length)) : text;
      const segs = L.segs || tokenize(shown, lg);
      const typingNow = L.type && vis && shown.length < text.length;
      return (
        <div key={i} style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', minHeight: lh,
          padding: '0 24px', background: hl > 0 ? alpha(hc, 0.16 * hl) : 'transparent',
          boxShadow: hl > 0 ? `inset ${4 * hl}px 0 0 ${hc}` : 'none',
          opacity: vis ? (L.dim ? 0.5 : 1) * e3(dt / 0.3) : 0, transform: `translateX(${vis ? (1 - e3(dt / 0.3)) * -12 : -12}px)` }}>
          {numbers && (
            <span style={{ width: 40, flexShrink: 0, textAlign: 'right', marginRight: 18, fontSize: Math.round(fontSize * 0.8),
              lineHeight: `${lh}px`, color: hl > 0.5 ? alpha(hc, 0.9) : 'rgba(245,247,255,0.28)' }}>{start + i}</span>
          )}
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: `${lh}px`,
            color: L.color ? tone(L.color) : CODE.text, textShadow: hl > 0.5 ? `0 0 18px ${alpha(hc, 0.35)}` : 'none' }}>
            {L.color ? shown : <Segs segs={segs} />}
            {typingNow && <span style={{ display: 'inline-block', width: '0.58em', height: '1.1em', verticalAlign: '-0.2em',
              background: CYAN, marginLeft: 1 }} />}
          </span>
          {L.label && (
            <span style={{ flexShrink: 0, marginLeft: 12, alignSelf: 'center' }}>
              <Badge variant={L.labelTone || 'cyan'} size={18} mono upper={false} t={lt} at={L.labelAt != null ? L.labelAt : la}>{L.label}</Badge>
            </span>
          )}
        </div>
      );
    });
    const rightSlot = badge != null ? badge : lg ? (
      <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, letterSpacing: '0.06em', color: CYAN,
        padding: '4px 9px', borderRadius: 7, background: alpha(CYAN, 0.12), border: `1px solid ${alpha(CYAN, 0.3)}`,
        textTransform: 'uppercase' }}>{lg}</span>
    ) : null;
    return (
      <Window title={title} icon="file" right={rightSlot} width={width} at={at} enter={en} accent={accent} t={lt}
        x={x} y={y} z={z} style={style} padding="16px 0 20px">
        <div style={{ fontFamily: MONO, fontSize }}>{rows}</div>
      </Window>
    );
  }

  // ── File tree ───────────────────────────────────────────────────────────────
  const FILE_TINT = { md: CYAN, json: WARN, html: VIOLET, jsx: VIOLET, js: VIOLET, mp4: OK, mp3: OK, wav: OK,
    env: DANGER, yaml: WARN, png: '#F472B6', jpg: '#F472B6', sh: OK };

  function FileGlyph({ kind, name, color, size = 26 }) {
    if (kind === 'dir') {
      const c = tone(color || VIOLET);
      return (
        <div style={{ position: 'relative', width: size, height: size * 0.78, marginTop: size * 0.12, flexShrink: 0 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: size * 0.46, height: size * 0.3, borderRadius: '4px 4px 0 0',
            background: mix(c, '#000000', 0.25) }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: size * 0.14, bottom: 0, borderRadius: 4,
            background: `linear-gradient(180deg, ${c}, ${mix(c, '#000000', 0.2)})`, boxShadow: `0 2px 10px ${alpha(c, 0.35)}` }} />
        </div>
      );
    }
    const c = tone(color || FILE_TINT[langOf(name)] || '#A5AEC8');
    const w = size * 0.78;
    const f = size * 0.3;
    return (
      <div style={{ position: 'relative', width: w, height: size, flexShrink: 0, margin: `0 ${(size - w) / 2}px` }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 4, background: alpha(c, 0.16), border: `2px solid ${c}`,
          clipPath: `polygon(0 0, calc(100% - ${f}px) 0, 100% ${f}px, 100% 100%, 0 100%)` }} />
        <div style={{ position: 'absolute', right: 0, top: 0, width: f, height: f,
          background: `linear-gradient(225deg, transparent 50%, ${c} 50%)`, borderRadius: '0 0 0 3px' }} />
        <div style={{ position: 'absolute', left: 5, right: 7, top: size * 0.5, height: 2, background: alpha(c, 0.7) }} />
        <div style={{ position: 'absolute', left: 5, right: 11, top: size * 0.68, height: 2, background: alpha(c, 0.5) }} />
      </div>
    );
  }

  // rows: [{ name, depth, kind: 'dir'|'file', at, badge, badgeVariant, note, hotAt, color }]
  function FileTree({ rows = [], at = 0, stagger = 0.14, title, width = 540, fontSize = 24, card = true,
    enter: en = 'fromLeft', t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const rowH = Math.round(fontSize * 1.8);
    const indent = 30;
    const R = rows.map((r) => ({ ...r, depth: r.depth || 0, kind: r.kind || (/\/$/.test(r.name) ? 'dir' : 'file') }));
    // Is there a later sibling at `depth` below row i (before the tree climbs above it)?
    const continues = (i, depth) => {
      for (let j = i + 1; j < R.length; j++) {
        if (R[j].depth < depth) return false;
        if (R[j].depth === depth) return true;
      }
      return false;
    };
    const items = R.map((r, i) => {
      const ra = r.at != null ? r.at : at + 0.2 + i * stagger;
      const dt = lt - ra;
      const hot = r.hotAt != null && lt >= r.hotAt ? e3((lt - r.hotAt) / 0.3) : 0;
      const guides = [];
      for (let d = 0; d < r.depth; d++) {
        const own = d === r.depth - 1;
        const cont = continues(i, d + 1);
        if (!own && !cont) continue;
        guides.push(
          <div key={d} style={{ position: 'absolute', left: d * indent + 13, top: 0, width: 2,
            height: own && !cont ? rowH / 2 : rowH, background: 'rgba(255,255,255,0.13)' }} />
        );
        if (own) guides.push(<div key={`h${d}`} style={{ position: 'absolute', left: d * indent + 13, top: rowH / 2 - 1,
          width: indent - 16, height: 2, background: 'rgba(255,255,255,0.13)' }} />);
      }
      return (
        <div key={i} style={{ position: 'relative', height: rowH, ...entry(en, dt) }}>
          {guides}
          <div style={{ position: 'absolute', left: r.depth * indent, right: 0, top: 0, bottom: 0, display: 'flex',
            alignItems: 'center', gap: 14, padding: '0 10px 0 2px', borderRadius: 10,
            background: hot > 0 ? alpha(CYAN, 0.12 * hot) : 'transparent',
            boxShadow: hot > 0 ? `inset 0 0 0 1px ${alpha(CYAN, 0.4 * hot)}` : 'none' }}>
            <FileGlyph kind={r.kind} name={r.name} color={r.color} size={Math.round(fontSize * 1.05)} />
            <span style={{ fontFamily: MONO, fontSize, fontWeight: r.kind === 'dir' ? 600 : 400, whiteSpace: 'nowrap',
              color: hot > 0.5 ? mix(TEXT, CYAN, 0.6) : r.kind === 'dir' ? TEXT : CODE.text }}>{r.name}</span>
            {r.badge && <Badge variant={r.badgeVariant || 'cyan'} size={18} t={lt} at={r.badgeAt != null ? r.badgeAt : ra + 0.15}>{r.badge}</Badge>}
            {r.note && <span style={{ marginLeft: 'auto', fontFamily: SANS, fontSize: 22, color: MUTED, whiteSpace: 'nowrap' }}>{r.note}</span>}
          </div>
        </div>
      );
    });
    const inner = <div style={{ position: 'relative' }}>{items}</div>;
    if (!card) return <div style={{ ...place(x, y, z), width, ...style }}>{inner}</div>;
    return (
      <Card width={width} at={at} t={lt} x={x} y={y} z={z} style={style} padding="22px 24px 18px" title={title}
        icon={title ? 'folder' : undefined} titleMono enter="slideUp">{inner}</Card>
    );
  }

  // ── Status rows (checklists, doctor output, take.json tables) ───────────────
  function StateIcon({ state, lt, at, size = 34 }) {
    const map = { ok: [OK, 'check'], warn: [WARN, 'warn'], bad: [DANGER, 'x'], err: [DANGER, 'x'], info: [CYAN, 'info'] };
    if (state === 'pending') {
      return (
        <div style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', border: `3px solid ${alpha(CYAN, 0.2)}`,
          borderTopColor: CYAN, transform: `rotate(${lt * 400}deg)` }} />
      );
    }
    const [c, ic] = map[state] || map.ok;
    const s = sp(lt - at, PUNCH.k, PUNCH.d);
    return (
      <div style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: alpha(c, 0.18), border: `1.5px solid ${alpha(c, 0.55)}`,
        transform: `scale(${0.4 + 0.6 * s})`, opacity: lt >= at ? 1 : 0 }}>
        <Icon name={ic} size={Math.round(size * 0.6)} color={c} stroke={3} />
      </div>
    );
  }

  // rows: [{ label, state: 'ok'|'warn'|'bad'|'pending', at, detail, doneAt }]
  // doneAt: show a spinner from `at` until doneAt, then the state.
  function StatusRows({ rows = [], at = 0, stagger = 0.2, title, width = 560, fontSize = 26, card = true,
    mono = false, enter: en = 'fromLeft', t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const items = rows.map((r, i) => {
      const ra = r.at != null ? r.at : at + 0.2 + i * stagger;
      const done = r.doneAt != null ? r.doneAt : ra + 0.12;
      const state = lt < done ? 'pending' : r.state || 'ok';
      const dc = { warn: WARN, bad: DANGER, err: DANGER }[r.state];
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0',
          borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none', ...entry(en, lt - ra) }}>
          <StateIcon state={state} lt={lt} at={done} />
          <span style={{ flex: 1, minWidth: 0, fontFamily: mono ? MONO : SANS, fontWeight: 500, fontSize, color: TEXT,
            lineHeight: 1.25 }}>{r.label}</span>
          {r.detail != null && (
            <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: Math.round(fontSize * 0.85), whiteSpace: 'nowrap',
              color: lt >= done && dc ? dc : MUTED, opacity: lt >= done ? 1 : 0.5 }}>{r.detail}</span>
          )}
        </div>
      );
    });
    const inner = <div>{items}</div>;
    if (!card) return <div style={{ ...place(x, y, z), width, ...style }}>{inner}</div>;
    return <Card width={width} at={at} t={lt} x={x} y={y} z={z} style={style} padding="16px 26px" title={title}
      icon={title ? 'check' : undefined} color={OK}>{inner}</Card>;
  }

  // ── Flow diagram ────────────────────────────────────────────────────────────
  // nodes: [{ id, label, sub, at, icon, color }] — each lights up at its `at`; the
  // connector into it draws during the 0.4 s before. `at` = when the dim skeleton shows.
  function FlowDiagram({ nodes = [], direction = 'vertical', at, nodeW, nodeH, gap = 44, width = 600, color = VIOLET,
    mono = true, steps = true, drawDur = 0.4, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const gid = 'fg' + React.useId().replace(/[^a-zA-Z0-9]/g, '');
    const n = nodes.length;
    const vert = direction !== 'horizontal';
    const NW = nodeW || (vert ? 420 : Math.floor((width - (n - 1) * gap) / Math.max(1, n)));
    const NH = nodeH || (vert ? 86 : 150);
    const W = vert ? NW : n * NW + (n - 1) * gap;
    const Ht = vert ? n * NH + (n - 1) * gap : NH;
    const ats = nodes.map((nd) => num(nd.at, Infinity));
    const show = at != null ? at : Math.max(0, Math.min(...ats) - 0.6);
    const pos = (i) => (vert ? { left: 0, top: i * (NH + gap) } : { left: i * (NW + gap), top: 0 });
    const links = [];
    for (let i = 1; i < n; i++) {
      const a = pos(i - 1);
      const b = pos(i);
      const x1 = vert ? NW / 2 : a.left + NW;
      const y1 = vert ? a.top + NH : NH / 2;
      const x2 = vert ? NW / 2 : b.left;
      const y2 = vert ? b.top : NH / 2;
      const end = ats[i];
      const p = eio((lt - (end - drawDur)) / drawDur);
      const hx = x1 + (x2 - x1) * p;
      const hy = y1 + (y2 - y1) * p;
      const c = tone(nodes[i].color || color);
      links.push(
        <g key={i}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.14)" strokeWidth={3} strokeDasharray="2 8"
            strokeLinecap="round" />
          {p > 0 && <line x1={x1} y1={y1} x2={hx} y2={hy} stroke={`url(#${gid})`} strokeWidth={4} strokeLinecap="round" />}
          {p > 0 && p < 1 && <circle cx={hx} cy={hy} r={11} fill={alpha(CYAN, 0.25)} />}
          {p > 0 && p < 1 && <circle cx={hx} cy={hy} r={5.5} fill={CYAN} />}
          {p >= 1 && [0, 0.5].map((o) => {
            const q = (lt * 0.9 + o + i * 0.17) % 1;
            return <circle key={o} cx={x1 + (x2 - x1) * q} cy={y1 + (y2 - y1) * q} r={3.5} fill={c}
              opacity={0.9 * Math.sin(Math.PI * q)} />;
          })}
        </g>
      );
    }
    return (
      <div style={place(x, y, z)}>
        <div style={{ position: 'relative', width: W, height: Ht, ...style }}>
          <svg width={W} height={Ht} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
            <defs>
              <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={vert ? 0 : W} y2={vert ? Ht : 0}>
                <stop offset="0%" stopColor={VIOLET} />
                <stop offset="100%" stopColor={CYAN} />
              </linearGradient>
            </defs>
            {links}
          </svg>
          {nodes.map((nd, i) => {
            const c = tone(nd.color || color);
            const dt = lt - ats[i];
            const lit = dt >= 0 ? e3(dt / 0.3) : 0;
            const scale = dt >= 0 ? 0.95 + 0.05 * sp(dt, PUNCH.k, PUNCH.d) : 0.95;
            const appear = enter.slideUp(lt - show - i * 0.06, 0.4, 18);
            return (
              <div key={nd.id || i} style={{ position: 'absolute', ...pos(i), width: NW, height: NH, ...appear }}>
                <div style={{ width: '100%', height: '100%', borderRadius: 20, transform: `scale(${scale})`,
                  display: 'flex', flexDirection: vert ? 'row' : 'column', alignItems: 'center',
                  justifyContent: vert ? 'flex-start' : 'center', gap: vert ? 18 : 10, padding: vert ? '0 22px' : '12px 8px',
                  background: lit > 0 ? `linear-gradient(135deg, ${alpha(c, 0.22 * lit)}, ${alpha(CODE_BG, 0.95)})` : 'rgba(255,255,255,0.03)',
                  border: `1.5px solid ${lit > 0 ? alpha(c, 0.3 + 0.55 * lit) : 'rgba(255,255,255,0.12)'}`,
                  boxShadow: lit > 0 ? `0 0 ${36 * lit}px ${alpha(c, 0.4 * lit)}, ${SHADOW}` : 'none' }}>
                  <div style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', background: lit > 0 ? alpha(c, 0.2 + 0.1 * lit) : 'rgba(255,255,255,0.05)' }}>
                    {nd.icon ? <Icon name={nd.icon} size={26} color={lit > 0.5 ? c : FAINT} />
                      : <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, color: lit > 0.5 ? c : FAINT }}>{i + 1}</span>}
                  </div>
                  <div style={{ minWidth: 0, textAlign: vert ? 'left' : 'center' }}>
                    <div style={{ fontFamily: mono ? MONO : SANS, fontWeight: 600, fontSize: vert ? 26 : 22, lineHeight: 1.2,
                      whiteSpace: 'nowrap', color: lit > 0.5 ? TEXT : FAINT }}>{nd.label}</div>
                    {nd.sub && <div style={{ fontFamily: SANS, fontSize: 20, color: lit > 0.5 ? MUTED : 'rgba(245,247,255,0.25)',
                      marginTop: 3, whiteSpace: 'nowrap' }}>{nd.sub}</div>}
                  </div>
                  {vert && steps && nd.icon && (
                    <div style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 20, color: lit > 0.5 ? alpha(c, 0.9) : FAINT }}>
                      {String(i + 1).padStart(2, '0')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Plugin dock ─────────────────────────────────────────────────────────────
  const SLOTS = {
    top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0],
    topLeft: [-1, -1], topRight: [1, -1], bottomLeft: [-1, 1], bottomRight: [1, 1],
  };
  const SLOT_ORDER = ['top', 'right', 'bottom', 'left', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

  // core: { label, sub, icon }; tiles: [{ label, sub, icon, color, at, slot, outAt }]
  function PluginDock({ core = { label: 'reelsmith', sub: 'core' }, tiles = [], at = 0, width = 620, height = 520,
    t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const cx = width / 2;
    const cy = height / 2;
    const CW = 230;
    const CH = 134;
    const TW = 156;
    const TH = 96;
    const offX = CW / 2 + 34 + TW / 2;
    const offY = CH / 2 + 50 + TH / 2;
    const docks = tiles.map((tl) => num(tl.at, Infinity) + 0.3);
    let pulse = 0;
    for (const d of docks) if (lt >= d) pulse = Math.max(pulse, Math.exp(-(lt - d) * 4));
    const coreIn = enter.pop(lt - at);
    const used = {};
    const tileEls = tiles.map((tl, i) => {
      const slot = tl.slot || SLOT_ORDER.find((s) => !used[s]) || 'top';
      used[slot] = true;
      const v = SLOTS[slot] || SLOTS.top;
      const tx = cx + v[0] * offX;
      const ty = cy + v[1] * offY;
      const c = tone(tl.color || VIOLET);
      const dt = lt - num(tl.at, Infinity);
      if (!(dt >= 0)) return null;
      const s = sp(dt, PUNCH.k, PUNCH.d);
      let dx = v[0] * 300 * (1 - s);
      let dy = v[1] * 300 * (1 - s);
      let rot = (1 - s) * 14 * (v[0] || 1);
      let op = clamp(dt / 0.15, 0, 1);
      if (tl.outAt != null && lt >= tl.outAt) {
        const e = e3((lt - tl.outAt) / 0.45);
        dx = v[0] * 280 * e;
        dy = (v[1] || -0.4) * 280 * e;
        rot = e * -18;
        op = 1 - e;
      }
      const docked = lt >= docks[i] && !(tl.outAt != null && lt >= tl.outAt);
      const flash = docked ? Math.exp(-(lt - docks[i]) * 5) : 0;
      const sockets = [];
      if (slot === 'left' || slot === 'right') {
        const x0 = slot === 'left' ? tx + TW / 2 : cx + CW / 2;
        sockets.push({ left: x0, top: cy - 3, width: 34, height: 6 });
      } else if (slot === 'top' || slot === 'bottom') {
        const y0 = slot === 'top' ? ty + TH / 2 : cy + CH / 2;
        sockets.push({ left: tx - 3, top: y0, width: 6, height: 50 });
      }
      return (
        <React.Fragment key={i}>
          {sockets.map((sk, j) => (
            <div key={j} style={{ position: 'absolute', ...sk, borderRadius: 4, opacity: op,
              background: docked ? c : 'rgba(255,255,255,0.12)', boxShadow: docked ? `0 0 ${12 + 20 * flash}px ${alpha(c, 0.8)}` : 'none' }} />
          ))}
          <div style={{ position: 'absolute', left: tx - TW / 2, top: ty - TH / 2, width: TW, height: TH, opacity: op,
            transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)` }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 20, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6, background: CODE_BG,
              border: `1.5px solid ${alpha(c, docked ? 0.85 : 0.45)}`,
              boxShadow: `${SHADOW}, 0 0 ${18 + 30 * flash}px ${alpha(c, 0.25 + 0.4 * flash)}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {tl.icon && <Icon name={tl.icon} size={24} color={c} />}
                <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 24, color: TEXT, whiteSpace: 'nowrap' }}>{tl.label}</span>
              </div>
              {tl.sub && <span style={{ fontFamily: SANS, fontSize: 18, color: MUTED, whiteSpace: 'nowrap' }}>{tl.sub}</span>}
            </div>
          </div>
        </React.Fragment>
      );
    });
    return (
      <div style={place(x, y, z)}>
        <div style={{ position: 'relative', width, height, ...style }}>
          {tileEls}
          <div style={{ position: 'absolute', left: cx - CW / 2, top: cy - CH / 2, width: CW, height: CH, ...coreIn }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 28, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6, border: '2px solid transparent',
              background: `linear-gradient(${CODE_BG}, ${CODE_BG}) padding-box, ${GRAD_DIAG} border-box`,
              boxShadow: `${SHADOW}, 0 0 ${40 + 40 * pulse}px ${alpha(VIOLET, 0.3 + 0.35 * pulse)}`,
              transform: `scale(${1 + 0.035 * pulse})` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name={core.icon || 'cog'} size={28} color={CYAN} />
                <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, color: TEXT, letterSpacing: '-0.02em' }}>{core.label}</span>
              </div>
              {core.sub && <span style={{ fontFamily: MONO, fontSize: 20, color: MUTED }}>{core.sub}</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Brand ───────────────────────────────────────────────────────────────────
  function Logo({ size = 64, at = 0, enter: en = 'pop', t, x, y, z, style }) {
    const lt = useLocalTime(t);
    return (
      <div style={place(x, y, z)}>
        <div style={{ width: size, height: size, borderRadius: size * 0.28, background: GRAD_DIAG, position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 10px 30px ${alpha(VIOLET, 0.45)}`,
          ...entry(en, lt - at), ...style }}>
          <div style={{ position: 'absolute', inset: size * 0.1, borderRadius: size * 0.2, border: `${Math.max(2, size * 0.04)}px solid rgba(255,255,255,0.35)` }} />
          <Icon name="play" size={size * 0.5} color="#FFFFFF" style={{ marginLeft: size * 0.05 }} />
        </div>
      </div>
    );
  }

  // Letter-by-letter spring pop. Colours run violet → cyan across the word.
  function Wordmark({ text = 'REELSMITH', at = 0, size = 76, stagger = 0.06, gradient = true, color = TEXT,
    underline = true, mark = false, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const letters = String(text).split('');
    const n = letters.length;
    const end = at + n * stagger + 0.1;
    const u = lt >= end ? e3((lt - end) / 0.5) : 0;
    return (
      <div style={place(x, y, z)}>
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', ...style }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.22 }}>
            {mark && <Logo size={size * 0.8} at={at - 0.05} t={lt} />}
            <div style={{ display: 'flex', fontFamily: DISPLAY, fontWeight: 800, fontSize: size, lineHeight: 1,
              letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
              {letters.map((ch, i) => {
                const dt = lt - at - i * stagger;
                const s = sp(dt, PUNCH.k, PUNCH.d);
                return (
                  <span key={i} style={{ display: 'inline-block', minWidth: ch === ' ' ? '0.3em' : undefined,
                    color: gradient ? mix(VIOLET, CYAN, n > 1 ? i / (n - 1) : 0) : color,
                    opacity: clamp(dt / 0.1, 0, 1), transformOrigin: '50% 80%',
                    transform: `translateY(${(1 - s) * 46}px) scale(${0.45 + 0.55 * s}) rotate(${(1 - s) * -14}deg)`,
                    textShadow: `0 6px 28px ${alpha(VIOLET, 0.35)}` }}>{ch}</span>
                );
              })}
            </div>
          </div>
          {underline && <div style={{ alignSelf: 'stretch', height: Math.max(4, size * 0.07), marginTop: size * 0.22,
            borderRadius: 4, background: GRAD, transform: `scaleX(${u})`, transformOrigin: 'left center',
            boxShadow: `0 0 20px ${alpha(CYAN, 0.5)}` }} />}
        </div>
      </div>
    );
  }

  // ── Audio ───────────────────────────────────────────────────────────────────
  // active: [from, to] window when the voice is "speaking" (bars dance); sweep:
  // [from, to] playhead that colours bars left → right like a player.
  function Waveform({ bars = 40, width = 520, height = 120, seed = 7, active, sweep, at = 0, color = CYAN,
    color2 = VIOLET, gap = 5, speed = 1, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const shape = React.useMemo(() => {
      const r = seededRandom(seed);
      return Array.from({ length: bars }, (_, i) => {
        const env = 0.45 + 0.55 * Math.sin(Math.PI * (i + 0.5) / bars);
        return { base: (0.3 + 0.7 * r()) * env, f: 4.2 + 4 * r(), ph: r() * Math.PI * 2 };
      });
    }, [bars, seed]);
    const [a0, a1] = active || [at, Infinity];
    const amt = lt >= a0 ? e3((lt - a0) / 0.25) * (lt >= a1 ? 1 - e3((lt - a1) / 0.4) : 1) : 0;
    const prog = sweep ? clamp((lt - sweep[0]) / Math.max(0.01, sweep[1] - sweep[0]), 0, 1) : null;
    const bw = (width - gap * (bars - 1)) / bars;
    return (
      <div style={place(x, y, z)}>
        <div style={{ position: 'relative', width, height, display: 'flex', alignItems: 'center', gap, ...style }}>
          {shape.map((b, i) => {
            const grow = e3((lt - at - Math.abs(i - bars / 2) * 0.012) / 0.35);
            const mod = 0.3 + 0.7 * Math.abs(Math.sin(lt * b.f * speed + b.ph));
            const h = Math.max(bw, height * b.base * (0.14 + (mod - 0.14) * amt) * grow);
            const lit = prog == null ? 0.35 + 0.65 * amt : i / bars <= prog ? 1 : 0.22;
            const c = prog != null && i / bars > prog ? 'rgba(255,255,255,0.35)' : mix(color2, color, i / Math.max(1, bars - 1));
            return <div key={i} style={{ width: bw, height: h, borderRadius: bw, background: c, opacity: lit * (grow > 0 ? 1 : 0) }} />;
          })}
          {prog != null && prog > 0 && prog < 1 && (
            <div style={{ position: 'absolute', left: prog * width - 1.5, top: -10, bottom: -10, width: 3, borderRadius: 2,
              background: TEXT, boxShadow: `0 0 12px ${alpha(CYAN, 0.8)}` }} />
          )}
        </div>
      </div>
    );
  }

  // Clip timeline. clips: [{ label, dur, color, at, cutAt }] — cutAt flashes the clip
  // red, then collapses it and the rest slides left. playhead: { at, until }.
  function Timeline({ clips = [], width = 580, height = 66, gap = 8, at = 0, stagger = 0.12, playhead, ruler = true,
    fontSize = 20, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const total = clips.reduce((s, c) => s + (c.dur || 1), 0);
    const scale = (width - gap * Math.max(0, clips.length - 1)) / Math.max(0.001, total);
    let cursor = 0;
    const els = clips.map((c, i) => {
      const ca = c.at != null ? c.at : at + 0.2 + i * stagger;
      const col = tone(c.color || (i % 2 ? CYAN : VIOLET));
      const cut = c.cutAt != null && lt >= c.cutAt;
      const collapse = cut ? sp(lt - c.cutAt - 0.35, SNAPPY.k, SNAPPY.d) : 0;
      const w = (c.dur || 1) * scale * (1 - clamp(collapse, 0, 1));
      const left = cursor;
      cursor += w + gap * (1 - clamp(collapse, 0, 1));
      const g = e3((lt - ca) / 0.3);
      const flash = cut ? 1 - clamp(collapse, 0, 1) : 0;
      return (
        <div key={i} style={{ position: 'absolute', left, top: 0, width: Math.max(0, w), height, borderRadius: 12,
          overflow: 'hidden', transformOrigin: 'left center', transform: `scaleX(${g})`,
          opacity: lt >= ca ? clamp((1 - collapse) * 6, 0, 1) : 0,
          background: flash > 0 ? alpha(DANGER, 0.3) : alpha(col, 0.22),
          border: `1.5px solid ${flash > 0 ? DANGER : alpha(col, 0.65)}`, display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 6 }}>
          {flash > 0 && <div style={{ position: 'absolute', inset: 0,
            backgroundImage: `repeating-linear-gradient(135deg, ${alpha(DANGER, 0.35)} 0 6px, transparent 6px 14px)` }} />}
          {flash > 0 && <Icon name="x" size={20} color={DANGER} stroke={3} />}
          {w > 44 && c.label && <span style={{ position: 'relative', fontFamily: MONO, fontSize, color: TEXT, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'clip', padding: '0 6px' }}>{c.label}</span>}
        </div>
      );
    });
    const used = cursor - (clips.length ? gap : 0);
    let head = null;
    if (playhead && lt >= playhead.at) {
      const p = clamp((lt - playhead.at) / Math.max(0.01, num(playhead.until, playhead.at + 2) - playhead.at), 0, 1);
      const hx = p * Math.max(0, used);
      head = (
        <div style={{ position: 'absolute', left: hx - 1.5, top: -16, height: height + 30, width: 3, background: TEXT,
          borderRadius: 2, boxShadow: `0 0 14px ${alpha(CYAN, 0.9)}` }}>
          <div style={{ position: 'absolute', left: -6.5, top: -8, width: 16, height: 16, borderRadius: '50%', background: CYAN }} />
        </div>
      );
    }
    return (
      <div style={place(x, y, z)}>
        <div style={{ position: 'relative', width, height: height + (ruler ? 34 : 0), ...style }}>
          {els}
          {head}
          {ruler && (
            <div data-bleed="" style={{ position: 'absolute', left: 0, right: 0, top: height + 14, height: 12,
              opacity: e3((lt - at) / 0.4),
              backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0.22) 2px, transparent 2px)',
              backgroundSize: `${width / 12}px 100%` }} />
          )}
        </div>
      </div>
    );
  }

  // ── Devices + grids ─────────────────────────────────────────────────────────
  // 9:16 phone. Children render in a 360×640 virtual screen scaled to fit, so
  // content is designed once regardless of the phone's size.
  function PhoneFrame({ width = 300, scale = 1, children, at = 0, screenBg = INK, tilt = 0, enter: en = 'rise',
    t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const Wd = width * scale;
    const b = Math.round(Wd * 0.04);
    const sw = Wd - 2 * b;
    const sh = sw * 16 / 9;
    const Hd = sh + 2 * b;
    const R = Wd * 0.14;
    const k = sw / 360;
    return (
      <div style={place(x, y, z)}>
        <div style={{ position: 'relative', width: Wd, height: Hd, ...entry(en, lt - at), ...style }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: R, background: 'linear-gradient(160deg, #262D40, #10141F)',
            boxShadow: `0 0 0 2px rgba(255,255,255,0.12), ${SHADOW}, 0 0 60px ${alpha(VIOLET, 0.18)}`,
            transform: tilt ? `rotate(${tilt}deg)` : undefined }}>
            {[[0.2, 0.07], [0.3, 0.1]].map(([top, h], i) => (
              <div key={i} style={{ position: 'absolute', left: -3, top: Hd * top, width: 3, height: Hd * h, borderRadius: 2, background: '#2A3146' }} />
            ))}
            <div style={{ position: 'absolute', right: -3, top: Hd * 0.26, width: 3, height: Hd * 0.12, borderRadius: 2, background: '#2A3146' }} />
            <div style={{ position: 'absolute', left: b, top: b, width: sw, height: sh, borderRadius: R - b, overflow: 'hidden',
              background: screenBg }}>
              <div style={{ position: 'absolute', left: 0, top: 0, width: 360, height: 640, transform: `scale(${k})`,
                transformOrigin: '0 0', overflow: 'hidden' }}>{children}</div>
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
                background: 'linear-gradient(125deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 38%)' }} />
            </div>
            <div style={{ position: 'absolute', left: Wd / 2 - sw * 0.16, top: b + sw * 0.03, width: sw * 0.32, height: sw * 0.085,
              borderRadius: 99, background: '#05070C' }} />
          </div>
        </div>
      </div>
    );
  }

  const REEL_LOOKS = {
    motion: { bg: INK, glow: VIOLET, glow2: CYAN, accent: CYAN, font: DISPLAY, text: TEXT, weight: 800, upper: false },
    reflective: { bg: '#0b0906', glow: '#e0a458', glow2: '#f2c46d', accent: '#f2c46d', font: "'Fraunces', Georgia, serif",
      text: '#f5efe6', weight: 700, upper: false, italic: true },
    news: { bg: '#080c14', glow: '#c8102e', glow2: '#c8102e', accent: '#c8102e', font: DISPLAY, text: '#ffffff',
      weight: 800, upper: true },
  };

  // A tiny fake short for PhoneFrame screens (360×640 virtual): title + karaoke
  // subtitle advancing at `wps` words/s + progress bar. look: motion | reflective | news.
  function MiniReel({ at = 0, title = 'Prompt caching', kicker = 'TUTORIAL', words, wps = 2.6, look = 'motion',
    accent, t }) {
    const lt = useLocalTime(t);
    const L = REEL_LOOKS[look] || REEL_LOOKS.motion;
    const acc = accent ? tone(accent) : L.accent;
    const ws = words || 'you write the script and the agent makes the video'.split(' ');
    const dt = lt - at;
    const wi = Math.floor(Math.max(0, dt - 0.5) * wps);
    const chunk = Math.floor(wi / 4) % Math.max(1, Math.ceil(ws.length / 4));
    const cur = ws.slice(chunk * 4, chunk * 4 + 4);
    const loopLen = Math.max(4, ws.length / wps + 1);
    const prog = ((Math.max(0, dt) % loopLen) / loopLen);
    return (
      <div style={{ position: 'absolute', inset: 0, background: L.bg, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: [
          `radial-gradient(ellipse 80% 50% at 15% 10%, ${alpha(L.glow, 0.35)}, transparent 70%)`,
          `radial-gradient(ellipse 70% 45% at 90% 95%, ${alpha(L.glow2, 0.2)}, transparent 70%)`,
        ].join(', ') }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, background: 'rgba(255,255,255,0.18)' }}>
          <div style={{ width: `${prog * 100}%`, height: '100%', background: acc }} />
        </div>
        <div style={{ position: 'absolute', left: 34, right: 34, top: 120, ...enter.slideUp(dt - 0.1) }}>
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 18, letterSpacing: '0.2em', color: acc, marginBottom: 14 }}>{kicker}</div>
          <div style={{ fontFamily: L.font, fontWeight: L.weight, fontStyle: L.italic ? 'italic' : 'normal', fontSize: 50,
            lineHeight: 1.04, color: L.text, textTransform: L.upper ? 'uppercase' : 'none', letterSpacing: '-0.02em' }}>{title}</div>
        </div>
        <div style={{ position: 'absolute', left: 34, top: 330, width: 292, height: 120, borderRadius: 18,
          background: alpha(L.glow, 0.16), border: `2px solid ${alpha(acc, 0.5)}`, ...enter.pop(dt - 0.35) }}>
          {[0.8, 0.55, 0.7].map((w, i) => (
            <div key={i} style={{ position: 'absolute', left: 20, top: 24 + i * 28, height: 12, borderRadius: 6,
              width: `${w * 100 * e3((dt - 0.5 - i * 0.12) / 0.4)}%`, maxWidth: 250, background: i === 0 ? acc : 'rgba(255,255,255,0.35)' }} />
          ))}
        </div>
        {dt >= 0.5 && (
          <div style={{ position: 'absolute', left: 20, right: 20, bottom: 96, display: 'flex', flexWrap: 'wrap',
            justifyContent: 'center', columnGap: 10, fontFamily: SANS, fontWeight: 600, fontSize: 24 }}>
            {cur.map((w, i) => {
              const gi = chunk * 4 + i;
              const now = wi % ws.length;
              const c = gi === now ? acc : gi < now ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.85)';
              return <span key={i} style={{ color: c }}>{w}</span>;
            })}
          </div>
        )}
      </div>
    );
  }

  // Contact-sheet-like grid. cells: [{ label, color, at, score, ringAt, ringColor }]
  // or `count` auto cells. aspect = height / width of a cell (16/9 = portrait frame).
  function Grid({ cells, count = 9, cols = 3, width = 520, gap = 14, aspect = 16 / 9, at = 0, stagger = 0.06,
    seed = 3, labels = true, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const list = cells || Array.from({ length: count }, (_, i) => ({ label: `${(i * 2.4 + 0.3).toFixed(1)}s` }));
    const cw = (width - gap * (cols - 1)) / cols;
    const ch = cw * aspect;
    const pal = [VIOLET, CYAN, OK, WARN, '#F472B6'];
    const shapes = React.useMemo(() => {
      const r = seededRandom(seed);
      return list.map(() => ({ a: 0.5 + 0.35 * r(), b: 0.3 + 0.3 * r(), box: 0.3 + 0.25 * r() }));
    }, [list.length, seed]);
    return (
      <div style={place(x, y, z)}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cw}px)`, columnGap: gap, rowGap: gap, width, ...style }}>
          {list.map((c, i) => {
            const ca = c.at != null ? c.at : at + i * stagger;
            const col = tone(c.color || pal[i % pal.length]);
            const s = shapes[i] || shapes[0];
            const ring = c.ringAt != null && lt >= c.ringAt ? sp(lt - c.ringAt, PUNCH.k, PUNCH.d) : 0;
            const rc = tone(c.ringColor || DANGER);
            return (
              <div key={i} style={{ position: 'relative', ...enter.pop(lt - ca, 0.7) }}>
                <div style={{ position: 'relative', width: cw, height: ch, borderRadius: 12, overflow: 'hidden',
                  background: `linear-gradient(165deg, ${alpha(col, 0.55)} 0%, ${alpha(INK, 0.9)} 70%), ${INK}`,
                  border: '1px solid rgba(255,255,255,0.12)', opacity: c.dim ? 0.45 : 1 }}>
                  <div style={{ position: 'absolute', left: '12%', top: '16%', width: `${s.a * 76}%`, height: ch * 0.05,
                    borderRadius: 4, background: 'rgba(255,255,255,0.85)' }} />
                  <div style={{ position: 'absolute', left: '12%', top: '25%', width: `${s.b * 76}%`, height: ch * 0.035,
                    borderRadius: 4, background: 'rgba(255,255,255,0.45)' }} />
                  <div style={{ position: 'absolute', left: '12%', right: '12%', top: '38%', height: ch * s.box, borderRadius: 8,
                    background: alpha(col, 0.28), border: `1px solid ${alpha(col, 0.6)}` }} />
                  <div style={{ position: 'absolute', left: '22%', right: '22%', bottom: '11%', height: ch * 0.03, borderRadius: 3,
                    background: 'rgba(255,255,255,0.6)' }} />
                  <div style={{ position: 'absolute', left: '22%', width: '22%', bottom: '11%', height: ch * 0.03, borderRadius: 3,
                    background: CYAN }} />
                  {c.score != null && (
                    <div style={{ position: 'absolute', right: 6, top: 6, minWidth: 34, height: 34, borderRadius: 10, padding: '0 6px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontWeight: 700,
                      fontSize: 20, color: INK, background: c.score >= 8 ? OK : c.score >= 7 ? WARN : DANGER,
                      ...enter.pop(lt - (c.scoreAt != null ? c.scoreAt : ca + 0.3)) }}>{c.score}</div>
                  )}
                </div>
                {ring > 0 && (
                  <div style={{ position: 'absolute', left: -6, top: -6, width: cw + 12, height: ch + 12, borderRadius: 16,
                    border: `4px solid ${rc}`, boxShadow: `0 0 22px ${alpha(rc, 0.6)}`, transform: `scale(${1.25 - 0.25 * ring})`,
                    opacity: clamp(ring * 1.5, 0, 1) }} />
                )}
                {labels && c.label && (
                  <div style={{ marginTop: 6, fontFamily: MONO, fontSize: 18, color: MUTED, textAlign: 'center', whiteSpace: 'nowrap' }}>{c.label}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Two panels side by side (layout="row") or stacked (layout="column") with a
  // medallion between. left/right: { title, sub, icon, color, at, children }.
  function SplitCard({ left = {}, right = {}, at = 0, divider = 'or', dividerAt, layout = 'row', width = 620, height = 380,
    gap = 26, t, x, y, z, style }) {
    const lt = useLocalTime(t);
    const row = layout !== 'column';
    const panel = (p, side) => {
      const c = tone(p.color || (side === 'left' ? VIOLET : CYAN));
      const pa = p.at != null ? p.at : at + (side === 'left' ? 0 : 0.25);
      const en = row ? (side === 'left' ? 'fromLeft' : 'fromRight') : (side === 'left' ? 'fromTop' : 'fromBottom');
      const pw = row ? (width - gap) / 2 : width;
      const ph = row ? height : (height - gap) / 2;
      return (
        <div style={{ width: pw, height: ph, borderRadius: 24, padding: '24px 22px', background: CARD, position: 'relative',
          overflow: 'hidden', border: `1.5px solid ${alpha(c, 0.4)}`, boxShadow: `${SHADOW}, inset 0 1px 0 rgba(255,255,255,0.05)`,
          display: 'flex', flexDirection: 'column', ...entry(en, lt - pa) }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: c }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {p.icon && (
              <div style={{ width: 46, height: 46, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: alpha(c, 0.18), flexShrink: 0 }}>
                <Icon name={p.icon} size={26} color={c} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, color: TEXT, lineHeight: 1.1 }}>{p.title}</div>
              {p.sub && <div style={{ fontFamily: SANS, fontSize: 20, color: MUTED, marginTop: 4 }}>{p.sub}</div>}
            </div>
          </div>
          <div style={{ flex: 1, position: 'relative', marginTop: 16 }}>{p.children}</div>
        </div>
      );
    };
    const la = left.at != null ? left.at : at;
    const ra = right.at != null ? right.at : at + 0.25;
    const da = dividerAt != null ? dividerAt : Math.max(la, ra) + 0.15;
    return (
      <div style={place(x, y, z)}>
        <div style={{ position: 'relative', width, display: 'flex', flexDirection: row ? 'row' : 'column', gap, ...style }}>
          {panel(left, 'left')}
          {panel(right, 'right')}
          {divider && (
            <div style={{ position: 'absolute', left: '50%', top: '50%', width: 62, height: 62, marginLeft: -31, marginTop: -31,
              borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: INK,
              border: '2px solid transparent', backgroundImage: `linear-gradient(${INK}, ${INK}), ${GRAD_DIAG}`,
              backgroundOrigin: 'border-box', backgroundClip: 'padding-box, border-box', fontFamily: DISPLAY, fontWeight: 700,
              fontSize: 22, color: TEXT, boxShadow: `0 0 24px ${alpha(VIOLET, 0.4)}`, ...enter.pop(lt - da) }}>{divider}</div>
          )}
        </div>
      </div>
    );
  }

  // ── Canvas-space pieces (place as direct children of SceneRoot) ─────────────
  // Arrow drawn from → to (canvas px), with an optional bend. The head rides the tip.
  function Arrow({ from = [180, 400], to = [540, 400], at = 0, dur = 0.5, curve = 0, color = CYAN, width = 4, head = 14,
    dashed = false, t }) {
    const lt = useLocalTime(t);
    const p = lt >= at ? eio((lt - at) / dur) : 0;
    if (p <= 0) return null;
    const [x1, y1] = from;
    const [x2, y2] = to;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const cx = mx - ((y2 - y1) / len) * curve;
    const cy = my + ((x2 - x1) / len) * curve;
    const bez = (u) => [
      (1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * cx + u * u * x2,
      (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * cy + u * u * y2,
    ];
    const N = 40;
    const pts = [];
    for (let i = 0; i <= N * p; i++) pts.push(bez(i / N));
    const tip = bez(p);
    pts.push(tip);
    const prev = bez(Math.max(0, p - 0.02));
    const ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
    const c = tone(color);
    const hp = (a, r) => `${tip[0] + Math.cos(ang + a) * r},${tip[1] + Math.sin(ang + a) * r}`;
    return (
      <svg data-bleed="" width={720} height={1280} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}>
        <polyline points={pts.map((q) => q.join(',')).join(' ')} fill="none" stroke={c} strokeWidth={width}
          strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed ? '2 10' : undefined}
          style={{ filter: `drop-shadow(0 0 6px ${alpha(c, 0.6)})` }} />
        <polygon points={`${hp(0, head * 0.2)} ${hp(Math.PI * 0.82, head)} ${hp(-Math.PI * 0.82, head)}`} fill={c} />
      </svg>
    );
  }

  // Pointer that moves along keyframes (spring-chained via track) and clicks.
  // path: [[time, x, y], ...] canvas px; clicks: [time, ...]. kind: 'pointer' | 'touch'.
  function Cursor({ path = [[0, 360, 700]], clicks = [], kind = 'pointer', size = 46, k = 170, d = 26, t }) {
    const lt = useLocalTime(t);
    const t0 = path[0][0];
    if (lt < t0) return null;
    const px = track(lt, path.map((q) => [q[0], q[1]]), k, d);
    const py = track(lt, path.map((q) => [q[0], q[2]]), k, d);
    let press = 1;
    const ripples = [];
    clicks.forEach((c, i) => {
      const dt = lt - c;
      if (dt >= 0 && dt < 0.25) press = Math.min(press, 1 - 0.2 * Math.sin(Math.PI * dt / 0.25));
      if (dt >= 0 && dt < 0.6) {
        const e = e3(dt / 0.6);
        ripples.push(<div key={i} style={{ position: 'absolute', left: px - 50 * e, top: py - 50 * e, width: 100 * e, height: 100 * e,
          borderRadius: '50%', border: `3px solid ${CYAN}`, opacity: 0.8 * (1 - e) }} />);
      }
    });
    const o = clamp((lt - t0) / 0.2, 0, 1);
    return (
      <div data-bleed="" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
        {ripples}
        {kind === 'touch' ? (
          <div style={{ position: 'absolute', left: px - size / 2, top: py - size / 2, width: size, height: size, borderRadius: '50%',
            background: 'rgba(255,255,255,0.35)', border: '3px solid rgba(255,255,255,0.9)', opacity: o,
            transform: `scale(${press})`, boxShadow: '0 6px 20px rgba(0,0,0,0.4)' }} />
        ) : (
          <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: 'absolute', left: px - size * 0.17,
            top: py - size * 0.08, opacity: o, transform: `scale(${press})`, transformOrigin: '17% 8%',
            filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))', overflow: 'visible' }}>
            <path d="M4 2.5v16.8l4.6-4.3 3 6.7 3-1.3-3-6.6h6.3z" fill="#FFFFFF" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
          </svg>
        )}
      </div>
    );
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  Object.assign(window, {
    // palette + type
    INK, VIOLET, CYAN, OK, WARN, DANGER, TEXT, MUTED, FAINT, CARD, CARD_BORDER, CODE_BG, GRAD, GRAD_DIAG,
    DISPLAY, SANS, MONO, SHADOW, TS, SNAPPY, PUNCH, CANVAS, CODE,
    // helpers
    enter, entry, alpha, mix, tone, typeDuration, tokenize, useLocalTime,
    // components
    SceneRoot, Glow, Watermark, Title, Kicker, Typed, Icon, Chip, Badge, Card, Callout, Tile, Stamp, Strike, Counter,
    ProgressBar, Ring, Window, BrowserFrame, Terminal, PromptBox, CodeCard, FileTree, StatusRows, FlowDiagram,
    PluginDock, Logo, Wordmark, Waveform, Timeline, PhoneFrame, MiniReel, Grid, SplitCard, Arrow, Cursor,
  });
  window.MOTION_KIT_VERSION = '1.0.0';
})();
