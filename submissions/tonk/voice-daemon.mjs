// Tonk Oracle voice daemon — joins Discord voice, listens + speaks.
// Control via HTTP IPC on 127.0.0.1:14830  (/status /join /say /who /leave /feed /listen).
//
// Pipeline: receive audio → transcribe (faster-whisper) → LLM (claude -p) → TTS → speak

import { readFileSync, writeFileSync, unlinkSync, createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { PassThrough } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import http from "node:http";
import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType,
  getVoiceConnection, entersState, VoiceConnectionStatus, AudioPlayerStatus,
  EndBehaviorType,
} from "@discordjs/voice";
import opusPkg from "@discordjs/opus";
const { OpusEncoder } = opusPkg;

const pexec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const FFMPEG = join(homedir(), ".bun/install/global/node_modules/ffmpeg-static/ffmpeg");
const TRANSCRIBE_PY = join(HERE, "transcribe.py");

process.env.DEBUG = "discordjs:voice:*";
const GREET = "สวัสดีครับ Tonk Oracle เข้าห้องเสียงแล้วครับ";
let listenEnabled = false;
let isProcessing = false;

// --- env ---
const ENV_PATH = join(homedir(), ".claude/channels/discord/.env");
const LOCAL_ENV = join(HERE, ".env");
let TOKEN = "";
let TYPHOON_API_KEY = "";
for (const envFile of [ENV_PATH, LOCAL_ENV]) {
  try {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^(\w+)=(.*)$/);
      if (!m) continue;
      if (m[1] === "DISCORD_BOT_TOKEN") TOKEN = m[2].trim();
      if (m[1] === "TYPHOON_API_KEY") TYPHOON_API_KEY = m[2].trim();
    }
  } catch {}
}
TOKEN = process.env.DISCORD_BOT_TOKEN || TOKEN;
TYPHOON_API_KEY = process.env.TYPHOON_API_KEY || TYPHOON_API_KEY;
if (!TOKEN) { console.error("tonk-voice: no DISCORD_BOT_TOKEN"); process.exit(1); }

const NAZT = "691531480689541170";
const TK = "1488376113733570692";
const GUILD_ID = "1512058941536735383";
const GENERAL_VOICE = "1512058942250024983";
const PORT = 14830;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const player = createAudioPlayer({ behaviors: { noSubscriber: "play" } });
let currentGuildId = null;
let currentChannelId = null;

client.on("raw", (packet) => {
  if (packet.t === "VOICE_SERVER_UPDATE" || packet.t === "VOICE_STATE_UPDATE") {
    console.error(`tonk-voice: gateway event ${packet.t}`);
  }
});

// Anti-injection: reject text that looks like a CLI flag (Leica's lesson)
function safeText(t) {
  const s = String(t ?? "").trim();
  if (!s) return "ครับ";
  return s.startsWith("-") ? " " + s : s;
}

// TTS: edge-tts (Microsoft) → mp3 → ffmpeg → OGG/Opus → discord player
let edgeTtsVoice = "th-TH-NiwatNeural";
async function speak(text) {
  const t = safeText(text);
  const mp3 = `/tmp/tonk-tts-${Date.now()}.mp3`;
  const toOggOpus = (input) =>
    spawn(FFMPEG, ["-loglevel", "error", "-i", input, "-c:a", "libopus", "-ar", "48000", "-ac", "2", "-filter:a", "volume=2.0", "-f", "ogg", "pipe:1"],
          { stdio: ["ignore", "pipe", "ignore"] });
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn("edge-tts", ["--voice", edgeTtsVoice, "--rate=+17%", "--text", t, "--write-media", mp3], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      proc.stderr.on("data", (d) => stderr += d);
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`edge-tts exit ${code}: ${stderr}`)));
    });
    player.play(createAudioResource(toOggOpus(mp3).stdout, { inputType: StreamType.OggOpus }));
    await entersState(player, AudioPlayerStatus.Idle, 30_000).catch(() => {});
  } catch (e) {
    console.error(`tonk-voice: TTS failed: ${e}`);
  } finally {
    try { unlinkSync(mp3); } catch {}
  }
}

async function joinChannel(guildId, channelId) {
  const guild = await client.guilds.fetch(guildId);
  const conn = joinVoiceChannel({
    guildId, channelId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false,
  });
  conn.on("stateChange", (oldS, newS) => {
    console.error(`tonk-voice: conn ${oldS.status} → ${newS.status}`);
  });
  conn.on("error", (e) => console.error(`tonk-voice: conn error: ${e}`));
  conn.subscribe(player);
  currentGuildId = guildId;
  currentChannelId = channelId;
  try {
    await entersState(conn, VoiceConnectionStatus.Ready, 30_000);
    console.error(`tonk-voice: connection ready`);
  } catch {
    console.error(`tonk-voice: voice state timeout (state=${conn.state?.status})`);
  }
  return conn;
}

