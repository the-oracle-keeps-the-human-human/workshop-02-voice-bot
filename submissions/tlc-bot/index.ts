import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const VOICE_PORT = 18790;
const PID_FILE = join(homedir(), ".maw", "tlc-voice.pid");

export default function (api: any) {
  // Existing commands
  api.command("say", async (log: any, args: string[]) => {
    const name = args[0] || "Human";
    log(`🐾 ตัวเล็ก Oracle: สวัสดีค่ะคุณ ${name}!`);
    log(`   ย่องเบาในระบบ จับจ้องทุกปัญหา ตะปบทุกเป้าหมายได้อย่างแม่นยำ`);
  });

  api.command("status", async (log: any) => {
    log(`🐾 ตัวเล็ก Oracle — The Curious Feline`);
    log(`   role:   Personal Assistant & System Guardian`);
    log(`   human:  Axe (axeziiezakk)`);
    log(`   model:  Gemini 3 Flash (2026.3.13)`);
    log(`   note:   Strictly no emojis for master communication.`);
  });

  api.command("humans", async (log: any, args: string[]) => {
    const HUMANS = [
      { name: "ก้อง", github: "twentyfxurth-k", oracle: "bongbaeng" },
      { name: "พี่นัท", github: "nazt_", oracle: "Yoi-Oracle" },
      { name: "Kong", github: "496340235374821386", oracle: "Orz" },
      { name: "Wave", github: "wvweeratouch", oracle: "Vessel" },
      { name: "Un", github: "switchaphon", oracle: "Leica" },
      { name: "ต่อ", github: "tordope", oracle: "SomTor" },
      { name: "พลีม", github: "pleamnm", oracle: "Tinky" },
      { name: "Namhom", github: "nhacry", oracle: "Gon" },
      { name: "แมท", github: "mathm_thm", oracle: "Maxus" },
      { name: "Master J", github: "papajinna", oracle: "ViaLumen" },
      { name: "Axe", github: "axeziiezakk", oracle: "TLC-Bot" },
      { name: "Bo", github: "borde9902", oracle: "No.6" },
      { name: "BM", github: "Yutthakit", oracle: "ChaiKlang" }
    ];

    const filter = args[0]?.toLowerCase();
    const results = filter 
      ? HUMANS.filter(h => h.name.toLowerCase().includes(filter) || h.oracle.toLowerCase().includes(filter))
      : HUMANS;

    log(`🐾 ตัวเล็ก Oracle — Human Directory (${results.length}/${HUMANS.length})`);
    log(`─`.repeat(50));
    results.forEach(h => {
      log(`  ${h.name.padEnd(10)} @${h.github.padEnd(20)} → ${h.oracle}`);
    });
  });

  // New Workshop 02 Voice commands
  api.command("voice", async (log: any, args: string[]) => {
    const action = args[0]?.toLowerCase();

    if (action === "start") {
      if (existsSync(PID_FILE)) {
        log(`🐾 voice daemon already running`);
        return;
      }
      try {
        const daemonPath = join(__dirname, "voice-daemon.ts");
        const proc = Bun.spawn(["bun", "run", daemonPath], { detached: true, stdio: "ignore" });
        proc.unref();
        log(`🐾 voice daemon spawned on port ${VOICE_PORT}`);
      } catch (e: any) {
        log(`✗ failed to spawn daemon: ${e.message}`);
      }
      return;
    }

    if (action === "join") {
      const channelId = args[1];
      const guildId = args[2];
      if (!channelId || !guildId) {
        log("usage: maw tlc voice join <channelId> <guildId>");
        return;
      }
      try {
        const res = await fetch(`http://localhost:${VOICE_PORT}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId, guildId }),
        });
        const data = await res.json() as any;
        log(data.ok ? `🐾 joined voice channel ${channelId}` : `✗ ${data.error}`);
      } catch {
        log("✗ voice daemon not running — run 'maw tlc voice start' first");
      }
      return;
    }

    if (action === "say") {
      const text = args.slice(1).join(" ");
      if (!text) {
        log("usage: maw tlc voice say <text>");
        return;
      }
      try {
        const res = await fetch(`http://localhost:${VOICE_PORT}/say`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await res.json() as any;
        log(data.ok ? `🐾 said: "${text}"` : `✗ ${data.error}`);
      } catch {
        log("✗ voice daemon not running");
      }
      return;
    }

    if (action === "status") {
      try {
        const res = await fetch(`http://localhost:${VOICE_PORT}/status`);
        const data = await res.json() as any;
        log(`🐾 voice daemon: connected=${data.connected}, channel=${data.channelId}`);
      } catch {
        log("🐾 voice daemon: offline");
      }
      return;
    }

    if (action === "leave") {
      try {
        await fetch(`http://localhost:${VOICE_PORT}/leave`, { method: "POST" });
        log("🐾 left voice channel");
      } catch {
        log("✗ voice daemon not running");
      }
      return;
    }

    log("usage: maw tlc voice <start|join|say|leave|status>");
  });
}
