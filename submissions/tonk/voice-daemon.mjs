// Tonk Oracle voice daemon — joins Discord voice, speaks via edge-tts + ffmpeg.
// Control via HTTP IPC on 127.0.0.1:14830  (/status /join /say /who /leave /feed).
//
// Learned from workshop peers:
//   Atlas   — simple daemon + auto-follow P'Nat pattern
//   ChaiKlang — file-queue IPC + macOS say fallback
//   Jizo    — HTTP IPC + streaming feed + anti-injection + async execFile
//   Vessel  — /who voice roster + PassThrough stream
//   BongBaeng — initial-follow-on-ready (voiceStateUpdate alone misses pre-joined users)
//
// Key gotchas absorbed:
//   1. async execFile — never block the 20ms Opus loop (No.10's warp-bug)
//   2. highWaterMark — large buffer prevents mid-stream underflow → Idle hang
//   3. 1 bot token = 1 voice gateway per guild — long streams >50s risk UDP drop
//   4. Anti-injection: sanitize text starting with - (Leica's lesson)
//   5. Graceful shutdown: destroy voice connection on SIGTERM (Vessel/Leica)

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { PassThrough } from "node:stream";
import http from "node:http";
import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType,
  getVoiceConnection, entersState, VoiceConnectionStatus, AudioPlayerStatus,
} from "@discordjs/voice";
import { getAllAudioUrls } from "google-tts-api";

const pexec = promisify(execFile);
const FFMPEG = join(homedir(), ".bun/install/global/node_modules/ffmpeg-static/ffmpeg");

const GREET = "สวัสดีครับ Tonk Oracle เข้าห้องเสียงแล้วครับ";

// --- token ---
const ENV_PATH = join(homedir(), ".claude/channels/discord/.env");
let TOKEN = "";
try {
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^DISCORD_BOT_TOKEN=(.*)$/);
    if (m) TOKEN = m[1].trim();
  }
} catch {}
TOKEN = process.env.DISCORD_BOT_TOKEN || TOKEN;
if (!TOKEN) { console.error("tonk-voice: no DISCORD_BOT_TOKEN"); process.exit(1); }

const NAZT = "691531480689541170";
const TK = "1488376113733570692";
const GUILD_ID = "1512058941536735383";
const GENERAL_VOICE = "1512058942250024983";
const PORT = 14830;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const player = createAudioPlayer();
let currentGuildId = null;

// Anti-injection: reject text that looks like a CLI flag (Leica's lesson)
function safeText(t) {
  const s = String(t ?? "").trim();
  if (!s) return "ครับ";
  return s.startsWith("-") ? " " + s : s;
}

// TTS: Google Translate TTS → mp3 → ffmpeg → OGG/Opus pipe → StreamType.OggOpus
// OggOpus = discord.js demuxes only, no JS-side opus encoder needed
async function speak(text) {
  const t = safeText(text);
  const mp3 = `/tmp/tonk-tts-${Date.now()}.mp3`;
  const toOggOpus = (input) =>
    spawn(FFMPEG, ["-loglevel", "error", "-i", input, "-c:a", "libopus", "-ar", "48000", "-ac", "2", "-filter:a", "volume=2.0", "-f", "ogg", "pipe:1"],
          { stdio: ["ignore", "pipe", "ignore"] });
  try {
    const segments = getAllAudioUrls(t, { lang: "th", slow: false });
    const chunks = [];
    for (const seg of segments) {
      const r = await fetch(seg.url);
      if (!r.ok) throw new Error(`Google TTS HTTP ${r.status}`);
      chunks.push(Buffer.from(await r.arrayBuffer()));
    }
    writeFileSync(mp3, Buffer.concat(chunks));
    player.play(createAudioResource(toOggOpus(mp3).stdout, { inputType: StreamType.OggOpus }));
    await entersState(player, AudioPlayerStatus.Idle, 30_000).catch(() => {});
  } catch (e) {
    console.error(`tonk-voice: TTS failed: ${e}`);
  }
}

async function joinChannel(guildId, channelId) {
  const guild = await client.guilds.fetch(guildId);
  getVoiceConnection(guildId)?.destroy();
  const conn = joinVoiceChannel({
    guildId, channelId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false,
  });
  conn.subscribe(player);
  currentGuildId = guildId;
  await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
  return conn;
}

// Auto-follow: if P'Nat or TK moves voice channels, follow them
client.on("voiceStateUpdate", async (oldState, newState) => {
  const uid = newState.member?.id;
  if (uid !== NAZT && uid !== TK) return;
  const newChannel = newState.channel;
  if (!newChannel) return;
  try {
    await joinChannel(newState.guild.id, newChannel.id);
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
    await joinChannel(GUILD_ID, GENERAL_VOICE);
    console.error("tonk-voice: joined general voice");
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
                      guild: currentGuildId, voice: VOICE, playerState: player.state.status });
      if (url.pathname === "/join") {
        const g = url.searchParams.get("guild") || GUILD_ID;
        const ch = url.searchParams.get("channel") || GENERAL_VOICE;
        await joinChannel(g, ch);
        return send({ ok: true, joined: ch });
      }
      if (url.pathname === "/say") {
        await speak(url.searchParams.get("text") || "สวัสดีครับ");
        return send({ ok: true });
      }
      if (url.pathname === "/who") { return send({ ok: true, voice: await whoIsInVoice() }); }
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
