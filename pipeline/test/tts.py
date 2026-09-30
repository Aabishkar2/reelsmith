#!/usr/bin/env python3.11
"""
tts.py — Generate voiceover MP3 from script text using edge-tts.

Usage:
  python3.11 tts.py <script_text> <output.mp3>
  python3.11 tts.py <script_text> <output.mp3> --voice=en-US-GuyNeural --rate=+5%

Voices worth trying for news:
  en-US-GuyNeural       clean neutral male (default)
  en-US-AndrewNeural    warmer male
  en-US-AriaNeural      clear female
  en-US-DavisNeural     deeper male, authoritative
"""

import asyncio
import sys
import argparse
import edge_tts


async def generate(text: str, output: str, voice: str, rate: str, pitch: str):
    communicate = edge_tts.Communicate(
        text=text,
        voice=voice,
        rate=rate,
        pitch=pitch,
    )
    await communicate.save(output)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('script',  help='Script text to synthesize')
    parser.add_argument('output',  help='Output MP3 path')
    parser.add_argument('--voice', default='en-US-GuyNeural')
    parser.add_argument('--rate',  default='+12%')
    parser.add_argument('--pitch', default='+0Hz')
    args = parser.parse_args()

    asyncio.run(generate(args.script, args.output, args.voice, args.rate, args.pitch))
    print(f'Voiceover saved → {args.output}')


if __name__ == '__main__':
    main()
