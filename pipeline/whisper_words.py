#!/usr/bin/env python3
"""
pipeline/whisper_words.py - word timestamps for take analysis.

Same CLI + output as the repo-root whisper_timestamps.py (JSON [{word,start,end}]
on stdout, 0-based seconds), plus:
  --prompt=<text>  whisper initial_prompt. A disfluent prompt ("Umm, ... uh, I-I
                   mean") makes whisper transcribe fillers/restarts verbatim;
                   without it whisper silently drops "um", "uh" and restarts,
                   which is exactly what take analysis must see.
  conf             per-word probability from whisper.

VAD-chunked mode (docs/spec.md §7b) — --chunks=<file.json>:
  Whisper transcribing a long take often hears a repeated phrase ONCE and
  stretches one word over the hidden repeat ("how" 25.52-28.04 covering a whole
  second attempt). So pipeline/whisper.js splits the take at pauses (energy VAD)
  and passes the speech chunks here, [[start, end], ...] in take seconds. The
  chunks are packed into windows of <= --pack-sec with --sep-sec of silence
  between them, INTERLEAVED (window p gets chunks p, p+P, p+2P, ...), so two
  neighbouring chunks - where a line and its retake sit - never share a window
  and whisper can't collapse them. Words are mapped back to take time; words
  that land in a separator (silence hallucinations) are dropped. One process,
  one model load, ~one encoder pass per window (the encoder output is reused
  for the word-alignment pass).

  Safety net (--net=<json>): a word longer than max(longWordSec, ratio x the
  take's median sec/char x its length) whose span is mostly speech energy is a
  suspected hidden repeat: its chunk is split at finer energy dips and
  re-transcribed (again interleaved). If that yields more words and no long
  word, the chunk's words are replaced; otherwise the word gets "suspect": true
  (analyze.js then flags "possible hidden repeat").

Usage: python3 pipeline/whisper_words.py <audio> [--model=turbo] [--prompt="..."]
         [--chunks=chunks.json --pack-sec=24 --sep-sec=1.0 --net='{...}' --noise-db=-40]
"""
import sys
import json
import math
import time
import argparse
import warnings

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

SR = 16000


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def memoize_encoder(model):
    """transcribe() runs the encoder once to decode and again (inside
    find_alignment) for word timestamps on the same mel window: reuse it."""
    enc = model.encoder
    orig = enc.forward
    memo = {}

    def forward(x):
        k = memo.get("x")
        if k is not None and k.shape == x.shape and k.stride() == x.stride() and k.data_ptr() == x.data_ptr() and k.dtype == x.dtype:
            return memo["y"]
        y = orig(x)
        memo["x"], memo["y"] = x, y        # keeping x alive means its memory can't be reused by another tensor
        return y

    enc.forward = forward


def words_of(result, conf=True):
    out = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            word = w["word"].strip()
            if not word:
                continue
            out.append({"word": word, "start": float(w["start"]), "end": float(w["end"]),
                        "conf": round(float(w.get("probability", 0.0)), 3)})
    return out


def transcribe(model, audio, prompt, temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0)):
    return model.transcribe(audio, word_timestamps=True, language="en", fp16=False, temperature=temperature,
                            initial_prompt=prompt or None, condition_on_previous_text=False, verbose=None)


# Packed windows (silence separators, unrelated fragments) trip whisper's logprob
# fallback more often; each extra temperature is a full re-decode, so cap it.
PACK_TEMPERATURES = (0.0, 0.2, 0.4)


def pack_plan(chunks, pack_sec, sep):
    """Interleaved packs of chunk indices; >= 2 packs whenever there are >= 2 chunks."""
    n = len(chunks)
    if n == 0:
        return []
    total = sum(e - s + sep for s, e in chunks) + sep
    P = max(1, math.ceil(total / pack_sec), min(2, n))
    while True:
        packs = [list(range(p, n, P)) for p in range(P)]
        durs = [sum(chunks[i][1] - chunks[i][0] + sep for i in pk) + sep for pk in packs]
        if max(durs) <= 29.0 or P >= n:
            return [pk for pk in packs if pk]
        P += 1


def run_packs(model, audio, chunks, prompt, pack_sec, sep, label):
    import numpy as np
    packs = pack_plan(chunks, pack_sec, sep)
    gap = np.zeros(int(sep * SR), dtype=np.float32)
    out = [[] for _ in chunks]
    for p, pk in enumerate(packs):
        parts, layout, t = [gap], [], sep
        for i in pk:
            s, e = chunks[i]
            seg = audio[int(s * SR):int(e * SR)]
            parts += [seg, gap]
            layout.append((i, t, t + len(seg) / SR))
            t += len(seg) / SR + sep
        arr = np.concatenate(parts).astype(np.float32)
        t0 = time.time()
        res = transcribe(model, arr, prompt, PACK_TEMPERATURES)
        ws = words_of(res)
        temps = sorted({round(float(sg.get("temperature", 0.0)), 1) for sg in res.get("segments", [])})
        log(f"  {label} window {p + 1}/{len(packs)}: {len(pk)} chunks, {len(arr) / SR:.1f}s audio, {len(ws)} words, {time.time() - t0:.1f}s"
            + (f" (fallback temperature {temps[-1]})" if temps and temps[-1] > 0 else ""))
        for w in ws:
            mid = (w["start"] + w["end"]) / 2
            hit = None
            for i, a, b in layout:
                if a - 0.15 <= mid <= b + 0.15:
                    hit = (i, a, b)
                    break
            if hit is None:
                continue                                  # in a separator: silence hallucination
            i, a, b = hit
            s = chunks[i][0]
            st = s + (min(max(w["start"], a), b) - a)
            en = s + (min(max(w["end"], a), b) - a)
            out[i].append({**w, "start": round(st, 3), "end": round(max(en, st), 3)})
    return out


