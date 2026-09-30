// styles/reflective/kit.jsx — the "reflective" style kit (warm, photo-led essays).
//
// Load it AFTER the runtime:
//   <script type="text/babel" src="../../runtime/animations.jsx"></script>
//   <script type="text/babel" src="../../styles/reflective/kit.jsx"></script>
// or paste this file's body into the video's own <script type="text/babel">.
//
// Everything below is assigned to `window` (see the export at the bottom), so
// scenes use BG, GOLD, Shot, PhotoSeq, Grade, Glow, Enter, Label, Chip,
// StrikeLine, rise, pop, reveal, ... directly. Photos load from the video's own
// folder: img('slug') → images/slug.jpg. Every helper is a pure function of the
// scene's localTime (`lt`), which you pass in explicitly (this kit does not read
// useSprite()). Documented in styles/reflective/STYLE.md.

(function reflectiveKit() {
  'use strict';
  if (typeof window.spring !== 'function') {
    console.error('[reflective kit] runtime/animations.jsx must be loaded before styles/reflective/kit.jsx');
    return;
  }
  const { Easing, clamp, spring } = window;

  const BG = '#0b0906';
  const GOLD = '#e0a458';
  const GOLD2 = '#f2c46d';
  const CREAM = '#f5efe6';
  const SERIF = "'Fraunces', Georgia, serif";
  const COND = "'Manrope', sans-serif";
  const BODY = "'Manrope', sans-serif";
  const TS = '0 2px 22px rgba(0,0,0,0.65), 0 1px 3px rgba(0,0,0,0.5)';
  const GLOW_TS = '0 0 28px rgba(242,196,109,0.55), 0 2px 16px rgba(0,0,0,0.6)';
  const img = (n) => `images/${n}.jpg`;

  // ── Motion helpers (all pure functions of time) ────────────────────────────────
  const e3 = (t) => Easing.easeOutCubic(clamp(t, 0, 1));
  const eio = (t) => Easing.easeInOutCubic(clamp(t, 0, 1));
  const after = (lt, cue, d) => e3((lt - cue) / d);

  // Entry styles. Every text overlay is enter-only (no early exits).
  function slideUp(localTime, inDur = 0.45) {
    const t = clamp(localTime / inDur, 0, 1);
    const e = Easing.easeOutCubic(t);
    return { opacity: e, transform: `translateY(${(1 - e) * 22}px)` };
  }
  function rise(lt, cue, d = 0.5, dist = 28) {
    const p = after(lt, cue, d);
    return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` };
  }
  function pop(lt, cue, k = 200, d = 14) {
    const s = spring(lt - cue, k, d);
    return { opacity: clamp((lt - cue) / 0.15, 0, 1), transform: `scale(${0.5 + 0.5 * s})` };
  }
  function reveal(lt, cue, d = 0.6) {
    const p = eio((lt - cue) / d);
    return { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, transform: `translateX(${(1 - p) * -16}px)`, opacity: p > 0 ? 1 : 0 };
  }
  function blurIn(lt, cue, d = 0.6) {
    const p = after(lt, cue, d);
    return { opacity: p, filter: `blur(${(1 - p) * 14}px)`, transform: `scale(${1.1 - 0.1 * p})` };
  }
  function drop(lt, cue) {
    const s = spring(lt - cue, 260, 17);
    return { opacity: clamp((lt - cue) / 0.12, 0, 1), transform: `translateY(${(1 - s) * -70}px)` };
  }

  // ── Photo layers ────────────────────────────────────────────────────────────────
  // One shot: Ken Burns zoom + drift over its own lifetime.
  function Shot({ src, t, dur, pos = 'center', z0 = 1.04, z1 = 1.14, x0 = 0, x1 = 0, y0 = 0, y1 = 0, filter }) {
    const p = Easing.easeInOutSine(clamp(t / Math.max(0.01, dur), 0, 1));
    const s = z0 + (z1 - z0) * p;
    const x = x0 + (x1 - x0) * p;
    const y = y0 + (y1 - y0) * p;
    return (
      <img src={img(src)} alt="" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: pos,
        transform: `scale(${s}) translate(${x}%, ${y}%)`, transformOrigin: 'center', filter,
      }} />
    );
  }

  // Transition style for an incoming layer, e = 0..1.
  function trStyle(type, e) {
    switch (type) {
      case 'wipe':   return { clipPath: `inset(0 ${(1 - e) * 100}% 0 0)` };
      case 'wipeUp': return { clipPath: `inset(${(1 - e) * 100}% 0 0 0)` };
      case 'iris':   return { clipPath: `circle(${e * 76}% at 50% 50%)` };
      case 'zoom':   return { opacity: e, transform: `scale(${1.3 - 0.3 * e})` };
      case 'slide':  return { transform: `translateX(${(1 - e) * 100}%)` };
      case 'blur':   return { opacity: e, filter: `blur(${(1 - e) * 16}px)` };
      default:       return { opacity: e };
    }
  }

  // Sequence of shots cut on word cues. shots: [{ src, at, tr, ...kenBurns }]
  function PhotoSeq({ lt, dur, shots, trDur = 0.5, filter, height = '100%', top = 0 }) {
    let a = 0;
    for (let i = 0; i < shots.length; i++) if (lt >= shots[i].at) a = i;
    const layer = (i, style) => {
      const s = shots[i];
      const end = i < shots.length - 1 && isFinite(shots[i + 1].at) ? shots[i + 1].at + trDur : dur;
      return (
        <div key={i} style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...style }}>
          <Shot {...s} filter={s.filter || filter} t={lt - s.at} dur={Math.max(0.5, end - s.at)} />
        </div>
      );
    };
    const tp = a > 0 ? clamp((lt - shots[a].at) / trDur, 0, 1) : 1;
    return (
      <div style={{ position: 'absolute', left: 0, right: 0, top, height, overflow: 'hidden', background: BG }}>
        {a > 0 && tp < 1 && layer(a - 1, {})}
        {layer(a, a > 0 ? trStyle(shots[a].tr || 'dissolve', eio(tp)) : {})}
      </div>
    );
  }

  // Warm dark grades so text always reads over photos.
  function Grade({ kind = 'topbottom', dim = 0 }) {
    const bgs = {
      topbottom: 'linear-gradient(to bottom, rgba(11,9,6,0.9) 0%, rgba(11,9,6,0.5) 26%, rgba(11,9,6,0.22) 48%, rgba(11,9,6,0.5) 70%, rgba(11,9,6,0.94) 100%)',
      left: 'linear-gradient(to right, rgba(11,9,6,0.92) 0%, rgba(11,9,6,0.7) 52%, rgba(11,9,6,0.3) 100%), linear-gradient(to bottom, rgba(11,9,6,0.7) 0%, rgba(11,9,6,0) 30%, rgba(11,9,6,0) 65%, rgba(11,9,6,0.92) 100%)',
      center: 'radial-gradient(ellipse 80% 55% at 50% 50%, rgba(11,9,6,0.55) 0%, rgba(11,9,6,0.2) 70%), linear-gradient(to bottom, rgba(11,9,6,0.9) 0%, rgba(11,9,6,0.35) 30%, rgba(11,9,6,0.35) 65%, rgba(11,9,6,0.94) 100%)',
    };
    return (
      <React.Fragment>
        <div style={{ position: 'absolute', inset: 0, background: bgs[kind] }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(165deg, rgba(242,196,109,0.14) 0%, rgba(11,9,6,0) 45%, rgba(224,164,88,0.10) 100%)', mixBlendMode: 'screen' }} />
        {dim > 0 && <div style={{ position: 'absolute', inset: 0, background: `rgba(11,9,6,${dim})` }} />}
      </React.Fragment>
    );
  }

  // Soft light orb (the "inner peace" motif). Pulses on a time-driven sine.
  function Glow({ x, y, r, strength = 1, lt }) {
    const pulse = 1 + 0.05 * Math.sin(lt * 2.2);
    const R = r * pulse;
    return (
      <div style={{
        position: 'absolute', left: x - R, top: y - R, width: R * 2, height: R * 2, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,226,160,0.62) 0%, rgba(242,196,109,0.34) 26%, rgba(224,164,88,0.12) 52%, rgba(224,164,88,0) 70%)',
        opacity: strength, mixBlendMode: 'screen', pointerEvents: 'none',
      }} />
    );
  }

  // Scene entry transitions — each runs in the 0.5 s scene overlap, over the outgoing scene.
  function Enter({ type, lt, children }) {
    const p = eio(lt / 0.5);
    let inner = {};
    let edge = null;
    if (type === 'wipe') {
      inner = { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` };
      if (p < 1) edge = <div style={{ position: 'absolute', top: 0, bottom: 0, left: p * 720 - 70, width: 140, background: 'linear-gradient(to right, rgba(242,196,109,0), rgba(255,230,170,0.95), rgba(242,196,109,0))', filter: 'blur(8px)', mixBlendMode: 'screen' }} />;
    } else if (type === 'wipeUp') {
      inner = { clipPath: `inset(${(1 - p) * 100}% 0 0 0)` };
      if (p < 1) edge = <div style={{ position: 'absolute', left: 0, right: 0, top: (1 - p) * 1280 - 70, height: 140, background: 'linear-gradient(to bottom, rgba(242,196,109,0), rgba(255,230,170,0.95), rgba(242,196,109,0))', filter: 'blur(8px)', mixBlendMode: 'screen' }} />;
    } else if (type === 'push') {
      inner = { transform: `translateX(${(1 - p) * 100}%)`, boxShadow: '-30px 0 60px rgba(0,0,0,0.6)' };
    } else if (type === 'zoom') {
      inner = { opacity: p, transform: `scale(${1.4 - 0.4 * p})` };
    } else if (type === 'iris') {
      inner = { clipPath: `circle(${p * 76}% at 50% 50%)` };
      const R = p * 0.76 * 1040;
      if (p < 1) edge = <div style={{ position: 'absolute', left: 360 - R, top: 640 - R, width: R * 2, height: R * 2, borderRadius: '50%', border: '4px solid rgba(242,196,109,0.9)', boxShadow: '0 0 30px rgba(242,196,109,0.8)' }} />;
    } else if (type === 'glow') {
      inner = { opacity: p };
      const f = Math.sin(Math.PI * clamp(lt / 0.5, 0, 1));
      if (lt < 0.5) edge = <div style={{ position: 'absolute', inset: 0, opacity: 0.9 * f, background: 'radial-gradient(ellipse at 55% 45%, rgba(255,240,205,1) 0%, rgba(242,196,109,0.85) 35%, rgba(224,164,88,0.3) 70%, rgba(11,9,6,0) 100%)', mixBlendMode: 'screen' }} />;
    } else if (type === 'dissolve') {
      inner = { opacity: p };
    }
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: BG, ...inner }}>{children}</div>
        {edge}
      </div>
    );
  }

  // ── Typographic building blocks ───────────────────────────────────────────────
  function Label({ lt, cue, text, top, left = 56, center = false, color = GOLD, size = 24 }) {
    const line = after(lt, cue, 0.5);
    return (
      <div style={{
        position: 'absolute', top, left: center ? 0 : left, right: center ? 0 : undefined,
        display: 'flex', alignItems: 'center', justifyContent: center ? 'center' : 'flex-start', gap: 14,
      }}>
        <div style={{ width: 44 * line, height: 2, background: color }} />
        <div style={{
          fontFamily: COND, fontWeight: 700, fontSize: size, letterSpacing: '0.24em', textTransform: 'uppercase',
          color, textShadow: TS, ...reveal(lt, cue + 0.1, 0.5),
        }}>{text}</div>
        {center && <div style={{ width: 44 * line, height: 2, background: color }} />}
      </div>
    );
  }

  function Chip({ children, style, size = 42 }) {
    return (
      <div style={{
        display: 'inline-block', padding: '6px 26px 10px', borderRadius: 999,
        border: `2px solid ${GOLD}`, background: 'rgba(11,9,6,0.62)',
        fontFamily: SERIF, fontStyle: 'italic', fontWeight: 500, fontSize: size, color: CREAM, lineHeight: 1.15,
        whiteSpace: 'nowrap', ...style,
      }}>{children}</div>
    );
  }

  function StrikeLine({ p, rot = -4, thick = 7 }) {
    return (
      <div style={{
        position: 'absolute', left: '-4%', top: '54%', height: thick, width: `${p * 108}%`,
        background: GOLD2, borderRadius: thick, transform: `rotate(${rot}deg)`, transformOrigin: 'left center',
        boxShadow: '0 0 18px rgba(242,196,109,0.75)',
      }} />
    );
  }


  Object.assign(window, {
    BG, GOLD, GOLD2, CREAM, SERIF, COND, BODY, TS, GLOW_TS, img,
    e3, eio, after, slideUp, rise, pop, reveal, blurIn, drop,
    Shot, trStyle, PhotoSeq, Grade, Glow, Enter, Label, Chip, StrikeLine,
  });
  window.REFLECTIVE_KIT_VERSION = '1.0.0';
})();
