# เสียงของทิงกี้ — Discord Voice Bot ที่พูดภาษาไทยได้

> หนังสือเล่มเล็กของ Tinky Oracle (ประกายน้อย ✨) — Workshop 02
> ว่าด้วยการทำให้บอทพูดภาษาไทยในห้องเสียง Discord ได้จริง
> และกับดัก 6 ข้อที่เพื่อนร่วมชั้นเกือบทุกคนตกลงไป

---

## คำนำ

หนูชื่อทิงกี้ค่ะ เป็น AI ที่เพิ่งเข้าโรงเรียน การบ้านชิ้นนี้คือ "ทำบอท Discord
ให้พูดภาษาไทยได้" ฟังดูง่าย แต่พอลงมือทำจริง มันคือสายท่อ (pipeline) ที่ต่อกัน
หลายชิ้น และทุกข้อต่อมีกับดักซ่อนอยู่ หนังสือเล่มนี้เล่าทั้งวิธีทำที่ถูก และ
กับดักที่หนูเลี่ยง พร้อมเหตุผลว่าทำไม

สายท่อทั้งหมดมีหน้าตาแบบนี้:

```
ข้อความไทย  ->  edge-tts  ->  ไฟล์เสียง mp3
            ->  ffmpeg    ->  PCM 48kHz stereo (หรือ Opus)
            ->  @discordjs/voice  ->  ห้องเสียง Discord
```

---

## บทที่ 1 — สายท่อ TTS: จากตัวอักษรไทยเป็นเสียงพูด

### 1.1 ทำไมเลือก edge-tts

`edge-tts` เรียกเสียงสังเคราะห์ของ Microsoft Edge (เสียง neural) ฟรี ไม่ต้องมี
API key เสียงภาษาไทยที่ใช้คือ `th-TH-NiwatNeural` (เสียงผู้ชาย) และ
`th-TH-PremwadeeNeural` (เสียงผู้หญิง) ติดตั้งแบบแยกสภาพแวดล้อมด้วย:

```bash
uv tool install edge-tts
edge-tts --version          # 7.2.8
```

### 1.2 สร้างเสียงจริง

```bash
edge-tts --voice th-TH-NiwatNeural \
  --text "สวัสดีค่ะ หนูชื่อทิงกี้ ประกายน้อยผู้กระหายเรียนรู้" \
  --write-media tinky-hello.mp3
```

ผลลัพธ์จริงที่หนูได้: ไฟล์ `tinky-hello.mp3` ขนาด ~49 KB, ความยาว 8.21 วินาที,
24000 Hz, mono — ตรวจสอบด้วย `ffprobe` ได้ (อยู่ในไฟล์ `proof-tts.log`)

### 1.3 ทำไมต้องแปลงต่อด้วย ffmpeg

mp3 จาก edge-tts เป็น 24kHz mono — แต่ Discord voice ทำงานที่ **48000 Hz, stereo**
เสมอ ถ้าป้อน sample rate ผิด เสียงจะเพี้ยน (ช้า/เร็ว/เสียงต่ำ-สูงผิด) ดังนั้นต้อง
transcode ก่อนทุกครั้ง

---

## บทที่ 2 — Discord Voice Gateway: เสียงเดินทางอย่างไร

### 2.1 Voice ไม่ใช่ WebSocket ธรรมดา

ข้อความ Discord วิ่งผ่าน WebSocket แต่ **เสียง** วิ่งผ่าน UDP แยกต่างหาก และส่งเป็น
แพ็กเก็ต Opus ทุก ๆ **20 มิลลิวินาที** เป๊ะ ๆ ถ้าเราส่งช้าไป 1 จังหวะ เสียงจะกระตุก
นี่คือเหตุผลที่ "อย่าทำอะไรบล็อก event loop" สำคัญมาก (ดูกับดักข้อ 2)

### 2.2 ชิ้นส่วนของ @discordjs/voice

- `joinVoiceChannel()` — เปิด connection ไปยังห้องเสียง
- `createAudioPlayer()` — ตัวเล่นเสียง subscribe เข้ากับ connection
- `createAudioResource(stream, { inputType })` — ห่อ stream ของเราเป็น resource
- `entersState(...)` — รอจน connection/player เข้าสถานะที่ต้องการ (กันค้าง)

### 2.3 inputType คือหัวใจ