def frame_db(audio, hop=0.01, win=0.02):
    import numpy as np
    h, n = int(hop * SR), int(win * SR)
    if len(audio) < n:
        return np.array([-91.0])
    frames = np.lib.stride_tricks.sliding_window_view(audio, n)[::h]
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    return 20 * np.log10(np.maximum(rms, 1e-9))


def norm_len(word):
    return max(1, sum(c.isalnum() for c in word))


def long_words(words, db, net, noise_db):
    """Indices of suspiciously long, speech-filled words."""
    import numpy as np
    spc = [(w["end"] - w["start"]) / norm_len(w["word"]) for w in words if w["end"] > w["start"]]
    med = float(np.median(spc)) if spc else 0.07
    out = []
    for k, w in enumerate(words):
        d = w["end"] - w["start"]
        if d <= max(net["longWordSec"], net["ratio"] * med * max(2, norm_len(w["word"]))):
            continue
        f0, f1 = int(w["start"] / 0.01), int(w["end"] / 0.01)
        seg = db[f0:max(f1, f0 + 1)]
        if len(seg) and float(np.mean(seg > noise_db)) >= net["speechFrac"]:
            out.append(k)
    return out


def sub_chunks(db, s, e, net, noise_db):
    """Split [s,e] at energy dips >= subSilenceSec below max(noise, p80 - subBelowDb)."""
    import numpy as np
    f0, f1 = int(s / 0.01), int(e / 0.01)
    seg = db[f0:f1]
    if len(seg) < 10:
        return [(s, e)]
    th = max(noise_db, float(np.percentile(seg, 80)) - net["subBelowDb"])
    low = seg < th
    minf = int(net["subSilenceSec"] / 0.01)
    cuts, i = [], 0
    while i < len(low):
        if low[i]:
            j = i
            while j < len(low) and low[j]:
                j += 1
            if j - i >= minf and i > 0 and j < len(low):
                cuts.append((f0 + i) * 0.01 + (j - i) * 0.005)     # dip centre
            i = j
        else:
            i += 1
    edges = [s] + cuts + [e]
    return [(a, b) for a, b in zip(edges, edges[1:]) if b - a >= 0.12]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--model", default="turbo")
    ap.add_argument("--prompt", default=None)
    ap.add_argument("--chunks", default=None)
    ap.add_argument("--pack-sec", type=float, default=24.0)
    ap.add_argument("--sep-sec", type=float, default=1.0)
    ap.add_argument("--net", default=None)
    ap.add_argument("--noise-db", type=float, default=-40.0)
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args()

    import torch
    import whisper
    if args.threads > 0:
        torch.set_num_threads(args.threads)
    log(f"  loading whisper model '{args.model}'...")
    model = whisper.load_model(args.model)
    memoize_encoder(model)
    t_all = time.time()

    if not args.chunks:
        log(f"  transcribing {args.audio}...")
        words = words_of(transcribe(model, args.audio, args.prompt))
        for w in words:
            w["start"], w["end"] = round(w["start"], 3), round(w["end"], 3)
        print(json.dumps(words))
        log(f"  {len(words)} words extracted.")
        return

    audio = whisper.load_audio(args.audio)
    with open(args.chunks) as f:
        chunks = [tuple(c) for c in json.load(f)]
    log(f"  transcribing {args.audio}: {len(chunks)} speech chunks (VAD), interleaved windows...")
    per = run_packs(model, audio, chunks, args.prompt, args.pack_sec, args.sep_sec, "pass 1")

    if args.net:
        net = json.loads(args.net)
        db = frame_db(audio)
        flat = [(ci, w) for ci, ws in enumerate(per) for w in ws]
        sus = long_words([w for _, w in flat], db, net, args.noise_db)
        bad_chunks = sorted({flat[k][0] for k in sus})
        if bad_chunks:
            log("  safety net: long speech-filled word(s) " + ", ".join(
                f'"{flat[k][1]["word"]}" {flat[k][1]["start"]:.2f}-{flat[k][1]["end"]:.2f}' for k in sus))
            subs, owner = [], []
            for ci in bad_chunks:
                for sc in sub_chunks(db, chunks[ci][0], chunks[ci][1], net, args.noise_db):
                    subs.append(sc)
                    owner.append(ci)
            sub_words = run_packs(model, audio, subs, args.prompt, args.pack_sec, args.sep_sec, "pass 2")
            for ci in bad_chunks:
                new = [w for si, ws in enumerate(sub_words) if owner[si] == ci for w in ws]
                still = long_words(new, db, net, args.noise_db) if new else [0]
                n_sub = sum(1 for o in owner if o == ci)
                if new and not still and len(new) > len(per[ci]):
                    log(f"  safety net: chunk {chunks[ci][0]:.2f}-{chunks[ci][1]:.2f} re-transcribed in {n_sub} sub-chunks: {len(per[ci])} -> {len(new)} words")
                    per[ci] = new
                else:
                    log(f"  safety net: chunk {chunks[ci][0]:.2f}-{chunks[ci][1]:.2f} unresolved ({n_sub} sub-chunks) - marking suspect")
                    for k in long_words(per[ci], db, net, args.noise_db):
                        per[ci][k]["suspect"] = True

    words = sorted((w for ws in per for w in ws), key=lambda w: (w["start"], w["end"]))
    print(json.dumps(words))
    log(f"  {len(words)} words extracted in {time.time() - t_all:.1f}s.")


if __name__ == "__main__":
    main()
