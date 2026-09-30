
// animations.jsx — animation runtime + frame-render control
// Exposes window.__stage = { setTime, setPlaying, duration } for headless rendering.
// When scenesSrc is set, __stage is gated until scenes.json has loaded.

const Easing = {
  linear: (t) => t,
  easeInQuad:    (t) => t * t,
  easeOutQuad:   (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic:    (t) => t * t * t,
  easeOutCubic:   (t) => (--t) * t * t + 1,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeInQuart:    (t) => t * t * t * t,
  easeOutQuart:   (t) => 1 - (--t) * t * t * t,
  easeInOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t),
  easeInExpo:  (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutExpo: (t) => {
    if (t === 0) return 0; if (t === 1) return 1;
    if (t < 0.5) return 0.5 * Math.pow(2, 20 * t - 10);
    return 1 - 0.5 * Math.pow(2, -20 * t + 10);
  },
  easeInSine:    (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine:   (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  easeInBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; },
  easeInOutBack: (t) => {
    const c1 = 1.70158, c2 = c1 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },
  easeOutElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0) return 0; if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ── Springs (closed-form, pure function of time) ────────────────────────────
// spring(t, k, d) — displacement 0→1 of a unit-mass spring released at t=0.
// k = stiffness, d = damping. No state, no timers: safe for frame-by-frame
// rendering. Low d overshoots (bouncy), d ≥ 2·√k settles without overshoot.
function spring(t, k = 170, d = 26) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(k);
  const zeta = d / (2 * w0);
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
  const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

// track(t, keys, k, d) — value at t for keyframes [[time, value], ...] sorted by
// time. Each key springs from the previous value, so moves chain and overlap.
//   const x = track(localTime, [[0, -200], [cueA, 0], [cueB, 180]]);
function track(t, keys, k = 170, d = 26) {
  let v = keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], k, d);
  }
  return v;
}

// seededRandom(seed) — deterministic PRNG (mulberry32). Use instead of
// Math.random so every render of a frame is identical.
//   const rand = seededRandom(42); rand(); // 0..1
function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function interpolate(input, output, ease = Easing.linear) {
  return (t) => {
    if (t <= input[0]) return output[0];
    if (t >= input[input.length - 1]) return output[output.length - 1];
    for (let i = 0; i < input.length - 1; i++) {
      if (t >= input[i] && t <= input[i + 1]) {
        const span = input[i + 1] - input[i];
        const local = span === 0 ? 0 : (t - input[i]) / span;
        const easeFn = Array.isArray(ease) ? (ease[i] || Easing.linear) : ease;
        return output[i] + (output[i + 1] - output[i]) * easeFn(local);
      }
    }
    return output[output.length - 1];
  };
}

function animate({ from = 0, to = 1, start = 0, end = 1, ease = Easing.easeInOutCubic }) {
  return (t) => {
    if (t <= start) return from;
    if (t >= end) return to;
    return from + (to - from) * ease((t - start) / (end - start));
  };
}

const TimelineContext = React.createContext({ time: 0, duration: 10, playing: false });
const useTime = () => React.useContext(TimelineContext).time;
const useTimeline = () => React.useContext(TimelineContext);

const ScenesContext = React.createContext(null);
const useScenes = () => React.useContext(ScenesContext);

// ─── Scene clocks ─────────────────────────────────────────────────────────────
// Each scene has two start times on the global playhead:
//
//   audioStart  = Σ dur of all earlier scenes — where sN.mp3 begins inside
//                 voiceover.mp3. Whisper word times in scenes.json are relative
//                 to this (word.start = 0 ⇒ spoken at audioStart).
//   windowStart = audioStart − overlap (0 for the first scene, clamped ≥ 0) —
//                 where the scene's <Sprite {...useSceneWindow(N)}> mounts, so
//                 it can crossfade over the outgoing scene.
//
// The Sprite's localTime (and `time - useSceneWindow(N).start`) runs on the
// WINDOW clock, which is `lead = audioStart − windowStart` seconds AHEAD of the
// scene's audio. useWordTimings adds that lead, so every consumer that compares
// word times against the window clock (SubtitleRail, WordReveal, generated
// `localTime - useWordCue(...)`) is in sync with the voice.
//
// SCENE_OVERLAP is the single default for both useSceneWindow and
// useWordTimings. If you pass a custom `overlap` to useSceneWindow(N, {overlap})
// you MUST pass the same value to useWordTimings / useWordCue for that scene,
// otherwise cues drift by the difference. SubtitleRail and WordReveal always
// use the default on both sides.
const SCENE_OVERLAP = 0.5;

// _sceneOffsets(scenes, idx, overlap) → { windowStart, audioStart, end } | null
function _sceneOffsets(scenes, idx, overlap = SCENE_OVERLAP) {
  if (!Array.isArray(scenes)) return null;
  const sorted = [...scenes].sort((a, b) => a.idx - b.idx);
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) {
    const audioStart = cum;
    cum += sorted[i].dur;
    if (sorted[i].idx === idx) {
      const windowStart = Math.max(0, audioStart - (i === 0 ? 0 : overlap));
      return { windowStart, audioStart, end: cum };
    }
  }
  return null;
}

function useSceneWindow(idx, { overlap = SCENE_OVERLAP } = {}) {
  const scenes = useScenes();
  if (!scenes) return { start: 0, end: 0 };
  const o = _sceneOffsets(scenes, idx, overlap);
  if (o) return { start: o.windowStart, end: o.end };
  console.warn(`useSceneWindow: no scene with idx=${idx} in scenes.json`);
  return { start: 0, end: 0 };
}

const SpriteContext = React.createContext({ localTime: 0, progress: 0, duration: 0 });
const useSprite = () => React.useContext(SpriteContext);

function Sprite({ start = 0, end = Infinity, children, keepMounted = false }) {
  const { time } = useTimeline();
  const visible = time >= start && time <= end;
  if (!visible && !keepMounted) return null;
  const duration = end - start;
  const localTime = Math.max(0, time - start);
  const progress = duration > 0 && isFinite(duration) ? clamp(localTime / duration, 0, 1) : 0;
  const value = { localTime, progress, duration, visible };
  return (
    <SpriteContext.Provider value={value}>
      {typeof children === 'function' ? children(value) : children}
    </SpriteContext.Provider>
  );
}

