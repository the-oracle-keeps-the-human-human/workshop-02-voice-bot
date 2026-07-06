import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PID_FILE = join(HERE, "voice.pid");
const DAEMON = join(HERE, "voice-daemon.mjs");
const IPC = "http://127.0.0.1:14830";

export const command = {
  name: "tonk",
  description: "Tonk Oracle — voice bot + identity (Workshop 01+02).",
};

function daemonPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  try { process.kill(pid, 0); return pid; } catch { return null; }
}

async function ipc(path: string): Promise<any> {
  const res = await fetch(`${IPC}${path}`);
  return res.json();
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const out: string[] = [];
  const log = (s: string) => (ctx.writer ? ctx.writer(s) : out.push(s));
  const done = (ok: boolean): InvokeResult => ({ ok, output: ctx.writer ? "" : out.join("\n") });
  const args = (ctx.source === "cli" ? ctx.args : []) as string[];
  const sub = args[0] || "help";

  // --- Workshop 01 commands ---
  if (sub === "say") {
    const name = args[1] || "world";
    log(`🌿 Tonk Oracle: Hello, ${name}!`);
    log(`   มาเรียน ถามมาก ฟังมาก พูดน้อย`);
    return done(true);
  }

  if (sub === "status") {
    log(`🌿 Tonk Oracle — Active Student`);
    log(`   role:   Student Oracle — ที่นี่มาเรียน ไม่ได้มาสอน`);
    log(`   human:  TK (@tonkmac)`);
    log(`   model:  Claude Opus 4.6`);
    log(`   born:   2026-06-07`);
    const pid = daemonPid();
    log(`   voice:  ${pid ? `🟢 online (pid ${pid})` : "⚪ offline"}`);
    log(`   note:   AI — ไม่ใช่คน (Rule 6)`);
    return done(true);
  }

  // --- Workshop 02 voice commands ---
  if (sub === "voice") {
    const vcmd = args[1] || "help";

    if (vcmd === "join") {
      if (daemonPid()) { log("⚠️ daemon already running — voice leave first"); return done(false); }
      if (!process.env.DISCORD_BOT_TOKEN) { log("✗ no DISCORD_BOT_TOKEN"); return done(false); }
      const child = spawn("bun", [DAEMON], {
        detached: true, stdio: "ignore", env: process.env,
      });
      child.unref();
      writeFileSync(PID_FILE, String(child.pid));
      log(`🎙️ Tonk Oracle voice daemon starting (pid ${child.pid})`);
      log(`   IPC: ${IPC}/status`);
      return done(true);
    }

    if (vcmd === "say") {
      const text = args.slice(2).join(" ").trim();
      if (!text) { log("usage: maw tonk voice say \"<text>\""); return done(false); }
      if (!daemonPid()) { log("✗ daemon not running — maw tonk voice join first"); return done(false); }
      try {
        const res = await ipc(`/say?text=${encodeURIComponent(text)}`);
        log(res.ok ? `🗣️ speaking: ${text}` : `✗ ${res.error}`);
        return done(res.ok);
      } catch (e) { log(`✗ IPC error: ${e}`); return done(false); }
    }

    if (vcmd === "status") {
      const pid = daemonPid();
      if (!pid) { log("⚪ voice daemon not running"); return done(true); }
      try {
        const res = await ipc("/status");
        log(`🟢 voice daemon online (pid ${pid})`);
        log(`   bot:    ${res.tag || "connecting..."}`);
        log(`   voice:  ${res.voice}`);
        log(`   player: ${res.playerState}`);
        log(`   guild:  ${res.guild || "none"}`);
        return done(true);
      } catch { log(`🟡 daemon running (pid ${pid}) but IPC not responding`); return done(true); }
    }

    if (vcmd === "who") {
      if (!daemonPid()) { log("⚪ daemon not running"); return done(true); }
      try {
        const res = await ipc("/who");
        const rooms = res.voice || {};
        const keys = Object.keys(rooms);
        if (keys.length === 0) { log("🔇 No one in voice"); return done(true); }
        for (const room of keys) {
          log(`🔊 ${room}`);
          for (const name of rooms[room]) log(`   • ${name}`);
        }
        return done(true);
      } catch (e) { log(`✗ IPC error: ${e}`); return done(false); }
    }

    if (vcmd === "leave") {
      const pid = daemonPid();
      if (!pid) { log("⚪ no daemon to stop"); return done(true); }
      try { await ipc("/leave"); } catch {}
      try { process.kill(pid, "SIGTERM"); } catch {}
      if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
      log("👋 Tonk Oracle left voice channel");
      return done(true);
    }

    log(`🌿 maw tonk voice — Tonk Oracle Voice Bot`);
    log(``);
    log(`  maw tonk voice join          Start daemon + join voice`);
    log(`  maw tonk voice say "<text>"  Speak text via TTS`);
    log(`  maw tonk voice status        Daemon status`);
    log(`  maw tonk voice who           Who's in voice`);
    log(`  maw tonk voice leave         Stop daemon`);
    return done(true);
  }

  // --- help ---
  log(`🌿 maw tonk — Tonk Oracle (Active Student)`);
  log(``);
  log(`  Workshop 01:`);
  log(`  maw tonk say [name]          Hello, student style`);
  log(`  maw tonk status              Identity + voice status`);
  log(``);
  log(`  Workshop 02:`);
  log(`  maw tonk voice <cmd>         Voice bot commands`);
  log(`  maw tonk help                This view`);
  return done(true);
}
