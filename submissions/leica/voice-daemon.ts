/**
 * Leica Voice Daemon — persistent voice connection for Discord.
 * Spawned by `maw leica voice start`, communicates via HTTP IPC.
 *
 * Usage:
 *   bun voice-daemon.ts [--port=14807]
 *
 * Endpoints:
 *   POST /join   {channelId, guildId}
 *   POST /say    {text, voice?}
 *   POST /leave
 *   GET  /status
 */
import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { tmpdir } from "os";

const PORT = parseInt(process.argv.find(a => a.startsWith("--port="))?.split("=")[1] || "14807");
const PID_FILE = join(homedir(), ".maw", "leica-voice.pid");
const STATE_DIR = process.env.DISCORD_STATE_DIR || join(homedir(), ".claude", "channels", "discord");

function getToken(): string {
  try {
    const env = readFileSync(join(STATE_DIR, ".env"), "utf8");
    const m = env.match(/^DISCORD_BOT_TOKEN=(.+)$/m);
    if (m?.[1]) return m[1];
  } catch {}
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;
  throw new Error("No DISCORD_BOT_TOKEN found");
}

const token = getToken();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

let connection: ReturnType<typeof joinVoiceChannel> | null = null;
const player = createAudioPlayer();

writeFileSync(PID_FILE, String(process.pid));
process.on("exit", () => { try { unlinkSync(PID_FILE); } catch {} });
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

async function ttsToFile(text: string, voice = "Kanya"): Promise<string> {
  const safeVoice = ALLOWED_VOICES.includes(voice) ? voice : "Kanya";
  const safeText = validateInput(text);
  const outPath = join(tmpdir(), `leica-tts-${Date.now()}.wav`);
  const aiffPath = join(tmpdir(), `leica-tts-${Date.now()}.aiff`);
  execFileSync("say", ["-v", safeVoice, "-r", "260", "-o", aiffPath, "--", safeText]);
  execFileSync("ffmpeg", ["-y", "-i", aiffPath, "-ar", "48000", "-ac", "2", "-f", "s16le", "--", outPath], { stdio: "ignore" });
  try { unlinkSync(aiffPath); } catch {}
  return outPath;
}

const ALLOWED_VOICES = ["Kanya", "Narin", "Samut", "Siriphen", "Alex", "Samantha", "Daniel"];

function validateInput(value: string): string {
  if (value.startsWith("-")) throw new Error("invalid input: leading dash");
  return value;
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/status") {
      return Response.json({
        alive: true,
        pid: process.pid,
        connected: connection !== null,
        playerStatus: player.state.status,
      });
    }

    if (req.method === "POST" && url.pathname === "/join") {
      const { channelId, guildId } = await req.json() as any;
      if (!channelId || !guildId) {
        return Response.json({ error: "channelId and guildId required" }, { status: 400 });
      }
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        return Response.json({ error: `guild ${guildId} not found` }, { status: 404 });
      }
      connection = joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator: guild.voiceAdapterCreator,
      });
      connection.subscribe(player);
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      } catch {
        return Response.json({ error: "timeout waiting for voice connection" }, { status: 504 });
      }
      return Response.json({ ok: true, channelId, guildId });
    }

    if (req.method === "POST" && url.pathname === "/say") {
      if (!connection) {
        return Response.json({ error: "not connected — POST /join first" }, { status: 400 });
      }
      const { text, voice } = await req.json() as any;
      if (!text) {
        return Response.json({ error: "text required" }, { status: 400 });
      }
      const wavPath = await ttsToFile(text, voice || "Kanya");
      const resource = createAudioResource(wavPath, { inputType: 6 /* Raw */ });
      player.play(resource);
      await entersState(player, AudioPlayerStatus.Idle, 30_000).catch(() => {});
      try { unlinkSync(wavPath); } catch {}
      return Response.json({ ok: true, text, voice: voice || "Kanya" });
    }

    if (req.method === "POST" && url.pathname === "/leave") {
      if (connection) {
        connection.destroy();
        connection = null;
      }
      return Response.json({ ok: true });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

await client.login(token);
client.once("ready", (c) => {
  console.log(`🐱 Leica voice daemon ready — ${c.user.tag} on port ${PORT}`);
});

console.log(`🐱 Leica voice daemon listening on http://localhost:${PORT}`);
console.log(`   PID: ${process.pid} → ${PID_FILE}`);
