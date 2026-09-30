---
title: Publish, without surprises
topic: devtools
date: 2026-09-30
style: motion
tts_voice: Leda
tts_mode: performance
series: reelsmith-tutorials
episode: 10
---

## Script

### Scene 1
The video is rendered.
Now let's get it out there, without accidentally posting to the wrong place.

### Scene 2
First, reelsmith publish notes.
Your agent writes publish dot md with a title under sixty characters, a description, tags, and the music credit.

### Scene 3
Every publish target is a plugin.
YouTube Shorts, Instagram and Facebook Reels, and Discord for team review.

### Scene 4
Every target supports dry run.
Reelsmith publish with dash dash dry run checks the credentials, the file size, and the metadata, and prints exactly what it would send.
Nothing leaves your machine.

### Scene 5
Drop the flag when you are ready.
The result, the URL and the ID, is saved next to the video so you never upload twice.

### Scene 6
Credentials live in dot env and in your config directory, never in the repo.
Reelsmith doctor tells you which target is ready.

### Scene 7
That's the whole series.
Script, voice, animation, gates, publish.
Go make something.

## Voice direction
The narrator wraps up the series with the publishing step. Careful and trustworthy in scenes 4 and 6, since this is about not making mistakes. The final scene is a warm send off: "Go make something."

## Scene Hints
- Scene 1 (hook): output.mp4 badge in the center, three destination icons orbit it; a red "wrong place" icon gets crossed out. Primitive: Orbit
- Scene 2 (notes): publish.md card fills in: title (char counter 58/60), description lines, tags chips, "Music: Clean Soul, Kevin MacLeod (CC BY 4.0)". Primitive: FileCard
- Scene 3 (targets): Three plugin tiles snap in: youtube, meta, discord, each with a kind badge "publish". Primitive: PluginDock
- Scene 4 (dry run): Terminal `reelsmith publish videos/my-video --to=youtube --dry-run`, rows: credentials ✓, size 41 MB ✓, title ✓, "DRY RUN · nothing sent" banner. Primitive: Terminal + Banner
- Scene 5 (real): Terminal with the same command minus the flag, output `youtube.json { id, url }` file badge lands next to the video folder. Primitive: Terminal + FileBadge
- Scene 6 (secrets): Two lock cards: `.env` and `~/.config/reelsmith/`, a repo icon with a "never" stamp; then `reelsmith doctor` rows for youtube ready / meta missing token. Primitive: LockCards + Terminal
- Scene 7 (close): Five word chips line up: Script · Voice · Animation · Gates · Publish; the Reelsmith wordmark; "Go make something." punches in. Primitive: Chips + Wordmark
