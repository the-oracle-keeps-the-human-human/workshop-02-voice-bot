/**
 * maw maxus voice — Workshop 02 (scope A: TTS-first). ⚡🌀
 * One-shot command that drives the persistent voice-daemon.mjs.
 *
 *   maw maxus voice join <guildId> <channelId>   spawn daemon -> join + greet
 *   maw maxus voice say "<text>"                 queue text -> daemon speaks
 *   maw maxus voice who                          who is in which voice channel
 *   maw maxus voice status                       is the daemon running?
 *   maw maxus voice leave                        stop daemon (leave channel)
 */
import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PID = join(HERE, "voice.pid");
const QUEUE = join(HERE, "say-queue.txt");
const WHO = join(HERE, "voice-who.json");

export const command = { name: "maxus", description: "Maxus voice bot (Workshop 02)." };

function running(): number | null {
  if (!existsSync(PID)) return null;
  const pid = Number(readFileSync(PID, "utf8").trim());
  try { process.kill(pid, 0); return pid; } catch { return null; }
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const out: string[] = [];
  const log = (s: string) => (ctx.writer ? ctx.writer(s) : out.push(s));
  const done = (ok: boolean): InvokeResult => ({ ok, output: ctx.writer ? "" : out.join("\n"), exitCode: ok ? 0 : 1 });
  const args = ctx.source === "cli" ? (ctx.args as string[]) : [];

  if (args[0] !== "voice") { log("maw maxus voice <join|say|who|status|leave>"); return done(true); }
  const sub = args[1];

  switch (sub) {
    case "join": {
      const [guildId, channelId] = [args[2], args[3]];
      if (!guildId || !channelId) { log("usage: maw maxus voice join <guildId> <channelId>"); return done(false); }
      if (running()) { log("⚠️ daemon already running — `voice leave` first"); return done(false); }
      if (!process.env.DISCORD_BOT_TOKEN) { log("✗ no DISCORD_BOT_TOKEN in env"); return done(false); }
      const child = spawn("node", [join(HERE, "voice-daemon.mjs"), guildId, channelId], {
        detached: true, stdio: "ignore", env: process.env,
      });
      child.unref();
      writeFileSync(PID, String(child.pid));
      log(`⚡🌀 Maxus กำลังเข้าห้อง voice ${channelId} (daemon pid ${child.pid})`);
      return done(true);
    }
    case "say": {
      const text = args.slice(2).join(" ").trim();
      if (!text) { log('usage: maw maxus voice say "<text>"'); return done(false); }
      if (!running()) { log("✗ daemon ไม่ได้รัน — `voice join` ก่อน"); return done(false); }
      writeFileSync(QUEUE, text);
      log(`🗣️ queued: ${text}`);
      return done(true);
    }
    case "who": {
      if (!existsSync(WHO)) { log("⚪ ยังไม่มีข้อมูล — `voice join` ก่อน"); return done(true); }
      const snap = JSON.parse(readFileSync(WHO, "utf8"));
      log(`🎙️ Voice channels (as of ${snap.ts}):`);
      if (!snap.rooms?.length) log("   (no one in voice)");
      for (const r of snap.rooms ?? []) {
        log(`   ${r.channel} (${r.members.length})`);
        for (const m of r.members) log(`     • ${m}`);
      }
      return done(true);
    }
    case "status": {
      const pid = running();
      log(pid ? `🟢 Maxus voice daemon online (pid ${pid})` : "⚪ voice daemon ไม่ได้รัน");
      return done(true);
    }
    case "leave": {
      const pid = running();
      if (!pid) { log("⚪ ไม่มี daemon ให้ปิด"); return done(true); }
      try { execFileSync("kill", [String(pid)]); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
      if (existsSync(PID)) unlinkSync(PID);
      log("👋 Maxus ออกจากห้อง voice แล้วครับ");
      return done(true);
    }
    default:
      log("maw maxus voice <join|say|who|status|leave>");
      return done(true);
  }
}
