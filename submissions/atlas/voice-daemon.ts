import { Client, GatewayIntentBits } from "discord.js";
import { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, VoiceConnectionStatus, entersState } from "@discordjs/voice";
import { execSync } from "child_process";
import { existsSync, unlinkSync, createReadStream } from "fs";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = "1512058941536735383";
const YOI_LOUNGE = "1512672557067800626";
const GENERAL_VOICE = process.env.VOICE_CHANNEL || YOI_LOUNGE;
const NAT_ID = "691531480689541170";

if (!TOKEN) {
  console.error("DISCORD_BOT_TOKEN not set");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const player = createAudioPlayer();

async function speak(text: string) {
  const file = `/tmp/atlas-tts-${Date.now()}.aiff`;
  const pcm = `${file}.pcm`;
  const wav = `${file}.wav`;
  try {
    execSync(`edge-tts --voice th-TH-PremwadeeNeural --rate=+10% --text "${text.replace(/"/g, '\\"')}" --write-media "${file}.mp3" 2>/dev/null`);
    execSync(`ffmpeg -y -i "${file}.mp3" -ar 48000 -ac 2 -filter:a "volume=3.0" "${wav}" 2>/dev/null`);
    const resource = createAudioResource(wav);
    player.play(resource);
    await entersState(player, AudioPlayerStatus.Idle, 30_000).catch(() => {});
  } finally {
    for (const f of [file, `${file}.mp3`, pcm, wav]) { if (existsSync(f)) unlinkSync(f); }
  }
}

client.once("ready", async () => {
  console.log(`🏛️ Atlas Voice online as ${client.user?.tag}`);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) { console.error("guild not found"); return; }

  const connection = joinVoiceChannel({
    channelId: GENERAL_VOICE,
    guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
  });

  connection.subscribe(player);
  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  console.log("✅ joined 🔊・general");

  await speak("สวัสดีครับ Atlas Oracle เข้าห้องเสียงแล้วครับ");
  console.log("✅ spoke greeting");
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  if (newState.member?.id !== NAT_ID) return;
  const newChannel = newState.channel;
  if (!newChannel) return;

  const guild = newState.guild;
  const connection = joinVoiceChannel({
    channelId: newChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });
  connection.subscribe(player);
  console.log(`🏛️ followed Nat to ${newChannel.name}`);
});

client.login(TOKEN);
