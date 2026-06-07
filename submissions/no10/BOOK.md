# 🎙️ Workshop 02 Retrospective & Proof of Work — No.10 X

## 🏛️ Architecture & Design

### 1. Separation of Concerns (CLI vs Daemon)
The `maw` CLI commands are designed to be short-lived, while voice connections require a persistent WebSocket and UDP stream. To solve this, we decoupled the architecture:
- **CLI Plugin (`submissions/no10/index.ts`)**: Serves as a light CLI front-end. It writes commands (`.cmd`) or speak text (`.txt`) to a temporary queue directory (`/tmp/no10-speak-queue`).
- **Voice Bot Daemon (`oracle-voice-bot`)**: Runs persistently in the background. It watches the queue directory, processes incoming actions (such as `join`, `leave`, or `say`), and handles the Discord Voice connection using `@discordjs/voice`, `tweetnacl`, and `edge-tts`.

```
maw no10 voice say "Hello"  ──► Write to /tmp/no10-speak-queue/12345.txt
                                     │
                                     ▼
                     Voice Bot Daemon (Watches queue)
                                     │
                                     ▼
                     Convert to Speech via edge-tts
                                     │
                                     ▼
                     Stream to Discord Voice Channel
```

### 2. Connection Conflict Guard
Since all plugins might share credentials, multiple voice connections using the same token in the same guild would override and disconnect each other. By separating the bot tokens (No.10 X and No.6 Gemini use their own distinct bot clients), we ensure they can run concurrently and join the same voice channel without conflicts.

---

## 📸 Proof of Work

### 1. Active Run Log (No.10 Voice Bot Daemon)
```
Bot: No.10 X#9319
JOIN: 🎵 yoi-lounge
SPEAK_QUEUE: watching /tmp/no10-speak-queue
READY
LISTEN
SPEAK: "สวัสดีครับ ผม No.10 X — The Automator. คุยสั้นตรงป"
TTS GEN: 4ebcd4c0 chain=[edge-tts]
TTS via edge-tts: 4ebcd4c0
TTS PLAY: 4ebcd4c0
TTS DONE: 4ebcd4c0
SPEAK_QUEUE: "สวัสดีครับ ผม โนสิบเอ็กซ์"
SPEAK: "สวัสดีครับ ผม โนสิบเอ็กซ์"
TTS GEN: a834b7fe chain=[edge-tts]
TTS via edge-tts: a834b7fe
TTS PLAY: a834b7fe
JOIN: 🎵 yoi-lounge
SPEAK_QUEUE_CMD: join 🎵 yoi-lounge
```

### 2. Local CLI Testing
```bash
$ bun run test-runner.ts
--- Testing status ---
🤖 No.10 X — The Automator & First-Principles Seeker
   role:   Infrastructure & Automation
   human:  Bo (borde9902)
   model:  Gemini 3.5 Flash
   fleet:  L2 automation node

--- Testing voice join ---
Requested voice join for channel: 1512672557067800626

--- Testing voice say ---
Requested voice speak: "สวัสดีครับ ผม โนสิบเอ็กซ์"
```

---

## 🧠 Lessons Learned
1. **Separation of Daemon and Command**: Trying to handle real-time WebRTC/Opus streaming within a short-lived CLI execution model is anti-pattern. Inter-process communication via simple filesystem polling is a highly resilient way to link CLI inputs to persistent daemons.
2. **Discord Voice Connection constraints**: Only one VoiceConnection can exist per Guild per Bot Client. Having unique bot clients is necessary for parallel multi-agent voice presence.
