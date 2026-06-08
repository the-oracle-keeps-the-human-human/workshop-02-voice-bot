/**
 * voice-daemon.mjs — Bungkee Cortex Oracle voice daemon 🧠 (Workshop 02)
 *
 * เปลือกสมองพูดด้วยเสียงจริง — brings the Cortex bot into a Discord voice channel and
 * speaks via **ElevenLabs streaming TTS** (natural, low-latency) with a graceful fallback
 * to macOS `say` when ELEVENLABS_API_KEY is absent.
 *
 * Cortex touch (Nothing is Deleted): every spoken line is appended to spoken-log.ndjson
 * with a timestamp — the daemon keeps a memory of everything it has ever said.
 *
 * Run:  DISCORD_BOT_TOKEN=... ELEVENLABS_API_KEY=... node voice-daemon.mjs <guildId> <channelId>
 * Then: write a line to ./say-queue.txt → daemon speaks it.
 *
 * deps: discord.js @discordjs/voice @discordjs/opus libsodium-wrappers
 * needs: `ffmpeg` on PATH (mp3→PCM). macOS `say` only for fallback.
 */
import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, entersState, VoiceConnectionStatus,
} from "@discordjs/voice";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { watch, writeFileSync, existsSync, readFileSync, unlinkSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const QUEUE = join(HERE, "say-queue.txt");
const LOG = join(HERE, "spoken-log.ndjson");        // append-only memory of every line spoken
const [guildId, channelId] = process.argv.slice(2);

const token = process.env.DISCORD_BOT_TOKEN;
const xiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // "Rachel" default
// default = eleven_v3 (เสียงคุณภาพสูงสุด/expressive — proven HTTP 200 @ ~1.6s).
// override ด้วย env ELEVENLABS_MODEL → eleven_turbo_v2_5 (~400ms) ถ้าต้องการ low-latency สุด
const xiModel = process.env.ELEVENLABS_MODEL || "eleven_v3";

if (!token || !guildId || !channelId) {
  console.error("usage: DISCORD_BOT_TOKEN=... node voice-daemon.mjs <guildId> <channelId>");
  process.exit(1);
}

const engine = xiKey ? "elevenlabs" : "macos-say";
console.log(`🧠 Cortex voice daemon — TTS engine: ${engine}`);

/**
 * text → raw 48kHz stereo PCM file (what @discordjs/voice plays with inputType:"raw").
 * ElevenLabs path: stream mp3 from /stream endpoint → pipe through ffmpeg → PCM.
 * Fallback path: macOS `say` → aiff → ffmpeg → PCM.
 */
async function tts(text) {
  const pcm = join(HERE, ".tts.pcm");
  if (xiKey) {
    const mp3 = join(HERE, ".tts.mp3");
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=2`,
      {
        method: "POST",
        headers: { "xi-api-key": xiKey, "Content-Type": "application/json", "Accept": "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: xiModel,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true },
        }),
      }
    );
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(mp3, buf);
    await run("ffmpeg", ["-y", "-i", mp3, "-f", "s16le", "-ar", "48000", "-ac", "2", pcm]);
    return pcm;
  }
  // fallback — macOS say
  const aiff = join(HERE, ".tts.aiff");
  await run("say", ["-o", aiff, text]);
  await run("ffmpeg", ["-y", "-i", aiff, "-f", "s16le", "-ar", "48000", "-ac", "2", pcm]);
  return pcm;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once("ready", async () => {
  console.log(`🎙️ Cortex voice daemon online as ${client.user.tag}`);
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
    // Nothing is Deleted — log every line BEFORE speaking (timestamp = truth)
    appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), engine, text }) + "\n");
    try {
      const pcm = await tts(text);
      player.play(createAudioResource(pcm, { inputType: "raw" }));
      await entersState(player, AudioPlayerStatus.Playing, 5_000).catch(() => {});
    } catch (e) {
      console.error(`✗ TTS failed: ${e.message}`);
    }
  }

  await speak("Cortex เข้าห้องแล้วครับ — เปลือกสมองพร้อมพูดด้วยเสียงจริง");

  if (existsSync(QUEUE)) unlinkSync(QUEUE);
  writeFileSync(QUEUE, "");
  watch(QUEUE, async () => {
    const text = readFileSync(QUEUE, "utf8").trim();
    if (text) { writeFileSync(QUEUE, ""); await speak(text); }
  });
  console.log(`📝 say-queue ready → write text to ${QUEUE}`);
  console.log(`🧠 spoken-log (append-only) → ${LOG}`);
});

client.login(token);
