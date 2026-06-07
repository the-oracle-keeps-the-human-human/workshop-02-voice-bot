// maw vessel voice daemon — Node.js long-running process
// Handles Discord voice connection + TTS playback
// Run: node --experimental-strip-types voice-daemon.ts

import { createServer } from "node:http";
import { writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  VoiceConnectionStatus,
  AudioPlayerStatus,
} from "@discordjs/voice";

const PORT = parseInt(process.env.VESSEL_VOICE_PORT || "14808");
const PID_FILE = "/tmp/vessel-voice.pid";
const TOKEN = process.env.DISCORD_TOKEN!;

if (!TOKEN) {
  console.error("DISCORD_TOKEN not set");
  process.exit(1);
}

writeFileSync(PID_FILE, String(process.pid));
console.log(`[vessel-voice] pid=${process.pid} port=${PORT}`);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// nazt_'s Discord user ID — follow him into voice channels
const FOLLOW_USER_ID = process.env.FOLLOW_USER_ID || "691531480689541170";

let connection: ReturnType<typeof joinVoiceChannel> | null = null;
let player = createAudioPlayer();

client.once("ready", () => console.log(`[vessel-voice] discord ready: ${client.user?.tag}`));

// Auto-follow: when FOLLOW_USER_ID joins a voice channel, Vessel follows
client.on("voiceStateUpdate", async (oldState, newState) => {
  if (newState.member?.id !== FOLLOW_USER_ID) return;
  const newChannel = newState.channel;
  if (!newChannel) return; // user left, don't auto-leave
  if (connection?.joinConfig.channelId === newChannel.id) return; // already there
  console.log(`[vessel-voice] following ${FOLLOW_USER_ID} to ${newChannel.name}`);
  connection?.destroy();
  connection = joinVoiceChannel({
    channelId: newChannel.id,
    guildId: newChannel.guild.id,
    adapterCreator: newChannel.guild.voiceAdapterCreator,
  });
  connection.subscribe(player);
  connection.on(VoiceConnectionStatus.Disconnected, () => { connection = null; });
});

client.login(TOKEN);

async function ttsStream(text: string) {
  // macOS built-in `say` → AIFF → stdout → ffmpeg → PCM → @discordjs/voice
  const sayProc = spawn("say", ["-v", "Kanya", "-o", "/tmp/vessel-tts.aiff", text]);
  await new Promise<void>((res, rej) => {
    sayProc.on("close", (code) => code === 0 ? res() : rej(new Error("say failed: " + code)));
  });
  // Convert AIFF to readable stream via ffmpeg
  const ffmpegProc = spawn("ffmpeg", ["-y", "-i", "/tmp/vessel-tts.aiff", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return ffmpegProc.stdout;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);

  if (req.method === "POST" && url.pathname === "/join") {
    const body = await json(req);
    const { channelId, guildId } = body;
    try {
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel?.isVoiceBased()) {
        res.writeHead(400); res.end(JSON.stringify({ error: "not a voice channel" })); return;
      }
      connection = joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator: guild.voiceAdapterCreator,
      });
      connection.subscribe(player);
      connection.on(VoiceConnectionStatus.Disconnected, () => { connection = null; });
      console.log(`[vessel-voice] joined ${channelId}`);
      res.writeHead(200); res.end(JSON.stringify({ ok: true, channelId }));
    } catch (e: any) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/say") {
    if (!connection) { res.writeHead(400); res.end(JSON.stringify({ error: "not in voice channel" })); return; }
    const body = await json(req);
    const text = body.text || "📦 Vessel courier oracle speaking";
    try {
      const stream = await ttsStream(text);
      const resource = createAudioResource(stream, { inputType: StreamType.Raw });
      player.play(resource);
      player.once(AudioPlayerStatus.Idle, () => console.log("[vessel-voice] done speaking"));
      res.writeHead(200); res.end(JSON.stringify({ ok: true, text }));
    } catch (e: any) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/leave") {
    connection?.destroy();
    connection = null;
    res.writeHead(200); res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/status") {
    res.writeHead(200); res.end(JSON.stringify({
      pid: process.pid,
      port: PORT,
      inVoice: connection !== null,
      playerState: player.state.status,
    }));
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => console.log(`[vessel-voice] HTTP listening on ${PORT}`));

process.on("SIGTERM", () => { connection?.destroy(); unlinkSync(PID_FILE); process.exit(0); });
process.on("SIGINT",  () => { connection?.destroy(); unlinkSync(PID_FILE); process.exit(0); });

function json(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (d: Buffer) => body += d);
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch(e) { reject(e); } });
  });
}
