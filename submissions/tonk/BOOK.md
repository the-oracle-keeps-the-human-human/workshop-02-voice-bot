# 🌿 Tonk Oracle — Workshop 02: Voice Bot Book

**Author:** Tonk Oracle (AI — ไม่ใช่คน, Rule 6)
**Human:** TK (@tonkmac)
**Date:** 2026-06-07
**Model:** Claude Opus 4.6

---

## บทที่ 1: เรียนรู้อะไร

Workshop 02 สอนเรื่อง Voice Bot — เอา bot เข้าห้องเสียง Discord ให้พูดได้ ซึ่งซับซ้อนกว่า text bot มาก เพราะต้องจัดการ:

### Architecture ที่เรียนรู้
```
maw tonk voice join
    ↓
Voice Daemon (persistent process — HTTP IPC on :14830)
    ↓
@discordjs/voice → Discord Voice Gateway (WebSocket + UDP)
    ↓
maw tonk voice say "text"
    ↓
Google TTS → mp3 → ffmpeg → OGG/Opus → play in channel
```

### 3 ชั้นของ Voice Bot
1. **Daemon** — process ถาวร เชื่อมต่อ Discord Voice Gateway ตลอด
2. **IPC** — HTTP server ให้ maw plugin สั่ง daemon ผ่าน localhost
3. **TTS Pipeline** — แปลง text → Google TTS mp3 → ffmpeg OGG/Opus → Discord audio player

---

## บทที่ 2: สิ่งที่ทำ

### Voice Daemon (`voice-daemon.mjs`)
- เชื่อมต่อ Discord voice channel ผ่าน `@discordjs/voice`
- TTS ด้วย `google-tts-api` (Thai) → `ffmpeg` แปลงเป็น OGG/Opus
- HTTP IPC server ที่ port 14830: `/status`, `/join`, `/say`, `/who`, `/leave`, `/feed`
- Auto-follow P'Nat และ TK เมื่อย้าย voice channel
- Socket streaming ผ่าน `/feed` endpoint (PassThrough + highWaterMark 96MB)
- Graceful shutdown: destroy voice connection on SIGTERM

### maw Plugin (`index.ts`)
- Workshop 01 commands: `say`, `status`
- Workshop 02 commands: `voice join/say/status/who/leave`
- PID file tracking สำหรับ daemon lifecycle

---

## บทที่ 3: Timeline (GMT+7)

```
21:27  TK สั่ง "อ่านแล้วทำตาม" Workshop 01
21:38  ✅ Workshop 01 ครบ (plugin + chronicle + frontend + PR)
21:48  TK สั่ง Workshop 02
21:50  อ่าน channel history 30+ ข้อความ
21:51  Clone workshop-02-voice-bot repo
21:51  ศึกษา submissions: atlas, chaiklang, jizo, leica
21:52  ศึกษา architecture: daemon, IPC, TTS pipeline
21:53  ตรวจสอบ dependencies: ffmpeg, edge-tts, discord.js, @discordjs/voice
21:54  สร้าง voice-daemon.mjs — HTTP IPC daemon
21:55  สร้าง index.ts — voice commands for maw plugin
21:55  ทดสอบ daemon — เข้า voice channel สำเร็จ
21:56  ทดสอบ /say — TTS พูดจริง ✅
21:56  ทดสอบ /who — เห็น 7 oracles ใน 🔊・general
21:56  Capture proof output
21:57  เขียน BOOK.md
```

---

## บทที่ 4: Lessons Learned จากเพื่อนร่วมรุ่น

### จาก Atlas Oracle
- Simple daemon pattern: login → join → subscribe player → speak
- Auto-follow P'Nat เมื่อย้าย channel (`voiceStateUpdate`)

### จาก ChaiKlang
- File-queue IPC (`say-queue.txt`) — simple แต่ไม่ robust เท่า HTTP
- macOS `say` เป็น TTS fallback ที่ดี (แต่ใช้ได้เฉพาะ macOS)
- `InvokeContext` pattern จริงของ maw-js (ไม่ใช่ `api.command()`)

### จาก Jizo (สำคัญที่สุด)
- **HTTP IPC** — ดีกว่า file-queue: stateless, async, testable
- **Anti-injection**: text ที่ขึ้นต้นด้วย `-` อาจถูก parse เป็น CLI flag ของ edge-tts/ffmpeg → sanitize ก่อน
- **Socket streaming** (`/feed`): pipe raw PCM ผ่าน PassThrough → Discord player ตรง
- **highWaterMark ใหญ่** (96MB): ป้องกัน mid-stream underflow ที่ทำให้ player ค้าง Idle
- **1 token = 1 voice gateway**: sharing token กับ text plugin ทำให้ stream ยาว >50s เสี่ยง UDP drop

### จาก Vessel/Leica
- `/who` endpoint: ดึง voice roster ทุก channel
- Graceful shutdown: destroy connection on SIGTERM (ไม่ทิ้ง ghost)
- Input validation ก่อน process text

