/**
 * voice-daemon.mjs — ChaiKlang voice bot daemon (Workshop 02, scope A: TTS-first).
 *
 * Joins a Discord voice channel and speaks text (macOS `say` → ffmpeg → @discordjs/voice).
 * Auto-follows P'Nat (nazt_) across voice channels.
 *
 * Run:  DISCORD_BOT_TOKEN=... node voice-daemon.mjs <guildId> <channelId>
 * Speak: write a line to ./say-queue.txt → daemon speaks it.
 *
 * deps: discord.js @discordjs/voice @discordjs/opus libsodium-wrappers  (voice >=0.19 — 0.17 encryption is deprecated!)
 */
import { Client, GatewayIntentBits, Events } from "discord.js";
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, entersState, VoiceConnectionStatus, getVoiceConnection,
} from "@discordjs/voice";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { watch, writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const QUEUE = join(HERE, "say-queue.txt");
const NAZT = "691531480689541170";            // P'Nat — follow him
const [guildId, startChannelId] = process.argv.slice(2);
const token = process.env.DISCORD_BOT_TOKEN;
if (!token || !guildId || !startChannelId) {
  console.error("usage: DISCORD_BOT_TOKEN=... node voice-daemon.mjs <guildId> <channelId>");
  process.exit(1);
}

async function tts(text) {
  const aiff = join(HERE, ".tts.aiff"), pcm = join(HERE, ".tts.pcm");
  await run("say", ["-o", aiff, text]);
  await run("ffmpeg", ["-y", "-i", aiff, "-f", "s16le", "-ar", "48000", "-ac", "2", pcm]);
  return pcm;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const player = createAudioPlayer();
let guild;

async function joinChannel(channelId, greet) {
  const conn = joinVoiceChannel({
    guildId, channelId, adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false, selfMute: false,
  });
  await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
  conn.subscribe(player);
  console.log(`✓ joined voice channel ${channelId}`);
  if (greet) await speak(greet);
}
async function speak(text) {
  const pcm = await tts(text);
  player.play(createAudioResource(pcm, { inputType: "raw" }));
  await entersState(player, AudioPlayerStatus.Playing, 5_000).catch(() => {});
  console.log(`🗣️ spoke: ${text.slice(0, 60)}`);
}

client.once(Events.ClientReady, async () => {
  console.log(`🎙️ ChaiKlang voice daemon online as ${client.user.tag}`);
  guild = await client.guilds.fetch(guildId);
  await joinChannel(startChannelId, "ชายกลางเข้าห้องแล้วครับ — ChaiKlang has joined the voice channel.");
  if (existsSync(QUEUE)) unlinkSync(QUEUE);
  writeFileSync(QUEUE, "");
  watch(QUEUE, async () => {
    const t = readFileSync(QUEUE, "utf8").trim();
    if (t) { writeFileSync(QUEUE, ""); await speak(t); }
  });
  console.log(`📝 say-queue ready → ${QUEUE}`);
});

// auto-follow P'Nat across voice channels
client.on(Events.VoiceStateUpdate, async (oldS, newS) => {
  if (newS.member?.id !== NAZT) return;
  if (newS.channelId && newS.channelId !== oldS.channelId) {
    console.log(`👣 following P'Nat → ${newS.channelId}`);
    try { await joinChannel(newS.channelId, "ชายกลางตามมาแล้วครับ"); } catch (e) { console.error("follow failed:", e.message); }
  } else if (!newS.channelId && oldS.channelId) {
    console.log("👋 P'Nat left voice — staying put");
  }
});

client.login(token);
