import { createServer } from "node:http";

export type VoiceState = {
  joined: boolean;
  channelId: string | null;
  lastText: string | null;
  startedAt: string;
};

export const state: VoiceState = {
  joined: false,
  channelId: null,
  lastText: null,
  startedAt: new Date().toISOString(),
};

function json(res: any, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: any) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function createVoiceDaemon() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/status") return json(res, 200, { ok: true, state });
      if (req.method === "POST" && url.pathname === "/join") {
        const body = await readBody(req);
        if (!body.channelId) return json(res, 400, { ok: false, error: "channelId is required" });
        state.joined = true; state.channelId = String(body.channelId);
        return json(res, 200, { ok: true, action: "join", state });
      }
      if (req.method === "POST" && url.pathname === "/say") {
        const body = await readBody(req);
        if (!state.joined) return json(res, 409, { ok: false, error: "not joined" });
        if (!body.text) return json(res, 400, { ok: false, error: "text is required" });
        state.lastText = String(body.text);
        return json(res, 200, { ok: true, action: "say", dryRunTts: true, state });
      }
      if (req.method === "POST" && url.pathname === "/leave") {
        state.joined = false; state.channelId = null;
        return json(res, 200, { ok: true, action: "leave", state });
      }
      return json(res, 404, { ok: false, error: "not found" });
    } catch (error: any) {
      return json(res, 500, { ok: false, error: error.message });
    }
  });
}

if (import.meta.main) {
  const port = Number(process.env.ATOM_VOICE_PORT || 47812);
  createVoiceDaemon().listen(port, "127.0.0.1", () => {
    console.log(`Atom voice daemon listening on 127.0.0.1:${port}`);
  });
}