// --- Listen pipeline: receive → transcribe → LLM → speak ---

async function transcribe(wavPath) {
  const { stdout } = await pexec("python3", [TRANSCRIBE_PY, wavPath], {
    timeout: 30_000,
    env: { ...process.env, TYPHOON_API_KEY },
  });
  return JSON.parse(stdout.trim());
}

async function askLLM(userText) {
  const id = Date.now();
  const resFile = `/tmp/tonk-voice-res-${id}.txt`;
  const escaped = userText.replace(/'/g, "'\\''").replace(/\\/g, "\\\\");
  const tmuxCmd = `voice-reply: ${escaped} — ตอบสั้น 1-2 ประโยค ภาษาไทย ครับลงท้าย เขียนเฉพาะคำตอบลงไฟล์ ${resFile} ห้ามเขียนอย่างอื่น`;

  try {
    await pexec("tmux", ["send-keys", "-t", "tonk-oracle:1", tmuxCmd, "Enter"], { timeout: 5000 });

    // Poll for response file (max 30s)
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = readFileSync(resFile, "utf8").trim();
        if (res) {
          try { unlinkSync(resFile); } catch {}
          return res.slice(0, 300);
        }
      } catch {}
    }
    console.error("tonk-voice: tonk-reply timeout (30s)");
    return "ขอโทษครับ ตอบไม่ทันครับ";
  } catch (e) {
    console.error(`tonk-voice: askLLM error: ${e}`);
    return "ขอโทษครับ มีปัญหาครับ";
  }
}

function startListening(conn) {
  const receiver = conn.receiver;
  console.error(`tonk-voice: connection state=${conn.state?.status}, receiver=${!!receiver}`);

  receiver.speaking.on("start", (userId) => {
    console.error(`tonk-voice: speaking event from ${userId}`);
    if (userId !== NAZT && userId !== TK) return;
    if (!listenEnabled || isProcessing) return;
    console.error(`tonk-voice: recording ${userId}...`);

    isProcessing = true;

    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 2000 },
    });

    const opusDecoder = new OpusEncoder(48000, 2);
    const pcmChunks = [];
    opusStream.on("data", (chunk) => {
      try { pcmChunks.push(opusDecoder.decode(chunk)); } catch {}
    });
    opusStream.on("error", () => {});

    // Timeout fallback: if no silence after 10s, stop recording
    const timeout = setTimeout(() => {
      console.error("tonk-voice: recording timeout (10s) — processing...");
      opusStream.destroy();
    }, 10_000);

    opusStream.on("end", async () => {
      clearTimeout(timeout);
      if (pcmChunks.length < 25) { isProcessing = false; return; }

      const wavPath = `/tmp/tonk-listen-${Date.now()}.wav`;
      try {
        // PCM (48kHz stereo s16le) → WAV (16kHz mono) via ffmpeg
        const pcm = Buffer.concat(pcmChunks);
        const ff = spawn(FFMPEG, [
          "-loglevel", "error",
          "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "pipe:0",
          "-ar", "16000", "-ac", "1", "-f", "wav", wavPath, "-y",
        ], { stdio: ["pipe", "ignore", "ignore"] });
        ff.stdin.write(pcm);
        ff.stdin.end();
        await new Promise((resolve) => ff.on("close", resolve));

        const result = await transcribe(wavPath);
        console.error(`tonk-voice: heard: "${result.text}"`);

        if (result.text && result.text.length > 2) {
          const reply = await askLLM(result.text);
          console.error(`tonk-voice: reply: "${reply}"`);
          if (reply) await speak(reply);
        }
      } catch (e) {
        console.error(`tonk-voice: listen error: ${e}`);
      } finally {
        isProcessing = false;
        try { unlinkSync(wavPath); } catch {}
      }
    });
  });

  console.error("tonk-voice: listener attached");
}

// Auto-follow: if P'Nat or TK moves voice channels, follow them
client.on("voiceStateUpdate", async (oldState, newState) => {
  const uid = newState.member?.id;
  if (uid !== NAZT && uid !== TK) return;
  const newChannel = newState.channel;
  if (!newChannel) return;
  try {
    const conn = await joinChannel(newState.guild.id, newChannel.id);
    startListening(conn);
    console.error(`tonk-voice: followed ${uid === NAZT ? "P'Nat" : "TK"} to ${newChannel.name}`);
  } catch (e) { console.error(`tonk-voice: follow failed: ${e}`); }
});

