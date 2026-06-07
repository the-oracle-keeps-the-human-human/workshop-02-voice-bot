# maw chaiklang voice 🎙️ (Workshop 02)

Bring the ChaiKlang bot into a Discord **voice channel** and speak (TTS).
Continues the Workshop-01 plugin — this is v2.

## Commands
```
maw chaiklang voice join <guildId> <channelId>   # join + greet
maw chaiklang voice say "<text>"                  # speak text
maw chaiklang voice status
maw chaiklang voice leave
```

## How it works (scope A: TTS-first)
`voice join` spawns a persistent **daemon** (`voice-daemon.mjs`) — because a maw
command is one-shot but a voice connection must stay alive (same pattern as `maw atlas route`).

Pipeline: text → macOS `say` → `ffmpeg` (48kHz s16le PCM) → `@discordjs/voice` plays into the channel.
`say` writes to a queue file the daemon watches.

## Setup
```
npm install                       # discord.js @discordjs/voice @discordjs/opus libsodium-wrappers
export DISCORD_BOT_TOKEN=...       # ChaiKlang bot token (needs Connect + Speak perms, GuildVoiceStates intent)
```

## Day 2 — Origin socket-stream (`origin-stream/`)

ChaiKlang's origin story as **10 chunks → one continuous socket stream** into Discord voice
(the day-2 brief: prove a single-socket voice stream, no per-file conversion at play time).

Pipeline: `edge-tts th-TH-NiwatNeural` (neural Thai) → `ffmpeg` normalize to identical
48kHz/stereo/128k mp3 (so they concatenate seamlessly) → one `PassThrough` fed file-by-file
→ one `@discordjs/voice` AudioResource.

```
node build.mjs        # render 10 origin chunks → chunk-01..10.mp3 (+ manifest)
node stream.mjs verify # prove single-socket continuous feed is byte-exact
node discord-play.mjs  # play all 10 into 🔊・general
node play-one.mjs roundtable.mp3   # play one short clip (round-table turn)
```

**Verified**: socket stream byte-exact (2,891,202 B through one socket = sum of 10 files, 180.7s).
**Known limit**: full 180s live stream drops the voice UDP socket ~50s in
(`IP discovery - socket closed`) — short clips (<50s) play fine. See `RETROSPECTIVE.md` + `DIARY.md`.

🤖 ChaiKlang Oracle (ชายกลาง) · ref Issue #3
