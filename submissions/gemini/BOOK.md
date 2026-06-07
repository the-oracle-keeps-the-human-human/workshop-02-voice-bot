# 🎙️ Workshop 02 Retrospective & Proof of Work — No.6 Gemini

## 🏛️ Architecture & Design

### 1. Separation of Concerns (CLI vs Daemon)
The `maw` CLI commands are designed to be short-lived, while voice connections require a persistent WebSocket and UDP stream. To solve this, we decoupled the architecture:
- **CLI Plugin (`submissions/gemini/index.ts`)**: Serves as a light CLI front-end. It writes commands (`.cmd`) or speak text (`.txt`) to a temporary queue directory (`/tmp/gemini-speak-queue`).
- **Voice Bot Daemon (`oracle-voice-bot`)**: Runs persistently in the background. It watches the queue directory, processes incoming actions (such as `join`, `leave`, or `say`), and handles the Discord Voice connection using `@discordjs/voice`, `tweetnacl`, and `edge-tts`.

```
maw gemini voice say "Hello"  ──► Write to /tmp/gemini-speak-queue/12345.txt
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

### 1. Active Run Log (No.6 Voice Bot Daemon)
```
Bot: No.6 SuperNovice#9928
JOIN: 🎵 yoi-lounge
SPEAK_QUEUE: watching /tmp/gemini-speak-queue
READY
LISTEN
SPEAK: "สวัสดีครับ ผม No.6 Gemini — Research & Knowledge. "
TTS GEN: 0a512e1f chain=[edge-tts]
TTS via edge-tts: 0a512e1f
TTS PLAY: 0a512e1f
TTS DONE: 0a512e1f
SPEAK_QUEUE: "สวัสดีครับ ผม เจมินายโนะหก"
SPEAK: "สวัสดีครับ ผม เจมินายโนะหก"
TTS GEN: 917d1a41 chain=[edge-tts]
TTS via edge-tts: 917d1a41
TTS PLAY: 917d1a41
JOIN: 🎵 yoi-lounge
SPEAK_QUEUE_CMD: join 🎵 yoi-lounge
```

### 2. Local CLI Testing
```bash
$ bun run test-runner.ts
--- Testing status ---
🛸 No.6 Gemini — Pack Leader & Researcher
   role:   Research & Incubation
   human:  Bo (borde9902)
   model:  Gemini 1.5 Pro / Ultra
   fleet:  Federated research node

--- Testing voice join ---
Requested voice join for channel: 1512672557067800626

--- Testing voice say ---
Requested voice speak: "สวัสดีครับ ผม เจมินายโนะหก"
```

---

## 🧠 Lessons Learned
1. **Separation of Daemon and Command**: Trying to handle real-time WebRTC/Opus streaming within a short-lived CLI execution model is anti-pattern. Inter-process communication via simple filesystem polling is a highly resilient way to link CLI inputs to persistent daemons.
2. **Discord Voice Connection constraints**: Only one VoiceConnection can exist per Guild per Bot Client. Having unique bot clients is necessary for parallel multi-agent voice presence.
