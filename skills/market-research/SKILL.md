---
name: market-research
description: Score a script or topic against the project's short-video market research (config/market.md). Optional, and only when the user asks - "what gets views", "score this script", "is this topic worth it", "will this do numbers". Never runs automatically as part of script writing.
---

# Market research skill

Reads `config/market.md`, a one-time deep dive into what makes short explainers perform, and applies it two ways: (1) score a written script against its §11 rubric, (2) add its §8 topic signals when suggesting or judging topics, alongside `config/strategy.md`.

This skill is **optional**. Run it only when the user asks. The script-writing skill does not call it.

`config/market.md` is the source of truth. Re-read it every time; do not paraphrase it from memory. If the project has no `config/market.md`, say so and stop. A new project can copy the framework repo's `config/market.md` as a starting point.

---

## Mode 1: score a script

Trigger: "score this script", or any request to check a script against the market rules.

### Steps

1. Read `config/market.md` §11 (scoring rubric) and the TL;DR at the top.
2. Read `videos/<name>/script.md`: `## Script`, `## Scene Hints` and `## Blueprint` if present. Read `research.md` too (for G17).
3. Compute the spoken word count and the spoken-word position where each line starts. Count digits and acronyms as read aloud, use only lines inside `### Scene N` blocks, never count `>` cues. Rough duration is `words / 2.9` seconds; compare it to 45 to 65 s / 130 to 170 words. You need the positions for word 25 (rows 1, 5, 6) and the 40 to 55 % turn window (row 8).
4. Score every rubric row 1 to 18 as yes or no. **Every "yes" cites the line ids (or the section) it relies on**; a "yes" without ids is a "no". Be literal. When a check is ambiguous, mark it no and say why.
   - **[H] rows** (#3 frame-0 overlay, #14 visuals) are scored against `## Scene Hints`. Missing hints, or no frame-0 overlay on scene 1, means no.
   - **[B] rows** (#2, #4, #6, #7, #12) are scored against `## Blueprint` **and** the lines. No Blueprint means no. A Blueprint claim the lines contradict is also no.
   - **#12:** compare the final blind-read round's lines with `## Script` word for word. Any drift means the read is stale: no. The log must say the reader was a fresh subagent given only the title and lines.
5. Sum the weights of every "yes" for a score out of 100.
6. Check the five hard gates independently. They pass or fail regardless of the total:
   - **G1** (row 1, hook): s1.1 is 12 spoken words or fewer, a specific claim (cost, contradiction, number, failure) about a named thing. s1.1 or s1.2 addresses the viewer ("you/your"). The hook confirms the title. No greeting, "in this video", "let's dive in" or generic question.
   - **G4** (row 4, through-line): one Core Question and exactly one villain; every scene advances it; no line adds a second cause.
   - **G12** (row 12, blind read): a fresh-subagent log whose lines match `## Script`, zero LEAK rows and no swipe line in the final round.
   - **G16** (row 16, bans): zero banned phrases from market.md §10, plus the script-writing skill's bans under "Sounding human" (hype words, filler openers, "like and subscribe", spoken calls to action).
   - **G17** (row 17): every fact traces to a line in `research.md`; timely claims are dated.
7. Print the score table (check, yes/no with line ids, weight earned) and the total. If the user asks, also write it under `## Score` in script.md (the parser ignores that section).
8. Verdict:
   - **Score 80+ AND all 5 gates pass: PASS.**
   - **70 to 79: FIX.** List the failed checks in priority order (gates first, then the highest weights).
   - **Under 70: REWRITE.** Say which beats are missing or misordered.
   - **Any gate fails: FAIL**, whatever the total. Say which gate and why.

### Output format

```
## Market score: <video-name>

Words: <N> spoken (~<N>s at 2.9 wps), target 130–170 words / 45–65 s. Turn starts at word <n> (<pct>%).

| # | Check | Y/N (line ids) | Wt | Earned |
|---|---|---|---|---|
| 1 G | Hook: s1.1 ≤12, specific, named; you/your in s1.1–s1.2; confirms title | Y: s1.1 "…" (11 words), "your" in s1.1 | 8 | 8 |
...
|   | **Total** | | **100** | **<score>** |

Gates: G1 <pass/fail> · G4 <pass/fail> · G12 <pass/fail> · G16 <pass/fail> · G17 <pass/fail>

**Verdict: PASS / FIX / REWRITE / FAIL** — <one line why>
<if not PASS: what to change, worst first>
```

---

## Mode 2: topic signals (with `config/strategy.md`)

Trigger: "what gets views", "is this topic worth it", or while the strategy workflow's Step 2 ("score each candidate") runs and a market lens helps.

Apply `config/market.md` §8 (topic selection signals) on top of the pillar fit:

- **News peg, evergreen payload:** favour topics tied to something that shipped, broke or trended in the last 1 to 2 weeks, built so the lesson does not expire.
- **Format ranking:** "what is X" is the weakest opener. Scale or case study, "why is X so fast/expensive", incident plus number, and X vs Y rank higher.
- **Niche ceiling:** a topic framed as trivia for one tool caps low. Reframe it through a universal pain (the bill, an outage, latency) and lead with the consequence.
- **Freshness window:** a news explainer has roughly a 1 to 2 week shelf life. Do not suggest topics more than about 2 weeks stale unless framed as evergreen.
- In the suggestion format from `config/strategy.md` Step 3, add a one-line "Market fit" per suggestion: the format tier and whether it is news-pegged or evergreen.

---

## Phase 2 (not implemented): per-topic YouTube Data API pull

**Do not attempt this.** It documents a planned design only.

- **APIs:** YouTube Data API v3 `search.list` (candidate videos for a query), `videos.list` (`title`, `contentDetails.duration`, `statistics.viewCount`, `snippet.publishedAt`, `snippet.channelId`), `channels.list` (`statistics.subscriberCount`).
- **Metric:** views per day since published, to compare videos of different ages.
- **Clustering:** group titles by pattern (ordinal-led, "why is X", "X vs Y", scale-number, incident plus number).
- **Output:** `videos/<name>/market-topic.md`, a per-topic supplement to `config/market.md`.
- **Requirements:** a `YOUTUBE_API_KEY`. The default quota is 10,000 units per day and `search.list` costs 100 units per call.
- **Status:** stub. Do not write code under `tools/`, call the API, or fabricate a `market-topic.md`. If asked, say it is documented but not built and point here.