function TextSprite({ text, x = 0, y = 0, size = 48, color = '#111', font = 'Inter, system-ui, sans-serif', weight = 600, entryDur = 0.45, exitDur = 0.35, entryEase = Easing.easeOutBack, exitEase = Easing.easeInCubic, align = 'left', letterSpacing = '-0.01em' }) {
  const { localTime, duration } = useSprite();
  const exitStart = Math.max(0, duration - exitDur);
  let opacity = 1, ty = 0;
  if (localTime < entryDur) {
    const t = entryEase(clamp(localTime / entryDur, 0, 1));
    opacity = t; ty = (1 - t) * 16;
  } else if (localTime > exitStart) {
    const t = exitEase(clamp((localTime - exitStart) / exitDur, 0, 1));
    opacity = 1 - t; ty = -t * 8;
  }
  const translateX = align === 'center' ? '-50%' : align === 'right' ? '-100%' : '0';
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `translate(${translateX}, ${ty}px)`, opacity, fontFamily: font, fontSize: size, fontWeight: weight, color, letterSpacing, whiteSpace: 'pre', lineHeight: 1.1, willChange: 'transform, opacity' }}>
      {text}
    </div>
  );
}

function ImageSprite({ src, x = 0, y = 0, width = 400, height = 300, entryDur = 0.6, exitDur = 0.4, kenBurns = false, kenBurnsScale = 1.08, radius = 12, fit = 'cover', placeholder = null }) {
  const { localTime, duration } = useSprite();
  const exitStart = Math.max(0, duration - exitDur);
  let opacity = 1, scale = 1;
  if (localTime < entryDur) {
    const t = Easing.easeOutCubic(clamp(localTime / entryDur, 0, 1));
    opacity = t; scale = 0.96 + 0.04 * t;
  } else if (localTime > exitStart) {
    const t = Easing.easeInCubic(clamp((localTime - exitStart) / exitDur, 0, 1));
    opacity = 1 - t; scale = (kenBurns ? kenBurnsScale : 1) + 0.02 * t;
  } else if (kenBurns) {
    const holdSpan = exitStart - entryDur;
    const holdT = holdSpan > 0 ? (localTime - entryDur) / holdSpan : 0;
    scale = 1 + (kenBurnsScale - 1) * holdT;
  }
  const content = placeholder
    ? <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'repeating-linear-gradient(135deg, #e9e6df 0 10px, #dcd8cf 10px 20px)', color: '#6b6458', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>{placeholder.label || 'image'}</div>
    : <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }} />;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width, height, opacity, transform: `scale(${scale})`, transformOrigin: 'center', borderRadius: radius, overflow: 'hidden', willChange: 'transform, opacity' }}>
      {content}
    </div>
  );
}

function RectSprite({ x = 0, y = 0, width = 100, height = 100, color = '#111', radius = 8, entryDur = 0.4, exitDur = 0.3, render }) {
  const spriteCtx = useSprite();
  const { localTime, duration } = spriteCtx;
  const exitStart = Math.max(0, duration - exitDur);
  let opacity = 1, scale = 1;
  if (localTime < entryDur) {
    const t = Easing.easeOutBack(clamp(localTime / entryDur, 0, 1));
    opacity = clamp(localTime / entryDur, 0, 1); scale = 0.4 + 0.6 * t;
  } else if (localTime > exitStart) {
    const t = Easing.easeInQuad(clamp((localTime - exitStart) / exitDur, 0, 1));
    opacity = 1 - t; scale = 1 - 0.15 * t;
  }
  const overrides = render ? render(spriteCtx) : {};
  return <div style={{ position: 'absolute', left: x, top: y, width, height, background: color, borderRadius: radius, opacity, transform: `scale(${scale})`, transformOrigin: 'center', willChange: 'transform, opacity', ...overrides }} />;
}

