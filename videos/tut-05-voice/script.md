---
title: Voice, TTS or your own take
topic: devtools
date: 2026-09-30
style: motion
tts_voice: Leda
tts_mode: performance
series: reelsmith-tutorials
episode: 5
---

## Script

### Scene 1
Reelsmith gives you two ways to get a voice.
A text to speech model, or your own recording.
Both end in the same files.

### Scene 2
Text to speech has two modes.
Sentence mode calls the model once per line, caches every clip, and joins them with clean gaps.
Change one line, and only that line is regenerated.

### Scene 3
Performance mode sends the whole script in one call, with a direction prompt.
Style, pace, accent.
It sounds more like one person talking, and it is what you are hearing right now.

### Scene 4
Prefer your own voice?
Run reelsmith record.
A teleprompter opens in your browser, scrolls at your pace, and records one long take.

### Scene 5
Then reelsmith analyze runs Whisper and aligns your take to the script.
It flags fillers, stutters, long pauses, and lines you skipped.

### Scene 6
Re record only the flagged lines, and run reelsmith cut.
Fillers are trimmed, the best attempt of each line is kept, and you get scenes dot json plus a clean voiceover.

## Voice direction
The narrator explains two voice paths. Scene 3 is self referential: the narrator is literally the output of performance mode, so deliver "what you are hearing right now" with a smile. Keep the recording path practical.

## Scene Hints
- Scene 1 (hook): Two doors side by side: "TTS" and "Your take". Both arrows converge into one file pair badge: scenes.json + voiceover.mp3. Primitive: SplitCard + Merge
- Scene 2 (sentence mode): A script with 4 lines; each line fires a tiny API request icon and returns a clip block; the blocks join on a timeline with small gaps. One line edits and only that block re-flashes. Primitive: Timeline
- Scene 3 (performance mode): One big request card containing PERFORMANCE / CONTEXT / TRANSCRIPT sections, a single waveform returns. A "you are hearing this" tag points at the waveform. Primitive: RequestCard + Waveform
- Scene 4 (record): A browser window mock: teleprompter text scrolling, a red REC dot, a level meter. Terminal chip `reelsmith record`. Primitive: BrowserMock
- Scene 5 (analyze): take.json table rows: s1.1 ok, s1.2 warn filler "um", s2.1 bad mismatch, s2.2 missing. Rows fill on cues. Primitive: StatusRows
- Scene 6 (cut): Timeline with a red filler segment removed (collapses), then the output badge pair snaps in. Terminal `reelsmith cut`. Primitive: Timeline + Terminal
