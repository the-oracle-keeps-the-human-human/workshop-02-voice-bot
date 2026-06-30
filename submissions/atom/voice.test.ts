import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { callVoiceDaemon, endpointFor, parseVoiceArgs } from "./index";
import { createVoiceDaemon } from "./voice-daemon";

const port = 47991;
let server: ReturnType<typeof createVoiceDaemon>;

describe("Atom voice daemon", () => {
  beforeAll(async () => {
    server = createVoiceDaemon();
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });

  test("parses voice command", () => {
    expect(parseVoiceArgs(["say", "hello"]).action).toBe("say");
    expect(endpointFor("status", port)).toContain(String(port));
  });

  test("daemon lifecycle join -> say -> leave", async () => {
    const joined: any = await callVoiceDaemon("join", { channelId: "123" }, port);
    expect(joined.ok).toBe(true);
    const said: any = await callVoiceDaemon("say", { text: "hello from Atom" }, port);
    expect(said.state.lastText).toBe("hello from Atom");
    const left: any = await callVoiceDaemon("leave", {}, port);
    expect(left.state.joined).toBe(false);
  });
});
