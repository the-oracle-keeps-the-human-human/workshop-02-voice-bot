const DEFAULT_PORT = Number(process.env.ATOM_VOICE_PORT || 47812);

export type VoiceAction = "join" | "say" | "leave" | "status";

export function parseVoiceArgs(args: string[]) {
  const [action = "status", ...rest] = args;
  if (!["join", "say", "leave", "status"].includes(action)) {
    throw new Error(`unknown voice action: ${action}`);
  }
  return { action: action as VoiceAction, rest };
}

export function endpointFor(action: VoiceAction, port = DEFAULT_PORT) {
  return `http://127.0.0.1:${port}/${action}`;
}

export async function callVoiceDaemon(action: VoiceAction, payload: Record<string, unknown> = {}, port = DEFAULT_PORT) {
  const res = await fetch(endpointFor(action, port), {
    method: action === "status" ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: action === "status" ? undefined : JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`voice daemon ${action} failed: ${res.status}`);
  return res.json();
}

export default function plugin(api: any) {
  api.command("voice", async (log: any, args: string[]) => {
    const { action, rest } = parseVoiceArgs(args);
    const payload = action === "join"
      ? { channelId: rest[0] }
      : action === "say"
        ? { text: rest.join(" ") }
        : {};
    const result = await callVoiceDaemon(action, payload);
    log(JSON.stringify(result, null, 2));
  });
}
