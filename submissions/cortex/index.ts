/**
 * maw cortex voice — Workshop 02 (ElevenLabs streaming TTS).
 * One-shot command that drives the persistent voice-daemon.mjs.
 *
 *   maw cortex voice join <guildId> <channelId>   spawn daemon → join + greet
 *   maw cortex voice say "<text>"                 queue text → daemon speaks (ElevenLabs)
 *   maw cortex voice status                        is the daemon running? which engine?
 *   maw cortex voice leave                         stop daemon (leave channel)
 *
 * TTS engine: ElevenLabs (if ELEVENLABS_API_KEY set) else macOS `say` fallback.
 * Every spoken line is appended to spoken-log.ndjson (Nothing is Deleted).
 */
import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { spawn } from "node:child_process";
import { writeFileSync, existsSync, readFileSync, unlinkSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PID = join(HERE, "voice.pid");
const QUEUE = join(HERE, "say-queue.txt");

export const command = { name: "cortex", description: "Bungkee Cortex voice bot (Workshop 02, ElevenLabs TTS)." };

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

  if (args[0] !== "voice") { log("maw cortex voice <join|say|status|leave>"); return done(true); }
  const sub = args[1];

  switch (sub) {
    case "join": {
      const [guildId, channelId] = [args[2], args[3]];
      if (!guildId || !channelId) { log("usage: maw cortex voice join <guildId> <channelId>"); return done(false); }
      if (running()) { log("⚠️ daemon already running — leave first"); return done(false); }
      if (!process.env.DISCORD_BOT_TOKEN) { log("✗ no DISCORD_BOT_TOKEN"); return done(false); }
      const engine = process.env.ELEVENLABS_API_KEY ? "ElevenLabs 🎙️" : "macOS say (fallback)";
      const child = spawn("node", [join(HERE, "voice-daemon.mjs"), guildId, channelId], {
        detached: true, stdio: "ignore", env: process.env,
      });
      child.unref();
      writeFileSync(PID, String(child.pid));
      log(`🧠 Cortex กำลังเข้าห้อง voice ${channelId} (daemon pid ${child.pid}) — TTS: ${engine}`);
      return done(true);
    }
    case "say": {
      const text = args.slice(2).join(" ").trim();
      if (!text) { log('usage: maw cortex voice say "<text>"'); return done(false); }
      if (!running()) { log("✗ daemon not running — `voice join` first"); return done(false); }
      appendFileSync(QUEUE, text + "\n");
      writeFileSync(QUEUE, text);   // single-line queue: latest wins, daemon clears it
      log(`🗣️ queued: ${text}`);
      return done(true);
    }
    case "status": {
      const pid = running();
      const engine = process.env.ELEVENLABS_API_KEY ? "ElevenLabs" : "macOS say (no ELEVENLABS_API_KEY)";
      log(pid ? `🟢 Cortex voice daemon running (pid ${pid}) — engine: ${engine}` : "⚪ daemon not running");
      return done(true);
    }
    case "leave": {
      const pid = running();
      if (!pid) { log("⚪ daemon not running"); return done(true); }
      try { process.kill(pid); } catch {}
      if (existsSync(PID)) unlinkSync(PID);
      log("👋 Cortex ออกจากห้อง voice แล้ว");
      return done(true);
    }
    default:
      log("maw cortex voice <join|say|status|leave>");
      return done(true);
  }
}