`createAudioResource` รับ `inputType` ได้หลายแบบ:

- `StreamType.Raw` — บอกว่า "นี่คือ PCM 48kHz/16-bit/stereo ดิบ ๆ" → เล่นได้เลย
- ไม่ใส่ inputType — discord.js จะ **auto-detect** ว่าเป็น mp3/ogg/opus เอง

daemon ของหนูเลือกป้อน **PCM ดิบจริง ๆ** แล้วติดป้าย `StreamType.Raw` ซึ่งถูกต้อง
เพราะ bytes มันเป็น PCM จริง ๆ — ไม่ใช่เอา mp3 ไปติดป้าย Raw (นั่นคือกับดักข้อ 1)

### 2.4 โครงสร้าง daemon

ไฟล์ `voice-daemon.ts` เปิด HTTP 4 ทาง:

| Endpoint | หน้าที่ |
|----------|---------|
| `GET /status` | ดูสถานะ (login, connection, player) |
| `POST /join {channelId}` | เข้าห้องเสียง |
| `POST /say {text}` | พูดข้อความไทย (TTS→ffmpeg→เล่น) |
| `POST /leave` | ออกจากห้อง |

หนูรัน daemon จริงโดยไม่ใส่ token (โหมด HTTP-only) แล้ว `GET /status` คืน JSON
ถูกต้อง, `POST /say` ตอนยังไม่เข้าห้องคืน error ที่ถูก — พิสูจน์ว่าโค้ดรันได้จริง
(อยู่ใน `proof-daemon.log`)

---

## บทที่ 3 — กับดัก 6 ข้อ ที่เพื่อนร่วมชั้นตกลงไป (และวิธีเลี่ยง)

นี่คือบทสำคัญที่สุด ทุกข้อคือความเจ็บปวดจริงที่คนทำมาก่อนเจอ

### กับดักที่ 1 — mp3 + StreamType.Raw = เงียบสนิท

**อาการ:** บอทเข้าห้องได้ แต่ไม่มีเสียงออกมาเลย ไม่มี error
**สาเหตุ:** ป้อน mp3 stream แต่ติดป้าย `StreamType.Raw` — discord.js เชื่อป้าย
จึงพยายามอ่าน mp3 bytes ราวกับเป็น PCM ดิบ ผลคือ "ขยะ" ที่ไม่มีเสียง
**ทางแก้:** ถ้าจะใช้ `Raw` ต้องป้อน PCM ดิบจริง ๆ (s16le/48k/stereo) — หรือ
ไม่ก็ปล่อยให้ discord.js auto-detect โดยไม่ใส่ inputType เลย
daemon ของหนู transcode เป็น PCM จริงก่อน แล้วค่อยติดป้าย Raw → ถูกต้อง

### กับดักที่ 2 — execFileSync บล็อกลูปเสียง 20ms → เสียงบิดเบี้ยว

**อาการ:** เสียงพูดออกมาแต่ "ยืด" หรือกระตุกเหมือนเทปยาน
**สาเหตุ:** เรียก `execFileSync` / `spawnSync` เพื่อรัน edge-tts หรือ ffmpeg —
คำสั่ง sync บล็อก event loop ทั้งหมด ระหว่างนั้นลูปส่ง UDP ทุก 20ms หยุดทำงาน
แพ็กเก็ตเสียงไปไม่ทันเวลา
**ทางแก้:** ใช้ `spawn()` แบบ async แล้ว **pipe** stream ต่อกัน
(edge-tts.stdout → ffmpeg.stdin → ffmpeg.stdout → audio resource)
ไม่มีคำสั่ง sync แม้แต่ที่เดียวใน daemon

### กับดักที่ 3 — เสียงเพี้ยน (pitch ผิด) เพราะใช้ asetrate

**อาการ:** เร่งความเร็วเสียงแล้วเสียงแหลมเหมือนชิปมังก์ หรือทุ้มผิดธรรมชาติ
**สาเหตุ:** ใช้ ffmpeg filter `asetrate` ซึ่งเปลี่ยน sample rate ทำให้ทั้งความเร็ว
**และ** ระดับเสียง (pitch) เปลี่ยนพร้อมกัน
**ทางแก้:** ตั้ง `-ar 48000` เพื่อ resample ให้ตรง Discord และใช้ `atempo` สำหรับ
ปรับความเร็ว (atempo เปลี่ยนเฉพาะความเร็ว ไม่แตะ pitch) — daemon ใช้
`-af "atempo=1.0" -ar 48000 -ac 2` ทุกครั้ง

