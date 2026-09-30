# Fast render + fast feedback loop

Design + build contract for the fast renderer. Written 2026-09-29 after profiling the
render of a 98 s TTS short (2943 frames, 720×1280@30).

## Why the old renderer was slow (measured)

Old loop: one headless-shell tab → `setTime(t)` → 2× rAF → `page.screenshot({type:'png'})`
→ 1 MB PNG on disk → after all frames, `libx264 -preset slow` reads 3 GB of PNGs back.

| Variant (150-frame slice, 720×1280, M1) | ms/frame | frame size |
|---|---|---|
| A. headless-shell, PNG, 2 rAF (old) | 349 | 754 KB |
| B. headless-shell, JPEG q95, 2 rAF | 55 | 170 KB |
| C. headless-shell, JPEG q95, 1 rAF | 48 | 170 KB (pixel-identical to B, same md5) |
| D. headless-shell, CDP `Page.captureScreenshot` JPEG q95, 1 rAF | 44 | 170 KB (same md5) |

PNG encoding inside Chromium was ~85 % of every frame. React + layout is cheap.
Parallel-shard and encoder numbers: see "Benchmark results" at the bottom.

## Design

Every frame is a pure function of `time` (html-animation Rule 4, enforced by
`check-sync.js`), so frames can be captured in any order by any number of browsers.

```
render.js (orchestrator)
  ├─ plan: totalFrames = ceil(duration·fps); split into K contiguous shards
  ├─ shard k (own chromium process, own page, own CDP session)
  │     for frame i in [a_k, b_k):
  │        __stage.setTime(i/fps) → 1× rAF → Page.captureScreenshot(jpeg, q)
  │        → write bytes to ffmpeg stdin (image2pipe, backpressure-aware)
  │     ffmpeg encodes seg-k.mp4 concurrently with capture
  └─ concat seg-0..K-1 (concat demuxer, -c copy) + audio mux → output.mp4
```

No frames touch disk. Encode overlaps capture. K browsers use K cores.

## `renderer/render.js` — contract

CLI stays backward compatible:

```
node renderer/render.js <index.html> [output.mp4]
   [--fps=30] [--duration=S] [--width=720] [--height=1280] [--audio=path]
   [--shards=N]          default auto (see below)
   [--quality=95]        JPEG quality of captured frames (final default 95)
   [--encoder=auto|videotoolbox|x264]   auto = videotoolbox if ffmpeg lists it, else x264
   [--draft]             fast low-res preview render (see below)
   [--from=S --to=S]     render only this time range (seconds; either may be omitted)
   [--gpu]               opt-in: full chromium (channel 'chromium') + metal/GPU raster flags
   [--keep-segments]     keep the segment cache after a successful render
   [--no-preview-gate]   fixtures/tests only (unchanged)
   [--frames-dir=dir]    REMOVED. Print a one-line notice pointing to the segment cache.
```

**Shards default:** `min(4, os.cpus().length - 1, floor(os.freemem() / 400 MB))`, never
below 1. `--shards=N` overrides but is still capped at cores − 1. Print the chosen count
and why.

**Draft mode (`--draft`):** fps 15, width/height ×0.75 (540×960 for a 720×1280 video),
quality 80, encoder auto with the draft bitrate, output default `<videoDir>/draft.mp4`.
Skips the preview gate (the draft IS the preview artifact the human approves).
Any explicit `--fps/--width/--height/--quality` still wins over the draft defaults.

**Range mode (`--from/--to`):** clamps to `[0, duration]`, renders frames whose time
is in `[from, to)`, output default `<videoDir>/clip-<from>s-<to>s.mp4` (e.g.
`clip-12s-24s.mp4`; `clip-12s-24s-draft.mp4` with `--draft`), audio is trimmed with `-ss from -to to` before muxing. Skips the
preview gate. A full-range render (no --from/--to, no --draft) keeps the gate exactly
as before via `tools/approve-preview.js checkApproval`.

**Frame count:** exactly `ceil(duration·fps)` frames (the old loop rendered one extra
frame; drop it). Frame i is captured at `t = i / fps`.

**Music tail:** without `--duration`, the length is Σ `scenes.json` `dur`, unless `--audio`
is 0.1 to 6 s longer (the tail `tools/mix-music.js` adds, 2.5 s). Then the video runs to the
end of the audio and every frame past Σdur is captured at Σdur, so the tail holds the closing
frame instead of an empty stage. Audio more than 6 s longer is cut at Σdur.

