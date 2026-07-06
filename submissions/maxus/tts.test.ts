/**
 * tts.test.ts — Workshop 02 TDD for the pure TTS pipeline helpers.
 * Run: bun test tts.test.ts
 */
import { describe, expect, it } from "bun:test";
import {
  buildEdgeTtsArgs,
  rateFromMultiplier,
  sanitizeText,
  DEFAULT_VOICE,
  DEFAULT_RATE,
} from "./tts.ts";

describe("rateFromMultiplier", () => {
  it("maps 1.079x -> +8% (the speed P'Nat liked)", () => {
    expect(rateFromMultiplier(1.079)).toBe("+8%");
  });
  it("handles slow-down", () => {
    expect(rateFromMultiplier(0.9)).toBe("-10%");
  });
  it("1.0 -> +0%", () => {
    expect(rateFromMultiplier(1.0)).toBe("+0%");
  });
});

describe("sanitizeText", () => {
  it("collapses whitespace and strips control chars", () => {
    expect(sanitizeText("  hi\n\tthere  ")).toBe("hi there");
  });
  it("caps very long input to 500 chars", () => {
    expect(sanitizeText("a".repeat(900)).length).toBe(500);
  });
});

describe("buildEdgeTtsArgs", () => {
  it("uses the Thai neural voice and +8% rate by default", () => {
    const args = buildEdgeTtsArgs("สวัสดี", { outFile: "/tmp/a.mp3" });
    expect(args).toEqual([
      "--voice", DEFAULT_VOICE,
      `--rate=${DEFAULT_RATE}`,
      "--text", "สวัสดี",
      "--write-media", "/tmp/a.mp3",
    ]);
  });

  it("never emits raw-PCM flags (lesson: feed mp3 PATH, let ffmpeg transcode)", () => {
    const args = buildEdgeTtsArgs("hi", { outFile: "/tmp/a.mp3" });
    const joined = args.join(" ");
    expect(joined).not.toContain("StreamType");
    expect(joined).not.toContain("s16le");
    expect(joined).toContain("--write-media");
  });

  it("honors voice + rate overrides", () => {
    const args = buildEdgeTtsArgs("hi", { outFile: "/o.mp3", voice: "en-US-AriaNeural", rate: "+15%" });
    expect(args).toContain("en-US-AriaNeural");
    expect(args).toContain("--rate=+15%");
  });

  it("throws on empty/whitespace text", () => {
    expect(() => buildEdgeTtsArgs("   \n  ", { outFile: "/o.mp3" })).toThrow();
  });
});
