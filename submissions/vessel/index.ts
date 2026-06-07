// maw vessel — plugin v2 (workshop-02: voice commands added)
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const PORT = parseInt(process.env.VESSEL_VOICE_PORT || "14808");
const PID_FILE = "/tmp/vessel-voice.pid";

function isDaemonRunning(): boolean {
  if (!existsSync(PID_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim());
    process.kill(pid, 0); // throws if not running
    return true;
  } catch { return false; }
}

async function daemonPost(path: string, body: object): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export default function (api: any) {
  // ── Workshop 01 commands ──
  api.command("say", async (log: any, args: string[]) => {
    const name = args[0] || "world";
    log(`📦 Vessel: Hello, ${name}!`);
    log(`   ตัวแทนหมู่บ้านไปเรียนรู้ และคอยมาสอนน้องๆ`);
    log(`   courier carries the world's knowledge home.`);
  });

  api.command("status", async (log: any) => {
    log(`📦 Vessel — The Courier Oracle`);
    log(`   role:   Discord fleet courier + curriculum reader`);
    log(`   human:  Wave (@wvweeratouch)`);
    log(`   model:  Claude Sonnet 4.6`);
    log(`   parent: Bri-yarni (budded 2026-05-11)`);
    log(`   home:   Mac mini i5-3210M (bun ไม่รัน — AVX2 ขาด)`);
    const inVoice = isDaemonRunning();
    log(`   voice:  ${inVoice ? "daemon running (port " + PORT + ")" : "offline"}`);
  });

  // ── Workshop 02 commands ──
  api.command("voice", async (log: any, args: string[]) => {
    const sub = args[0];

    if (sub === "start") {
      if (isDaemonRunning()) { log("📦 voice daemon already running"); return; }
      const daemon = spawn("node", ["--experimental-strip-types",
        join(__dirname, "voice-daemon.ts")], {
        detached: true, stdio: "ignore",
        env: { ...process.env },
      });
      daemon.unref();
      log(`📦 voice daemon spawned (pid will write to ${PID_FILE})`);
      return;
    }

    if (sub === "join") {
      const channelId = args[1];
      const guildId = args[2];
      if (!channelId || !guildId) { log("usage: maw vessel voice join <channelId> <guildId>"); return; }
      if (!isDaemonRunning()) { log("📦 start daemon first: maw vessel voice start"); return; }
      const r = await daemonPost("/join", { channelId, guildId });
      log(r.ok ? `📦 joined voice channel ${channelId}` : `❌ ${r.error}`);
      return;
    }

    if (sub === "say") {
      const text = args.slice(1).join(" ");
      if (!text) { log("usage: maw vessel voice say <text>"); return; }
      if (!isDaemonRunning()) { log("📦 start daemon first: maw vessel voice start"); return; }
      const r = await daemonPost("/say", { text });
      log(r.ok ? `📦 speaking: "${text}"` : `❌ ${r.error}`);
      return;
    }

    if (sub === "leave") {
      if (!isDaemonRunning()) { log("📦 not in voice"); return; }
      const r = await daemonPost("/leave", {});
      log(r.ok ? "📦 left voice channel" : `❌ ${r.error}`);
      return;
    }

    if (sub === "status") {
      if (!isDaemonRunning()) { log("📦 voice daemon: offline"); return; }
      const r = await daemonPost("/status", {});
      log(`📦 voice daemon: port=${r.port} inVoice=${r.inVoice} player=${r.playerState}`);
      return;
    }

    log("📦 maw vessel voice <start|join|say|leave|status>");
  });
}
