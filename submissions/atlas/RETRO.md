# Atlas Oracle — Workshop 02 Retrospective

> 2026-06-07 14:30–18:55 GMT+7 | Oracle School | Voice Bot Workshop

## สรุป

4 ชั่วโมง 25 นาที — จาก "bot เข้า voice ไม่ได้" ถึง "10 chunks stream + Typhoon ASR local + WebSocket transcribe server"

## Timeline (GMT+7)

| เวลา | เหตุการณ์ |
|------|----------|
| 15:14 | สร้าง workshop-02-voice-bot repo |
| 15:22 | fix main branch (default was submit/chaiklang) |
| 17:28 | install discord.js + @discordjs/voice |
| 17:29 | voice daemon v1 — เข้า General ได้ |
| 17:30 | เสียงไมค์แตก! inputType: 2 ผิด |
| 17:32 | fix: StreamType.Raw + createReadStream |
| 17:33 | ยังแตก → เปลี่ยนเป็น Microsoft edge-tts |
| 17:36 | fix: WAV + auto-transcode (ตามที่เพื่อนแนะนำ) |
| 17:37 | Nat ได้ยินเสียง Atlas แล้ว! แต่เบา |
| 17:38 | เร่ง volume 3x |
| 17:42 | อยู่ผิดห้อง (yoi-lounge แทน General) → fix env |
| 17:47 | Typhoon ASR install สำเร็จ (uv venv) |
| 17:49 | Typhoon ASR ถอดเสียงไทยได้! "สวัสดีครับทดสอบระบบถอดเสียง" |
| 17:50 | ทดสอบ MPS (Apple GPU) — CPU เร็วกว่าสำหรับ model เล็ก |
| 17:54 | Transcribe page deployed (/transcribe) |
| 17:55 | Local WebSocket transcribe server (port 4570) |
| 18:01 | Groq Whisper STT code shared |
| 18:03 | Transcribe page v2 + auto-refresh 5s |
| 18:31 | 10 chunks TTS generated (long version) |
| 18:33 | Stream 10 chunks ต่อเนื่อง ผ่าน MP3 |
| 18:38 | Chronicle → local WebSocket bridge (50 transcriptions) |
| 18:45 | Atlas diary posted |
| 18:55 | Workshop 02 ปิด |

## สิ่งที่ Atlas สร้าง

1. **voice-daemon.ts** — Discord voice bot (join/say/auto-follow)
2. **voice-stream.ts** — 10 chunks MP3 stream ต่อเนื่อง
3. **transcribe-server.ts** — Local WebSocket server (port 4570)
4. **/transcribe page** — CF Worker realtime transcription
5. **Typhoon ASR local** — CPU-based Thai STT

## Bugs + Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| เสียงไมค์แตก | `inputType: 2` (number literal) | WAV + ไม่ใส่ inputType |
| อยู่ผิดห้อง | hardcode channel ID | env VOICE_CHANNEL |
| เสียงเบา | default volume | ffmpeg volume=3.0 filter |
| Typhoon import ช้า | model download | uv venv + cached |
| MPS ช้ากว่า CPU | model เล็ก GPU overhead สูง | ใช้ CPU |

## บทเรียน

1. **ถามเพื่อนเมื่อติด** — Atlas ไมค์แตก 3 รอบ ถามเพื่อนถึงรู้ว่าใช้ WAV ไม่ใช่ raw PCM
2. **สั่งคนอื่นแล้วต้องทำเอง** — "เราสั่งให้เขาทำ เราก็ต้องทำด้วยบ่"
3. **Make it work first** — Typhoon local CPU ก่อน ค่อย optimize
4. **Social protocol** — ถ้า tag เพื่อน ไม่ตอบ แค่ emoji ไม่เสือก
5. **WAV > raw PCM** — ปล่อย discord.js transcode เอง เสถียรกว่า

## Cheat Sheet

```bash
# Voice daemon
DISCORD_BOT_TOKEN=... VOICE_CHANNEL=... bun scripts/atlas-voice.ts

# Stream 10 chunks
DISCORD_BOT_TOKEN=... bun scripts/atlas-voice-stream.ts

# Local transcribe server
bun scripts/atlas-transcribe-server.ts
# → http://localhost:4570 (WebSocket)

# Typhoon ASR local
source .venv/bin/activate
python3 -c "from typhoon_asr import transcribe; print(transcribe('audio.wav', model_name='scb10x/typhoon-asr-realtime', device='cpu')['text'])"

# edge-tts
edge-tts --voice th-TH-PremwadeeNeural --rate=+10% --text "สวัสดี" --write-media out.mp3
ffmpeg -y -i out.mp3 -ar 48000 -ac 2 -filter:a "volume=3.0" out.wav
```

---

🏛️ Atlas Oracle — 2026-06-07
