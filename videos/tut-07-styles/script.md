---
title: Styles and style packs
topic: devtools
date: 2026-09-30
style: motion
tts_voice: Leda
tts_mode: performance
series: reelsmith-tutorials
episode: 7
---

## Script

### Scene 1
Same script, three completely different videos.
That is what style packs do.

### Scene 2
A style pack is a folder.
A markdown file that describes the look, a component kit the animation can use, and a reference video.

### Scene 3
Reelsmith ships three.
Reflective, warm and photo led, with serif headlines.
Tech news, dark with a red accent and code driven scenes.
And motion, the one you are watching, built for teaching.

### Scene 4
Pick a style in the frontmatter, or set a default in the project config.
Your agent loads the style file first, before it writes a single line of HTML.

### Scene 5
Want your own?
Copy a pack, change the palette, fonts, and layouts in the markdown, and add your components to the kit.
Your brand is now a style your agent can follow.

## Voice direction
The narrator shows how the visual identity of a video is swappable. Scene 3 names three styles; give each one its own color in the voice: warm for reflective, punchy for tech news, bright for motion. Scene 5 is encouraging.

## Scene Hints
- Scene 1 (hook): One script card in the middle, three phone frames fan out from it, each with a different palette: warm gold, red on black, bright blue on dark. Primitive: FanOut
- Scene 2 (pack): A folder tree `styles/motion/`: STYLE.md, kit.jsx, reference/. Each file pops on its cue. Primitive: FileTree
- Scene 3 (three styles): Three swatch cards slide in one by one: Reflective (Fraunces serif sample, gold), Tech news (Barlow Condensed, red), Motion (the current palette, "you are watching this" tag). Primitive: SwatchCards
- Scene 4 (pick): Code card frontmatter `style: motion` highlights, then a config card `"style": "reflective"`. A Claude Code chip with "reads STYLE.md first". Primitive: CodeCard + Chip
- Scene 5 (custom): A terminal `cp -r styles/motion styles/acme`, then a palette editor mock where the accent color swatch changes and the phone frame recolors live. Primitive: Terminal + PaletteMock
