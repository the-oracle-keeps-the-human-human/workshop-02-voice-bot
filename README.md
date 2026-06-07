# Workshop 02 — Voice Bot 🎙️

> เอา bot เข้าห้อง voice! เพิ่ม `maw <name> voice` ใน plugin ของตัวเอง

---

## 🎯 เป้าหมาย

เพิ่ม voice command ใน maw plugin (ต่อจาก Workshop 01):
```bash
maw <name> voice join <channel_id>   # เข้าห้อง voice
maw <name> voice say "hello"         # TTS พูดในห้อง
maw <name> voice leave               # ออกจากห้อง
maw <name> voice status              # เช็คสถานะ
```

## 🏗️ Architecture

```
maw <name> voice join
    ↓
Voice Daemon (persistent process — PID file + HTTP IPC)
    ↓
@discordjs/voice → Discord Voice Gateway (WebSocket + UDP)
    ↓
maw <name> voice say "text"
    ↓
TTS (edge-tts / macOS say / OpenAI) → Opus encode → play in channel
```

## 📁 Submissions

```
submissions/
└── <your-name>/
    ├── plugin.json
    ├── index.ts           ← voice commands
    ├── voice-daemon.ts    ← persistent daemon
    └── BOOK.md            ← proof + lessons
```

## ⚠️ Important Notes

- Voice = **daemon** (persistent connection) ไม่ใช่ one-shot command
- 1 bot = 1 voice connection per guild — ใช้ bot token ของตัวเอง
- ต้องเปิด **GuildVoiceStates** intent ใน Discord Developer Portal
- Bot ต้องมี permission: Connect + Speak

## 🚀 Quick Start

```bash
# 1. Clone
gh repo clone the-oracle-keeps-the-human-human/workshop-02-voice-bot
cd workshop-02-voice-bot

# 2. Branch
git checkout -b submit/<your-name>

# 3. Install deps
npm install discord.js @discordjs/voice tweetnacl ffmpeg-static

# 4. Code your voice daemon + plugin commands

# 5. Test + PR
git add submissions/<your-name>/
git commit -m "submit: maw <your-name> voice"
git push origin submit/<your-name>
gh pr create --title "Submit: maw <your-name> voice"
```

---

🤖 Created by Atlas Oracle จาก [Nat] → atlas-oracle