// Stage voiceover (preview only). `audioSrc`: a string plays that file, null keeps the
// preview silent, undefined (default) auto-resolves by HEAD-ing voiceover-mix.mp3, then
// voiceover.mp3, next to the page. While playing with audio, the audio clock is the
// master (time = audio.currentTime); without audio the rAF dt clock runs as before.
// Render mode (?render=1) never fetches, never mounts <audio>, never shows the overlay.
function Stage({ width = 1280, height = 720, duration, background = '#f6f4ef', loop = true, autoplay = true, persistKey = 'animstage', scenesSrc = null, audioSrc, children }) {
  const [scenes, setScenes] = React.useState(null);

  React.useEffect(() => {
    if (!scenesSrc) return;
    let cancelled = false;
    fetch(scenesSrc)
      .then(r => r.json())
      .then(data => { if (!cancelled) setScenes(data); })
      .catch(e => {
        if (!cancelled) {
          console.error('Failed to load scenes.json:', e);
          setScenes([]); // unblock __stage so renderer fails fast
        }
      });
    return () => { cancelled = true; };
  }, [scenesSrc]);

  const effectiveDuration = scenes
    ? scenes.reduce((a, s) => a + s.dur, 0)
    : (duration != null ? duration : 10);

  const isRenderMode = new URLSearchParams(window.location.search).get('render') === '1';

  const [time, setTimeState] = React.useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(persistKey + ':t') || '0');
      return isFinite(v) ? clamp(v, 0, effectiveDuration) : 0;
    } catch { return 0; }
  });
  const [playing, setPlayingState] = React.useState(isRenderMode ? false : autoplay);
  const [hoverTime, setHoverTime] = React.useState(null);
  const [scale, setScale] = React.useState(1);
  // Voiceover src: undefined while auto-resolving, null = none (silent preview).
  const [audioUrl, setAudioUrl] = React.useState(() =>
    (isRenderMode || audioSrc === null) ? null : (typeof audioSrc === 'string' ? audioSrc : undefined));
  const [audioBlocked, setAudioBlocked] = React.useState(false);

  const stageRef = React.useRef(null);
  const rafRef = React.useRef(null);
  const lastTsRef = React.useRef(null);
  const audioRef = React.useRef(null);
  const pendingSeekRef = React.useRef(null);
  const timeRef = React.useRef(time);
  const playingRef = React.useRef(playing);
  timeRef.current = time;
  playingRef.current = playing;

  const audioActive = !isRenderMode && typeof audioUrl === 'string' && !(scenesSrc && !scenes);
  const clockReady = audioUrl === null || audioActive; // hold the clock while the voiceover resolves/mounts

  // ── Voiceover transport (no-ops while no <audio> is mounted) ──
  const seekAudio = React.useCallback((t) => {
    const a = audioRef.current;
    if (!a) return;
    pendingSeekRef.current = t;
    try { a.currentTime = t; } catch {}
  }, []);

  const startAudio = React.useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    seekAudio(timeRef.current);
    setAudioBlocked(false);
    let p;
    try { p = a.play(); } catch (err) { p = Promise.reject(err); }
    Promise.resolve(p).catch((err) => {
      if (audioRef.current !== a || !playingRef.current || (err && err.name === 'AbortError')) return;
      if (err && err.name === 'NotAllowedError') {
        // Autoplay policy (mobile, first load): wait for a tap, which is the user gesture.
        playingRef.current = false;
        setPlayingState(false);
        setAudioBlocked(true);
      } else {
        console.warn('Stage: voiceover playback failed, preview is silent:', err);
        setAudioUrl(null);
      }
    });
  }, [seekAudio]);

  // Public setters (context, __stage, keys, bar). With no <audio> mounted they pass
  // straight through to React state, so the silent and render paths are unchanged.
  const setTime = React.useCallback((v) => {
    if (!audioRef.current) { setTimeState(v); return; }
    const next = typeof v === 'function' ? v(timeRef.current) : v;
    timeRef.current = next;
    setTimeState(next);
    seekAudio(next);
  }, [seekAudio]);

  const setPlaying = React.useCallback((v) => {
    const a = audioRef.current;
    if (!a) { setPlayingState(v); return; }
    const next = !!(typeof v === 'function' ? v(playingRef.current) : v);
    playingRef.current = next;
    setPlayingState(next);
    if (!next) a.pause();
    else if (a.paused) startAudio(); // synchronous, so a click/tap/key press counts as the gesture
  }, [startAudio]);

  // Audio reached the timeline end (or its own end): same loop/stop rule as the dt clock.
  const handleAudioEnd = () => {
    const a = audioRef.current;
    if (!a || !playingRef.current) return;
    if (loop) { timeRef.current = 0; setTimeState(0); startAudio(); return; }
    playingRef.current = false;
    setPlayingState(false);
    a.pause();
    timeRef.current = effectiveDuration;
    setTimeState(effectiveDuration);
  };

  // Expose render controls for Playwright (only once scenes are loaded, if scenesSrc given)
  React.useEffect(() => {
    if (scenesSrc && !scenes) return;
    window.__stage = { setTime, setPlaying, duration: effectiveDuration };
  }, [setTime, setPlaying, effectiveDuration, scenesSrc, scenes]);

  // Render mode: CSS transitions/animations run on the wall clock, not on
  // `time`, so a captured frame would depend on how long the screenshot took.
  // Kill them so every frame is a pure function of time.
  React.useEffect(() => {
    if (!isRenderMode) return;
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, [isRenderMode]);

  // Resolve the voiceover (never in render mode).
  React.useEffect(() => {
    if (isRenderMode) return;
    if (audioSrc === null || typeof audioSrc === 'string') { setAudioUrl(audioSrc); return; }
    let cancelled = false;
    const exists = (u) => fetch(u, { method: 'HEAD', cache: 'no-store' })
      .then(r => r.ok && !/^text\/html/i.test(r.headers.get('content-type') || ''), () => false);
    (async () => {
      let found = null;
      for (const u of ['voiceover-mix.mp3', 'voiceover.mp3']) {
        if (await exists(u)) { found = u; break; }
        if (cancelled) return;
      }
      if (!cancelled) setAudioUrl(found);
    })();
    return () => { cancelled = true; };
  }, [audioSrc, isRenderMode]);

  // Voiceover mounted: seek it to the current (possibly persisted) time, honour autoplay.
  React.useEffect(() => {
    const a = audioActive ? audioRef.current : null;
    if (!a) return;
    seekAudio(timeRef.current);
    if (playingRef.current) startAudio();
    return () => { try { a.pause(); } catch {} };
  }, [audioActive, audioUrl, seekAudio, startAudio]);

  React.useEffect(() => {
    try { localStorage.setItem(persistKey + ':t', String(time)); } catch {}
  }, [time, persistKey]);

  React.useEffect(() => {
    if (!stageRef.current) return;
    const el = stageRef.current;
    const measure = () => {
      const barH = isRenderMode ? 0 : 44;
      const s = Math.min(el.clientWidth / width, (el.clientHeight - barH) / height);
      setScale(Math.max(0.05, s));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [width, height, isRenderMode]);

  React.useEffect(() => {
    if (!playing || !clockReady) { lastTsRef.current = null; return; }
    const audio = audioActive ? audioRef.current : null;
    if (audio) {
      // Audio clock is the master: follow audio.currentTime, never accumulate dt.
      const step = () => {
        const pend = pendingSeekRef.current;
        if (pend != null && audio.readyState < 1) { rafRef.current = requestAnimationFrame(step); return; } // seek can't land yet: hold
        if (pend != null) {
          pendingSeekRef.current = null;
          if (Math.abs(audio.currentTime - pend) > 0.25) { try { audio.currentTime = pend; } catch {} } // a pre-load seek was dropped
        }
        const t = audio.currentTime;
        if (audio.ended || t >= effectiveDuration) handleAudioEnd();
        else { timeRef.current = t; setTimeState(t); }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }
    const step = (ts) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setTime((t) => {
        let next = t + dt;
        if (next >= effectiveDuration) {
          if (loop) next = next % effectiveDuration;
          else { next = effectiveDuration; setPlaying(false); }
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); lastTsRef.current = null; };
  }, [playing, effectiveDuration, loop, clockReady, audioActive]);

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(p => !p); }
      else if (e.code === 'ArrowLeft') setTime(t => clamp(t - (e.shiftKey ? 1 : 0.1), 0, effectiveDuration));
      else if (e.code === 'ArrowRight') setTime(t => clamp(t + (e.shiftKey ? 1 : 0.1), 0, effectiveDuration));
      else if (e.key === '0' || e.code === 'Home') setTime(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [effectiveDuration]);

  const displayTime = hoverTime != null ? hoverTime : time;
  const ctxValue = React.useMemo(
    () => ({ time: displayTime, duration: effectiveDuration, playing, setTime, setPlaying }),
    [displayTime, effectiveDuration, playing]
  );

  if (scenesSrc && !scenes) {
    return <div ref={stageRef} style={{ position: 'absolute', inset: 0, background: '#0a0a0a' }} />;
  }

  return (
    <div ref={stageRef} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#0a0a0a', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ width, height, background, position: 'relative', transform: `scale(${scale})`, transformOrigin: 'center', flexShrink: 0, boxShadow: isRenderMode ? 'none' : '0 20px 60px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
          <ScenesContext.Provider value={scenes}>
            <TimelineContext.Provider value={ctxValue}>
              {children}
            </TimelineContext.Provider>
          </ScenesContext.Provider>
        </div>
      </div>
      {!isRenderMode && (
        <PlaybackBar
          time={displayTime}
          duration={effectiveDuration}
          playing={playing}
          onPlayPause={() => setPlaying(p => !p)}
          onReset={() => setTime(0)}
          onSeek={(t) => setTime(t)}
          onHover={(t) => setHoverTime(t)}
        />
      )}
      {audioActive && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          style={{ display: 'none' }}
          onEnded={() => { const a = audioRef.current; if (a && a.ended) handleAudioEnd(); }}
          onPause={() => { const a = audioRef.current; if (a && a.paused && !a.ended && playingRef.current) { playingRef.current = false; setPlayingState(false); } }}
          onPlay={() => { const a = audioRef.current; if (a && !a.paused && !playingRef.current) { playingRef.current = true; setPlayingState(true); setAudioBlocked(false); } }}
          onError={() => { console.warn('Stage: could not load voiceover ' + audioUrl + ', preview is silent'); setAudioBlocked(false); setAudioUrl(null); }}
        />
      )}
      {audioActive && audioBlocked && <TapToPlayOverlay onTap={() => setPlaying(true)} />}
    </div>
  );
}

// Shown only when a voiceover exists and the browser blocked audio.play() (mobile
// autoplay policy). The tap is the user gesture that unlocks audio.
function TapToPlayOverlay({ onTap }) {
  return (
    <button type="button" onClick={onTap}
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', border: 'none', margin: 0, padding: 0, cursor: 'pointer', zIndex: 10, WebkitTapHighlightColor: 'transparent' }}>
      <span style={{ padding: '14px 28px', borderRadius: 999, background: 'rgba(20,20,20,0.9)', border: '1px solid rgba(255,255,255,0.18)', color: '#f6f4ef', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 20, fontWeight: 600, boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }}>
        {'▶︎ tap to play'}
      </span>
    </button>
  );
}

function PlaybackBar({ time, duration, playing, onPlayPause, onReset, onSeek, onHover }) {
  const trackRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);

  const timeFromEvent = React.useCallback((e) => {
    const rect = trackRef.current.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / rect.width, 0, 1) * duration;
  }, [duration]);

  const onTrackMove = (e) => {
    if (!trackRef.current) return;
    const t = timeFromEvent(e);
    dragging ? onSeek(t) : onHover(t);
  };

  const onTrackDown = (e) => {
    setDragging(true);
    onSeek(timeFromEvent(e));
    onHover(null);
  };

  React.useEffect(() => {
    if (!dragging) return;
    const onUp = () => setDragging(false);
    const onMove = (e) => { if (trackRef.current) onSeek(timeFromEvent(e)); };
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('mouseup', onUp); window.removeEventListener('mousemove', onMove); };
  }, [dragging, timeFromEvent, onSeek]);

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const fmt = (t) => {
    const total = Math.max(0, t);
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    const cs = Math.floor((total * 100) % 100);
    return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };
  const mono = 'JetBrains Mono, ui-monospace, monospace';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: 'rgba(20,20,20,0.92)', borderTop: '1px solid rgba(255,255,255,0.08)', width: '100%', maxWidth: 680, alignSelf: 'center', borderRadius: 8, color: '#f6f4ef', fontFamily: 'Inter, system-ui, sans-serif', userSelect: 'none', flexShrink: 0 }}>
      <IconButton onClick={onReset} title="Return to start">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2v10M12 2L5 7l7 5V2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg>
      </IconButton>
      <IconButton onClick={onPlayPause} title="Play/pause (space)">
        {playing
          ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="2" width="3" height="10" fill="currentColor"/><rect x="8" y="2" width="3" height="10" fill="currentColor"/></svg>
          : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2l9 5-9 5V2z" fill="currentColor"/></svg>
        }
      </IconButton>
      <div style={{ fontFamily: mono, fontSize: 12, fontVariantNumeric: 'tabular-nums', width: 64, textAlign: 'right', color: '#f6f4ef' }}>{fmt(time)}</div>
      <div ref={trackRef} onMouseMove={onTrackMove} onMouseLeave={() => { if (!dragging) onHover(null); }} onMouseDown={onTrackDown} style={{ flex: 1, height: 22, position: 'relative', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 4, background: 'rgba(255,255,255,0.12)', borderRadius: 2 }}/>
        <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: 4, background: 'oklch(72% 0.12 250)', borderRadius: 2 }}/>
        <div style={{ position: 'absolute', left: `${pct}%`, top: '50%', width: 12, height: 12, marginLeft: -6, marginTop: -6, background: '#fff', borderRadius: 6, boxShadow: '0 2px 4px rgba(0,0,0,0.4)' }}/>
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, fontVariantNumeric: 'tabular-nums', width: 64, textAlign: 'left', color: 'rgba(246,244,239,0.55)' }}>{fmt(duration)}</div>
    </div>
  );
}

