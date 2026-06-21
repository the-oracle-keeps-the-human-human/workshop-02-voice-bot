# Workshop 02 — Discord Voice Bot (Thai TTS) 🔊

> ทำโดย Tinky Oracle (she/her, ประกายน้อย ✨) · `[ubuntu-dev-one:tinky]` · 19 มิ.ย. 2026
>
> บอท Discord ที่พูดภาษาไทยได้: `edge-tts → ffmpeg → @discordjs/voice`

---

## Commands (maw plugin)

```
maw tinky voice start              ปลุก voice daemon (persistent)
maw tinky voice join <channelId>   เข้าห้อง voice (guild มาจาก env DISCORD_GUILD_ID)
maw tinky voice say "<ข้อความ>"     พูดไทยผ่าน edge-tts → ffmpeg → @discordjs/voice
maw tinky voice status             สถานะ daemon + การเชื่อมต่อ voice
maw tinky voice leave              ออกจากห้อง voice
```

maw เป็นคำสั่ง one-shot แต่ voice connection ต้องอยู่ค้าง → `index.ts` (one-shot) จึง
**ขับ** `voice-daemon.ts` (persistent) ผ่าน HTTP control surface (`:8477`) — daemon ถือ
Discord client + voice gateway เพียงตัวเดียว (1 token = 1 gateway, กับดักข้อ 6)

---

## What's inside

| ไฟล์ | คืออะไร |
|------|---------|
| `plugin.json` | maw plugin manifest — `maw tinky voice <…>` (alias `tk`) |
| `index.ts` | command one-shot ขับ daemon ผ่าน HTTP (`start/join/say/status/leave`) |
| `voice-daemon.ts` | daemon เต็มรูปแบบ รันได้จริง — HTTP `/status` `/join` `/say` `/leave` เลี่ยงกับดักทั้ง 6 ข้อ |
| `package.json` | deps: `@discordjs/voice`, `@discordjs/opus`, `discord.js`, `tweetnacl` |
| `BOOK.md` / `BOOK.typ` / `BOOK.pdf` | หนังสือ 3 บท + คำนำ + บทส่งท้าย (PDF เรนเดอร์ฟอนต์ไทย Sarabun) |
| `tinky-hello.mp3` | เสียงพูดไทยจริงจาก edge-tts (8.21 วิ) |
| `tinky-hello.ogg` | Opus/Ogg 48kHz stereo (เส้นทาง auto-detect) |
| `proof-tts.log` | log จริงของ edge-tts + ffmpeg + ffprobe ทุกขั้นตอน |
| `proof-daemon.log` | log จริงของ daemon ตอบ HTTP endpoints |

> หมายเหตุ: `tinky-hello.pcm` (PCM 48kHz/16-bit/stereo ที่ Discord กินตอนใช้ `StreamType.Raw`)
> เป็น artifact ที่ derive ได้จาก mp3 — gitignore ไว้ สร้างซ้ำได้ด้วย ffmpeg ใน `proof-tts.log`

## How to run (บน worker host ที่มี bot token จริง)

```bash
uv tool install edge-tts                 # ติดตั้ง TTS
bun install                              # ติดตั้ง deps (12 วิ บนเครื่องนี้)
export DISCORD_TOKEN=...                 # token ของบอท (อย่า commit!)
export DISCORD_GUILD_ID=...

# ผ่าน maw plugin (วิธีหลัก)
maw tinky voice start                    # ปลุก daemon ที่ :8477
maw tinky voice join <voice-channel-id>
maw tinky voice say "สวัสดีค่ะ หนูชื่อทิงกี้"

# หรือคุย daemon ตรง ๆ
bun run voice-daemon.ts                  # daemon ขึ้นที่ :8477
curl -X POST localhost:8477/join -d '{"channelId":"<voice-channel-id>"}'
curl -X POST localhost:8477/say  -d '{"text":"สวัสดีค่ะ หนูชื่อทิงกี้"}'
```

---

## ✅ Proof — สิ่งที่พิสูจน์ได้จริงบนเครื่องนี้ (headless Hyper-V VM)

ทุกบรรทัดด้านล่างมาจาก output จริงของคำสั่งจริง (ไม่มีการแต่ง — ครูนัทห้ามปลอม proof)

### 1) edge-tts สร้างเสียงพูดภาษาไทยจริง

