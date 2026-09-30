# Concepts

Reelsmith is a pipeline of small steps. Each step reads files and writes files. The files are the contract: any step can be redone, replaced by a plugin, or done by hand, as long as it writes the same files.

## The pipeline

```
script.md ─► voice ─► words ─► index.html ─► gates ─► output.mp4 ─► publish
```

| Stage | Command or skill | Reads | Writes |
|---|---|---|---|
| Script | `reelsmith new`, script-writing skill | `research.md` | `script.md` |
| Voice (TTS) | `reelsmith tts` | `script.md` | `voiceover/sN.mp3`, `voiceover.mp3`, `scenes.json` |
| Voice (own take) | `reelsmith record`, `analyze`, `cut` | `script.md`, `takes/` | `take.json`, then the same three files |
| Music | `reelsmith mix` | `voiceover.mp3`, a track | `voiceover-mix.mp3`, `voiceover-mix.json` |
| Animation | html-animation skill | `scenes.json`, `script.md`, a style pack | `index.html` |
| Gates | `reelsmith lint`, `sheet --stills`, `draft`, `approve` | `index.html`, `scenes.json` | contact sheet and stills, `draft.mp4`, `preview-approved.json` |
| Render | `reelsmith render` | `index.html`, `scenes.json`, audio | `output.mp4` |
| Publish | `reelsmith publish` | `output.mp4`, `publish.md` | `publish/<target>.json` |

## One project, many videos

A **project** is a folder with `reelsmith.config.json` at its root (in clone mode, the repo itself). Every command finds the project root by walking up from the current folder, so you can run them from anywhere inside it.

A **video** is a folder under `videos/`. Everything about one video lives in its folder: the script, the voice, the animation, the render, the publish results. Commands take the video as `<name>`, `videos/<name>` or a path.

## The central contract: `scenes.json`

Both voice paths end in the same three files:

- `voiceover/sN.mp3`: one clean audio file per scene.
- `voiceover.mp3`: the scenes joined in order.
- `scenes.json`: a bare array, one entry per scene.

```json
[
  { "idx": 1, "dur": 6.42, "file": "voiceover/s1.mp3",
    "words": [ { "word": "You", "start": 0.04, "end": 0.21 }, { "word": "write", "start": 0.21, "end": 0.48 } ] }
]
```

- `idx` matches `### Scene N` in `script.md`.
- `dur` is the exact length of `sN.mp3` in seconds. The video's length is the sum of `dur`; never hardcode it.
- `words` are Whisper word timings in seconds, **relative to the start of that scene's audio**, monotonic and clamped inside the scene.

Everything downstream reads only this file. That is why TTS, a recorded take or a new provider plugin can all feed the same animation and renderer.

## Word cues, not delays

In `index.html`, nothing appears at a hand-picked time. An overlay that shows a spoken number appears when that number is spoken:

```jsx
const cueBill = useWordCue(2, "bill");      // seconds, on the scene's clock
```

The runtime converts scene-relative word times to the scene's clock (scenes overlap by 0.5 s for crossfades, and the runtime accounts for it). `SubtitleRail` uses the same clock, so subtitles are always in sync. See [Animation](animation.md).

## Deterministic frames

Every frame is a pure function of time. The renderer sets the time, captures a frame, and moves on, in any order, across several browsers at once. So `index.html` may not use `Math.random`, timers, `requestAnimationFrame`, the wall clock or CSS transitions. `reelsmith lint` fails on them. This is what makes renders repeatable and parallel.

## Style packs

A style pack decides the look: palette, fonts, subtitle props, layouts, components. The agent loads it before it writes a line of HTML. A video's style comes from `style:` in `script.md`, else `style` in `reelsmith.config.json`. Three ship with Reelsmith: `reflective` (default), `tech-news`, `motion`. See [Styles](styles.md).

## Plugins

Four kinds, one registry:

| Kind | Role | Built in |
|---|---|---|
| `tts` | text → audio | `tts-openrouter` |
| `stt` | audio → word timings | `stt-whisper` |
| `style` | a look | the three packs |
| `publish` | send the MP4 somewhere | `publish-youtube`, `publish-meta`, `publish-discord` |

Built-ins load through the same registry as your plugins. `reelsmith plugins` lists what is loaded. See [Plugins](plugins.md).

## Gates

Reelsmith separates what an agent may decide from what a human must approve.

**Content gates** (a human approves the artifact before the next step):

| Gate | Artifact | Signal |
|---|---|---|
| Research | `research.md` | the user says "approved"; the agent flips `Status: DRAFT` to `Status: APPROVED` |
| Script | `script.md` | the user approves it in chat |
| Voice | the TTS voice | the creator names it; there is no default voice |

**Render gates** (four checks stand between an animation and `output.mp4`):

| Gate | Tool | Passes when |
|---|---|---|
| 1. Linters | `reelsmith lint` | check-sync and validate-sync both exit 0 |
| 2. Contact sheet | `reelsmith sheet` (`--stills` for the review) | the agent scored every criterion 8 or higher on its own frames |
| 3. Draft | `reelsmith draft` | the user watched `draft.mp4` and the stills and said "approved" |
| 4. Approval | `reelsmith approve --by=<who>` | `preview-approved.json` matches the current fingerprint (index.html, scenes.json, the runtime, every local script the page loads, the images); `reelsmith render` checks it and exits 3 otherwise |

**Publish gates:** the user approves `publish.md`, and posting only happens when the user says so, after a `--dry-run`.

Draft and clip renders skip the approval check: they are how you get to an approval.

## Settings and precedence

Settings come from several places. For each setting, the first one that is set wins:

1. CLI flag (`--voice=Leda`)
2. `script.md` frontmatter (`tts_voice: Leda`)
3. What the video used last time (`voiceover/tts/meta.json`: the TTS provider, mode, model and voice)
4. Environment (`TTS_VOICE`, …, usually from `.env`)
5. `reelsmith.config.json`
6. Built-in defaults

Agent-facing defaults (how loud the music is, how the TTS performance should sound) are markdown in `config/`, so the agent can read them and a human can edit them.

## Where to go next

- [Script format](script-format.md): the one file that controls the video.
- [Architecture](architecture.md): every file and its schema.
