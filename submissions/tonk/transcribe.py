#!/usr/bin/env python3
"""Transcribe audio to Thai text using Typhoon ASR (OpenAI-compatible API)."""
import sys
import os
import json
import requests

API_URL = "https://api.opentyphoon.ai/v1/audio/transcriptions"
API_KEY = os.environ.get("TYPHOON_API_KEY", "")

def transcribe(audio_path):
    with open(audio_path, "rb") as f:
        resp = requests.post(
            API_URL,
            headers={"Authorization": f"Bearer {API_KEY}"},
            files={"file": f},
            data={"model": "typhoon-asr-realtime"},
            timeout=30,
        )
    resp.raise_for_status()
    result = resp.json()
    return {"text": result.get("text", ""), "model": "typhoon-asr-realtime"}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: transcribe.py <audio_path>"}))
        sys.exit(1)
    if not API_KEY:
        print(json.dumps({"error": "TYPHOON_API_KEY not set"}))
        sys.exit(1)
    try:
        result = transcribe(sys.argv[1])
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
