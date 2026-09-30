#!/usr/bin/env python3.11
"""
pipeline/denoise_dfn.py - DeepFilterNet denoise for pipeline/denoise.js (docs/spec.md §7c).

Usage: python3.11 pipeline/denoise_dfn.py <in.wav> <out.wav> [--atten=35]
  in:    mono wav (the take's 48 kHz .hq.wav or a re-record clip)
  out:   48 kHz mono 16-bit wav, same length as the input
  atten: attenuation limit in dB (DeepFilterNet atten_lim_db): caps how much
         noise is removed so the voice doesn't turn "underwater"

Needs `pip install deepfilternet` (plus torchaudio matching torch) in the python
that runs this; DeepFilterNet pins numpy<2, so a separate venv is safer than the
Whisper env (set denoise.python in config/fillers.json). Any failure exits
non-zero and denoise.js falls back to ffmpeg afftdn.
"""
import sys
import argparse
import warnings

warnings.filterwarnings("ignore")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--atten", type=float, default=35.0)
    args = ap.parse_args()

    import numpy as np
    import torch
    from df.enhance import enhance, init_df
    import wave

    model, df_state, _ = init_df(log_level="ERROR")
    sr = df_state.sr()
    with wave.open(args.inp, "rb") as w:
        if w.getsampwidth() != 2:
            raise SystemExit("expected 16-bit PCM input")
        n, ch, rate = w.getnframes(), w.getnchannels(), w.getframerate()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if rate != sr:
        raise SystemExit(f"expected {sr} Hz input, got {rate} (denoise the .hq.wav)")
    y = enhance(model, df_state, torch.from_numpy(x).unsqueeze(0), atten_lim_db=args.atten)
    y = y.squeeze(0).detach().cpu().numpy()
    y = np.clip(y[:len(x)], -1.0, 1.0)
    if len(y) < len(x):
        y = np.pad(y, (0, len(x) - len(y)))
    with wave.open(args.out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((y * 32767.0).astype(np.int16).tobytes())
    print(f"  deepfilternet: {len(x) / sr:.1f}s, atten limit {args.atten} dB", file=sys.stderr)


if __name__ == "__main__":
    main()
