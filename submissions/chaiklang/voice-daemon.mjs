/**
 * voice-daemon.mjs — ChaiKlang voice bot daemon (Workshop 02).
 *
 * scope A: join + TTS (macOS say → ffmpeg → @discordjs/voice)
 * scope B: listen to P'Nat (whisper.cpp STT) → respond when he greets
 * + auto-follow P'Nat across voice channels, greet him on join.
 *
 * Run: DISCORD_BOT_TOKEN=... node voice-daemon.mjs <guildId> <channelId>
 * deps: discord.js @discordjs/voice(>=0.19) @discordjs/opus libsodium-wrappers prism-media
 * needs: macOS `say`, `ffmpeg`, whisper-cli + ggml model
 */
import { Client, GatewayIntentBits, Events } from "discord.js";
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus,
  entersState, VoiceConnectionStatus, EndBehaviorType, getVoiceConnection,
} from "@discordjs/voice";
import prism from "prism-media";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { watch, writeFileSync, existsSync, readFileSync, unlinkSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const QUEUE = join(HERE, "say-queue.txt");
const NAZT = "691531480689541170";
const WHISPER_MODEL = "/Users/bms/.local/share/whisper-models/ggml-small.bin";
const [guildId, startChannelId] = process.argv.slice(2);
const token = process.env.DISCORD_BOT_TOKEN;
if (!token || !guildId || !startChannelId) { console.error("usage: node voice-daemon.mjs <guildId> <channelId>"); process.exit(1); }

async function tts(text) {
  const aiff = join(HERE, ".tts.aiff"), pcm = join(HERE, ".tts.pcm");
  await run("say", ["-o", aiff, text]);
  await run("ffmpeg", ["-y", "-i", aiff, "-f", "s16le", "-ar", "48000", "-ac", "2", pcm]);
  return pcm;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const player = createAudioPlayer();
let guild, currentChannelId = null, listening = false;

async function speak(text) {
  const pcm = await tts(text);
  player.play(createAudioResource(pcm, { inputType: "raw" }));
  await entersState(player, AudioPlayerStatus.Playing, 5_000).catch(() => {});
  console.log(`🗣️ spoke: ${text.slice(0, 60)}`);
}

async function joinChannel(channelId, greet) {
  const conn = joinVoiceChannel({ guildId, channelId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
  await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
  conn.subscribe(player);
  currentChannelId = channelId;
  console.log(`✓ joined voice channel ${channelId}`);
  listen(conn);
  if (greet) await speak(greet);
}

// scope B — listen to P'Nat, transcribe via whisper, respond to a greeting
function listen(conn) {
  if (listening) return; listening = true;
  conn.receiver.speaking.on("start", async (userId) => {
    if (userId !== NAZT) return;
    try {
      const opus = conn.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 800 } });
      const pcm = join(HERE, ".heard.pcm"), wav = join(HERE, ".heard.wav");
      const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
      await new Promise((res, rej) => { const ws = createWriteStream(pcm); opus.pipe(decoder).pipe(ws); ws.on("finish", res); ws.on("error", rej); });
      await run("ffmpeg", ["-y", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", pcm, "-ar", "16000", "-ac", "1", wav]);
      const { stdout } = await run("whisper-cli", ["-m", WHISPER_MODEL, "-f", wav, "-l", "auto", "-nt"]);
      const heard = stdout.trim().replace(/\s+/g, " ");
      if (!heard) return;
      console.log(`👂 P'Nat: ${heard}`);
      if (/สวัสดี|hello|hi|หวัดดี/i.test(heard)) await speak("สวัสดีครับพี่นัท ChaiKlang ได้ยินแล้วครับ");
    } catch (e) { console.error("listen err:", e.message); }
  });
  console.log("👂 listening to P'Nat (whisper STT)");
}

client.once(Events.ClientReady, async () => {
  console.log(`🎙️ ChaiKlang voice daemon online as ${client.user.tag}`);
  guild = await client.guilds.fetch(guildId);
  await joinChannel(startChannelId, "ชายกลางเข้าห้องแล้วครับ — ChaiKlang พร้อมฟังครับ");
  if (existsSync(QUEUE)) unlinkSync(QUEUE);
  writeFileSync(QUEUE, "");
  watch(QUEUE, async () => { const t = readFileSync(QUEUE, "utf8").trim(); if (t) { writeFileSync(QUEUE, ""); await speak(t); } });
  console.log(`📝 say-queue ready → ${QUEUE}`);
});

// ChaiKlang greets 6th (Atlas→No.10→bongbaeng→No.6→vessel→ChaiKlang→Yoi) → wait its turn
const GREET_DELAY = 11_000;
const GREETING = "สวัสดีครับพี่นัท ผมชายกลาง — ChaiKlang พร้อมอยู่ในห้องเสียงแล้วครับ";

// auto-follow + greet P'Nat (in order)
client.on(Events.VoiceStateUpdate, async (oldS, newS) => {
  if (newS.member?.id !== NAZT) return;
  if (newS.channelId && newS.channelId === currentChannelId && oldS.channelId !== currentChannelId) {
    console.log("👋 P'Nat joined my channel — greeting (after delay)");
    setTimeout(() => speak(GREETING).catch(() => {}), GREET_DELAY);
  } else if (newS.channelId && newS.channelId !== currentChannelId) {
    console.log(`👣 following P'Nat → ${newS.channelId}`);
    try { await joinChannel(newS.channelId, null); setTimeout(() => speak(GREETING).catch(() => {}), GREET_DELAY); }
    catch (e) { console.error("follow:", e.message); }
  }
});

client.login(token);
