# Market Research — Short-form Technical Video (2026)

Scope: YouTube Shorts explainers for working engineers. Creator voice-over (no face), animated diagrams/text/b-roll, karaoke subtitles, AI-drafted script read from a teleprompter. Compiled 2026-09-27.
Tags: **[OFF]** YouTube official · **[STUDY]** peer-reviewed or large-n · **[VENDOR]** tool/SEO vendor, method opaque · **[ANEC]** anecdote · **[OWN]** our measurement (source 33) · **[INF]** inference. Cite as `[#, date]`.

## TL;DR — the 10 rules

1. **Line 1 ≤12 words: a specific claim about a named tech** (a cost, contradiction, number or failure). No greeting, no "in this video", no "let's dive in". [2, 2025-01; 8, 2025-11; 33]
2. **The question or tension is stated within the first two lines** (≤25 spoken words, ≈8–10 s), and a partial payoff lands by ~0:30. [10, 2026-01]
3. **45–65 s, 130–170 words, 165–185 wpm.** Longer only if the mechanism needs it. [12, 2014; 33; 35, 2024]
4. **One idea:** one mechanism + one tradeoff + one takeaway.
5. **The screen changes every 2–4 s** (node, arrow, highlight, cut). Diagrams, not stock footage. [7, 2025-11; 17, 2000]
6. **Re-hook (the turn) at 35–55% of spoken words** with the gotcha. [10; 21, 1994]
7. **End on the payoff:** a repeatable takeaway, no outro or CTA. Optionally loop back into line 1. [5, 2025-03; 10]
8. **Karaoke subtitles on. Overlays ≤6 keywords that add to the speech, not repeat it. No music under narration.** [15, 2015; 17; 18, 2016]
9. **Title = named tech + tension.** 2–3 accurate hashtags. [31; 33]
10. **News peg, evergreen payload.** ≥12 Shorts/month, each built differently (templated sameness risks the inauthentic-content rule). [11, 2026; 22, 2025-07; 29, 2025-12]

## 1. Format & length

- **Shorts** = vertical or square, ≤3 min, uploaded after 2024-10-15 [1, OFF, 2026].
- **Duration isn't ranked; enjoyment is.** Signals YouTube names: viewed vs swiped away, watch time, rewatches, likes, shares, comments [3; 4, OFF, 2023-08].
- **Evidence on length:**
  - Galloway (5,400 Shorts, 3.3B views): 40 s+ Shorts that held AVD did best; AVD >50 s averaged 4.1M views; outliers at every length [6, ANEC, 2023-04].
  - OpusClip: educational content does best at 35–45 s, tips at 15–20 s [7, VENDOR].
  - ByteByteGo, the closest analog (faceless, diagrams + VO): median 54 s / 142 words (n=14). Its 5 most-viewed ran 49–60 s. Fireship: median 45 s / 150 words [33 OWN].
- **Attention context:** the average stretch on one screen before switching is ~47 s (median 40 s) [20, STUDY, 2023].
- **Conflict:** vendors say 15–45 s; Galloway and ByteByteGo say ~50–60 s if retention holds. **Use 45–65 s for mechanisms, 25–40 s for single gotchas.**
- **BIDS is internally inconsistent:** 150 words at 175 wpm lasts ~50 s, not 60–90 s. Derive word count from duration (≈2.9 words/s).
- **3-minute limit:**
  - Retention is judged against Shorts of similar length [10].
  - Most Audio Library tracks cap at 30–90 s.
  - Since 2026-09-24, 1–3 min Shorts with a Content ID claim are no longer auto-blocked [1].
  - Go past 90 s only after a 60 s version has proven the topic.
- **Loops:** since 2025-03-31, every start or replay counts as a view. Ranking and YPP use *engaged* views [5, OFF]. Shorts hit 200B daily views in June 2025, partly because of this change [36, OFF].

## 2. Hooks

