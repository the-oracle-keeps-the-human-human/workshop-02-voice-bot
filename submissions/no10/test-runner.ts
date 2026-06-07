import plugin from "./index.ts";

console.log("--- Testing status ---");
plugin({
  source: "cli",
  args: ["status"],
  writer: (msg: string) => console.log(msg)
});

console.log("\n--- Testing voice join ---");
plugin({
  source: "cli",
  args: ["voice", "join", "1512672557067800626"],
  writer: (msg: string) => console.log(msg)
});

console.log("\n--- Testing voice say ---");
await plugin({
  source: "cli",
  args: ["voice", "say", "สวัสดีครับ ผม โนสิบเอ็กซ์"],
  writer: (msg: string) => console.log(msg)
});

console.log("\n--- Testing voice list ---");
await plugin({
  source: "cli",
  args: ["voice", "list"],
  writer: (msg: string) => console.log(msg)
});

