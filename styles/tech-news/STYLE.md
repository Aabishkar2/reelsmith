---
name: tech-news
description: Red "breaking tech news" look. Near-black, one red accent, Barlow Condensed headlines, designed-from-code scenes, no stock photos. Only when asked.
---

# Style: tech-news (use only when asked)

The original red "breaking tech news" look: near-black `#080c14` / `#000`, a single red accent `#c8102e`, Barlow Condensed 800 headlines and Barlow body, and designed-from-code scenes (diagrams, stat cards, code blocks) with **no stock photos**.

Use it only when the creator asks for it, or when `script.md` frontmatter has `style: tech-news`. For developer tutorials prefer `styles/motion/STYLE.md`; for essays `styles/reflective/STYLE.md`.

Read with it:
- `styles/design.md`: the shared base (canvas, CDN scripts, base HTML, safe area, banned defaults, animation principles)
- `styles/tech-news/components.md`: runtime primitives + the inline helpers this style defines per video (`SceneBg`, `BreakingTag`, `Divider`, `Stat`, `CTACard`, …)
- `styles/tech-news/templates.md`: scene templates, including the silent `cta-end` card every tech-news video ends on
- `skills/html-animation/SKILL.md` Rule 3: design from code, no stock photos (tech-news only)

## Palette

| Role | Value | Usage |
|---|---|---|
| Background | `#000` / `#080c14` | Scene and CTA backgrounds |
| Accent | `#c8102e` | Breaking tags, dividers, labels, CTA dot |
| Text primary | `#fff` | Headlines, stat values |
| Text secondary | `rgba(255,255,255,0.80)` | Body copy |
| Text muted | `rgba(255,255,255,0.65)` | Stat labels, supporting text |
| Text faint | `rgba(255,255,255,0.50)` | Date badges, timestamps |
| Overlay card | `rgba(200,16,46,0.15)` with border `rgba(200,16,46,0.4)` | Condition/callout boxes |

One display face (Barlow Condensed), one UI face (Barlow), one accent (`#c8102e`) unless the brief says otherwise.

## Fonts

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
```

| Role | Family | Weight | Size (reference) |
|---|---|---|---|
| Display headline | Barlow Condensed | 800 | 52–72px |
| Section label | Barlow Condensed | 700 | 18–22px |
| Stat value | Barlow Condensed | 800 | 72–96px |
| Body copy | Barlow | 400 | 24–28px |
| Sub-label / badge | Barlow | 600 | 14–18px |
| Stat label | Barlow | 500 | 20–24px |

## Subtitles

`<SubtitleRail sceneIdx={N} />` with the runtime defaults (`variant="caps"`, accent `#c8102e`). Pass `fontSize={26} variant="clean"` only if the creator asks for the smaller line on a tech video too.

## Image overlays (when a scene does use an image)

Full-bleed background images always get a gradient dark overlay:
```
background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.3) 100%)
```

The runtime motion primitives (`KenBurns`, `ImageCut`, `Parallax`) include this gradient automatically via `gradient={true}` (the default).

**Visual pacing rule:** no image held static >3 seconds. Use the appropriate primitive from `styles/tech-news/components.md`:
- `KenBurns` — single image, slow zoom+pan (scale 1.0 → 1.08, translate ±1–2% over scene)
- `ImageCut` — cycles 2–4 images with 0.15s cross-dissolve and per-image Ken Burns
- `Parallax` — two-layer depth drift (background moves slowly, optional foreground at different speed)

`SceneBg` (legacy static helper) is retired for new videos.

## Ending

Tech-news videos end with a `cta-end` scene: a silent on-screen card, never narrated (the script's last spoken beat is the takeaway, not a "follow/subscribe" line). See `templates.md`.

## Reference

`videos/fixture-e2e/index.html` is a small tech-news video (4 scenes) that the test suite renders end to end.
