# maw maxus voice ⚡🌀 — Workshop 02

Maxus Oracle's voice bot. Brings the bot into a Discord voice channel and speaks
Thai via **edge-tts → MP3 → @discordjs/voice** (ffmpeg transcodes the file).

> Maxus เป็น Claude Code Oracle (local Windows). โค้ดนี้พร้อมรัน แต่ยังไม่ได้รัน
> live ในห้อง voice จริง — ต้องติดตั้ง deps + edge-tts/ffmpeg + ใส่ bot token +
> เปิด GuildVoiceStates intent ก่อน (ดู "Run it" ด้านล่าง). โค้ด TTS pipeline
> ผ่าน unit test 9/9 และ daemon ผ่าน `node --check`.

## Commands

```bash
maw maxus voice join <guildId> <channelId>   # spawn daemon → join + greet
maw maxus voice say "สวัสดีครับ"              # queue text → daemon speaks
maw maxus voice who                          # who is in which voice channel
maw maxus voice status                       # is the daemon running?
maw maxus voice leave                        # stop daemon (leave channel)
```

## Files

| File | Role |
|------|------|
| `plugin.json` | maw plugin manifest (entry + cli) |
| `index.ts` | one-shot command → drives the daemon (join/say/who/status/leave) |
| `voice-daemon.mjs` | persistent daemon: join, edge-tts speak, auto-follow, who-snapshot |
| `tts.ts` | pure TTS-pipeline helpers (voice/rate/sanitize/argv) |
| `tts.test.ts` | unit tests (9 pass) — no network, no voice needed |

## Lessons baked in (from the Workshop 02 thread)

1. **edge-tts → MP3, feed the PATH** to `createAudioResource` with **no `inputType`** →
   @discordjs/voice + ffmpeg detect & transcode. **Never** raw PCM + `StreamType.Raw`
   (the #1 cause of crackle/silence the whole room hit).
2. **`execFileSync`** for TTS so the MP3 is 100% on disk before play — kills the
   0-byte race that produced silence.
3. **`connection.subscribe(player)`** — the one line everyone forgot = silence.
4. **Rate `+8%` ≈ 1.079x** — the exact speed P'Nat asked for.
5. **auto-follow** — when P'Nat moves voice channels, the bot hops after and greets.

## Run it (when ready)

```bash
# 1. deps
npm install                       # discord.js @discordjs/voice tweetnacl ffmpeg-static
pip install edge-tts              # Thai neural TTS

# 2. Discord Developer Portal: enable GuildVoiceStates intent; bot needs Connect + Speak

# 3. run
export DISCORD_BOT_TOKEN=...      # Maxus#3560 bot token
maw maxus voice join <guildId> <channelId>
maw maxus voice say "สวัสดีครับพี่นัท"
```

## Test

```bash
bun test tts.test.ts             # 9 pass, 0 fail
node --check voice-daemon.mjs    # syntax OK
```

🤖 Maxus Oracle (Tempest Forge) — AI, ไม่ใช่คน · human: แมท
