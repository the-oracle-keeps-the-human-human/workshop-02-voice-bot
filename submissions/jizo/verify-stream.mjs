#!/usr/bin/env node
// Jizo — stream self-test (adapted from a fleet peer's stream-verify pattern).
// The discipline I was missing: PROVE the stream is byte-exact + well-formed on a local
// loopback BEFORE claiming it works live in Discord (eyeballing "playing" for 20s is not proof).
//
//   node verify-stream.mjs <file.pcm>
//
// Checks:
//   1. format: ffprobe confirms s16le 48kHz stereo (what @discordjs/voice StreamType.Raw wants)
//   2. byte-exact: serve the PCM over a loopback socket, drain it back, assert received == file size
//   3. duration: report seconds (bytes / (48000*2*2)) so you know the FULL playback length to expect
import net from "node:net";
import { createReadStream, createWriteStream, statSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node verify-stream.mjs <file.pcm>"); process.exit(1); }
const SIZE = statSync(file).size;
const seconds = SIZE / (48000 * 2 * 2); // s16le 48k stereo = 192000 bytes/s

// 1. format note: raw s16le PCM is HEADERLESS — there's nothing for ffprobe to introspect;
// the format is guaranteed by how the file was produced (ffmpeg -f s16le -ar 48000 -ac 2).
// What we CAN check meaningfully: the byte count divides evenly into whole stereo frames.
const FRAME = 2 * 2; // 16-bit × 2 channels = 4 bytes/sample-frame
const frameAligned = SIZE % FRAME === 0;
const fmt = `s16le 48kHz stereo (by construction; headerless) — frame-aligned: ${frameAligned ? "yes ✓" : "NO ✗ (truncated?)"}`;

// 2. byte-exact loopback round-trip
const srv = net.createServer((sock) => { createReadStream(file).pipe(sock); });
srv.listen(0, () => {
  const cli = net.createConnection(srv.address().port, "127.0.0.1");
  const sink = createWriteStream("/dev/null");
  let got = 0;
  cli.on("data", (b) => { got += b.length; });
  cli.pipe(sink);
  cli.on("end", () => {
    const ok = got === SIZE;
    console.log(`file       : ${file}`);
    console.log(`format     : ${fmt}`);
    console.log(`bytes      : received ${got} / expected ${SIZE} — ${ok ? "MATCH ✓" : "MISMATCH ✗"}`);
    console.log(`duration   : ${seconds.toFixed(1)}s  ← the FULL playthrough to verify live (don't claim done before this elapses)`);
    srv.close();
    process.exit(ok ? 0 : 1);
  });
});
