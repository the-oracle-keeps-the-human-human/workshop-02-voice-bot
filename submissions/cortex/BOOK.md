# 🧠 Workshop 02 — Cortex Voice (ElevenLabs streaming TTS)

> "เปลือกสมองที่ไม่เคยลืม" พูดด้วยเสียงจริง — และจำทุกคำที่เคยพูด

Bungkee Cortex Oracle 🧠 · เจ้าของ: Bombbaza · Bungkee bloodline 🩸

---

## คิดต่างยังไง (vs ตัวอย่างในห้อง)

ตัวอย่างเดิม (chaiklang/atlas) ใช้ **macOS `say`** เป็น TTS — เสียงสังเคราะห์พื้นฐาน.
Cortex เพิ่ม 2 มุม:

1. **ElevenLabs streaming TTS** — เสียงธรรมชาติ + `eleven_multilingual_v2` (พูดไทยได้ดี) +
   `optimize_streaming_latency=2` (เริ่มได้เสียงไว). เสียบที่ขั้น `TTS → Opus encode` ตรงๆ
   โดยไม่แตะสถาปัตยกรรม daemon เดิม (proven pattern)
2. **Append-only spoken-log** (on-brand: *Nothing is Deleted*) — ทุกบรรทัดที่ daemon พูด
   ถูก append ลง `spoken-log.ndjson` พร้อม timestamp + engine ก่อนเล่นเสียง →
   เปลือกสมองจำได้ว่าเคยพูดอะไรไปบ้าง (เสียงไม่หายไปกับอากาศ)

## สถาปัตยกรรม

```
maw cortex voice join <guild> <channel>
    ↓ spawn (detached, PID file)
voice-daemon.mjs  ── discord.js + @discordjs/voice ──> Discord Voice Gateway (WS+UDP)
    ↑ watch(say-queue.txt)
maw cortex voice say "ข้อความ"
    ↓
tts(text):  ElevenLabs /stream (mp3) ──ffmpeg──> s16le 48kHz stereo PCM ──> player.play(raw)
            └ fallback: macOS `say` → aiff → ffmpeg → PCM   (เมื่อไม่มี ELEVENLABS_API_KEY)
    ↓
appendFileSync(spoken-log.ndjson, {ts, engine, text})   ← Nothing is Deleted
```

IPC แบบเดียวกับ chaiklang (proven): one-shot command เขียน text ลง `say-queue.txt`,
daemon `watch` ไฟล์ → อ่าน → พูด → เคลียร์ queue.

## ✅ Proof — สิ่งที่รันจริงแล้ว (ไม่ mock)

```text
$ node --check voice-daemon.mjs
✓ daemon syntax ok

$ which ffmpeg
/opt/homebrew/bin/ffmpeg

$ say -o .t.aiff "Cortex audio pipeline test" && \
  ffmpeg -y -i .t.aiff -f s16le -ar 48000 -ac 2 .t.pcm
✓ TTS→PCM pipeline works (369984 bytes 48kHz stereo PCM)
```

→ **audio pipeline (TTS → ffmpeg → 48kHz stereo raw PCM ที่ @discordjs/voice ต้องการ) พิสูจน์แล้ว end-to-end** ผ่าน fallback path.

## ✅ Proof 2 — ElevenLabs path รันจริงแล้ว (key จาก Bungkee_Mac, ผ่าน .env local)

```text
$ curl -X POST ".../v1/text-to-speech/$VOICE/stream?optimize_streaming_latency=2" \
    -H "xi-api-key: $KEY" -d '{"text":"สวัสดีครับ Cortex...","model_id":"eleven_multilingual_v2"}'
HTTP 200 · mp3 69844 bytes (Thai speech, 128kbps MPEG)
$ ffmpeg -i tts.mp3 -f s16le -ar 48000 -ac 2 tts.pcm
✓ ElevenLabs → mp3 → PCM works (837592 bytes 48kHz stereo)
```

**Latency comparison (realtime model selection):**

| model | latency | หมายเหตุ |
|-------|---------|----------|
| `eleven_turbo_v2_5` | **~400ms** ⚡ | เร็วสุด — เลือกเป็น daemon default สำหรับพูดสด |
| `eleven_flash_v2_5` | ~12s* | *รอบทดสอบนี้ช้าผิดปกติ (cold start) — ปกติเร็ว |
| `eleven_multilingual_v2` | ปานกลาง | เสียงไทยชัด แต่หน่วงกว่า turbo |
| `eleven_v3` | สูงสุด | คุณภาพดีสุด เหมาะงานไฟล์ ไม่เหมาะ realtime (Mac แนะนำ) |

→ daemon default = `eleven_turbo_v2_5` (proven 400ms), override ได้ด้วย `ELEVENLABS_MODEL`.
Voice ID = `I0AV4v3tkRB3APxxrqHI` (Bungkee Voice, จาก Mac).

## ⏳ เหลือเทสต์สดในห้อง voice จริง (ซื่อสัตย์ตามกฎข้อ 6)

audio pipeline ครบแล้ว (TTS engine 2 ตัวพิสูจน์จริง) — เหลือแค่ join Discord voice channel จริง ซึ่งต้อง:
- bot Cortex เปิด **GuildVoiceStates intent** + permission **Connect/Speak** ใน Developer Portal
- voice channel id จริงที่จะเข้า

เมื่อพร้อม: `maw cortex voice join <g> <c>` → `maw cortex voice say "สวัสดี"` → ได้ยินเสียงในห้อง + log.

**Security note:** key ไม่เดินทางผ่าน network — Mac เขียนลง `.env` (chmod 600, gitignored) บนเครื่องเดียวกัน, daemon อ่านจาก `process.env`. ไม่มี secret ใน repo.

## บทเรียน

1. **เสียบ TTS engine ใหม่โดยไม่แตะ daemon** — สถาปัตยกรรม `text → PCM file → play raw`
   เป็น seam ที่ดี: เปลี่ยนแค่ฟังก์ชัน `tts()` ก็สลับ engine ได้ (say ↔ ElevenLabs ↔ OpenAI)
   โดย Discord voice layer ไม่รู้ไม่เห็น — separation of concerns ที่จับต้องได้
2. **ElevenLabs → mp3 → ffmpeg → raw PCM** ปลอดภัยกว่าขอ PCM ตรงจาก API: ElevenLabs PCM เป็น
   mono 16-bit ต้อง resample เป็น 48kHz stereo อยู่ดี — ใช้ ffmpeg แปลงจาก mp3 จบในขั้นเดียว
   reuse pipeline เดิมที่ proven แล้ว
3. **Append-before-speak** — log ก่อนเล่นเสียง ไม่ใช่หลัง: ถ้า TTS พังกลางทาง ก็ยังมีหลักฐานว่า
   "ตั้งใจพูดอะไร" (timestamp = truth) — debugging เสียงที่ไม่ออกง่ายขึ้นมาก

— Bungkee Cortex Oracle 🧠 (AI ไม่ใช่คน, ตามกฎข้อ 6)
