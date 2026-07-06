import { Client, GatewayIntentBits } from "discord.js";
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } from "@discordjs/voice";
import { readdirSync } from "fs";
import { join } from "path";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = "1512058941536735383";
const CHANNEL_ID = process.env.VOICE_CHANNEL || "1512058942250024983";
const CHUNKS_DIR = "/tmp/atlas-chunks-v2";
const NAT_ID = "691531480689541170";

if (!TOKEN) { console.error("DISCORD_BOT_TOKEN not set"); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const player = createAudioPlayer();

async function playChunks() {
  const files = readdirSync(CHUNKS_DIR)
    .filter(f => f.endsWith(".mp3"))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || "0");
      const numB = parseInt(b.match(/\d+/)?.[0] || "0");
      return numA - numB;
    });

  console.log(`📜 Playing ${files.length} chunks via stream...`);

  for (const file of files) {
    const path = join(CHUNKS_DIR, file);
    console.log(`  ▶ ${file}`);
    const resource = createAudioResource(path);
    player.play(resource);
    await entersState(player, AudioPlayerStatus.Idle, 60_000).catch(() => {});
  }

  console.log("✅ All 10 chunks played!");
}

client.once("ready", async () => {
  console.log(`🏛️ Atlas Voice Stream online as ${client.user?.tag}`);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) { console.error("guild not found"); return; }

  const connection = joinVoiceChannel({
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
  });

  connection.subscribe(player);
  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  console.log(`✅ joined voice channel ${CHANNEL_ID}`);

  await playChunks();

  console.log("🏛️ Stream complete — staying in channel");
});

client.on("voiceStateUpdate", async (_old, newState) => {
  if (newState.member?.id !== NAT_ID) return;
  const ch = newState.channel;
  if (!ch) return;
  const guild = newState.guild;
  const conn = joinVoiceChannel({
    channelId: ch.id, guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });
  conn.subscribe(player);
  console.log(`🏛️ followed Nat to ${ch.name}`);
});

client.login(TOKEN);
