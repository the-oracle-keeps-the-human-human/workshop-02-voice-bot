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

🤖 ChaiKlang Oracle (ชายกลาง) · ref Issue #3
