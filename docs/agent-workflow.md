# Agent workflow

Reelsmith is designed to be driven by a coding agent. The agent does the creative work (research, the script, the animation, reviewing its own frames). The CLI does the mechanical work. A human approves every artifact that matters.

This page is written for Claude Code, which loads the skills automatically. Any agent that can read files and run commands can follow the same instructions.

## What the agent reads

| File | Purpose |
|---|---|
| `CLAUDE.md` | the project, the pipeline, the commands, the gates, the HTML rules |
| `skills/*/SKILL.md` (`.claude/skills/` in a project) | one skill per step, with the detailed rules |
| `config/strategy.md` | pillars and topic choice |
| `config/audio.md`, `config/music.md` | how the video should sound; the agent never asks for these values again |
| `config/voice/performance.md` | the PERFORMANCE block for TTS performance mode |
| `config/market.md` | optional market research, used only by the market-research skill |
| `styles/<name>/STYLE.md`, `styles/design.md` | the look of the chosen style pack |
| `videos/<name>/*` | the state of each video |

Config the agent needs is markdown on purpose: the agent can read it, and a human can review and edit it in a pull request.

## The skills

| Skill | Triggered by | Produces |
|---|---|---|
| `reelsmith-pipeline` | "make me a video", "what's next", "render it" | the plan: which step is next and which command runs it |
| `research` | "research this", a topic or URL | `research.md` with `Status: DRAFT` and 2 to 3 angle options |
| `script-writing` | "write me a script" | `script.md` with scenes, scene hints, voice direction |
| `teleprompter-prep` | "prep this for the teleprompter" | cues, breath marks and `## Delivery notes` in `script.md` |
| `take-review` | "review my take" | plain-language flags, the re-record loop, `reelsmith cut` |
| `html-animation` | writing or editing `index.html` | `index.html`, lint clean, contact sheet scored 8+, the preview gate |
| `publish` | "write the publish notes", "post it" | `publish.md`, then `reelsmith publish` after a dry run |
| `market-research` | "score this script" (only when asked) | a rubric score from `config/market.md` |

## A typical session

> **You:** make me a video about why CI gets slow

1. The agent runs `reelsmith new ci-slow` and the research skill. It writes `research.md` as `Status: DRAFT` and shows you the TL;DR and the angle options. **It waits.**
2. You say "approved, use angle B". The agent flips the status to `APPROVED` and writes the script. **It waits** for you to approve the script.
3. The agent asks which voice to use. **It waits.** You say "Leda, performance mode".
4. `reelsmith tts videos/ci-slow --voice=Leda --mode=performance`, then `reelsmith mix` with a track that fits the mood.
5. The agent reads the style pack and writes `index.html`, runs `reelsmith lint` until it exits 0, then `reelsmith sheet` and scores its own contact sheet, fixing the three worst problems each round until every score is 8 or higher.
6. `reelsmith sheet --stills` and `reelsmith draft`. It sends you `draft.mp4`, the contact sheet and stills with its scores. **It waits.**
7. You give feedback. It fixes, checks the range with `reelsmith clip`, sends a new draft. You say "approved".
8. `reelsmith approve videos/ci-slow --by="you"`, then `reelsmith render`. `output.mp4` is done.
9. You say "write the publish notes and post to YouTube". It writes `publish.md` (**waits** for approval), runs `--dry-run`, shows the output (**waits** for your go), then publishes and reports the URL and the actual privacy.

## The gates

The agent never crosses these on its own judgment:

| Gate | The agent must have |
|---|---|
| Research → script | your "approved" on `research.md` (then it sets `Status: APPROVED`) |
| Script → voice | your approval of `script.md` |
| TTS | the voice you named; it never picks one |
| Preview → render | your "approved" after watching `draft.mp4` and the stills; `reelsmith render` also checks the fingerprint and exits 3 without it |
| Notes → posting | your approval of `publish.md` and an explicit instruction to post, after a dry run |

Two gates are enforced by tools as well as by the skills: `reelsmith lint` must pass, and `reelsmith render` refuses without a current approval. Any change to `index.html`, `scenes.json`, the runtime, the style kit or the images after approval invalidates it.

## What the agent never does

- Pick a TTS voice.
- Set `Status: APPROVED` without your "approved".
- Run the final render, or `reelsmith approve`, without your approval of the draft.
- Publish, or publish publicly, without your explicit instruction.
- Run the YouTube sign-in: it needs you to click Allow.
- Ask you for audio levels that `config/audio.md` already defines.
- Print or commit tokens and secrets.

## Tips

- **Effort:** use high effort (or max) when the agent writes a new `index.html` or a new script, medium for small fixes and re-renders.
- **Iterating on a script:** after you edit a line, `reelsmith run videos/<name> --voice=<v>` redoes tts, mix, lint, sheet and draft in one go. In sentence mode only the changed line is re-synthesized.
- **Checking one scene:** ask for a range render; `reelsmith clip --from=S --to=S` takes seconds.
- **On your phone:** `reelsmith preview videos/<name> --lan` and scan the `/qr` page.
- **Something broke:** ask the agent to run `reelsmith doctor` first.
