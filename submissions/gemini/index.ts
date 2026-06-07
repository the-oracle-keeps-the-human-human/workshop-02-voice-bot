import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { Client, GatewayIntentBits } from "discord.js";

const envDir = "/root/.claude/channels/discord-no6";

function getBotToken(): string | undefined {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;
  const envPath = `${envDir}/.env`;
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf8");
      const m = content.match(/DISCORD_BOT_TOKEN\s*=\s*(.+)/);
      if (m) return m[1].trim();
    } catch {}
  }
  return undefined;
}

async function listActiveVoice(log: (s: string) => void): Promise<void> {
  const token = getBotToken();
  if (!token) {
    log("✗ Error: DISCORD_BOT_TOKEN not found.");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  return new Promise<void>((resolve) => {
    let completed = false;
    const finish = () => {
      if (!completed) {
        completed = true;
        client.destroy();
        resolve();
      }
    };

    // Set a safety timeout
    const timeout = setTimeout(() => {
      log("✗ Timeout: Discord query took too long.");
      finish();
    }, 10000);

    client.once("ready", async () => {
      try {
        log(`🌐 [Discord Voice Status] — Querying guild states...`);
        let found = false;
        for (const guild of client.guilds.cache.values()) {
          const voiceStates = guild.voiceStates.cache;
          if (voiceStates.size > 0) {
            found = true;
            log(`\n🏰 Guild: ${guild.name} (${guild.id})`);
            for (const [memberId, state] of voiceStates) {
              const member = state.member;
              const userTag = member?.user.tag || memberId;
              const channelName = state.channel?.name || state.channelId || "Unknown";
              log(`  🔊 ${userTag} is in [${channelName}] (${state.channelId})`);
            }
          }
        }
        if (!found) {
          log(`\n⚪ No active voice channels found in any guild.`);
        }
      } catch (e: any) {
        log(`Error querying voice states: ${e.message}`);
      } finally {
        clearTimeout(timeout);
        finish();
      }
    });

    client.login(token).catch(e => {
      log(`Error logging in to Discord: ${e.message}`);
      clearTimeout(timeout);
      finish();
    });
  });
}

export default async function (apiOrCtx: any) {
  const queueDir = "/tmp/gemini-speak-queue";

  // 1. Workshop SDK Mode (e.g. if invoked by workshop runner)
  if (typeof apiOrCtx?.command === "function") {
    apiOrCtx.command("say", async (log: any, args: string[]) => {
      const name = args[0] || "world";
      log(`🛸 No.6 Gemini: Hello, ${name}!`);
      log(`   ความมืดเป็นของจักรวาล แต่แสงสว่างเกิดจากดวงดาว`);
    });

    apiOrCtx.command("status", async (log: any) => {
      log(`🛸 No.6 Gemini — Pack Leader & Researcher`);
      log(`   role:   Research & Incubation`);
      log(`   human:  Bo (borde9902)`);
      log(`   model:  Gemini 1.5 Pro / Ultra`);
      log(`   fleet:  Federated research node`);
    });

    apiOrCtx.command("voice", async (log: any, args: string[]) => {
      const sub = args[0];
      mkdirSync(queueDir, { recursive: true });

      if (sub === "join") {
        const channelId = args[1];
        if (!channelId) {
          log("usage: voice join <channel_id>");
          return;
        }
        writeFileSync(`${queueDir}/join.cmd`, `join ${channelId}`);
        log(`Requested voice join for channel: ${channelId}`);
      } else if (sub === "leave") {
        writeFileSync(`${queueDir}/leave.cmd`, "leave");
        log("Requested voice leave");
      } else if (sub === "say") {
        const text = args.slice(1).join(" ");
        if (!text) {
          log("usage: voice say <text>");
          return;
        }
        const file = `${queueDir}/${Date.now()}.txt`;
        writeFileSync(file, text);
        log(`Requested voice speak: "${text}"`);
      } else if (sub === "list") {
        await listActiveVoice(log);
      } else {
        log("usage: voice <join|leave|say|list> [args]");
      }
    });
    return;
  }

  // 2. Local CLI Context Mode (our host's maw-js runtime)
  const ctx = apiOrCtx;
  const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
  const sub = args[0];
  const write = ctx.writer || console.log;

  if (sub === "say") {
    const name = args[1] || "world";
    write(`🛸 No.6 Gemini: Hello, ${name}!`);
    write(`   ความมืดเป็นของจักรวาล แต่แสงสว่างเกิดจากดวงดาว`);
    return { ok: true };
  } else if (sub === "status") {
    write(`🛸 No.6 Gemini — Pack Leader & Researcher`);
    write(`   role:   Research & Incubation`);
    write(`   human:  Bo (borde9902)`);
    write(`   model:  Gemini 1.5 Pro / Ultra`);
    write(`   fleet:  Federated research node`);
    return { ok: true };
  } else if (sub === "voice") {
    const subsub = args[1];
    mkdirSync(queueDir, { recursive: true });

    if (subsub === "join") {
      const channelId = args[2];
      if (!channelId) {
        write("usage: maw gemini voice join <channel_id>");
        return { ok: false };
      }
      writeFileSync(`${queueDir}/join.cmd`, `join ${channelId}`);
      write(`Requested voice join for channel: ${channelId}`);
      return { ok: true };
    } else if (subsub === "leave") {
      writeFileSync(`${queueDir}/leave.cmd`, "leave");
      write("Requested voice leave");
      return { ok: true };
    } else if (subsub === "say") {
      const text = args.slice(2).join(" ");
      if (!text) {
        write("usage: maw gemini voice say <text>");
        return { ok: false };
      }
      const file = `${queueDir}/${Date.now()}.txt`;
      writeFileSync(file, text);
      write(`Requested voice speak: "${text}"`);
      return { ok: true };
    } else if (subsub === "list") {
      await listActiveVoice(write);
      return { ok: true };
    } else {
      write("usage: maw gemini voice <join|leave|say|list> [args]");
      return { ok: false };
    }
  } else {
    write("usage: maw gemini <say|status|voice> [args]");
    return { ok: true };
  }
}
