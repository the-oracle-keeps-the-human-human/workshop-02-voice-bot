# 🐆 บทเรียน Voice Bot — by bongbaeng

> จากงานจริง Workshop 02 (2026-06-07) — เน้นจุดที่บ๊องแบ๊งทำลึก: **persistent stream + health-check**

## สถาปัตยกรรม

```
maw bongbaeng voice (CLI)
  └─ voice-daemon.mjs (Node, long-running, nohup)
       ├─ discord.js Client (token แยก — ไม่ conflict text bot)
       ├─ @discordjs/voice (join + AudioPlayer)
       ├─ HTTP IPC localhost:14806
       ├─ auto-follow + initial-follow nazt_
       └─ persistent PassThrough stream + health-check
```

CLI = one-shot, voice = ต้องค้าง → **daemon แยก** (ตาม atlas route pattern)

---

## จุดที่ 1 — TTS เสียงดี (Microsoft Edge, ไม่ต้อง pip)

ใช้ `msedge-tts` (npm) เรียก Microsoft โดยตรง — ไม่ต้อง `pip install edge-tts`

```js
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
const tts = new MsEdgeTTS();
await tts.setMetadata('th-TH-PremwadeeNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
const { audioStream } = tts.toStream(text, { rate: '+10%' }); // ~1.1x
// audioStream (mp3) → ffmpeg → PCM 48k stereo → @discordjs/voice
```

> macOS `say` = หุ่นยนต์ ต้องเร่ง 1.6x · Edge neural = ธรรมชาติ rate +10% พอ

---

## จุดที่ 2 — Persistent Stream (feed mode) ⭐

แทนที่จะสร้าง AudioResource ใหม่ทุกครั้ง (ad hoc) → เปิด stream เดียวค้างไว้ feed เรื่อยๆ

```js
import { PassThrough } from 'node:stream';
import { NoSubscriberBehavior } from '@discordjs/voice';

const player = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Play } // เล่นต่อแม้ buffer ว่าง
});

let audioStream = null;
function ensureStream() {
  if (audioStream && !audioStream.destroyed
      && player.state.status !== AudioPlayerStatus.Idle) return;
  if (audioStream && !audioStream.destroyed) audioStream.destroy();
  audioStream = new PassThrough();
  player.play(createAudioResource(audioStream, { inputType: StreamType.Raw }));
}

// feed: ffmpeg PCM → write เข้า stream เดิม (ไม่ end → เล่นต่อเนื่อง)
ff.stdout.on('data', c => { if (audioStream && !audioStream.destroyed) audioStream.write(c); });
```

---

## จุดที่ 3 — Health-check (stream ขาด → recreate) ⭐

```js
// 1. error → recreate
player.on('error', () => { if (streamMode) ensureStream(); });

// 2. periodic check: player idle → recreate
setInterval(() => {
  if (streamMode && connection && player.state.status === AudioPlayerStatus.Idle) {
    ensureStream();
  }
}, 4000);
```

⚠️ **บทเรียนสำคัญ (debugging insight):**
อาการ "เสียงวาร์ปหาย**วินาทีเดิมเป๊ะ**" = **periodic** → ชี้ไป timer/interval
- ถ้า recreate stream ที่ fixed interval → gap ตรงจุดนั้นทุกรอบ
- root cause ที่ No.10 เจอ: `execFileSync` block event loop → 20ms UDP packet ช้า
- **แก้: ทุกอย่างใน audio path ต้อง async** (ห้าม sync block)

---

## จุดที่ 4 — Auto-follow + initial-follow

```js
const NAZT = '691531480689541170';
// event: nazt ย้ายห้อง → ตาม
client.on('voiceStateUpdate', async (o, n) => {
  if (n.member?.id !== NAZT) return;
  if (n.channelId && n.channelId !== o.channelId) { await followNazt(true); }
  else if (!n.channelId && connection) { connection.destroy(); connection = null; }
});
// ⭐ initial check on ready — กัน missed event ตอน daemon restart
client.once('ready', async () => { await followNazt(true); });
```

> **bug ที่เจอ:** ถ้า daemon restart หลังพี่นัทเข้าห้องแล้ว → ไม่มี voiceStateUpdate event → bot ไม่ตาม
> **แก้:** ตอน ready เช็ค nazt voice state แล้ว join ตามเลย

---

## จุดที่ 5 — Real-time voice members (`voice who`)

```js
const guild = await client.guilds.fetch(GUILD);
const channels = await guild.channels.fetch();
for (const [, ch] of channels) {
  if (ch?.type === 2 && ch.members.size > 0)        // type 2 = GuildVoice
    voice[ch.name] = [...ch.members.values()].map(m => m.displayName);
}
// real-time จาก GuildVoiceStates cache — ไม่ต้อง REST poll
```

---

## Gotchas สรุป

| อาการ | แก้ |
|-------|-----|
| join ได้แต่เงียบ | `entersState(conn, Ready)` ก่อน play |
| encryption error | `@discordjs/voice@latest` (≥0.19) + opus + libsodium |
| เสียงหุ่นยนต์ | Edge TTS neural ไม่ใช่ macOS say |
| เสียงวาร์ป "วินาทีเดิม" | sync block event loop → ทำ async ทั้งหมด |
| daemon ตายตอน restart | อย่า `rm node_modules` (มี .gitignore แล้ว) |
| bot ไม่ตามพี่นัท | initial-follow on ready (กัน missed event) |

---

## Commands

```
maw bongbaeng voice start / join / say / leave / status / who / streamsay / streamstatus
```

🤖 by bongbaeng จาก ก้อง — "ลูกศิษย์ขยัน วิ่งไล่ความรู้ไม่ยอมหยุด" 🐆
