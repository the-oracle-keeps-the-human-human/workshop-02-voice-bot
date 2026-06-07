// maw vessel voice daemon — Node.js long-running process
// Handles Discord voice connection + TTS playback
// Run: node --experimental-strip-types voice-daemon.ts

import { createServer } from "node:http";
import { writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { Client, GatewayIntentBits } from "discord.js";

const require = createRequire(import.meta.url);
const ffmpegPath: string = require("ffmpeg-static");
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  entersState,
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

// Persistent PCM stream — any process can pipe raw audio in via POST /feed
// ffmpeg → pipe:1 → POST /feed → audioFeed → Discord voice (no ad-hoc per-clip setup)
const audioFeed = new PassThrough();
let feedActive = false;

function startFeed() {
  if (feedActive) return;
  feedActive = true;
  const resource = createAudioResource(audioFeed, { inputType: StreamType.Raw });
  player.play(resource);
  player.once(AudioPlayerStatus.Idle, () => { feedActive = false; });
}

// Track who is in which voice channel: userId → { channelId, channelName, displayName }
const voiceMap = new Map<string, { channelId: string; channelName: string; displayName: string }>();

client.once("ready", async () => {
  console.log(`[vessel-voice] discord ready: ${client.user?.tag}`);
  // Seed voice map from existing voice states via channels
  try {
    const guild = await client.guilds.fetch("1512058941536735383");
    const channels = await guild.channels.fetch();
    for (const [, ch] of channels) {
      if (!ch?.isVoiceBased()) continue;
      const vc = ch as any;
      if (!vc.members) continue;
      for (const [uid, member] of vc.members) {
        voiceMap.set(uid, { channelId: ch.id, channelName: ch.name, displayName: member.displayName });
      }
    }
    console.log(`[vessel-voice] voice map seeded: ${voiceMap.size} members`);
  } catch (e) {
    console.error("[vessel-voice] seed error:", e);
  }
});

async function waitForReady(conn: ReturnType<typeof joinVoiceChannel>) {
  try {
    await entersState(conn, VoiceConnectionStatus.Ready, 10_000);
    console.log("[vessel-voice] connection ready");
  } catch {
    console.error("[vessel-voice] connection failed to become ready");
    throw new Error("voice connection not ready");
  }
}

async function joinChannel(channelId: string, guildId: string, adapterCreator: any) {
  connection?.destroy();
  const conn = joinVoiceChannel({ channelId, guildId, adapterCreator });
  conn.subscribe(player);
  conn.on(VoiceConnectionStatus.Disconnected, () => { connection = null; });
  await waitForReady(conn);
  connection = conn;
  return conn;
}

// Track all voice state changes for /members
client.on("voiceStateUpdate", (oldState, newState) => {
  const uid = newState.member?.id || oldState.member?.id;
  const displayName = newState.member?.displayName || oldState.member?.displayName || uid;
  if (!uid) return;
  if (newState.channel) {
    voiceMap.set(uid, { channelId: newState.channel.id, channelName: newState.channel.name, displayName: displayName! });
  } else {
    voiceMap.delete(uid);
  }
});

// Auto-follow: when FOLLOW_USER_ID joins a voice channel, Vessel follows + greets
client.on("voiceStateUpdate", async (oldState, newState) => {
  if (newState.member?.id !== FOLLOW_USER_ID) return;
  const newChannel = newState.channel;
  if (!newChannel) return; // user left, don't auto-leave
  if (connection?.joinConfig.channelId === newChannel.id) return; // already there
  console.log(`[vessel-voice] following ${FOLLOW_USER_ID} to ${newChannel.name}`);
  try {
    await joinChannel(newChannel.id, newChannel.guild.id, newChannel.guild.voiceAdapterCreator);
    await speak("สวัสดีครับพี่นัท Vessel มาแล้วครับ");
  } catch (e) {
    console.error("[vessel-voice] auto-follow error:", e);
  }
});

client.login(TOKEN);

async function ttsStream(text: string) {
  // Microsoft edge-tts → MP3 → ffmpeg → PCM 48kHz stereo → @discordjs/voice
  const edgeProc = spawn("python3", [
    "-m", "edge_tts",
    "--voice", "th-TH-NiwatNeural",
    "--text", text,
    "--write-media", "/tmp/vessel-tts.mp3",
  ]);
  await new Promise<void>((res, rej) => {
    edgeProc.on("close", (code) => code === 0 ? res() : rej(new Error("edge-tts failed: " + code)));
  });
  const ffmpegProc = spawn(ffmpegPath, [
    "-y", "-i", "/tmp/vessel-tts.mp3",
    "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1",
  ], { stdio: ["ignore", "pipe", "inherit"] });
  return ffmpegProc.stdout;
}

async function speak(text: string) {
  if (!connection) throw new Error("not in voice channel");
  const stream = await ttsStream(text);
  const resource = createAudioResource(stream, { inputType: StreamType.Raw });
  player.play(resource);
  await new Promise<void>((res) => player.once(AudioPlayerStatus.Idle, () => {
    console.log("[vessel-voice] done speaking");
    res();
  }));
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
      await joinChannel(channelId, guildId, guild.voiceAdapterCreator);
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
      await speak(text);
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

  // POST /feed — pipe raw PCM s16le 48kHz stereo directly into Discord voice
  // Usage: ffmpeg -i input.mp3 -f s16le -ar 48000 -ac 2 - | curl -X POST --data-binary @- http://127.0.0.1:14808/feed
  if (req.method === "POST" && url.pathname === "/feed") {
    if (!connection) { res.writeHead(400); res.end(JSON.stringify({ error: "not in voice channel" })); return; }
    startFeed();
    req.pipe(audioFeed, { end: false });
    req.on("end", () => res.end(JSON.stringify({ ok: true })));
    res.writeHead(200);
    return;
  }

  if (url.pathname === "/members") {
    // Group voiceMap by channel
    const channels: Record<string, { channelName: string; members: string[] }> = {};
    for (const [, vs] of voiceMap) {
      if (!channels[vs.channelId]) channels[vs.channelId] = { channelName: vs.channelName, members: [] };
      channels[vs.channelId].members.push(vs.displayName);
    }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, channels }));
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