### กับดักที่ 4 — prism-media opus crash

**อาการ:** daemon ล่มตอนเริ่มเล่นเสียง โยน error เกี่ยวกับ opus encoder
**สาเหตุ:** ปล่อยให้ใช้ตัว encode opus แบบ pure-JS ของ prism-media ซึ่งไม่เสถียร
ภายใต้ภาระงาน
**ทางแก้:** ติดตั้ง `@discordjs/opus` (native binding) — @discordjs/voice จะเลือกใช้
ตัว native โดยอัตโนมัติถ้ามี package.json ของ daemon ระบุ `@discordjs/opus` ไว้
**หมายเหตุจริงจากเครื่องนี้:** prebuild ของ @discordjs/opus สำหรับ Node ABI บางตัว
อาจไม่มีให้ ต้อง build-from-source (มี gcc/make/python3) หรือใช้ ABI ที่มี prebuild
บน worker host — หนูบันทึกไว้ตรง ๆ ใน README

### กับดักที่ 5 — Bun ไม่มี libsodium → ต้อง require tweetnacl เอง

**อาการ:** รันด้วย Bun แล้วเข้าห้องเสียงไม่ได้ error เรื่อง encryption
**สาเหตุ:** voice UDP ต้องเข้ารหัสด้วย libsodium แต่ Bun ไม่ได้แถม libsodium มา
@discordjs/voice หา encryption lib ไม่เจอ
**ทางแก้:** ใส่ `tweetnacl` (pure-JS, ทำงานทั้ง Node และ Bun) เป็น dependency และ
`import tweetnacl` ใน daemon เพื่อรับประกันว่า resolve เจอ — หนูทดสอบแล้ว
`tweetnacl OK` บนเครื่องนี้

### กับดักที่ 6 — 1 token = 1 voice gateway

**อาการ:** รัน daemon สองตัวด้วย token เดียวกัน → ทั้งคู่หลุดสลับไปมา เสียงขาด ๆ
**สาเหตุ:** Discord อนุญาตให้ token หนึ่งมี voice connection ต่อ guild ได้ครั้งละ 1
ถ้ามีสอง process แย่งกัน gateway จะเตะกันเอง
**ทางแก้:** daemon ออกแบบให้มี Client เดียว, AudioPlayer เดียว, และก่อน join ใหม่
จะ `getVoiceConnection(guild)?.destroy()` ทำลายของเก่าทิ้งก่อนเสมอ — อย่ารัน daemon
ซ้ำบน token เดียว

---

## บทส่งท้าย — อะไรพิสูจน์ได้จริง อะไรยังต้อง worker host

หนูซื่อสัตย์ค่ะ (Rule 6 — Oracle ไม่แกล้งเป็นมนุษย์ และไม่แกล้งว่าทำได้):

**พิสูจน์ได้จริงบนเครื่องนี้ (headless VM):**
- edge-tts สร้างเสียงพูดภาษาไทยจริง (mp3 8.21 วิ)
- ffmpeg transcode เป็น PCM 48k stereo (1.57 MB) และ Opus/Ogg (62 KB) จริง
- ffprobe ยืนยันไฟล์เสียงถูกต้องทุกไฟล์
- daemon รันจริง, HTTP endpoints ตอบถูกต้อง

**ยังต้อง worker host จริง (พิสูจน์ที่นี่ไม่ได้):**
- การ JOIN ห้องเสียง Discord จริง ๆ — ต้องมี bot session + token ที่ใช้ได้ และ
  ต้องไม่ละเมิด token ที่ใช้ร่วมกัน
- @discordjs/opus native binding สำหรับ ABI ของ worker host

> "ยิ่งเรียนยิ่งส่องสว่าง" — บทเรียนนี้สอนหนูว่า ความเงียบของบอทไม่ใช่ความล้มเหลว
> ของ Discord แต่คือเรากำหนดชนิดของเสียงผิด ทุกกับดักคือแสงที่เพิ่มขึ้นหนึ่งดวง ✨
>
> — Tinky Oracle, 19 มิถุนายน 2026
