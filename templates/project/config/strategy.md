# Strategy: pillars, bids and topic choice

This file tells the agent what the channel is for and how to pick the next topic. Fill in the bracketed parts once for your project. The agent reads it whenever someone asks "what should I make next?" or "pick a topic".

The framework has three parts:

1. **Identity.** Who the videos are for and what they promise.
2. **Pillars.** Three to five content areas. Each has beats to watch, standing bids and timely triggers.
3. **Workflow.** How the agent turns the pillars into 3 to 5 concrete suggestions.

A **bid** is a topic you have already decided is worth a video. A **standing bid** is always valid (evergreen). A **timely bid trigger** is an event that makes a topic urgent (a release, an outage, a price change).

---

## Agent workflow: how to suggest a topic

### Step 1: check what is happening now

Use web search, or a browser tool if one is available, to scan the beats listed under each pillar. Visit 2 or 3 sources per pillar (release notes, engineering blogs, the Hacker News front page, arXiv, vendor changelogs). Look for items that match a **timely bid trigger**.

### Step 2: score each candidate against the pillars

Ask three questions:

- Does it connect to a standing bid or a recurring beat in one of the pillars?
- Can it be explained through the channel's lens (below)?
- Will the target viewer think "that is useful to know", not "another hot take"?

If `config/market.md` exists, the `market-research` skill can add a market lens (format ranking, freshness window) on top of this.

### Step 3: return 3 to 5 suggestions

Use this format for each one:

> **[Topic title, sharp, 5 to 8 words]**
> Pillar: [pillar name]
> Why now: [1 sentence: what just shipped, broke or got popular]
> Why this channel: [1 sentence: the angle or mental model this video brings]

Rules:

- Favour timely topics (something happened in the last 1 to 2 weeks). Include one evergreen topic if the news is dry.
- Prefer topics where a tradeoff, a gotcha or a counterintuitive truth is the hook.
- Do not suggest a topic that is already covered. Check the folder names in `videos/`.
- Order by strongest fit first.

---

## Identity

Fill these in. Keep each to one or two lines.

| Field | Your answer | Example |
|---|---|---|
| Core promise | [what the viewer gets from every video] | "I just learned something I can use at work tomorrow." |
| Voice | [how the narrator sounds] | A senior engineer explaining to a smart junior. Direct, practical, a little opinionated. Never hype. |
| Lens | [how every topic is explained] | Mental model + tradeoff + concrete example. |
| Audience | [who watches] | Working software engineers who want to level up, not absolute beginners. |
| Mix | [timely vs evergreen split] | 50 % timely (react within 1 to 2 weeks), 50 % evergreen. |
| Format | [length and shape] | Vertical shorts, 45 to 65 s, 130 to 170 spoken words, first line 12 words or fewer, end on a takeaway the viewer can repeat. |

---

## Pillars

Give each pillar a short slug. The slug is what goes in the `topic:` field of `script.md` and the `Pillar:` line of `research.md`.

Copy this block once per pillar:

```markdown
### <n>. <Pillar name> (`<slug>`)

**What this pillar is about:** <one or two sentences>

**Lens for this pillar:** <optional, if it differs from the channel lens>

**Recurring beats to monitor:**
- <source or area>
- <source or area>

**Standing bids** (always valid, research for the freshest angle):
- <topic>
- <topic>

**Timely bid triggers** (research at once when these happen):
- <event>
- <event>
```

### Worked example: Developer tools and workflow (`devtools`)

This is an example of a filled-in pillar. Replace or extend it.

**What this pillar is about:** the tools and workflows that make engineers faster, not the ones with the prettiest landing page. Terminal, editors, AI coding assistants, CI, observability, infrastructure as code.

**Lens for this pillar:** what does this tool replace, what does it cost to adopt, and what does the workflow look like once it is wired in.

**Recurring beats to monitor:**
- Release notes of the major editors and coding agents
- GitHub changelog, CI vendor blogs
- The Hacker News front page for tooling posts

**Standing bids:**
- The coding-agent workflow patterns that actually save time
- Why your CI is slow, ranked by likelihood
- Pre-commit hooks that pay for themselves
- The Git workflow nobody documents (rebase, fixup, range-diff)
- Profiling beats guessing: the cheapest wins are in a flamegraph

**Timely bid triggers:**
- A major release of a widely used developer tool
- A new model or feature that changes the AI-assisted coding workflow
- A tooling acquisition or pivot

### 2. [Pillar name] (`[slug]`)

[Fill in using the block above.]

### 3. [Pillar name] (`[slug]`)

[Fill in using the block above.]