**Per-frame capture:** `page.evaluate(t => window.__stage.setTime(t), t)`, then ONE
`requestAnimationFrame` wait, then CDP `Page.captureScreenshot({format:'jpeg', quality,
fromSurface:true, captureBeyondViewport:false})` via `page.context().newCDPSession(page)`.
Viewport set with `page.setViewportSize`. Decode base64 → `Buffer` → `ffmpeg.stdin.write`;
if `write` returns false, await `'drain'` before capturing the next frame.

**Per-shard ffmpeg:**
```
ffmpeg -y -loglevel error -f image2pipe -framerate <fps> -i pipe:0 <encoder args> -pix_fmt yuv420p seg-k.mp4
```
Encoder args:
- videotoolbox final: `-c:v h264_videotoolbox -q:v 75`
- videotoolbox draft: `-c:v h264_videotoolbox -q:v 50`
- x264 final: `-c:v libx264 -preset medium -crf 18`
- x264 draft: `-c:v libx264 -preset veryfast -crf 23`
All segments of one render use identical args so `-c copy` concat is valid.
Probe once with `ffmpeg -hide_banner -encoders` (cache the result in-process).

**Concat + mux:**
```
ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt [-ss from -t (to-from)] -i audio -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart output.mp4
```
(`-ss/-t` only in range mode, placed before the audio `-i` so they trim the audio input;
without `--audio` the concat has no audio args at all.)

**Segment cache / crash resume:** segments live in
`<videoDir>/frames/render-cache/<key>/seg-<k>-<a>-<b>.mp4` where `key` = first 12 hex
of sha256(preview fingerprint of the video dir + JSON of {fps,width,height,quality,
encoderArgs,from,to}). Use `fingerprint()` from `tools/approve-preview.js`. A
segment whose file exists, has size > 0, and whose ffprobe frame count equals `b − a`
is reused (print "reusing seg-k"). Other `<key>` dirs under `render-cache/` are deleted
at the start of a render (stale). The cache dir for the current key is deleted after a
successful final concat unless `--keep-segments`. `frames/` is already gitignored.

**Robustness:**
- Screenshot timeout 60 s, retry ×3 per frame (as before). After 3 failures: close that
  shard's browser, relaunch, re-open the page, continue from the same frame (do not
  restart the segment; ffmpeg's stdin stays open). After 3 relaunches: abort the render
  with a clear message; finished segments stay cached for the next run.
- If ffmpeg for a shard exits early, abort the render with its stderr.
- If chromium launch fails with `--gpu`, print the error and fall back to the default
  headless-shell launch for that render.
- On SIGINT: kill child browsers + ffmpegs, keep cached segments, exit 130.

**Progress:** one combined line, refreshed at most 5×/s:
`[████░░░░] 42%  1236/2943 frames  57 fps  ETA 0:30  (4 shards)`; final summary prints
wall time, capture fps, encoder used, output size.

**Exports for tests:** when `require`d as a module (not `require.main`), export
`{ planShards(totalFrames, shards), pickShards({cpus, freeMem, requested}), encoderArgs({encoder, draft, available}), resolveMode(args) }` and do not run.

## `tools/preview.js` + runtime — live preview with voice, on the phone

Today's preview is silent (no `<audio>` anywhere in `runtime/animations.jsx`).

