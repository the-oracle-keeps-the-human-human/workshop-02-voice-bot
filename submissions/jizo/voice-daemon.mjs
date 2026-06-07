// Jizo voice daemon — joins Discord voice, speaks with a calm mature voice, auto-follows P'Nat.
// Reuses Jizo's existing bot token (text MCP + voice daemon run in parallel).
// Control via HTTP IPC on 127.0.0.1:14820  (/status /join /say /who /follow /leave).
//
// Built by imitating the best of workshop-02: streaming TTS via ffmpeg pipe (Vessel/bongbaeng),
// initial-follow-on-ready (bongbaeng), /who voice roster (Vessel), input validation (Leica),
// async execFile so TTS never blocks the 20ms Opus packets (No.10's warp-bug lesson).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType,
  getVoiceConnection, entersState, VoiceConnectionStatus, AudioPlayerStatus,
} from "@discordjs/voice";
import ffmpegPath from "ffmpeg-static";

const pexec = promisify(execFile);
const FFMPEG = ffmpegPath || "ffmpeg";
const EDGE = join(homedir(), "Library/Python/3.14/bin/edge-tts");

// --- Jizo's voice: a calm man in his 40s. Andrew = warm/confident/authentic, multilingual
//     (so he can greet the Thai-speaking fleet too). Slowed + grounded — a guardian doesn't rush.
const VOICE = "en-US-AndrewMultilingualNeural";
const RATE = "-8%";
const PITCH = "-3Hz";
const GREET = "สวัสดีครับพี่นัท Jizo มาแล้วครับ"; // multilingual voice handles the Thai greeting

// --- token (same file the text channel plugin uses) ---
const ENV = join(homedir(), ".claude/channels/discord/.env");
let TOKEN = "";
for (const line of readFileSync(ENV, "utf8").split("\n")) {
  const m = line.match(/^DISCORD_BOT_TOKEN=(.*)$/);
  if (m) TOKEN = m[1].trim();
}
if (!TOKEN) { console.error("jizo-voice: no DISCORD_BOT_TOKEN"); process.exit(1); }

const NAZT = "691531480689541170";           // auto-follow target (P'Nat)
const GUILDS = ["1512058941536735383", "1500510700446027849"]; // Oracle School, HUMAN SCHOOL
const PORT = 14820;
const GREET_DELAY_MS = 9000;                  // let others greet first; avoid overlapping voices

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const player = createAudioPlayer();
let currentGuildId = null;

// Reject text that could be parsed as an edge-tts/ffmpeg flag (Leica's anti-injection lesson).
function safeText(t) {
  const s = String(t ?? "").trim();
  if (!s) return "ครับ";
  return s.startsWith("-") ? " " + s : s;
}

