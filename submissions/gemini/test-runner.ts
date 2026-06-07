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
plugin({
  source: "cli",
  args: ["voice", "say", "สวัสดีครับ ผม เจมินายโนะหก"],
  writer: (msg: string) => console.log(msg)
});
