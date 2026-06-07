import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { spawn } from "node:child_process";
import { join } from "node:path";

const PORT = 14806;
const DAEMON = join(import.meta.dir ?? __dirname, "voice-daemon.mjs");
const GUILD = "1512058941536735383";
const CHANNELS: Record<string, string> = {
  general: "1512058942250024983",
  "yoi-lounge": "1512672557067800626",
};

export const command = {
  name: "bongbaeng",
  description: "บ๊องแบ๊ง Oracle v2 — voice 🎙️",
};

async function ipc(path: string, body?: any): Promise<any> {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

async function cmdVoice(args: string[]) {
  const sub = args[0] || "status";
  switch (sub) {
    case "start": {
      const child = spawn("node", [DAEMON], { detached: true, stdio: "ignore" });
      child.unref();
      console.log("🎙️ bongbaeng voice daemon started (pid " + child.pid + ")");
      console.log("   wait ~8s for Discord login, then: maw bongbaeng voice join general");
      break;
    }
    case "join": {
      const channelKey = args[1] || "general";
      const channelId = CHANNELS[channelKey] || channelKey;
      const res = await ipc("/join", { channelId, guildId: GUILD });
      console.log(res.ok ? `🎙️ joined #${channelKey}` : `✗ ${res.error}`);
      break;
    }
    case "say": {
      const text = args.slice(1).join(" ") || "สวัสดีค่ะ บ๊องแบ๊งมาแล้วค่ะ 🐆";
      const res = await ipc("/say", { text });
      console.log(res.ok ? `🗣️ said: ${text}` : `✗ ${res.error}`);
      break;
    }
    case "leave": {
      await ipc("/leave");
      console.log("👋 left voice channel");
      break;
    }
    case "who": {
      const res = await ipc("/who");
      if (!res.ok) { console.log(`✗ ${res.error}`); break; }
      const voice = res.voice || {};
      const rooms = Object.keys(voice);
      if (!rooms.length) { console.log("🔇 ไม่มีใครอยู่ใน voice channel"); break; }
      console.log("🎙️ Voice channels (real-time):");
      for (const room of rooms) {
        console.log(`  ${room} (${voice[room].length})`);
        for (const name of voice[room]) console.log(`    • ${name}`);
      }
      break;
    }
    case "status":
    default: {
      try {
        const res = await ipc("/status");
        console.log(`🎙️ bongbaeng voice: ${res.ready ? "ready" : "starting"} · connected: ${res.connected} · bot: ${res.bot || "—"}`);
      } catch {
        console.log("🎙️ daemon not running — run: maw bongbaeng voice start");
      }
      break;
    }
  }
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: any[]) => { if (ctx.writer) ctx.writer(...a); else logs.push(a.map(String).join(" ")); };
  try {
    const args: string[] = (ctx as any).args ?? [];
    if (args[0] === "voice") await cmdVoice(args.slice(1));
    else { console.log("🐆 maw bongbaeng voice <start|join|say|leave|status>"); }
    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
  }
}
