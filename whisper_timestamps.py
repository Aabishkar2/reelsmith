#!/usr/bin/env python3
"""
whisper_timestamps.py — Extract word-level timestamps from a per-scene voiceover MP3.

Usage:
  python3 whisper_timestamps.py <audio.mp3>
  python3 whisper_timestamps.py <audio.mp3> --model=turbo

Output:
  JSON to stdout — [{word, start, end}, ...]
  All timestamps are relative to the start of the audio file (0-based).

Models (fastest → most accurate):
  tiny    — ~32MB,  fastest,  lower accuracy
  base    — ~74MB,  fast,     good for clean TTS audio
  small   — ~244MB, balanced
  medium  — ~769MB, accurate
  turbo   — ~1.5GB, large-v3-turbo, best quality/speed tradeoff (default)
  large   — ~1.5GB, slowest,  highest accuracy

Note: first run downloads the model (~1.5GB for turbo). Cached in ~/.cache/whisper.
Since we're transcribing audio we just generated from a known script, word-level
accuracy is near-perfect even with smaller models.
"""

import sys
import json
import argparse
import warnings

# Suppress irrelevant warnings from torch/whisper
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)


def extract_words(audio_path: str, model_name: str) -> list[dict]:
    import whisper

    print(f"  loading whisper model '{model_name}'...", file=sys.stderr)
    model = whisper.load_model(model_name)

    print(f"  transcribing {audio_path}...", file=sys.stderr)
    result = model.transcribe(
        audio_path,
        word_timestamps=True,
        language="en",          # force English — avoids language detection overhead
        fp16=False,             # fp16 can be unstable on CPU / MPS; safe default
        verbose=False,
    )

    words = []
    for segment in result.get("segments", []):
        for w in segment.get("words", []):
            word = w["word"].strip()
            if not word:
                continue
            words.append({
                "word":  word,
                "start": round(float(w["start"]), 3),
                "end":   round(float(w["end"]),   3),
            })

    return words


def main():
    parser = argparse.ArgumentParser(
        description="Extract word-level timestamps from a voiceover MP3 using Whisper."
    )
    parser.add_argument("audio",  help="Path to the MP3 file")
    parser.add_argument("--model", default="turbo",
                        help="Whisper model to use (default: turbo)")
    args = parser.parse_args()

    words = extract_words(args.audio, args.model)

    # Only JSON goes to stdout — pipeline/whisper.js parses it
    print(json.dumps(words))
    print(f"  {len(words)} words extracted.", file=sys.stderr)


if __name__ == "__main__":
    main()
