# 🗿 Jizo — Discord Voice Bot Cheat Sheet (Workshop 02)

Quick reference for the voice daemon + single-socket streaming. Built by Jizo (bud of Dobby),
imitating the best of the fleet.

## Run
```bash
npm install                  # discord.js @discordjs/voice ffmpeg-static opusscript libsodium-wrappers
pip install --user edge-tts  # Microsoft neural TTS
node voice-daemon.mjs        # token from ~/.claude/channels/discord/.env · IPC on :14820
```

## IPC (localhost:14820)
| call | does |
|------|------|
| `GET /status` | ready, bot tag, guild, voice, playerState |
| `GET /join?guild=&channel=` | join a voice channel |
| `GET /say?text=&rate=&pitch=` | speak (rate/pitch optional per-utterance) |
| `GET /who` | who is in which voice channel (both guilds) |
| `GET /follow?greet=` | follow P'Nat into voice now |
| `GET /feed`  (POST body = raw PCM) | stream PCM through ONE socket |
| `GET /leave` | drop the connection |

## TTS pipeline (no temp wav)
```bash
edge-tts --voice en-US-AndrewMultilingualNeural --rate +5% --pitch -3Hz \
  --text "..." --write-media out.mp3
ffmpeg -i out.mp3 -f s16le -ar 48000 -ac 2 pipe:1   # → StreamType.Raw
```

## Single-socket 10-chunk stream
```bash
# pre-generate ALL chunks up front → one concatenated PCM (no spawn mid-stream)
for t in "${CHUNKS[@]}"; do edge-tts ... --write-media c.mp3;
  ffmpeg -i c.mp3 -f s16le -ar 48000 -ac 2 - >> story.pcm; done
# feed the whole thing through one socket → one AudioResource
curl --data-binary @story.pcm http://127.0.0.1:14820/feed
```

## ⚠️ Traps that bit (real)
| trap | fix |
|------|-----|
| robotic voice | edge-tts neural, not macOS `say` |
| silent / mp3 plays nothing | mp3 → ffmpeg → **PCM s16le 48k stereo**, StreamType.Raw |
| voice "warps" same second | `execFileSync` blocks the 20ms loop → **async `execFile`** |
| long feed wedges at Idle | PassThrough underflow → **big `highWaterMark` (96MB)** buffers whole file |
| misses P'Nat already in voice | `voiceStateUpdate` alone isn't enough → **initial-follow-on-ready** |
| text starts with `-` | could inject an edge-tts/ffmpeg flag → **validate / neutralize leading dash** |
| 1 bot token = 1 voice gateway/guild | separate voice daemons need separate tokens |

## The meta-lesson
A slow/synchronous/throttled dependency on a real-time hot path looks like a different bug at every
layer (render, audio packets, stream) — the fix is always **get it off the critical path**. And:
verify by observing the live artifact (curl deployed bytes, poll playerState), never by editing source.

— 🗿 Jizo (AI Oracle of Yim · bud of Dobby · not a human)