**Evidence**
- 50–60% of drop-offs happen in the first 3 s. Aim for >70% of viewers past 3 s [7, VENDOR]. Hoyos: you get about 1 s [2].
- Deliver the hook in 2–2.5 s. For education, a direct promise beats a pattern interrupt [8, VENDOR].
- Winning first frames combine 1 focal visual, 1 short spoken line and matching text. Visual demonstration is the most common top hook (2,847 clips) [9, VENDOR, 2026-04].
- Curiosity is an information gap. A small, specific fact triggers more of it than a vague tease [21, STUDY].
- Packaging makes a promise; deliver it immediately. There's no slow burn [27, OFF, 2023-08; 26, 2024-09].

**How tech channels open** [33 OWN, transcripts, paraphrased]
- **Fireship** (median 1.25M views per Short):
  - A 3 a.m. broken-code scene.
  - Incident + number (CrowdStrike's Friday push, 8.5M machines).
  - Timeline compression (HTML 1990 → CSS "to fix it"…): its top Short, 5.2M.
  - Absurd analogy (Big O explained with playing cards).
  - Never a greeting.
- **ByteByteGo** (median 381K):
  - Ordinal + open loop ("3 reasons Redis is fast; the last is unintuitive"): 1.3M.
  - Scale number ("1 TRILLION messages"): 2.4M.
  - "What is X?" openers: 35K–230K.
- **Theo / ThePrimeagen:** clips that start mid-argument, opinion in sentence 1.
- **NetworkChuck:** number + story ("16 million times"): ~7× his median.
- Definition-first openers (Fireship's long-form style [39]) underperform in Shorts.

**Templates** (fill from research.md)
1. "[Service] bills you twice for [thing]. Here's where."
2. "[Belief] stopped being true in [year]."
3. "[N] [unit]. That's what [setting] costs you."
4. "How does [X] do [N]/sec on [constraint]?"
5. "[Company] did [action]; [N] [consequence]. Cause: [pattern]."
6. "[N] reasons [X] is [fast/expensive]. The last one surprises people."
7. "Your [retries] are [failing], and the logs look fine."
8. "[X] vs [Y]. One number decides it."

**What loses:** greeting, name or logo; "have you ever wondered"; context first ("AWS recently announced…"); definition first; superlatives; a hook the visuals don't show.

**Spoken vs on-screen:** frame-0 overlay ≤6 words carrying the tension ("NAT gateway: billed twice"). The voice adds the specifics. Never repeat the spoken sentence as a headline; the subtitles already do that [18].

## 3. Retention & pacing

- **Speaking rate:**
  - Guo (6.9M sessions): engagement rose up to 2× with faster speech in every length bucket [12, STUDY, 2014].
  - 254 wpm stayed understandable when the visuals carried the content.
  - In 6–12 min videos, engagement dipped at 145–165 wpm, where instructors were least energetic.
  - The authors credit enthusiasm, not speed itself.
- **Measured** [33 OWN, ASR words ÷ speech span, ±10%]: ByteByteGo median 160 wpm (132–196). Fireship 218 (143–251). Theo 203.
- **Subtitle readability:** BBC recommends 160–180 wpm, ≥0.3 s per word [35].
- **Target 165–185 wpm.** Floor 150 (sounds flat). Ceiling 200 (karaoke text gets hard to follow).
- **Visual cadence (conflict):** a cut every 2–4 s [7, VENDOR] vs a visual change every 1–2 s plus a micro open loop every 5–8 s [10, VENDOR].
  - On diagrams, a new node, arrow, highlight or zoom counts as a change.
  - Film shot lengths shortened between 1935 and 2005 and settled into a 1/f rhythm [34, STUDY, 2010]. Vary tempo in phrases (fast hook, one longer hold on the key diagram) rather than cutting like a metronome.
- **Where viewers drop** [10]:
  - 0–1.5 s: hook or first frame failed.
  - 3–8 s: payoff too slow.
  - One specific timestamp: a dead beat. Cut it.
- **No dead air:** edX cuts fillers and pauses [12]. Allow no pause >0.4 s except one deliberate beat before the gotcha [INF].
- **Re-hook** at 35–55% of spoken words: "That's the happy path. Here's what breaks." [21; 26].
- **Benchmarks conflict:** "70% viewed = good" [40, VENDOR] vs "50% for 30–60 s" [37, unsourced]. YouTube publishes no thresholds. Use Studio's similar-length comparison [10].

## 4. Structure that works for explainers

| t (60 s) | Beat | Job |
|---|---|---|
| 0–3 s | Hook | Specific claim + frame-0 overlay |
| 3–8 s | Stakes | Why it bites at work; state the question |
| 8–30 s | Mechanism | 2–3 steps, one diagram state each = partial payoff |
| 30–35 s | Turn | "But…" gotcha = re-hook (≈35–55% of runtime) |
| 35–52 s | Tradeoff | Decision rule with a number |
| 52–60 s | Takeaway | One repeatable sentence, then stop |

- This mirrors Fireship's what → why → how → when [39, ANEC].
- Never hold the only payoff for the last 3 s [10].
- **Series:** ByteByteGo's Kafka Part 2 got 70% of Part 1's views [33]. Each part must stand alone.
- **Loop endings:** a final line that runs naturally into line 1 earns replays [10, VENDOR], and replays count as views [5].
- **No spoken CTA.** There's no evidence it helps, and it adds a swipe point [INF]. Any required end card: ≤1.5 s, silent.

## 5. Voice & delivery

- **Faceless VO works in tech:** ByteByteGo (1.43M subs, 381K median, diagrams + VO) and Fireship (4.28M subs, VO over memes and code) [33].
- **Tone beats wording:** across 210 lectures and 738 students, a positive, high-energy voice (happy, surprised) raised engagement. Emotive word choice didn't; anger lowered it [13, STUDY, 2025]. Sound curious; don't write hype.
- **Don't slow down artificially.** Enthusiasm drives the speed effect [12].
- **Cut** "um/uh", restarts and breaths [12].
- **Audio:** the same talk with echoey audio got the speaker and the research rated lower [14, STUDY, 2018]. Minimum: close mic, no echo, inaudible noise floor. Loudness ~-14 LUFS is convention [INF].
- **Music:** background music under narration reduced recall and transfer [17, STUDY]. None, or a sting at hook/end only [INF].
- **AI-drafted scripts:**
  - The inauthentic-content rule (2025-07-15) targets mass-produced or templated content without meaningful human input. Human narration plus original analysis is safe [22, OFF].
  - Mohan's 2026 letter prioritizes cutting AI "slop" [23, OFF, 2026-01]. AI labels reduce engagement [24, STUDY, 2026].
  - Include a lived gotcha and an opinion in every script.
- **Teleprompter:** average ≤14 words per sentence, contractions, one breath per sentence [INF].

## 6. Visual style

- **Captions:**
  - 100+ studies: captions improve comprehension, attention and memory for everyone [15, STUDY].
  - Survey (n=5,616): 80% more likely to finish with captions; 69% watch sound-off in public [16, 2019].
  - Vendor claims, unverified: +15–25% retention [7]; word-by-word beats static [38].
  - Caveat: Shorts autoplays with sound, so 69% overstates muted viewing here [INF].
- **Redundancy:** narration + full text + animation can hurt learning; keyword-only text is the exception [18, STUDY]. So: subtitles + ≤3-word diagram labels. **Never 3 text layers at once.**
- **Diagrams over stock:**
  - Progressively drawn visuals beat slides [12].
  - Decorative visuals hurt [17].
  - ByteByteGo reveals icons and arrows one step at a time [33].
  - Stock b-roll = 1–2 s pattern breaks only.
- **Density:** ≤6 words per overlay, 1 focal point per frame [9].
- **Contrast** ≥4.5:1 (WCAG AA). One accent color, reserved for the thing that matters [INF].
- **Safe zones:** keep text out of the bottom ~20% and the right edge, where Shorts UI sits [INF].
- **Frame 0 is content** (diagram or "before" state), not a title card [9].

## 7. Titles, descriptions, hashtags, thumbnails for Shorts

- **The feed dominates:** 99.9% of Hoyos's views come from it [2]. Titles still matter for search, the title overlay and topic context.
- **Thumbnails (conflict):** Sherman said most are never seen (2025-05). YouTube began rolling out custom Shorts thumbnails (1080×1920, <2 MB) to YPP creators in 2026-07 [30]. They help search and the channel page, not the feed. Make one: 3–4 words over a diagram crop.
- **Hashtags** [31, OFF]:
  - Optional. The first 3 display; >60 and all are ignored; misleading tags risk removal.
  - SEO blogs say ">15 ignored" (conflicts with official).
  - Use 2–3 accurate ones (#aws #dynamodb). ByteByteGo's #python on Kafka Shorts is the anti-pattern [33].
- **Length:** ≤45 characters preferred, 60 hard max; named tech in the first 3 words. ByteByteGo's top titles run 17–38 [33].
- **Within-channel patterns** [33 OWN]:
  - ByteByteGo: "Why is Redis so FAST" 1.3M; "How Big Tech Ships Code to Production" 1.8M; "Netflix Tech Stack" 1.7M; "What is X?" 35K–230K.
  - Theo: "Why Can't We Commit .env Files?" 474K vs AI-news reactions 7K–73K.
- **Description:** line 1 = the takeaway with keywords; line 2 = the source link; then hashtags [INF]. Keep the title distinct from the spoken hook.

## 8. Topic selection signals

- **Collective attention is shortening:** a top-50 hashtag lasted 17.5 h in 2013 vs 11.9 h in 2016, and the same holds for Google and Reddit [19, STUDY]. Ship news reactions within 24–72 h. A news explainer lasts 1–2 weeks [INF].
- **Freshness:** since 2025-09, Shorts older than ~30 days get far fewer new impressions (seen on 100M–1B-views/month channels; YouTube hasn't confirmed) [29, ANEC]. Evergreen Shorts compound less.
- **But evergreen wins within a channel:** Theo's top 3 Shorts are all evergreen. ByteByteGo's newsy MCP (50K) and prompt-injection (35K) Shorts trail its mechanism Shorts [33]. **News peg, evergreen payload.**
- **Format ranking** [33, small n, age-confounded]:
  1. Scale/case study ("how Netflix does X")
  2. "Why is X so fast/expensive"
  3. Incident + number
  4. X vs Y (Fireship image formats 1.3M ≈ its median)
  5. "Stop doing X (do this first)" (Nana: 2.75× her median)
  6. "What is X" (weakest)
- **Niche ceiling:** Be A Better Dev's two AWS-only Shorts got 5–7K [33, n=2]. Frame AWS through universal pain (the bill, an outage, latency) and lead with the consequence, not the feature.
- **Discovery:** the feed is primary; search helps evergreen "why/how" topics [2; INF].

## 9. Posting cadence & channel-level factors

- **vidIQ (10.2M channels, 2025-04→2026-03):** channels posting 12+ times a month grew views 2.18%/month vs 0.53% for <1/month (4.1×); subs 0.91% vs ~0. Correlational [11].
- **YouTube:** no magic post count, quality over quantity, posting time matters little [3; 4, OFF]. The algorithm follows the audience: make more of what your Audience tab shows growing [28, OFF, 2024-08].
- **Rotate templates, hook types and structure.** Identical high-volume output is what the inauthentic-content rule targets [22].
- **Target 12–20/month, batch-scripted** [INF].
- **Shorts vs long-form:** in a study of 250 creators, long-form views fell after Shorts began, but education channels were relatively unaffected [32, STUDY, 2024-04]. Shorts convert few subscribers [ANEC].
- **Series:** a named recurring series ("AWS bill traps #3") gives viewers a reason to return. Ritchie says cliffhangers are underused [27].
- **Community:** comments and shares are ranking signals [4]. Reply early; pin corrections [INF].

## 10. Anti-patterns

- Greetings or logos; "In this video", "Let's dive in", "Today we'll explore".
- Opening with a definition or background context.
- More than 1 concept; stacked caveats; every edge case covered.
- More than 3 undefined acronyms, or, in the hook, any acronym the target viewer wouldn't recognize instantly (S3, Lambda, GPT, RAG are fine; obscure internal acronyms are not).
- Hype words ("game-changer", "insane"). Vocal energy is what works, not adjectives [13].
- AI tells:
  - "delve", "underscore", "showcase" (heavily overrepresented in LLM text [25, STUDY, 2025]).
  - "crucial", "landscape", "unlock", "in today's fast-paced", "whether you're X or Y", "it's important to note", "not just X but Y", tidy triads [INF].
- Payoff only at the end; CTA outros.
- Stock wallpaper under a generic VO [22]; music under narration [17]; echo [14].
- Hashtag spam [31]; a promise not delivered in the first 3 s [26].
- Subtitles repeated as headlines [18]; flat 145–165 wpm monotone [12].

## 11. Scoring rubric

Score = sum of weights for "yes". **Pass ≥80 AND every gate (G) = yes.** 70–79: fix the failed checks. <70: rewrite.
All word counts are spoken words (digits and acronyms counted as read aloud: '25×' = 'twenty-five times' = 3 words). Line ids are `s<scene>.<line>`.

The rows check what lines *do*, not whether a beat is present; a flat script that has every beat still fails. **Every "yes" cites the line ids (or the section) it relies on**; a "yes" without ids is a "no". Rows tagged **[B]** are judged against `## Blueprint`, **[H]** against `## Scene Hints`; a missing section makes those rows "no". [B] rows are also judged on the lines: a Blueprint that *declares* one villain doesn't pass G4 if the lines introduce a second.

| # | Check (yes/no) | Wt |
|---|---|---|
| 1 G | **Hook.** s1.1 ≤12 words, a specific claim (cost/contradiction/number/failure) about a named tech. s1.1 or s1.2 addresses the viewer's system, money or belief ("you/your"). s1.1–s1.2 confirm the title's tech and tension. No greeting, "in this video", "let's dive in" or generic question ("have you ever wondered…", "did you know…"); no acronym the target viewer wouldn't recognize instantly (§10) | 8 |
| 2 | **Hook tournament** [B]: ≥10 hooks from ≥5 formulas, each scored on the six-property panel; s1.1–s1.2 is the winner, verdict ≥3.6 with no property <3 | 6 |
| 3 | **Frame-0 overlay** [H]: ≤6 words that adds to (not repeats) the hook | 4 |
| 4 G | **Through-line** [B]: the Angle block names one Core Question and exactly one villain; every scene advances that question; no line introduces a second cause of the failure (row 10's "when not to bother" may only follow from the same villain or mechanism) | 10 |
| 5 | **Stakes** in the viewer's currency ($, ms, pages, lost data, *their* bill) by word 25, and restated in the turn beat. A vendor price ratio is not the viewer's stakes | 6 |
| 6 | **Open loop** [B, loop ledger]: a question the viewer can't yet answer opens by word 25 and closes in the turn beat; ≤2 open at once; none left open after the last line | 8 |
| 7 | **Earned transitions** [B, beat map]: every line boundary tagged with but / so / because / which means / therefore / otherwise; ≤1 boundary where only "and / also / then" fits; no line starts with "And"; zero label transitions ("here's the catch", "under the hood", "let's…") | 8 |
| 8 | **Turn = belief flip**: the turn beat starts at 40–55% of spoken words, contradicts the Misconception the viewer was allowed to hold, and its first line is the script's shortest line (ties allowed) | 6 |
| 9 | **Anchored numbers**: every spoken number has a comparison or consequence in the same or next line; ≥2 concrete specifics (numbers, limits, prices, API/field names, error strings) | 6 |
| 10 | **Actionable**: a check or fix that names an artifact the viewer can inspect (a field, flag, command, metric or prompt line), plus when not to bother | 6 |
| 11 | **Callback**: the last line answers the Core Question and reuses the hook's key word (the Callback term); ≤14 words; no CTA or outro | 6 |
| 12 G | **Blind read** [B]: a log from a fresh subagent that saw only the title and the spoken lines; its lines match `## Script` word for word; the final round has zero LEAK rows and names no swipe line | 8 |
| 13 | 130–170 words for 45–65 s (≈2.9 words/s) | 2 |
| 14 | **Visuals** [H]: every scene has a named primitive and overlay; a planned change at least every 4 s | 3 |
| 15 | **Clarity and rhythm**: unfamiliar terms defined in ≤8 words or cut; ≤3 acronyms; every line 8–16 words (none >18); no parentheticals; no four consecutive lines whose lengths span ≤2 words | 4 |
| 16 G | Zero banned phrases (§10, plus the script-writing skill's `references/line-craft.md` §6, which bans label transitions, wrap-ups, CTAs and "It launched [date], so…" lines) | 3 |
| 17 G | Every fact traces to research.md; timely claims are dated in the overlay or inside a line that does other work (no standalone date line) | 3 |
| 18 | **Judgment line**: a first-person or opinionated senior-engineer line that is the next logical step (the delete test fails without it), not decoration | 3 |
| | **Total** | **100** |

**What changed from the presence rubric (2026-09-27).** Question-in-two-lines → #6 (the loop must also close). One core idea → G4. No restated sentence → #7 plus G12. Mechanism by 50% → implied by #8 (the turn can't start by 55% after it). Decision rule → #10 (must name an artifact). Takeaway → #11 (must reuse the hook's word). Sentence-length and acronym checks → #15. Opinion line → #18 (must carry weight). Word count 6 → 2 points.

**Calibration (re-scored 2026-09-27, see docs/learnings.md).** A flat script must fail this rubric; if one passes, the rubric is gameable again, so tighten it.

| Script | Score | Gates failed |
|---|---|---|
| Old prompt-cache-miss (100/100 on the presence rubric) | 18/100 (26 if [B] rows are judged on the lines alone) | G1, G4, G12, G16 |
| fixture-e2e | 6/100 | all five |
| Rewritten prompt-cache-miss | 96/100 | none |

## 12. Open questions / to validate with the channel's own analytics later

1. 45 s vs 65 s cuts of the same topic: compare APV and viewed-vs-swiped.
2. 165 vs 185 wpm in the creator's own voice.
3. Word-by-word karaoke vs phrase captions.
4. Silent end card vs none: effect on the final drop and on replays.
5. Loop endings: track the views ÷ engaged-views ratio as a replay proxy.
6. Do this channel's Shorts still get impressions after 30 days [29]?
7. AWS-specific vs general SWE topics: is there a view ceiling?
8. Music sting in the hook vs silence.
9. Title patterns here: "Why is X" vs "X vs Y" vs number-led.
10. 3 vs 5 uploads/week: effect on views per Short.
11. Custom thumbnails: effect on search share.
12. Is 70% viewed-vs-swiped realistic in this niche? Set a baseline after 20 uploads.

## Sources

1. YouTube Help, three-minute Shorts (2026; Content ID change 2026-09-24). https://support.google.com/youtube/answer/15424877
2. YouTube Blog, Shorts deep dive: Sherman & Hoyos (2025-01-28). https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/
3. Search Engine Journal, YouTube explains Shorts algorithm (2023-08-28). https://www.searchenginejournal.com/youtube-explains-how-shorts-algorithm-works/494953/
4. MediaPost, Shorts product lead insights (2023-08-25). https://www.mediapost.com/publications/article/388588/youtube-shorts-product-lead-offers-insights-for-cr.html
5. TechCrunch, Shorts view counting change (2025-03-26). https://techcrunch.com/2025/03/26/youtube-is-changing-how-youtube-shorts-views-are-counted
6. Paddy Galloway & Chris Gileta, 3.3B-view Shorts study (2023-04). https://threadreaderapp.com/thread/1646898356419981315.html
7. OpusClip, Shorts length & retention (2025-11-11). https://www.opus.pro/blog/ideal-youtube-shorts-length-format-retention
8. OpusClip, Shorts hook formulas (2025-11-11). https://www.opus.pro/blog/youtube-shorts-hook-formulas
9. OpusClip Research, visual hooks, 2,847 clips (2026-04-03). https://www.opus.pro/research/how-to-use-visual-hooks
10. Shortimize, Shorts retention rate (2026-01-20). https://www.shortimize.com/blog/youtube-shorts-retention-rate
11. vidIQ, upload frequency study, 10.2M channels (2026; via search excerpt). https://vidiq.com/research/youtube-upload-frequency-study/
12. Guo, Kim, Rubin, video production & engagement, L@S (2014-03). https://dl.acm.org/doi/10.1145/2556325.2566239
13. Suen & Su, vocal expressions & engagement, IJHCI (2025). https://arxiv.org/pdf/2605.17463
14. Newman & Schwarz, "Good Sound, Good Research" (2018). https://journals.sagepub.com/doi/abs/10.1177/1075547018759345
15. Gernsbacher, "Video Captions Benefit Everyone" (2015-10). https://pmc.ncbi.nlm.nih.gov/articles/PMC5214590/
16. Verizon Media/Publicis captions survey, via Forbes (2019-07-31). https://www.forbes.com/sites/tjmccue/2019/07/31/verizon-media-says-69-percent-of-consumers-watching-video-with-sound-off/
17. Moreno & Mayer, coherence effect (2000). https://tecfa.unige.ch/tecfa/teaching/methodo/Moreno_Mayer00.pdf
18. Clark & Mayer, redundancy principle, e-Learning & the Science of Instruction (2016). https://onlinelibrary.wiley.com/doi/abs/10.1002/9781119239086.ch7
19. Lorenz-Spreen et al., collective attention, Nature Comms (2019-04). https://www.nature.com/articles/s41467-019-09311-w
20. Gloria Mark, 47 s screen attention (2023). https://www.universityofcalifornia.edu/news/cant-pay-attention-youre-not-alone
21. Loewenstein, "The Psychology of Curiosity" (1994). https://www.cmu.edu/dietrich/sds/docs/loewenstein/PsychofCuriosity.pdf
22. YouTube Help, monetization policies / inauthentic content (2025-07-15); Fliki summary (2025). https://support.google.com/youtube/answer/1311392 · https://fliki.ai/blog/youtube-monetization-policy-2025
23. CNBC, Mohan: managing AI slop a 2026 priority (2026-01-21). https://www.cnbc.com/2026/01/21/youtube-chief-says-managing-ai-slop-is-a-priority-for-2026-.html
24. Electronic Markets, AI labeling & engagement (2026). https://link.springer.com/article/10.1007/s12525-026-00883-2
25. Kobak et al., LLM excess vocabulary, Science Advances (2025-07). https://www.science.org/doi/10.1126/sciadv.adt3813
26. Simon Willison, MrBeast production memo (2024-09-15). https://simonwillison.net/2024/Sep/15/how-to-succeed-in-mrbeast-production/
27. Search Engine Journal, Rene Ritchie insights (2023-08-14). https://www.searchenginejournal.com/youtube-algorithm-insights-from-creator-liaison-renee-ritchie/493901/
28. Tubefilter, Ritchie Shorts FAQ: "the algorithm follows the audience" (2024-08-26). https://www.tubefilter.com/2024/08/26/rene-ritchie-shorts-creator-faqs/
29. Search Engine Journal, Shorts may favor fresh over evergreen (2025-12-05). https://www.searchenginejournal.com/youtube-shorts-algorithm-may-now-favor-fresh-over-evergreen/562661/
30. NetInfluencer, Shorts custom thumbnails (2026-07-27). https://www.netinfluencer.com/youtube-lets-shorts-creators-upload-custom-thumbnails-reversing-prior-stance/
31. YouTube Help, hashtag rules (accessed 2026-09-27). https://support.google.com/youtube/answer/6390658
32. "Shorts on the Rise," arXiv 2402.18208 (2024-04). https://arxiv.org/html/2402.18208v2
33. OWN: Shorts tabs of ByteByteGo, Fireship, t3dotgg, NetworkChuck, ThePrimeagen, TechWorldwithNana, BeABetterDev (≤48 latest each, scraped 2026-09-27), plus auto-caption transcripts of 34 Shorts. Observational; confounded by video age.
34. Cutting et al., "Attention and the Evolution of Hollywood Film" (2010). https://journals.sagepub.com/doi/10.1177/0956797610361679
35. BBC Subtitle Guidelines, via Broadcast Writer (2024-12-12). https://broadcastwriter.com/2024/12/12/bbc-subtitle-style-guide-2024/
36. Search Engine Journal, 200B daily Shorts views (2025-06). https://www.searchenginejournal.com/youtube-reports-200-billion-daily-views-for-shorts-format/549315/
37. OutlierKit, 2026 algorithm updates (no primary sources). https://outlierkit.com/resources/youtube-algorithm-updates/
38. EMAX Studio, word-by-word vs static captions (2026, VENDOR). https://emax.studio/blog/word-by-word-ai-captions-vs-static-subtitles
39. Faceless Directory, Fireship case study (2026, ANEC). https://faceless.directory/case-studies/fireship
40. Fliki, Shorts algorithm 2026 (VENDOR). https://fliki.ai/blog/youtube-shorts-algorithm-explained
