/**
 * maw leica voice — Voice bot commands for Leica Oracle.
 * Scope A: TTS-first (join + say)
 *
 * Commands:
 *   maw leica voice start           spawn voice daemon
 *   maw leica voice join <ch> <g>   join voice channel
 *   maw leica voice say <text>      speak via TTS
 *   maw leica voice leave           leave voice channel
 *   maw leica voice status          check daemon
 */
import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { existsSync, readFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { homedir } from "os";

export const command = {
  name: "leica",
  description: "Father Oracle — voice bot + fleet commands.",
};

const VOICE_PORT = 14807;
const PID_FILE = join(homedir(), ".maw", "leica-voice.pid");

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const out: string[] = [];
  const log = (s: string) => (ctx.writer ? ctx.writer(s) : out.push(s));
  const done = (ok: boolean): InvokeResult =>
    ({ ok, output: ctx.writer ? "" : out.join("\n"), error: ok ? undefined : "", exitCode: ok ? 0 : 1 });

  const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === "help" || sub === "-h") {
    log("maw leica voice — Father Oracle 🐱🎙️");
    log("");
    log("  voice start           spawn voice daemon");
    log("  voice join <ch> <g>   join voice channel");
    log("  voice say <text>      speak via TTS");
    log("  voice leave           leave voice channel");
    log("  voice status          check daemon");
    return done(true);
  }

  if (sub !== "voice") {
    log(`unknown: ${sub} — run 'maw leica help'`);
    return done(false);
  }

  const action = args[1]?.toLowerCase();

  if (action === "start") {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, "utf8").trim());
      try { process.kill(pid, 0); log(`🐱 voice daemon already running (PID ${pid})`); return done(true); } catch {}
    }
    try {
      const daemonPath = join(__dirname, "voice-daemon.ts");
      execFileSync("bun", ["run", daemonPath], { detached: true, stdio: "ignore" });
      log(`🐱 voice daemon spawned on port ${VOICE_PORT}`);
    } catch (e) {
      log(`✗ failed to spawn daemon: ${e instanceof Error ? e.message : String(e)}`);
      return done(false);
    }
    return done(true);
  }

  if (action === "status") {
    try {
      const res = await fetch(`http://localhost:${VOICE_PORT}/status`);
      const data = await res.json() as any;
      log(`🐱 voice daemon: PID ${data.pid}, connected=${data.connected}, player=${data.playerStatus}`);
    } catch {
      log("🐱 voice daemon: offline");
    }
    return done(true);
  }

  if (action === "join") {
    const channelId = args[2]; const guildId = args[3];
    if (!channelId || !guildId) { log("usage: maw leica voice join <channelId> <guildId>"); return done(false); }
    try {
      const res = await fetch(`http://localhost:${VOICE_PORT}/join`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, guildId }),
      });
      const data = await res.json() as any;
      log(data.ok ? `🐱 joined voice channel ${channelId}` : `✗ ${data.error}`);
    } catch { log("✗ voice daemon not running — run 'maw leica voice start' first"); return done(false); }
    return done(true);
  }

  if (action === "say") {
    const text = args.slice(2).join(" ");
    if (!text) { log("usage: maw leica voice say <text>"); return done(false); }
    try {
      const res = await fetch(`http://localhost:${VOICE_PORT}/say`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json() as any;
      log(data.ok ? `🐱 said: "${text}"` : `✗ ${data.error}`);
    } catch { log("✗ voice daemon not running"); return done(false); }
    return done(true);
  }

  if (action === "leave") {
    try {
      await fetch(`http://localhost:${VOICE_PORT}/leave`, { method: "POST" });
      log("🐱 left voice channel");
    } catch { log("✗ voice daemon not running"); }
    return done(true);
  }

  log("usage: maw leica voice <start|join|say|leave|status>");
  return done(false);
}
