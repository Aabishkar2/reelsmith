# Performance direction (TTS performance mode)

This block is sent as the direction of the single-call TTS prompt (`reelsmith tts <video> --mode=performance`). Everything from the line that says only PERFORMANCE to the end of this file goes into the prompt. Per-video CONTEXT comes from the `## Voice direction` section of `script.md`; the TRANSCRIPT is the script's spoken lines. Override this file for one video with `tts_performance: <path>` in its frontmatter.

Edit the three lines below to describe your channel's voice. Changing this file does not re-voice videos that already have audio (`reelsmith tts` keeps the cached take and says so); pass `--force` to re-voice one.

PERFORMANCE

Style: Warm, clear and conversational, like someone who knows the subject explaining it to a curious friend. The opening grabs attention right away, then the delivery stays natural: no presenter voice, no sales pitch. Emphasize the key phrase of each scene and give the final line a moment to land.

Pace: Brisk and engaging at the start. Keep the middle moving, with short pauses after each main point so it registers. Slow down slightly toward the end so the last line resonates.

Accent: Natural and clear, in the narrator's own accent. Avoid an exaggerated announcer tone.