// Streaming TTS: edge-tts → mp3 → ffmpeg → pipe:1 PCM (s16le 48k stereo) → StreamType.Raw.
// No temp WAV on disk; lower latency. Falls back to macOS `say` if edge-tts/network fails.
async function speak(text, rate = RATE, pitch = PITCH) {
  const t = safeText(text);
  const mp3 = `/tmp/jizo-tts-${Date.now()}.mp3`;
  const toPcm = (input) =>
    spawn(FFMPEG, ["-loglevel", "error", "-i", input, "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
          { stdio: ["ignore", "pipe", "ignore"] });
  try {
    await pexec(EDGE, ["--voice", VOICE, "--rate", rate, "--pitch", pitch, "--text", t, "--write-media", mp3]);
    player.play(createAudioResource(toPcm(mp3).stdout, { inputType: StreamType.Raw }));
    await entersState(player, AudioPlayerStatus.Idle, 30_000).catch(() => {});
  } catch (e) {
    console.error(`jizo-voice: edge-tts path failed (${e}); falling back to say`);
    try {
      const aiff = `/tmp/jizo-tts-${Date.now()}.aiff`;
      await pexec("say", ["-r", "180", "-o", aiff, "--", t]);
      player.play(createAudioResource(toPcm(aiff).stdout, { inputType: StreamType.Raw }));
      await entersState(player, AudioPlayerStatus.Idle, 30_000).catch(() => {});
    } catch (e2) { console.error(`jizo-voice: say fallback also failed: ${e2}`); }
  }
}

async function joinChannel(guildId, channelId) {
  const guild = await client.guilds.fetch(guildId);
  getVoiceConnection(guildId)?.destroy();          // never stack connections in one guild
  const conn = joinVoiceChannel({
    guildId, channelId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false,
  });
  conn.subscribe(player);
  currentGuildId = guildId;
  await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
  return conn;
}

// Initial follow on startup: if P'Nat is ALREADY in a voice channel when Jizo boots, join him.
// (bongbaeng's lesson — voiceStateUpdate alone misses the case where he was there before we started.)
async function followIfPresent(greet) {
  for (const gid of GUILDS) {
    try {
      const guild = await client.guilds.fetch(gid);
      const member = await guild.members.fetch(NAZT);
      const ch = member.voice?.channelId;
      if (!ch) continue;
      await joinChannel(gid, ch);
      console.error(`jizo-voice: P'Nat already in voice → joined ${ch}`);
      if (greet) { await new Promise((r) => setTimeout(r, GREET_DELAY_MS)); speak(GREET); }
      return true;
    } catch { /* not in this guild / not fetchable — try next */ }
  }
  return false;
}

client.once("clientReady", async (c) => {
  console.error(`jizo-voice: ready as ${c.user.tag}`);
  await followIfPresent(true);
});

// auto-follow P'Nat into whatever voice channel he joins; leave when he leaves
client.on("voiceStateUpdate", async (oldS, newS) => {
  if (newS.member?.id !== NAZT) return;
  try {
    if (newS.channelId && newS.channelId !== oldS.channelId) {
      await joinChannel(newS.guild.id, newS.channelId);
      await new Promise((r) => setTimeout(r, GREET_DELAY_MS));
      speak(GREET);
      console.error(`jizo-voice: followed P'Nat → ${newS.channelId}`);
    } else if (!newS.channelId) {
      getVoiceConnection(newS.guild.id)?.destroy();
      if (newS.guild.id === currentGuildId) currentGuildId = null;
      console.error("jizo-voice: P'Nat left → disconnected");
    }
  } catch (e) { console.error(`jizo-voice: follow error: ${e}`); }
});

// /who — who is in which voice channel, across both guilds (Vessel/bongbaeng pattern, read-only)
async function whoIsInVoice() {
  const out = {};
  for (const gid of GUILDS) {
    try {
      const guild = await client.guilds.fetch(gid);
      const channels = await guild.channels.fetch();
      for (const [, ch] of channels) {
        if (ch?.type === 2 && ch.members.size > 0) {
          out[`${guild.name} · ${ch.name}`] = [...ch.members.values()].map((m) => m.displayName);
        }
      }
    } catch { /* skip guild */ }
  }
  return out;
}

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
        await joinChannel(url.searchParams.get("guild"), url.searchParams.get("channel"));
        return send({ ok: true, joined: url.searchParams.get("channel") });
      }
      if (url.pathname === "/say") {
        await speak(url.searchParams.get("text") || "hello",
                    url.searchParams.get("rate") || RATE, url.searchParams.get("pitch") || PITCH);
        return send({ ok: true });
      }
      if (url.pathname === "/who") { return send({ ok: true, voice: await whoIsInVoice() }); }
      if (url.pathname === "/follow") { const ok = await followIfPresent(url.searchParams.get("greet") !== "0"); return send({ ok, followed: ok }); }
      if (url.pathname === "/leave") { getVoiceConnection(currentGuildId)?.destroy(); currentGuildId = null; return send({ ok: true }); }
      send({ error: "not found" }, 404);
    } catch (e) { send({ error: String(e) }, 500); }
  })();
}).listen(PORT, "127.0.0.1", () => console.error(`jizo-voice: IPC on 127.0.0.1:${PORT}`));

// graceful shutdown (Vessel/Leica): drop the voice connection cleanly so we don't leave a ghost
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (currentGuildId) getVoiceConnection(currentGuildId)?.destroy();
    process.exit(0);
  });
}

client.login(TOKEN);
