/**
 * maw tinky voice — Workshop 02 (Thai-TTS voice bot).
 *
 * A maw command is one-shot; a voice connection must stay alive. So this
 * one-shot command DRIVES the persistent `voice-daemon.ts` over its local
 * HTTP control surface (default :8477). The daemon owns the single Discord
 * client + voice gateway (one token == one gateway — Trap #6).
 *
 *   maw tinky voice start              spawn the persistent voice-daemon
 *   maw tinky voice join <channelId>   join a voice channel (guild from env)
 *   maw tinky voice say "<text>"       speak Thai text via edge-tts → ffmpeg
 *   maw tinky voice status             daemon + connection state
 *   maw tinky voice leave              disconnect from voice
 *
 * Env (never hard-code secrets — Golden Rule):
 *   DISCORD_TOKEN       bot token (required for join/say)
 *   DISCORD_GUILD_ID    guild the bot operates in
 *   VOICE_DAEMON_PORT   HTTP control port (default 8477)
 *
 * Author: Tinky Oracle (she/her, ประกายน้อย ✨)  [ubuntu-dev-one:tinky]
 * AI, not a human (Rule 6).
 */
import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.VOICE_DAEMON_PORT ?? 8477);
const BASE = `http://localhost:${PORT}`;

export const command = {
  name: "tinky",
  description: "Tinky voice bot — join a Discord voice channel and speak Thai (Workshop 02).",
};

async function daemonGet(path: string): Promise<any | null> {
  try {
    const res = await fetch(`${BASE}${path}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function daemonPost(path: string, body: unknown): Promise<any | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return null;
  }
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const out: string[] = [];
  const log = (s: string) => (ctx.writer ? ctx.writer(s) : out.push(s));
  const done = (ok: boolean): InvokeResult => ({
    ok,
    output: ctx.writer ? "" : out.join("\n"),
    exitCode: ok ? 0 : 1,
  });

  const args = ctx.source === "cli" ? (ctx.args as string[]) : [];

  if (args[0] !== "voice") {
    log("maw tinky voice <start|join|say|status|leave> ✨");
    return done(true);
  }

  const sub = args[1];

  switch (sub) {
    case "start": {
      const status = await daemonGet("/status");
      if (status?.ok) {
        log("🟢 voice daemon ออนไลน์อยู่แล้ว — `voice join` ได้เลย");
        return done(true);
      }
      if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_GUILD_ID) {
        log("✗ ต้องตั้ง DISCORD_TOKEN และ DISCORD_GUILD_ID ก่อน (อย่า commit token!)");
        return done(false);
      }
      const child = spawn("bun", ["run", join(HERE, "voice-daemon.ts")], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.unref();
      log(`🎙️ ทิงกี้ปลุก voice daemon ขึ้นที่ :${PORT} (pid ${child.pid}) ✨`);
      return done(true);
    }

    case "join": {
      const channelId = args[2];
      if (!channelId) {
        log('usage: maw tinky voice join <channelId>');
        return done(false);
      }
      const r = await daemonPost("/join", { channelId });
      if (!r) {
        log("✗ daemon ไม่ตอบ — `maw tinky voice start` ก่อน");
        return done(false);
      }
      log(r.ok ? `🎙️ ทิงกี้เข้าห้อง voice ${channelId} แล้ว ✨` : `✗ ${r.error}`);
      return done(!!r.ok);
    }

    case "say": {
      const text = args.slice(2).join(" ").trim();
      if (!text) {
        log('usage: maw tinky voice say "<ข้อความ>"');
        return done(false);
      }
      const r = await daemonPost("/say", { text });
      if (!r) {
        log("✗ daemon ไม่ตอบ — `maw tinky voice start` ก่อน");
        return done(false);
      }
      log(r.ok ? `🗣️ ทิงกี้พูดว่า: ${text}` : `✗ ${r.error}`);
      return done(!!r.ok);
    }

    case "status": {
      const r = await daemonGet("/status");
      if (!r) {
        log("⚪ voice daemon ไม่ได้รัน");
        return done(true);
      }
      log(
        `🟢 daemon online · loggedIn=${r.loggedIn} · conn=${r.connectionState} · player=${r.playerState} · voice=${r.ttsVoice}`
      );
      return done(true);
    }

    case "leave": {
      const r = await daemonPost("/leave", {});
      log(r?.ok ? "👋 ทิงกี้ออกจากห้อง voice แล้ว" : "⚪ ไม่มี daemon ให้สั่งออก");
      return done(true);
    }

    default:
      log("maw tinky voice <start|join|say|status|leave> ✨");
      return done(true);
  }
}
