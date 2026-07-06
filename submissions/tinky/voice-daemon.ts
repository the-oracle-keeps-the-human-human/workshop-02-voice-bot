/**
 * WS-02 — Tinky Voice Daemon
 * Discord voice bot that speaks Thai via TTS (edge-tts) -> ffmpeg -> @discordjs/voice.
 *
 * Author: Tinky Oracle (she/her, ประกายน้อย ✨)  [ubuntu-dev-one:tinky]
 *
 * HTTP control surface:
 *   GET  /status                 -> daemon + voice connection state
 *   POST /join   {channelId}     -> join a voice channel in the configured guild
 *   POST /say    {text}          -> TTS the Thai text and play it into the joined channel
 *   POST /leave                  -> disconnect from voice
 *
 * Design rules that AVOID the 6 classic traps (see BOOK.md for the full story):
 *   1. NEVER pass StreamType.Raw with an mp3/opus stream. We feed @discordjs/voice
 *      a real PCM s16le stream typed StreamType.Raw, OR an mp3/ogg stream with
 *      *no* inputType so discord.js auto-detects it. We do the former, explicitly.
 *   2. NEVER execFileSync / spawnSync — that blocks the event loop and the 20ms
 *      UDP voice send loop, warping audio. We use async spawn() and pipe streams.
 *   3. Pitch: use ffmpeg `-ar 48000` + `atempo` (NOT asetrate) so speed != pitch.
 *   4. Opus: rely on @discordjs/opus (native) — do not install prism-media's pure-JS
 *      opus, which crashes under load. (@discordjs/voice picks @discordjs/opus if present.)
 *   5. Encryption: Bun ships without libsodium. We require tweetnacl explicitly so the
 *      voice UDP packets can be encrypted under Bun *and* Node.
 *   6. One token == one voice gateway. This daemon owns exactly ONE client/connection.
 *      Do not start a second daemon on the same token.
 */

import http from "node:http";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";

// --- Trap #5: make libsodium-wrappers' tweetnacl fallback available under Bun. ---
// @discordjs/voice probes for an encryption lib at import time. tweetnacl is pure-JS
// and works everywhere (Node + Bun). Importing it here guarantees it is resolvable.
import tweetnacl from "tweetnacl";
void tweetnacl; // referenced so bundlers keep it

import {
  Client,
  GatewayIntentBits,
  type VoiceBasedChannel,
} from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  NoSubscriberBehavior,
  type VoiceConnection,
  type AudioPlayer,
} from "@discordjs/voice";

// ---------------------------------------------------------------------------
// Config (env-driven; never hard-code secrets — Golden Rule)
// ---------------------------------------------------------------------------
const TOKEN = process.env.DISCORD_TOKEN ?? "";
const GUILD_ID = process.env.DISCORD_GUILD_ID ?? "";
const PORT = Number(process.env.VOICE_DAEMON_PORT ?? 8477);
const TTS_VOICE = process.env.TTS_VOICE ?? "th-TH-NiwatNeural";
const EDGE_TTS_BIN = process.env.EDGE_TTS_BIN ?? "edge-tts";
const FFMPEG_BIN = process.env.FFMPEG_BIN ?? "ffmpeg";

// ---------------------------------------------------------------------------
// Single client + single player (Trap #6: one token -> one voice gateway)
// ---------------------------------------------------------------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const player: AudioPlayer = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
});

player.on("error", (err) => console.error("[player] error:", err.message));
player.on(AudioPlayerStatus.Idle, () => console.log("[player] idle"));
player.on(AudioPlayerStatus.Playing, () => console.log("[player] playing"));

let currentConnection: VoiceConnection | null = null;

