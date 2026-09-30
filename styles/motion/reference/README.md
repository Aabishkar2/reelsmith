# motion · reference

`index.html` is the approved reference video for this pack: a copy of `videos/tut-01-what-is-reelsmith/index.html`, the first Reelsmith tutorial ("Reelsmith in 60 seconds", 7 scenes, about 51 s). The comment block at the top of its script maps each scene to the kit components it uses:

| Scene | Beat | Built with |
|---|---|---|
| 1 | hook | `Counter` "150", then a `PhoneFrame` + `MiniReel` rising, `StatusRows` |
| 2 | name | `Logo` + `Wordmark`, a per-word `Title`, `PromptBox` + a "Claude Code" `Chip` |
| 3 | pipeline | `FlowDiagram` (5 nodes, one per spoken step) + a render `ProgressBar` |
| 4 | voice | `SplitCard` (`Waveform` / teleprompter), a synced word row, `Stamp` |
| 5 | files | `FileTree` + a deck of `CodeCard`s (`script.md`, `index.html`, `config/audio.md`) |
| 6 | plugins | empty sockets, then `PluginDock` (swap tts, add style, add publish) + `Callout` |
| 7 | close | a syllabus grid + `Terminal` typing `npx reelsmith init my-channel` with `finalPrompt` |

Read it for the patterns: every reveal bound to a `useWordCue` phrase, one kit-led composition per scene, `SceneRoot` transitions that never repeat back to back, and the few local components (word dots, focus rings, a teleprompter, a card deck) that add only what the kit does not have.

It is shipped as **code to read**, not a runnable page. It needs that video's `scenes.json` (word timings) and `voiceover/` audio, which are not in the pack, and its `../../runtime/animations.jsx` and `../../styles/motion/kit.jsx` paths assume it sits at `videos/<name>/index.html`. To watch it, use the original: `reelsmith preview tut-01-what-is-reelsmith` in this repo. New videos load `styles/motion/kit.jsx` and write their own scenes; do not copy this file's cues, they only match tut-01's voiceover.