function IconButton({ children, onClick, title }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: hover ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f6f4ef', cursor: 'pointer', padding: 0, transition: 'background 120ms' }}>
      {children}
    </button>
  );
}

// ─── _useWordTimingsAbsolute ──────────────────────────────────────────────────
// Internal: returns word list with timestamps converted to absolute playhead
// time (cumulative audio offset + scene-relative timestamp). Used only by the
// inline WordReveal below which compares against useTime() directly.
function _useWordTimingsAbsolute(sceneIdx) {
  const scenes = useScenes();
  if (!scenes) return [];

  const scene = scenes.find(s => s.idx === sceneIdx);
  if (!scene || !Array.isArray(scene.words) || scene.words.length === 0) return [];

  // Audio start = sum of durations of all scenes before this one
  const { audioStart } = _sceneOffsets(scenes, sceneIdx);

  return scene.words.map(w => ({
    word:  w.word,
    start: audioStart + w.start,
    end:   audioStart + w.end,
  }));
}

// ─── WordReveal ───────────────────────────────────────────────────────────────
// Renders narration text word-by-word, each word fading in at its exact Whisper
// timestamp. Requires `words` in scenes.json (written by
// `node pipeline/cli.js cut` / the app's Finalize).
//
// Props:
//   sceneIdx  — 1-based scene index (must match ### Scene N in script.md)
//   style     — optional CSS spread applied to every word span
//   emphasis  — if true, ALL-CAPS words and words containing digits render
//               in accent red (#c8102e) at 1.15× scale (default true)
//   fadeDur   — per-word fade-in duration in seconds (default 0.08)
//
// Usage:
//   <WordReveal sceneIdx={3} />
//   <WordReveal sceneIdx={3} style={{ fontSize: 28, fontFamily: "'Barlow', sans-serif" }} />
function _WordRevealLegacy({ sceneIdx, style = {}, emphasis = true, fadeDur = 0.08 }) {
  const words = _useWordTimingsAbsolute(sceneIdx);
  const { time } = useTimeline();

  if (words.length === 0) return null;

  return (
    <span style={{ display: 'inline' }}>
      {words.map((w, i) => {
        const t = clamp((time - w.start) / Math.max(0.001, fadeDur), 0, 1);
        const opacity = Easing.easeOutCubic(t);
        const isEmphasis = emphasis && (/[A-Z]{2,}/.test(w.word) || /\d/.test(w.word));
        const scale = isEmphasis && opacity > 0 ? 1 + 0.15 * Easing.easeOutBack(opacity) : 1;
        return (
          <span key={i} style={{
            display: 'inline-block',
            opacity,
            color: isEmphasis ? '#c8102e' : 'inherit',
            transform: scale !== 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'bottom center',
            marginRight: '0.22em',
            willChange: 'opacity',
            ...style,
          }}>
            {w.word}
          </span>
        );
      })}
    </span>
  );
}


