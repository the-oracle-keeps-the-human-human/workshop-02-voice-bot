/**
 * voice-daemon.mjs — ChaiKlang voice bot daemon (Workshop 02, scope A: TTS-first).
 *
 * Brings the ChaiKlang bot into a Discord voice channel and speaks text via
 * macOS `say` → ffmpeg → @discordjs/voice. Persistent (this is the daemon the
 * one-shot `maw chaiklang voice` command spawns/talks to).
 *
 * Run:  DISCORD_BOT_TOKEN=... node voice-daemon.mjs <guildId> <channelId>
 * Then: write a line of text to ./say-queue.txt → daemon speaks it.
 *
 * deps: discord.js @discordjs/voice @discordjs/opus libsodium-wrappers
 * needs: macOS `say`, `ffmpeg` on PATH
 */
import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, entersState, VoiceConnectionStatus,
} from "@discordjs/voice";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { watch, writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const QUEUE = join(HERE, "say-queue.txt");
const [guildId, channelId] = process.argv.slice(2);
const token = process.env.DISCORD_BOT_TOKEN;

if (!token || !guildId || !channelId) {
  console.error("usage: DISCORD_BOT_TOKEN=... node voice-daemon.mjs <guildId> <channelId>");
  process.exit(1);
}

// text → speech file (48kHz stereo PCM, what @discordjs/voice wants raw)
async function tts(text) {
  const aiff = join(HERE, ".tts.aiff");
  const pcm = join(HERE, ".tts.pcm");
  await run("say", ["-o", aiff, text]);                       // macOS TTS
  await run("ffmpeg", ["-y", "-i", aiff, "-f", "s16le", "-ar", "48000", "-ac", "2", pcm]);
  return pcm;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once("ready", async () => {
  console.log(`🎙️ ChaiKlang voice daemon online as ${client.user.tag}`);
  const conn = joinVoiceChannel({
    guildId, channelId,
    adapterCreator: (await client.guilds.fetch(guildId)).voiceAdapterCreator,
    selfDeaf: false, selfMute: false,
  });
  await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
  console.log(`✓ joined voice channel ${channelId}`);

  const player = createAudioPlayer();
  conn.subscribe(player);

  async function speak(text) {
    const pcm = await tts(text);
    player.play(createAudioResource(pcm, { inputType: "raw" }));
    await entersState(player, AudioPlayerStatus.Playing, 5_000).catch(() => {});
  }

  await speak("ชายกลางเข้าห้องแล้วครับ — ChaiKlang has joined the voice channel.");

  // simple IPC: watch a queue file; each line written → speak it
  if (existsSync(QUEUE)) unlinkSync(QUEUE);
  writeFileSync(QUEUE, "");
  watch(QUEUE, async () => {
    const text = readFileSync(QUEUE, "utf8").trim();
    if (text) { writeFileSync(QUEUE, ""); await speak(text); }
  });
  console.log(`📝 say-queue ready → write text to ${QUEUE}`);
});

client.login(token);
