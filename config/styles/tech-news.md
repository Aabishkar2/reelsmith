# Style: tech-news (use only when asked)

This is the original red "breaking tech news" look: near-black `#080c14` / `#000`, a single red accent `#c8102e`, Barlow Condensed 800 headlines and Barlow body, and designed-from-code scenes (diagrams, stat cards, code blocks) with **no stock photos**.

It's no longer the default. Use it only when the creator asks for it, or when `script.md` frontmatter has `style: tech-news`. Otherwise use `config/styles/reflective.md`.

The rules are unchanged and live where they always did:
- `config/design.md`: palette, fonts + Google Fonts link, type scale, animation principles, layout, banned defaults
- `.claude/skills/html-animation/SKILL.md` Rule 3: design from code, no stock photos (tech-news only)
- `config/components.md` / `config/templates.md`: primitives and scene templates, including the silent `cta-end` card every tech-news video ends on

Subtitles: `<SubtitleRail sceneIdx={N} />` with the runtime defaults (`variant="caps"`, accent `#c8102e`). Pass `fontSize={26} variant="clean"` only if the creator asks for the smaller line on a tech video too.