// /who — voice roster across guild
async function whoIsInVoice() {
  const out = {};
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channels = await guild.channels.fetch();
    for (const [, ch] of channels) {
      if (ch?.type === 2 && ch.members.size > 0) {
        out[`${guild.name} · ${ch.name}`] = [...ch.members.values()].map((m) => m.displayName);
      }
    }
  } catch {}
  return out;
}

// Startup: join general voice channel
client.once("clientReady", async (c) => {
  console.error(`tonk-voice: ready as ${c.user.tag}`);
  try {
    const conn = await joinChannel(GUILD_ID, GENERAL_VOICE);
    console.error("tonk-voice: joined general voice");
    startListening(conn);
    setTimeout(() => speak(GREET), 3000);
  } catch (e) { console.error(`tonk-voice: join failed: ${e}`); }
});

// HTTP IPC server
http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (o, code = 200) => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(o));
  };
  (async () => {
    try {
      if (url.pathname === "/status")
        return send({ ready: client.isReady?.() ?? false, tag: client.user?.tag ?? null,
                      guild: currentGuildId, voice: currentChannelId ?? "none",
                      playerState: player.state.status, listen: listenEnabled });
      if (url.pathname === "/join") {
        const g = url.searchParams.get("guild") || GUILD_ID;
        const ch = url.searchParams.get("channel") || GENERAL_VOICE;
        const conn = await joinChannel(g, ch);
        startListening(conn);
        return send({ ok: true, joined: ch });
      }
      if (url.pathname === "/say") {
        await speak(url.searchParams.get("text") || "สวัสดีครับ");
        return send({ ok: true });
      }
      if (url.pathname === "/who") { return send({ ok: true, voice: await whoIsInVoice() }); }
      if (url.pathname === "/voice") {
        const name = url.searchParams.get("name");
        if (name) edgeTtsVoice = name;
        return send({ ok: true, voice: edgeTtsVoice });
      }
      if (url.pathname === "/deaf") {
        const conn = currentGuildId ? getVoiceConnection(currentGuildId) : null;
        if (!conn) return send({ error: "not in voice" }, 400);
        const on = url.searchParams.get("on");
        const deaf = on !== null ? (on === "true" || on === "1") : !conn.joinConfig.selfDeaf;
        conn.rejoin({ ...conn.joinConfig, selfDeaf: deaf });
        console.error(`tonk-voice: deaf ${deaf ? "ON" : "OFF"}`);
        return send({ ok: true, deaf });
      }
      if (url.pathname === "/mute") {
        const conn = currentGuildId ? getVoiceConnection(currentGuildId) : null;
        if (!conn) return send({ error: "not in voice" }, 400);
        const on = url.searchParams.get("on");
        const mute = on !== null ? (on === "true" || on === "1") : !conn.joinConfig.selfMute;
        conn.rejoin({ ...conn.joinConfig, selfMute: mute });
        console.error(`tonk-voice: mute ${mute ? "ON" : "OFF"}`);
        return send({ ok: true, mute });
      }
      if (url.pathname === "/listen") {
        const on = url.searchParams.get("on");
        if (on !== null) listenEnabled = on === "true" || on === "1";
        else listenEnabled = !listenEnabled;
        console.error(`tonk-voice: listen ${listenEnabled ? "ON" : "OFF"}`);
        return send({ ok: true, listen: listenEnabled });
      }
      if (url.pathname === "/feed") {
        // Socket stream: pipe raw PCM directly into Discord audio player
        // Large highWaterMark prevents mid-stream underflow (Jizo's lesson)
        const feed = new PassThrough({ highWaterMark: 96 * 1024 * 1024 });
        player.play(createAudioResource(feed, { inputType: StreamType.OggOpus }));
        req.pipe(feed);
        req.on("end", () => send({ ok: true, streamed: true }));
        req.on("error", (e) => send({ error: String(e) }, 500));
        return;
      }
      if (url.pathname === "/leave") {
        if (currentGuildId) getVoiceConnection(currentGuildId)?.destroy();
        currentGuildId = null;
        currentChannelId = null;
        return send({ ok: true });
      }
      send({ error: "not found" }, 404);
    } catch (e) { send({ error: String(e) }, 500); }
  })();
}).listen(PORT, "127.0.0.1", () => console.error(`tonk-voice: IPC on 127.0.0.1:${PORT}`));

// Graceful shutdown (Vessel/Leica pattern)
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (currentGuildId) getVoiceConnection(currentGuildId)?.destroy();
    process.exit(0);
  });
}

client.login(TOKEN);
