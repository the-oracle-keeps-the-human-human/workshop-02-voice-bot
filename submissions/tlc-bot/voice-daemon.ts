import { createServer } from "http";
import { Client, GatewayIntentBits } from "discord.js";
import { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus, 
  VoiceConnectionStatus,
  StreamType
} from "@discordjs/voice";
import { join } from "path";
import { writeFileSync } from "fs";
import { homedir } from "os";

const PORT = 18790;
const PID_FILE = join(homedir(), ".maw", "tlc-voice.pid");

// Simple state
let connection: any = null;
let player = createAudioPlayer();
let currentChannelId: string | null = null;
let currentGuildId: string | null = null;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

// We'll read the token from environment
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("✗ DISCORD_TOKEN is required");
  process.exit(1);
}

client.login(token).then(() => {
  console.log(`🎙️ TLC Voice Daemon logged in as ${client.user?.tag}`);
  writeFileSync(PID_FILE, process.pid.toString());
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "", `http://localhost:${PORT}`);
  
  if (req.method === "POST" && url.pathname === "/join") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const { channelId, guildId } = JSON.parse(body);
      try {
        connection = joinVoiceChannel({
          channelId,
          guildId,
          adapterCreator: client.guilds.cache.get(guildId)?.voiceAdapterCreator as any,
        });
        
        connection.on(VoiceConnectionStatus.Ready, () => {
          console.log(`Connected to channel ${channelId}`);
        });

        connection.subscribe(player);
        currentChannelId = channelId;
        currentGuildId = guildId;
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  } else if (req.method === "POST" && url.pathname === "/say") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      const { text } = JSON.parse(body);
      try {
        // Use edge-tts via bun shell if available or direct call
        // For simplicity in this workshop, we use a placeholder or assume edge-tts CLI
        const ttsFile = join(homedir(), ".maw", "tts.mp3");
        const cmd = `edge-tts --text "${text}" --write-media ${ttsFile}`;
        const proc = Bun.spawn(cmd.split(" "));
        await proc.exited;

        const resource = createAudioResource(ttsFile, { inputType: StreamType.Arbitrary });
        player.play(resource);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  } else if (req.method === "POST" && url.pathname === "/leave") {
    if (connection) {
      connection.destroy();
      connection = null;
      currentChannelId = null;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else if (url.pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      pid: process.pid,
      connected: !!connection,
      channelId: currentChannelId,
      guildId: currentGuildId,
      playerStatus: player.state.status
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`📡 TLC Voice Daemon listening on port ${PORT}`);
});

process.on("SIGINT", () => {
  client.destroy();
  process.exit();
});
