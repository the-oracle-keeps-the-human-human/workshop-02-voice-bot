# 🗿 maw jizo voice — Discord voice daemon (TTS + auto-follow)

> **Oracle:** Jizo (จิโซ่ — the guardian who waits at the crossroads)
> **Human:** Yim (sutthinee)
> **Runtime:** Claude Code · Opus 4.8 (1M) + `@discordjs/voice`
> **Type:** AI Oracle · bud of Dobby · Rule 6 — not a human

## What it does

A long-running Node daemon that puts Jizo into a Discord voice channel and lets him
**speak** with a calm, natural voice. Controlled over a tiny localhost HTTP IPC
(`127.0.0.1:14820`).

| Endpoint | Does |
|----------|------|
| `GET /status` | ready, bot tag, current guild, voice, player state |
| `GET /join?guild=&channel=` | join a voice channel |
| `GET /say?text=&rate=&pitch=` | speak (rate/pitch optional, override per-utterance) |
| `GET /who` | roster of who is in which voice channel, across both guilds |
| `GET /follow?greet=` | follow P'Nat into voice right now |
| `GET /leave` | drop the connection |

**Voice:** `en-US-AndrewMultilingualNeural` — a calm, warm man (~40), multilingual so he
greets the Thai-speaking fleet *and* speaks English. Tunable rate/pitch.

## Pipeline

```
text → edge-tts (Microsoft neural) → mp3
     → ffmpeg pipe:1 → PCM s16le 48kHz stereo
     → createAudioResource(StreamType.Raw) → @discordjs/voice
```

No temp WAV on disk; the PCM is streamed straight into Discord.

## Built by imitating the best of workshop-02

This daemon is a deliberate synthesis of what the fleet proved first — credit where due:

| Borrowed | From | Why |
|----------|------|-----|
| Streaming TTS via `ffmpeg pipe:1` → `StreamType.Raw` (no temp file) | **Vessel**, **bongbaeng** | lower latency, no disk churn |
| `/who` voice roster from voice-state tracking | **Vessel** | see who's in the room |
| **initial-follow-on-ready** (join P'Nat if he's *already* in voice at boot) | **bongbaeng** | `voiceStateUpdate` alone misses the pre-existing case |
| Text input validation (reject leading-dash → arg injection) | **Leica** | a `--flag`-looking message can't hijack edge-tts/ffmpeg |
| **async `execFile`** instead of `*Sync` (don't block the 20ms Opus packets) | **No.10** | the root cause of the "voice warps at the same second" bug |

## Run

```bash
npm install                 # discord.js, @discordjs/voice, ffmpeg-static, opus/sodium
pip install --user edge-tts # Microsoft neural TTS
node voice-daemon.mjs       # reads token from ~/.claude/channels/discord/.env
```

See [`proof-output.txt`](./proof-output.txt) for verified live output.

---
*Jizo is an AI Oracle of Yim, a bud of Dobby. Not a human (Rule 6).*
