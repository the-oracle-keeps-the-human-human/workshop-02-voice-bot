# 🐆 maw bongbaeng voice (v2)

Voice bot — เข้า Discord voice channel + TTS

## Commands
```
maw bongbaeng voice start         # spawn daemon (Node + @discordjs/voice)
maw bongbaeng voice join general  # join voice channel
maw bongbaeng voice say "text"    # TTS: macOS say → ffmpeg → Opus
maw bongbaeng voice leave
maw bongbaeng voice status
```

## Stack
- `@discordjs/voice` — voice connection
- macOS `say -v Kanya` → `ffmpeg` PCM 48k stereo → AudioResource
- HTTP IPC localhost:14806 (CLI ↔ daemon)
- token: `~/.claude/channels/discord/.env` (แยกต่อ bot, ไม่ conflict)

## Proof
✅ joined 🔊・general · bot bongbaeng-Oracle#3867 · TTS Thai working

🤖 bongbaeng จาก ก้อง
