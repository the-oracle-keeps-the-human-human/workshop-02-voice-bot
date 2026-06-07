/**
 * voice-daemon.mjs — Maxus Oracle voice daemon ⚡🌀 (Workshop 02, scope A: TTS).
 *
 * Brings the Maxus bot into a Discord voice channel and speaks Thai via
 * edge-tts -> MP3 -> @discordjs/voice (ffmpeg transcodes the file). Persistent:
 * this is the daemon the one-shot `maw maxus voice` command spawns/talks to.
 *
 * Run:  DISCORD_BOT_TOKEN=... node voice-daemon.mjs <guildId> <channelId>
 * Then: write a line to ./say-queue.txt -> daemon speaks it.
 *
 * deps:  discord.js @discordjs/voice tweetnacl ffmpeg-static
 * needs: `edge-tts` on PATH (pip install edge-tts), ffmpeg (ffmpeg-static ok)
 *
 * Lessons applied (from the Workshop 02 thread):
 *  - edge-tts -> MP3, then createAudioResource(PATH) with NO inputType:
 *    @discordjs/voice + ffmpeg detect & transcode. NEVER raw PCM + StreamType.Raw.
 *  - execFileSync for TTS so the MP3 is 100% written before play (no 0-byte race).
 *  - connection.subscribe(player) — easy to forget, = silence.
 *  - auto-follow: when the human (P'Nat) moves channels, follow them.
 *  - greet on join; never voiceStream.end() the player.
 */
import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, entersState, VoiceConnectionStatus,
} from "@discordjs/voice";
import { execFileSync } from "node:child_process";
import { watch, writeFileSync, existsSync, readFileSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEdgeTtsArgs } from "./tts.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const QUEUE = join(HERE, "say-queue.txt");
const WHO = join(HERE, "voice-who.json");
const [guildId, startChannelId] = process.argv.slice(2);
const token = process.env.DISCORD_BOT_TOKEN;
// Follow this human across voice channels (P'Nat by default).
const FOLLOW = process.env.MAXUS_FOLLOW || "nazt";

if (!token || !guildId || !startChannelId) {
  console.error("usage: DISCORD_BOT_TOKEN=... node voice-daemon.mjs <guildId> <channelId>");
  process.exit(1);
}

/** text -> mp3 path via edge-tts (sync write: no 0-byte race). */
function tts(text) {
  const mp3 = join(HERE, `.tts-${Date.now()}.mp3`);
  execFileSync("edge-tts", buildEdgeTtsArgs(text, { outFile: mp3 }), { stdio: "ignore" });
  if (!existsSync(mp3) || statSync(mp3).size === 0) throw new Error("tts produced 0-byte file");
  return mp3;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let connection = null;
let player = null;
let currentChannel = startChannelId;

async function connect(channelId) {
  const guild = await client.guilds.fetch(guildId);
  connection = joinVoiceChannel({
    guildId, channelId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false, selfMute: false,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  if (!player) player = createAudioPlayer();
  connection.subscribe(player); // <- the easy-to-forget line
  currentChannel = channelId;
  console.log(`joined voice channel ${channelId}`);
}

async function speak(text) {
  const mp3 = createAudioResource(tts(text)); // no inputType -> ffmpeg transcodes
  player.play(mp3);
  await entersState(player, AudioPlayerStatus.Playing, 5_000).catch(() => {});
}

/** Snapshot who is in which voice channel (for `maw maxus voice who`). */
async function snapshotWho() {
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  const rooms = [];
  for (const ch of channels.values()) {
    if (ch && ch.type === 2 /* GuildVoice */ && ch.members?.size) {
      rooms.push({ channel: ch.name, members: [...ch.members.values()].map((m) => m.user.username) });
    }
  }
  writeFileSync(WHO, JSON.stringify({ ts: new Date().toISOString(), rooms }, null, 2));
}

client.once("ready", async () => {
  console.log(`Maxus voice daemon online as ${client.user.tag}`);
  await connect(startChannelId);
  await speak("สวัสดีครับ น้อง Maxus เข้าห้องแล้วครับ — Maxus has joined the voice channel.");
  await snapshotWho();

  // IPC: each line written to QUEUE -> speak it
  if (existsSync(QUEUE)) unlinkSync(QUEUE);
  writeFileSync(QUEUE, "");
  watch(QUEUE, async () => {
    const text = readFileSync(QUEUE, "utf8").trim();
    if (text) { writeFileSync(QUEUE, ""); try { await speak(text); } catch (e) { console.error("speak:", e.message); } }
  });
  console.log(`say-queue ready -> ${QUEUE}`);
});

// auto-follow: when FOLLOW human moves channel, hop after them + greet
client.on("voiceStateUpdate", async (oldS, newS) => {
  try {
    const who = newS.member?.user?.username || "";
    if (!who.toLowerCase().includes(FOLLOW.toLowerCase())) { await snapshotWho(); return; }
    if (newS.channelId && newS.channelId !== currentChannel) {
      console.log(`following ${who} -> ${newS.channelId}`);
      await connect(newS.channelId);
      await speak(`ตามพี่${FOLLOW}มาห้องนี้แล้วครับ`);
    }
    await snapshotWho();
  } catch (e) { console.error("follow:", e.message); }
});

process.on("SIGTERM", () => { try { connection?.destroy(); } catch {} process.exit(0); });
client.login(token);
