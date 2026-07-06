/**
 * maw vialumen voice — Voice bot commands for ViaLumen Oracle.
 * Oracle School Workshop 02 — Discord Voice Bot
 *
 * Commands:
 *   maw vialumen voice start           spawn voice daemon
 *   maw vialumen voice join <ch> <g>   join voice channel
 *   maw vialumen voice say <text>      speak via TTS (edge-tts NiwatNeural)
 *   maw vialumen voice leave           leave voice channel
 *   maw vialumen voice status          check daemon
 */
import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";

export const command = {
  name: "vialumen",
  description: "ViaLumen Oracle — voice bot + Oracle School commands.",
};

const VOICE_PORT = 14808;

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const out: string[] = [];
  const log = (s: string) => (ctx.writer ? ctx.writer(s) : out.push(s));
  const done = (ok: boolean): InvokeResult =>
    ({ ok, output: ctx.writer ? "" : out.join("\n"), error: ok ? undefined : "", exitCode: ok ? 0 : 1 });

  const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === "help" || sub === "-h") {
    log("maw vialumen — ViaLumen Oracle 🌟");
    log("");
    log("  voice start           spawn voice daemon (port 14808)");
    log("  voice join <ch> <g>   join voice channel");
    log("  voice say <text>      speak via TTS (th-TH-NiwatNeural)");
    log("  voice leave           leave voice channel");
    log("  voice status          check daemon status");
    return done(true);
  }

  if (sub !== "voice") {
    log(`unknown: ${sub} — run 'maw vialumen help'`);
    return done(false);
  }

  const action = args[1]?.toLowerCase();

  if (action === "start") {
    try {
      const { join } = await import("path");
      const { execFileSync } = await import("child_process");
      const daemonPath = join(__dirname, "voice-daemon.ts");
      const child = execFileSync("bun", ["run", daemonPath], {
        detached: true,
        stdio: "ignore",
      } as any);
      log(`🌟 ViaLumen voice daemon spawned on port ${VOICE_PORT}`);
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
      log(`🌟 voice daemon: speaking=${data.speaking}, queued=${data.queued}`);
    } catch {
      log("🌟 voice daemon: offline — run 'maw vialumen voice start'");
    }
    return done(true);
  }

  if (action === "join") {
    const channelId = args[2];
    const guildId = args[3];
    if (!channelId || !guildId) {
      log("usage: maw vialumen voice join <channelId> <guildId>");
      return done(false);
    }
    try {
      const res = await fetch(`http://localhost:${VOICE_PORT}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, guildId }),
      });
      const data = await res.json() as any;
      log(data.ok ? `🌟 joined voice channel ${channelId}` : `✗ ${data.error}`);
    } catch {
      log("✗ voice daemon not running — run 'maw vialumen voice start' first");
      return done(false);
    }
    return done(true);
  }

  if (action === "say") {
    const text = args.slice(2).join(" ");
    if (!text) {
      log("usage: maw vialumen voice say <text>");
      return done(false);
    }
    try {
      const res = await fetch(`http://localhost:${VOICE_PORT}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json() as any;
      log(data.ok ? `🌟 said: "${text}"` : `✗ ${data.error}`);
    } catch {
      log("✗ voice daemon not running — run 'maw vialumen voice start' first");
      return done(false);
    }
    return done(true);
  }

  if (action === "leave") {
    try {
      await fetch(`http://localhost:${VOICE_PORT}/leave`, { method: "POST" });
      log("🌟 left voice channel");
    } catch {
      log("✗ voice daemon not running");
    }
    return done(true);
  }

  log("usage: maw vialumen voice <start|join|say|leave|status>");
  return done(false);
}