// Full-bleed or positioned image with Ken Burns zoom + pan motion.
// Takes localTime + duration directly — use inside a Sprite's render callback.
//
// Props:
//   src           — image path
//   localTime     — seconds since scene start
//   duration      — total scene duration in seconds
//   startScale    — initial zoom (default 1.0)
//   endScale      — final zoom (default 1.08)
//   panFrom       — {x, y} starting translate offset in % (default {x:0, y:0})
//   panTo         — {x, y} ending translate offset in % (default {x:0, y:0})
//   position      — CSS object-position (default 'center')
//   gradient      — add dark gradient overlay (default true)
//   entryDur      — fade-in duration in seconds (default 0.5)
//   exitDur       — fade-out duration in seconds (default 0.4)
//   width/height  — CSS width/height (default '100%')
//   x/y           — CSS left/top (default 0)
//   radius        — border-radius (default 0)
function KenBurns({
  src,
  width = '100%',
  height = '100%',
  x = 0,
  y = 0,
  localTime = 0,
  duration = 1,
  startScale = 1.0,
  endScale = 1.08,
  panFrom = { x: 0, y: 0 },
  panTo = { x: 0, y: 0 },
  position = 'center',
  gradient = true,
  entryDur = 0.5,
  exitDur = 0.4,
  radius = 0,
}) {
  const exitStart = Math.max(0, duration - exitDur);
  let opacity = 1;
  if (localTime < entryDur) {
    opacity = Easing.easeOutCubic(clamp(localTime / entryDur, 0, 1));
  } else if (localTime > exitStart) {
    opacity = 1 - Easing.easeInCubic(clamp((localTime - exitStart) / exitDur, 0, 1));
  }

  const holdSpan = Math.max(0.01, exitStart - entryDur);
  const holdT = Easing.easeInOutSine(clamp((localTime - entryDur) / holdSpan, 0, 1));

  const scale = startScale + (endScale - startScale) * holdT;
  const px = (panFrom.x || 0) + ((panTo.x || 0) - (panFrom.x || 0)) * holdT;
  const py = (panFrom.y || 0) + ((panTo.y || 0) - (panFrom.y || 0)) * holdT;

  return (
    <div style={{
      position: 'absolute', left: x, top: y, width, height,
      opacity, overflow: 'hidden', borderRadius: radius,
    }}>
      <img src={src} alt="" style={{
        width: '100%', height: '100%',
        objectFit: 'cover',
        objectPosition: position,
        transform: `scale(${scale}) translate(${px}%, ${py}%)`,
        transformOrigin: 'center',
        willChange: 'transform',
      }} />
      {gradient && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.3) 100%)',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}

// ─── ImageCut ─────────────────────────────────────────────────────────────────
// Cycles through N images at specified timestamps, cross-dissolving between them.
// Each image has its own Ken Burns zoom+pan while visible.
// Use this for any scene where the narration runs longer than 3 seconds.
//
// Props:
//   images        — array of { src, position='center', panDir={x,y}, alt='' }
//                   panDir: translate drift in % over the image's hold duration
//   cuts          — array of localTime offsets where each image cuts in.
//                   cuts[0] must be 0. Length must equal images.length.
//   localTime     — seconds since scene start
//   duration      — total scene duration in seconds
//   crossfadeDur  — dissolve duration between cuts (default 0.15)
//   kenBurnsScale — max zoom for each image's Ken Burns motion (default 1.06)
//   gradient      — add dark gradient overlay (default true)
//   entryDur      — fade-in duration in seconds (default 0.5)
//   exitDur       — fade-out duration in seconds (default 0.4)
//   width/height  — CSS width/height (default '100%')
//   x/y           — CSS left/top (default 0)
//   radius        — border-radius (default 0)
function ImageCut({
  images,
  cuts,
  localTime = 0,
  duration = 1,
  width = '100%',
  height = '100%',
  x = 0,
  y = 0,
  crossfadeDur = 0.15,
  gradient = true,
  entryDur = 0.5,
  exitDur = 0.4,
  kenBurnsScale = 1.06,
  radius = 0,
}) {
  // Find the active (latest) cut index
  let activeIdx = 0;
  for (let i = 0; i < cuts.length; i++) {
    if (localTime >= cuts[i]) activeIdx = i;
  }

  const timeSinceCut = localTime - cuts[activeIdx];
  const crossT = Easing.easeInOutCubic(clamp(timeSinceCut / Math.max(0.001, crossfadeDur), 0, 1));
  const prevIdx = activeIdx > 0 ? activeIdx - 1 : null;
  const inCrossfade = prevIdx !== null && crossT < 1;

  // Overall component entry/exit opacity
  const exitStart = Math.max(0, duration - exitDur);
  let globalOpacity = 1;
  if (localTime < entryDur) {
    globalOpacity = Easing.easeOutCubic(clamp(localTime / entryDur, 0, 1));
  } else if (localTime > exitStart) {
    globalOpacity = 1 - Easing.easeInCubic(clamp((localTime - exitStart) / exitDur, 0, 1));
  }

  const renderImgLayer = (idx, layerOpacity, zIndex) => {
    if (idx < 0 || idx >= images.length) return null;
    const img = images[idx];
    const imgStart = cuts[idx] || 0;
    const imgEnd = idx < cuts.length - 1 ? cuts[idx + 1] : duration;
    const imgDur = Math.max(0.01, imgEnd - imgStart);
    const imgLocal = clamp(localTime - imgStart, 0, imgDur);
    const kbT = Easing.easeInOutSine(imgLocal / imgDur);
    const scale = 1 + (kenBurnsScale - 1) * kbT;
    const dir = img.panDir || { x: 0, y: 0 };
    return (
      <div key={`img-${idx}`} style={{ position: 'absolute', inset: 0, opacity: layerOpacity, zIndex }}>
        <img src={img.src} alt={img.alt || ''} style={{
          width: '100%', height: '100%',
          objectFit: 'cover',
          objectPosition: img.position || 'center',
          transform: `scale(${scale}) translate(${(dir.x || 0) * kbT}%, ${(dir.y || 0) * kbT}%)`,
          transformOrigin: 'center',
          willChange: 'transform',
        }} />
      </div>
    );
  };

  return (
    <div style={{
      position: 'absolute', left: x, top: y, width, height,
      opacity: globalOpacity, overflow: 'hidden', borderRadius: radius,
    }}>
      {inCrossfade && renderImgLayer(prevIdx, 1 - crossT, 1)}
      {renderImgLayer(activeIdx, inCrossfade ? crossT : 1, 2)}
      {gradient && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 3,
          background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.3) 100%)',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}

// ─── Parallax ─────────────────────────────────────────────────────────────────
// Two-layer depth effect: background image drifts slowly, optional foreground
// element moves at a different rate (or opposite direction) for parallax depth.
//
// Props:
//   bg            — { src, position='center', alt='' } background image
//   fg            — optional { src, position='center', x, y, width, height, radius, alt='' }
//                   foreground image element
//   localTime     — seconds since scene start
//   duration      — total scene duration in seconds
//   amount        — total pixels background drifts over the scene (default 24)
//   direction     — 'up' | 'down' | 'left' | 'right' (default 'up')
//   fgSpeedMult   — foreground drift as fraction of bg drift, negative = opposite (default -0.5)
//   gradient      — add dark gradient overlay (default true)
//   entryDur      — fade-in duration in seconds (default 0.5)
//   exitDur       — fade-out duration in seconds (default 0.4)
//   width/height  — CSS width/height (default '100%')
//   x/y           — CSS left/top (default 0)
function Parallax({
  bg,
  fg = null,
  localTime = 0,
  duration = 1,
  width = '100%',
  height = '100%',
  x = 0,
  y = 0,
  amount = 24,
  direction = 'up',
  fgSpeedMult = -0.5,
  gradient = true,
  entryDur = 0.5,
  exitDur = 0.4,
}) {
  const exitStart = Math.max(0, duration - exitDur);
  let globalOpacity = 1;
  if (localTime < entryDur) {
    globalOpacity = Easing.easeOutCubic(clamp(localTime / entryDur, 0, 1));
  } else if (localTime > exitStart) {
    globalOpacity = 1 - Easing.easeInCubic(clamp((localTime - exitStart) / exitDur, 0, 1));
  }

  const progress = Easing.easeInOutSine(duration > 0 ? clamp(localTime / duration, 0, 1) : 0);
  const offset = progress * amount;

  const bgDx = direction === 'left' ? -offset : direction === 'right' ? offset : 0;
  const bgDy = direction === 'up' ? -offset : direction === 'down' ? offset : 0;
  const fgDx = bgDx * fgSpeedMult;
  const fgDy = bgDy * fgSpeedMult;

  const oversize = Math.abs(amount) + 4;

  return (
    <div style={{
      position: 'absolute', left: x, top: y, width, height,
      opacity: globalOpacity, overflow: 'hidden',
    }}>
      {/* Background — oversized so drift doesn't expose edges */}
      <div style={{
        position: 'absolute',
        left: -oversize, right: -oversize,
        top: -oversize, bottom: -oversize,
      }}>
        <img src={bg.src} alt={bg.alt || ''} style={{
          width: '100%', height: '100%',
          objectFit: 'cover',
          objectPosition: bg.position || 'center',
          transform: `translate(${bgDx}px, ${bgDy}px)`,
          willChange: 'transform',
        }} />
      </div>
      {/* Optional foreground element */}
      {fg && (
        <div style={{
          position: 'absolute',
          left: fg.x || 0, top: fg.y || 0,
          width: fg.width || 300, height: fg.height || 300,
          overflow: 'hidden',
          borderRadius: fg.radius || 0,
          transform: `translate(${fgDx}px, ${fgDy}px)`,
          willChange: 'transform',
          zIndex: 2,
        }}>
          <img src={fg.src} alt={fg.alt || ''} style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            objectPosition: fg.position || 'center',
          }} />
        </div>
      )}
      {gradient && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 3,
          background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.3) 100%)',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}

// ─── useWordTimings ───────────────────────────────────────────────────────────
// Returns the words array for a given scene index from scenes.json.
// Each entry: { word: string, start: number, end: number, ... }
// Timestamps are on the scene WINDOW clock — the same clock as the scene
// Sprite's `localTime` and `time - useSceneWindow(N).start` — i.e. the
// scene-relative Whisper time plus `lead = audioStart − windowStart`
// (0 for the first scene, SCENE_OVERLAP otherwise; see "Scene clocks" above).
// Pass the same { overlap } you gave useSceneWindow if you overrode it.
//
// Usage:
//   const words = useWordTimings(3);  // words for scene 3
function useWordTimings(sceneIdx, { overlap = SCENE_OVERLAP } = {}) {
  const scenes = useScenes();
  if (!scenes) return [];
  const scene = scenes.find(s => s.idx === sceneIdx);
  if (!scene || !Array.isArray(scene.words) || scene.words.length === 0) return [];
  const o = _sceneOffsets(scenes, sceneIdx, overlap);
  const lead = o ? o.audioStart - o.windowStart : 0;
  return scene.words.map(w => ({ ...w, start: w.start + lead, end: w.end + lead }));
}

// ─── WordReveal ───────────────────────────────────────────────────────────────
// Animates per-scene narration text word-by-word, each word popping in on its
// exact Whisper timestamp. Requires scenes.json to contain a `words` array
// (populated by whisper via `node pipeline/cli.js cut` / the app's Finalize).
//
// Props:
//   sceneIdx      — 1-based scene index (must match useSceneWindow(N))
//   x / y         — CSS left / top position
//   width         — container width (default 660)
//   fontSize      — CSS font-size (default 52)
//   fontWeight    — CSS font-weight (default 800)
//   fontFamily    — CSS font-family (default Barlow Condensed)
//   color         — base text color (default '#fff')
//   accentColor   — color for ALL-CAPS words and numbers (default '#c8102e')
//   lineHeight    — CSS line-height (default 1.15)
//   animDur       — pop-in transition duration in seconds (default 0.07)
//   uppercase     — force all text to uppercase (default false)
//
// Words containing only digits, or written in ALL-CAPS (≥2 chars), receive
// the accentColor automatically — matching the TTS skill emphasis rules.
function WordReveal({
  sceneIdx,
  x = 30,
  y = 900,
  width = 660,
  fontSize = 52,
  fontWeight = 800,
  fontFamily = "'Barlow Condensed', sans-serif",
  color = '#fff',
  accentColor = '#c8102e',
  lineHeight = 1.15,
  animDur = 0.07,
  uppercase = false,
}) {
  // Both on the window clock (default overlap) — see "Scene clocks".
  const words       = useWordTimings(sceneIdx);
  const { start: sceneStart } = useSceneWindow(sceneIdx);
  const time        = useTime();
  const localTime   = time - sceneStart;

  if (!words.length) return null;

  const isAccent = (word) => {
    const clean = word.replace(/[^A-Za-z0-9]/g, '');
    if (!clean) return false;
    // All-digit (number)
    if (/^\d+$/.test(clean)) return true;
    // ALL-CAPS word of ≥2 alpha chars
    if (clean.length >= 2 && clean === clean.toUpperCase() && /[A-Z]/.test(clean)) return true;
    return false;
  };

  return (
    <div style={{
      position: 'absolute',
      left: x,
      top: y,
      width,
      fontSize,
      fontWeight,
      fontFamily,
      lineHeight,
      color,
      textTransform: uppercase ? 'uppercase' : 'none',
    }}>
      {words.map(({ word, start }, i) => {
        const visible = localTime >= start;
        const accent  = isAccent(word);
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              marginRight: '0.22em',
              opacity: visible ? 1 : 0,
              transform: visible ? 'translateY(0px)' : 'translateY(6px)',
              color: (visible && accent) ? accentColor : 'inherit',
              transition: `opacity ${animDur}s ease-out, transform ${animDur}s ease-out`,
              willChange: 'opacity, transform',
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
}

// ─── useWordCue ───────────────────────────────────────────────────────────────
// Returns the Whisper-derived start time (seconds) of when the narrator
// actually says a phrase inside a given scene, on the scene Sprite's
// `localTime` clock (window clock — the overlap lead is already included, see
// useWordTimings). Use this as the `delay` for any text overlay that introduces
// a specific word/stat/callout so the visual reveal is locked to the voiceover
// — NEVER use hand-guessed delays.
//
// Usage:
//   const cueFuel = useWordCue(3, "fuel rationed");
//   ...slideUp(Math.max(0, localTime - cueFuel), 0.5)
//   useWordCue(3, "fuel", { overlap: 1 })  // only if useSceneWindow(3, { overlap: 1 })
//
// Matching is case-insensitive and ignores punctuation, so "$103B" matches
// Whisper's "103" token, and "four of five" matches "Four of five,".
//
// If the phrase isn't found, logs a warning and returns Infinity so the
// element stays hidden (preferred over showing at the wrong time).
function useWordCue(sceneIdx, phrase, { overlap = SCENE_OVERLAP } = {}) {
  const words = useWordTimings(sceneIdx, { overlap });
  if (!words.length || !phrase) return Infinity;
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = String(phrase).trim().split(/\s+/).map(norm).filter(Boolean);
  if (!target.length) return Infinity;
  const flat = words.map(w => ({ n: norm(w.word), start: w.start }));
  for (let i = 0; i <= flat.length - target.length; i++) {
    let hit = true;
    for (let j = 0; j < target.length; j++) {
      if (flat[i + j].n !== target[j]) { hit = false; break; }
    }
    if (hit) return flat[i].start;
  }
  // Fallback: try matching just the first word of the phrase
  const first = target[0];
  const firstHit = flat.find(f => f.n === first);
  if (firstHit) {
    console.warn(`useWordCue(${sceneIdx}): phrase "${phrase}" not found exactly; falling back to first word "${first}" at ${firstHit.start}s`);
    return firstHit.start;
  }
  console.warn(`useWordCue(${sceneIdx}): phrase "${phrase}" not found in scene words`);
  return Infinity;
}

// ─── SubtitleRail ─────────────────────────────────────────────────────────────
// Karaoke-style subtitle bar synced to Whisper word timestamps.
//
// Displays narration in 5-word chunks (TikTok / Reels style):
//   - Upcoming words in the chunk: soft white (rgba 255,255,255,0.5)
//   - Past words in the chunk:     dim (rgba 255,255,255,0.28)
//   - Current word being spoken:   full white, scale 1.1x
//   - Numbers and ALL-CAPS words:  accent red (#c8102e) when current/past
//
// A semi-transparent dark pill behind each chunk guarantees readability over
// any background image. New chunk slides in as narration advances.
//
// Usage — add to EVERY scene Sprite that has narration (skip CTA):
//   <SubtitleRail sceneIdx={N} />
//
// Props:
//   sceneIdx    — 1-based scene index (matches useSceneWindow)
//   chunkSize   — words per chunk (default 5)
//   bottom      — CSS bottom offset in px (default 300)
//   fontSize    — px (default 32)
//   accentColor — highlight color for numbers/caps words (default #c8102e)
//   variant     — 'caps' (default: condensed CAPS on a dark pill, current word
//                 scales up) or 'clean' (sentence case, no pill, soft shadow,
//                 wider word gap, current word in accentColor at the same size)
//   fontFamily  — 'clean' only; default Manrope

function SubtitleRail({
  sceneIdx,
  chunkSize   = 5,
  bottom      = 300,
  fontSize    = 32,
  accentColor = '#c8102e',
  variant     = 'caps',
  fontFamily  = "'Manrope', sans-serif",
}) {
  // Both on the window clock (default overlap) — see "Scene clocks".
  const words       = useWordTimings(sceneIdx);
  const { start: sceneStart } = useSceneWindow(sceneIdx);
  const time        = useTime();
  const localTime   = time - sceneStart;

  if (!words.length) return null;

  // Index of the word currently being spoken (-1 = not started yet)
  let currentWordIdx = -1;
  for (let i = 0; i < words.length; i++) {
    if (localTime >= words[i].start) currentWordIdx = i;
  }

  // Hide before narration begins
  if (currentWordIdx < 0) return null;

  // Split all scene words into fixed-size chunks
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, Math.min(i + chunkSize, words.length)));
  }

  const currentChunkIdx = Math.floor(currentWordIdx / chunkSize);
  const chunk = chunks[currentChunkIdx];
  if (!chunk) return null;

  const isAccent = (word) => {
    const clean = word.replace(/[^A-Za-z0-9]/g, '');
    if (!clean) return false;
    if (/^\d+$/.test(clean)) return true;
    if (clean.length >= 2 && clean === clean.toUpperCase() && /[A-Z]/.test(clean)) return true;
    return false;
  };

  if (variant === 'clean') {
    return (
      <div data-subtitle style={{ position: 'absolute', left: 0, right: 0, bottom, display: 'flex', justifyContent: 'center', alignItems: 'center', pointerEvents: 'none', zIndex: 10 }}>
        <div style={{
          display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', maxWidth: 620,
          rowGap: Math.round(fontSize * 0.15), columnGap: Math.round(fontSize * 0.42),
        }}>
          {chunk.map((w, i) => {
            const globalIdx = currentChunkIdx * chunkSize + i;
            const color = globalIdx === currentWordIdx ? accentColor
              : globalIdx < currentWordIdx ? 'rgba(245,239,230,0.45)' : 'rgba(245,239,230,0.82)';
            return (
              <span key={i} style={{
                display: 'inline-block', fontFamily, fontWeight: 600, fontSize, lineHeight: 1.3,
                letterSpacing: '0.02em', color,
                textShadow: '0 2px 10px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)',
              }}>
                {w.word}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div data-subtitle style={{
      position: 'absolute',
      left: 0,
      right: 0,
      bottom,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      pointerEvents: 'none',
      zIndex: 10,
    }}>
      <div style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        rowGap: Math.round(fontSize * 0.1),
        columnGap: Math.round(fontSize * 0.22),
        background: 'rgba(0,0,0,0.52)',
        borderRadius: Math.round(fontSize * 0.3),
        padding: `${Math.round(fontSize * 0.18)}px ${Math.round(fontSize * 0.4)}px`,
        maxWidth: 660,
      }}>
        {chunk.map((w, i) => {
          const globalIdx = currentChunkIdx * chunkSize + i;
          const isCurrent = globalIdx === currentWordIdx;
          const isPast    = globalIdx < currentWordIdx;
          const accent    = isAccent(w.word);

          // Color logic
          let color;
          if (isCurrent)    color = accent ? accentColor : '#ffffff';
          else if (isPast)  color = accent ? `${accentColor}77` : 'rgba(255,255,255,0.28)';
          else              color = 'rgba(255,255,255,0.52)'; // upcoming

          return (
            <span
              key={i}
              style={{
                display:         'inline-block',
                fontFamily:      "'Barlow Condensed', sans-serif",
                fontWeight:      800,
                fontSize,
                lineHeight:      1.25,
                color,
                transform:       isCurrent ? 'scale(1.1)' : 'scale(1)',
                transformOrigin: 'center bottom',
                transition:      'color 0.07s ease-out, transform 0.07s ease-out',
                willChange:      'color, transform',
                textTransform:   'uppercase',
                letterSpacing:   '0.03em',
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, {
  Easing, interpolate, animate, clamp, spring, track, seededRandom,
  TimelineContext, useTime, useTimeline,
  Sprite, SpriteContext, useSprite,
  TextSprite, ImageSprite, RectSprite,
  Stage, PlaybackBar,
  ScenesContext, useScenes, useSceneWindow,
  useWordTimings, useWordCue, WordReveal,
  KenBurns, ImageCut, Parallax,
  SubtitleRail,
});