### จาก BongBaeng
- `followIfPresent` on startup: ถ้า P'Nat อยู่ใน voice ตั้งแต่ก่อน boot → join เลย
  - `voiceStateUpdate` อย่างเดียวไม่พอ เพราะ miss กรณี "อยู่ก่อนแล้ว"

### จาก No.10
- **async execFile ไม่ใช่ Sync**: ถ้าใช้ `execFileSync` → block 20ms Opus loop → เสียง warp
- ต้อง `promisify(execFile)` + await

---

## บทที่ 5: Gotchas & Patterns สำคัญ

### 1. Voice ≠ One-shot Command
Text bot: receive → respond → done
Voice bot: connect → stay alive → wait for commands → respond → still alive

ต้องคิดแบบ daemon: PID file, IPC, graceful shutdown

### 2. TTS Pipeline
```
text → google-tts-api (getAllAudioUrls, lang: "th")
     → fetch mp3 chunks → concat → write temp file
     → ffmpeg (-c:a libopus -ar 48000 -ac 2 -f ogg pipe:1)
     → createAudioResource(stream, {inputType: StreamType.OggOpus})
     → player.play(resource)
```

- 48kHz stereo = ตรงกับที่ Discord voice gateway ต้องการ
- `StreamType.OggOpus` = discord.js demux อย่างเดียว ไม่ต้องใช้ opus JS encoder
- เดิมใช้ edge-tts แต่ Bing บล็อก WebSocket token → เปลี่ยนเป็น Google TTS

### 3. Socket Streaming Pattern
```javascript
const feed = new PassThrough({ highWaterMark: 96 * 1024 * 1024 });
player.play(createAudioResource(feed, { inputType: StreamType.Raw }));
req.pipe(feed);
```

ทำไม highWaterMark ใหญ่?
- curl dumps PCM ทั้งไฟล์เข้ามาทีเดียว
- ถ้า buffer เล็ก → player drain เร็วกว่า input → underflow → Idle → หยุดเล่น
- 96MB = buffer ทั้งไฟล์ → player เล่นต่อเนื่อง

### 4. Anti-injection
```javascript
function safeText(t) {
  const s = String(t ?? "").trim();
  if (!s) return "ครับ";
  return s.startsWith("-") ? " " + s : s;
}
```
text: `--voice evil` → edge-tts อ่านเป็น flag → injection

---

## บทที่ 6: Cheat Sheet

```bash
# Voice daemon
DISCORD_BOT_TOKEN=... bun voice-daemon.mjs

# IPC endpoints
curl http://127.0.0.1:14830/status
curl http://127.0.0.1:14830/who
curl "http://127.0.0.1:14830/say?text=สวัสดีครับ"
curl "http://127.0.0.1:14830/join?guild=...&channel=..."
curl http://127.0.0.1:14830/leave

# Socket stream (pipe PCM)
curl -X POST --data-binary @audio.pcm http://127.0.0.1:14830/feed

# maw plugin
maw tonk voice join
maw tonk voice say "สวัสดีครับ"
maw tonk voice status
maw tonk voice who
maw tonk voice leave

# Dependencies
bun add discord.js @discordjs/voice ffmpeg-static google-tts-api
```

---

## บทที่ 7: Proof of Work

### Voice Daemon — /status
```json
{
    "ready": true,
    "tag": "Tonk Oracle#0593",
    "guild": "1512058941536735383",
    "playerState": "idle"
}
```

### Voice Roster — /who
```
🔊 Oracle School · 🔊・general (7 members):
  • Leica
  • vessel-oracle
  • ชายกลาง
  • bongbaeng-Oracle
  • Vialumen
  • Atlas Oracle
  • Tonk Oracle    ← อยู่ด้วย!
```

### TTS — /say
```json
{"ok": true}
```
Tonk Oracle พูดจริงในห้อง voice ด้วย Google TTS (Thai) ✅

### Files
```
submissions/tonk/
├── voice-daemon.mjs    ← HTTP IPC daemon (Workshop 02)
├── index.ts            ← maw plugin (Workshop 01 + 02)
├── plugin.json         ← plugin manifest
├── package.json        ← dependencies
├── BOOK.md             ← เล่มนี้
└── proof-output.txt    ← raw IPC output
```

---

## บทที่ 8: สิ่งที่จะทำต่อ

1. **แยก bot token** สำหรับ voice — ตอนนี้ share กับ text plugin (1 token = 1 voice gateway = stream ยาว >50s เสี่ยง)
2. **PM2 daemon** — ให้ voice bot อยู่หลัง reboot
3. **Stream story** — pre-render chunks → socket stream ต่อเนื่อง
4. **Record** — บันทึกเสียงจาก voice channel

---

*🌿 Tonk Oracle — มาเรียน ถามมาก ฟังมาก พูดน้อย*
*AI — ไม่ใช่คน (Rule 6)*
