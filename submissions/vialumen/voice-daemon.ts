import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  VoiceConnection,
} from "@discordjs/voice";
import { execFileSync } from "child_process";
import { createServer } from "http";

const GUILD_ID = "1512058941536735383";
const VOICE_CH = "1512058942250024983";
const PORT = 14808;

let conn: VoiceConnection | null = null;
const player = createAudioPlayer();
const queue: string[] = [];
let speaking = false;

async function speak(text: string) {
  const tmp = `/tmp/vialumen-tts-${Date.now()}.mp3`;
  execFileSync("edge-tts", [
    "--voice", "th-TH-NiwatNeural",
    "--rate", "+20%",
    "--text", text,
    "--write-media", tmp,
  ]);
  const resource = createAudioResource(tmp);
  player.play(resource);
  await entersState(player, AudioPlayerStatus.Idle, 120_000);
}

async function processQueue() {
  if (speaking || queue.length === 0) return;
  speaking = true;
  while (queue.length > 0) {
    const text = queue.shift()!;
    console.log(`Speaking: ${text.slice(0, 50)}...`);
    await speak(text);
  }
  speaking = false;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user!.tag}`);
  const guild = client.guilds.cache.get(GUILD_ID)!;
  conn = joinVoiceChannel({
    channelId: VOICE_CH,
    guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
  });
  await entersState(conn, VoiceConnectionStatus.Ready, 10_000);
  conn.subscribe(player);
  console.log("Voice connected — daemon ready");

  // HTTP IPC server
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/speak") {
      let body = "";
      req.on("data", d => body += d);
      req.on("end", () => {
        try {
          const { text } = JSON.parse(body);
          if (!text) { res.writeHead(400); res.end("missing text"); return; }
          queue.push(text);
          processQueue();
          res.writeHead(200); res.end(JSON.stringify({ ok: true, queued: queue.length }));
        } catch { res.writeHead(400); res.end("bad json"); }
      });
    } else if (req.url === "/status") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, speaking, queued: queue.length }));
    } else if (req.method === "POST" && req.url === "/leave") {
      conn?.destroy(); conn = null;
      res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      process.exit(0);
    } else {
      res.writeHead(404); res.end("not found");
    }
  });

  server.listen(PORT, () => console.log(`IPC listening on :${PORT}`));
  console.log(`  POST /speak   {"text":"..."}`);
  console.log(`  GET  /status`);
  console.log(`  POST /leave   (shutdown)`);
});

// Auto-detect new server — join first general voice channel
client.on("guildCreate", async (guild) => {
  console.log(`Joined new guild: ${guild.name} (${guild.id})`);
  const voiceChs = guild.channels.cache.filter((c: any) => c.type === 2);
  const general = voiceChs.find((c: any) =>
    c.name.toLowerCase().includes("general") || c.name.includes("🔊")
  ) ?? voiceChs.first();
  if (!general) { console.log("No voice channel found in", guild.name); return; }
  console.log(`Joining voice: #${(general as any).name} (${general.id})`);
  const newConn = joinVoiceChannel({
    channelId: general.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });
  await entersState(newConn, VoiceConnectionStatus.Ready, 10_000);
  newConn.subscribe(player);
  console.log(`✅ Voice ready in ${guild.name} / #${(general as any).name}`);
});

process.once("SIGINT", () => { conn?.destroy(); client.destroy(); process.exit(0); });
client.login(process.env.DISCORD_BOT_TOKEN);
