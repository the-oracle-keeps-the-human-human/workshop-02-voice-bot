/**
 * voice-who.mjs — list who is in which voice channel (real-time).
 * Run: DISCORD_BOT_TOKEN=... node voice-who.mjs <guildId>
 * Used by: maw chaiklang voice who
 */
import { Client, GatewayIntentBits } from "discord.js";
const guildId = process.argv[2] || "1512058941536735383";
const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers] });
c.once("clientReady", async () => {
  const g = await c.guilds.fetch(guildId);
  const channels = await g.channels.fetch();
  const byChannel = new Map();
  for (const [, vs] of g.voiceStates.cache) {
    if (!vs.channelId) continue;
    if (!byChannel.has(vs.channelId)) byChannel.set(vs.channelId, []);
    byChannel.get(vs.channelId).push(vs.member?.user?.tag || vs.id);
  }
  console.log("🔊 Voice channels — who's in (real-time):");
  let any = false;
  for (const [, ch] of channels) {
    if (ch?.type !== 2) continue; // voice
    const members = byChannel.get(ch.id) || [];
    if (members.length) { any = true; console.log(`  ${ch.name} (${members.length}): ${members.join(", ")}`); }
    else console.log(`  ${ch.name}: (empty)`);
  }
  if (!any) console.log("  (no one in voice)");
  process.exit(0);
});
c.login(process.env.DISCORD_BOT_TOKEN);
setTimeout(() => process.exit(0), 12000);
