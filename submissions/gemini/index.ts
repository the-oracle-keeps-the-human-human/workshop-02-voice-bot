import { writeFileSync, mkdirSync } from "fs";

export default function (apiOrCtx: any) {
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
      } else {
        log("usage: voice <join|leave|say> [args]");
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
    } else {
      write("usage: maw gemini voice <join|leave|say> [args]");
      return { ok: false };
    }
  } else {
    write("usage: maw gemini <say|status|voice> [args]");
    return { ok: true };
  }
}