**`runtime/animations.jsx` — `Stage` gains audio:**
- New prop `audioSrc` (string | null). Default `undefined` = auto: in non-render mode,
  `fetch(HEAD)` `voiceover-mix.mp3` next to the page, else `voiceover.mp3`; if neither
  exists, no audio (silent, exactly today's behaviour). `audioSrc={null}` disables. Render
  mode (`?render=1`) never creates the element.
- A hidden `<audio preload="auto">` element. When audio is loaded, the audio clock is the
  master while playing: the rAF step does `setTime(audio.currentTime)` instead of
  accumulating `dt`. On `setPlaying(true)` → `audio.currentTime = time; audio.play()`. On
  pause → `audio.pause()`. On any seek (`setTime` from bar/keys) → `audio.currentTime =
  t`. On `ended` → respect `loop` (restart at 0 or stop) like the dt loop does today.
- `audio.play()` can reject (mobile autoplay policy, first load). Then set `playing`
  false and show a centered "▶ tap to play" overlay (only when audio exists and is
  blocked); tapping it calls `setPlaying(true)`. The `autoplay` prop keeps working on
  desktop.
- `persistKey` restore keeps working (audio seeks to the restored time on load).
- Nothing changes in render mode; `?render=1` output must be byte-identical before/after
  (this is checked by the render test's fixture md5).

**`tools/preview.js`:**
- `--lan`: listen on `0.0.0.0` instead of `127.0.0.1`; print every non-internal IPv4 URL
  from `os.networkInterfaces()` plus a `/qr` link.
- `GET /qr?u=<url>` (any mode): serve a tiny inline HTML page (no new npm deps; load a QR
  library from a CDN in the page, e.g. `qrcode` via unpkg, with `integrity`
  omitted only if the pinned URL is used) that draws the QR for the LAN URL and prints
  it as text underneath. The user opens `/qr` on the Mac and scans it with the phone.
- Add `.mp3/.wav/.woff2/.webp/.json` MIME entries if missing (already present) and
  `Accept-Ranges: bytes` + Range support for audio (Safari on iOS requires Range
  responses to play `<audio>`). Implement Range for `.mp3/.wav/.mp4` only.
- Print a note when the machine has no non-internal IPv4.

## Docs to update (main thread does these after the agents)

- `CLAUDE.md`: pipeline diagram (draft step), commands block (draft, range, --lan),
  preview-gate paragraph (draft.mp4 replaces/accompanies stills).
- `skills/html-animation/SKILL.md` Rule 6 + checklist: after the contact-sheet
  loop, run `--draft`, send `draft.mp4` to the user together with the stills, approve,
  then final render.
- `docs/spec.md` line for `renderer/render.js`.

## Tests

`pipeline/test/render.test.js` (pure, fast):
- `planShards(2943, 4)` → 4 contiguous ranges covering `[0,2943)` exactly, sizes differ
  by ≤ 1; `planShards(5, 8)` → 5 shards of 1 (never empty shards).
- `pickShards`: `{cpus:2}` → 1; `{cpus:8, freeMem:16 GB}` → 4; `{cpus:8, freeMem:500 MB}`
  → 1; `{cpus:8, requested:6}` → 6; `{cpus:4, requested:6}` → 3.
- `encoderArgs`: videotoolbox available → videotoolbox args; not available → x264; draft
  variants; `--encoder=x264` forces x264 even when videotoolbox exists.
- `resolveMode`: `--draft` → gate off, fps 15, 540×960, out `draft.mp4`; `--from=12
  --to=24` → gate off, out `clip-12s-24s.mp4`; plain → gate on, out `output.mp4`.

`pipeline/test/render.e2e.test.js` (needs playwright + ffmpeg, ~30 s): renders
`videos/fixture-e2e` with `--draft --shards=2 --no-preview-gate` and asserts the mp4
exists, `ffprobe` frame count = `ceil(Σdur · 15)`, duration within 0.1 s of Σdur; then
a `--from=1 --to=3 --shards=1` clip has `ceil(2·30)` frames. Register both in
`run-tests.js` step 1 (e2e one skipped with a notice when `ffmpeg`/playwright missing).

## Benchmark results (filled in from scratchpad/bench/bench.log)

| Variant | Result |
|---|---|
| E. full chromium (`channel:'chromium'`), JPEG, 1 rAF, no GPU flags | 52 ms/frame |
| F. full chromium + `--use-angle=metal --enable-gpu-rasterization --ignore-gpu-blocklist --enable-zero-copy` | 34 ms/frame, pixels differ slightly from software raster (different md5) → `--gpu` stays opt-in |
| Parallel ×2, separate headless-shell processes, CDP JPEG, 1 rAF | 43 ms/frame aggregate incl. browser startups (12.8 s wall / 300 frames) |
| Parallel ×4 | **29 ms/frame aggregate** incl. startups (17.6 s wall / 600 frames, ≈34 fps) |
| Encode libx264 slow crf18 | 30.9 ms/frame |
| Encode libx264 medium crf18 | 18.7 ms/frame |
| Encode libx264 veryfast crf18 | 7.2 ms/frame |
| Encode h264_videotoolbox q65 | 6.3 ms/frame (file size ≈ x264 crf18) |
| Encode h264_videotoolbox 12M | 8.0 ms/frame (9× larger file, no point) |

Projection for that 98 s short (2943 frames): old ≈ 20 min → new ≈ 1.5 min final, ≈ 30 s draft.
Every encoder is faster than one shard's capture, so encoding is fully hidden.