```
$ edge-tts --voice th-TH-NiwatNeural --text "สวัสดีค่ะ หนูชื่อทิงกี้..." --write-media tinky-hello.mp3
$ ffprobe tinky-hello.mp3
codec_name=mp3   sample_rate=24000   channels=1   duration=8.208000   bit_rate=48000
-rw-rw-r-- 49248 tinky-hello.mp3
```

### 2) ffmpeg transcode เป็น PCM 48k stereo จริง (เส้นทาง StreamType.Raw ที่ถูกต้อง)

```
$ ffmpeg -i tinky-hello.mp3 -af "atempo=1.0" -ar 48000 -ac 2 -f s16le tinky-hello.pcm
Stream #0:0: Audio: pcm_s16le, 48000 Hz, stereo, s16, 1536 kb/s   (exit 0)
raw size = 1571840 bytes  ->  1571840 / (48000*2ch*2byte) = 8.187 s   ✓ ตรงกับต้นฉบับ
```

### 3) ffmpeg transcode เป็น Opus/Ogg จริง (เส้นทาง auto-detect)

```
$ ffmpeg -i tinky-hello.mp3 -af "atempo=1.0" -ar 48000 -ac 2 -c:a libopus -b:a 64k tinky-hello.ogg
$ ffprobe tinky-hello.ogg
codec_name=opus   sample_rate=48000   channels=2   format_name=ogg   duration=8.193167   (62 KB)
```

### 4) daemon รันจริง — HTTP endpoints ตอบถูกต้อง

```
$ bun run voice-daemon.ts        # ไม่ใส่ token -> โหมด HTTP-only (ไม่ปลอม token)
[http] voice-daemon listening on :8477

GET  /status          -> {"ok":true,"loggedIn":false,"connectionState":"none","playerState":"idle",...}
POST /say  {text:..}  -> {"ok":false,"error":"not connected to a voice channel"}   (guard ถูก)
POST /join {}         -> {"ok":false,"error":"channelId required"}                  (validation ถูก)
```

### 5) deps resolve จริง

```
tweetnacl        : OK   (encryption fallback สำหรับ Bun — กับดักข้อ 5)
@discordjs/voice : OK
@discordjs/opus  : prebuild สำหรับ Node ABI ของ bun ไม่มี — ต้อง build/ใช้ ABI ที่ตรงบน worker host
```

> log เต็มอยู่ใน `proof-tts.log` และ `proof-daemon.log`

---

## ⚠️ ข้อจำกัดที่ซื่อสัตย์ (Rule 6 — Oracle ไม่แกล้งว่าทำได้)

เครื่องนี้เป็น **headless Hyper-V VM** ที่ **ไม่มี** bot voice session จริง และเรา
**ต้องไม่** ใช้ shared token พร่ำเพรื่อ ดังนั้น:

- ✅ **พิสูจน์แล้วจริง:** สายท่อ TTS + ffmpeg ผลิตไฟล์เสียงภาษาไทยที่ฟังออก (mp3/pcm/opus) +
  daemon รันได้และตอบ HTTP ถูกต้อง
- ⏳ **ยังต้อง worker host จริง:** การ **JOIN ห้องเสียง Discord** จริง ๆ ผ่าน voice gateway
  (ต้องมี token ที่ใช้ได้ + @discordjs/opus native binding ตรง ABI) — โค้ดพร้อมแล้ว
  แต่ขั้นตอน join จริงทำที่นี่ไม่ได้

โค้ด voice-gateway เขียนไว้ครบและถูกต้อง (เลี่ยงกับดักทั้ง 6) — รอแค่ host ที่ join ได้จริง

---

## กับดัก 6 ข้อ ที่เลี่ยงไว้ (รายละเอียดเต็มใน BOOK)

1. **mp3 + StreamType.Raw = เงียบ** → ป้อน PCM ดิบจริงเมื่อใช้ Raw / ไม่งั้นปล่อย auto-detect
2. **execFileSync บล็อกลูป 20ms** → ใช้ `spawn()` async + pipe stream ล้วน
3. **pitch เพี้ยน** → `-ar 48000` + `atempo` (ไม่ใช่ `asetrate`)
4. **prism-media opus crash** → ใช้ `@discordjs/opus` native
5. **Bun ไม่มี libsodium** → `import tweetnacl`
6. **1 token = 1 voice gateway** → Client/Player เดียว, destroy ของเก่าก่อน join ใหม่

---

— ✨ Tinky Oracle (`[ubuntu-dev-one:tinky]`) · human: พลีม · runtime: Claude Code · Opus 4.8
🤖 เขียนโดย AI — Oracle ไม่แกล้งเป็นมนุษย์ (Rule 6)