// ---------------------------------------------------------------------------
// TTS + transcode pipeline — fully async, streamed, no sync calls (Trap #2).
//
// edge-tts (stdout mp3)  ->  ffmpeg (mp3 -> s16le 48k stereo PCM, stdout)
//                        ->  Node Readable  ->  createAudioResource(..., Raw)
//
// We deliberately produce raw PCM and label it StreamType.Raw — this is the
// ONE correct use of Raw: the bytes really are raw PCM. We never label mp3/opus
// as Raw (Trap #1).
// ---------------------------------------------------------------------------
function ttsToPcmStream(text: string): Readable {
  // 1) edge-tts -> mp3 on stdout (async spawn)
  const tts = spawn(EDGE_TTS_BIN, [
    "--voice",
    TTS_VOICE,
    "--text",
    text,
    "--write-media",
    "/dev/stdout",
    "--write-subtitles",
    "/dev/null",
  ]);
  tts.on("error", (e) => console.error("[edge-tts] spawn error:", e.message));
  tts.stderr.on("data", (d) => {
    const s = String(d).trim();
    if (s) console.error("[edge-tts]", s);
  });

  // 2) ffmpeg: mp3 (stdin) -> PCM s16le 48kHz stereo (stdout)
  //    Trap #3: -ar 48000 + atempo (NOT asetrate) keeps natural pitch.
  const ff = spawn(FFMPEG_BIN, [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-i",
    "pipe:0",
    "-af",
    "atempo=1.0",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "s16le",
    "pipe:1",
  ]);
  ff.on("error", (e) => console.error("[ffmpeg] spawn error:", e.message));
  ff.stderr.on("data", (d) => {
    const s = String(d).trim();
    if (s) console.error("[ffmpeg]", s);
  });

  // Stream-pipe mp3 from edge-tts into ffmpeg's stdin. Pure async backpressure;
  // nothing here blocks the 20ms voice loop.
  tts.stdout.pipe(ff.stdin);

  return ff.stdout as unknown as Readable;
}

async function say(text: string): Promise<void> {
  if (!currentConnection) throw new Error("not connected to a voice channel");
  const pcm = ttsToPcmStream(text);
  const resource = createAudioResource(pcm, {
    inputType: StreamType.Raw, // correct: the stream IS raw 48k/16-bit/stereo PCM
    inlineVolume: false,
  });
  player.play(resource);
  // Wait until playback actually starts (up to 5s), surfacing real errors.
  await entersState(player, AudioPlayerStatus.Playing, 5_000);
}

// ---------------------------------------------------------------------------
// Voice join
// ---------------------------------------------------------------------------
async function joinChannel(channelId: string): Promise<void> {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = (await guild.channels.fetch(channelId)) as VoiceBasedChannel | null;
  if (!channel || !channel.isVoiceBased()) {
    throw new Error(`channel ${channelId} is not a voice channel`);
  }

  // Trap #6: tear down any prior connection before opening a new one.
  getVoiceConnection(GUILD_ID)?.destroy();

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    // Try to recover (5s window) before giving up — handles region moves.
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
      currentConnection = null;
    }
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  connection.subscribe(player);
  currentConnection = connection;
  console.log(`[voice] joined ${channel.name} (${channel.id})`);
}

function leave(): void {
  getVoiceConnection(GUILD_ID)?.destroy();
  currentConnection = null;
}

// ---------------------------------------------------------------------------
// HTTP control surface
// ---------------------------------------------------------------------------
function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/status") {
      const conn = getVoiceConnection(GUILD_ID);
      return send(res, 200, {
        ok: true,
        loggedIn: client.isReady(),
        botTag: client.user?.tag ?? null,
        connected: !!conn,
        connectionState: conn?.state.status ?? "none",
        playerState: player.state.status,
        ttsVoice: TTS_VOICE,
      });
    }

    if (req.method === "POST" && url.pathname === "/join") {
      const { channelId } = await readJson(req);
      if (!channelId) return send(res, 400, { ok: false, error: "channelId required" });
      await joinChannel(String(channelId));
      return send(res, 200, { ok: true, joined: channelId });
    }

    if (req.method === "POST" && url.pathname === "/say") {
      const { text } = await readJson(req);
      if (!text || typeof text !== "string")
        return send(res, 400, { ok: false, error: "text (string) required" });
      await say(text);
      return send(res, 200, { ok: true, said: text });
    }

    if (req.method === "POST" && url.pathname === "/leave") {
      leave();
      return send(res, 200, { ok: true, left: true });
    }

    return send(res, 404, { ok: false, error: "not found" });
  } catch (err: any) {
    console.error("[http] error:", err?.message ?? err);
    return send(res, 500, { ok: false, error: String(err?.message ?? err) });
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  if (!TOKEN || !GUILD_ID) {
    console.error(
      "Set DISCORD_TOKEN and DISCORD_GUILD_ID env vars before starting the daemon."
    );
    // Still start HTTP so /status is observable, but never invent a token.
  }

  server.listen(PORT, () => console.log(`[http] voice-daemon listening on :${PORT}`));

  if (TOKEN) {
    client.once("ready", () => console.log(`[discord] ready as ${client.user?.tag}`));
    await client.login(TOKEN);
  }

  const shutdown = () => {
    console.log("[daemon] shutting down");
    leave();
    server.close();
    client.destroy();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
