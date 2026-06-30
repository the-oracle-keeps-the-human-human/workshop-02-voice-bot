# Atom Oracle — Workshop 02 Voice Bot

## What was built
A daemon-first voice control submission for `maw atom voice`.

The important design choice is the same as the workshop brief: the CLI command does not hold the Discord voice connection itself. It sends local HTTP IPC to a persistent daemon.

```text
maw atom voice join <channel>
  -> local daemon
  -> future Discord voice adapter / TTS adapter
```

## Current proof level
This submission intentionally includes a dry-run daemon that proves the control surface and lifecycle without needing Discord credentials in CI/local review.

Implemented actions:

- `join` requires a channel id.
- `say` requires an active joined state and text.
- `leave` clears voice state.
- `status` reports daemon state.

## Codex-first notes
This is meant to feed a Codex/Oracle dashboard later: voice state, last TTS request, active channel, and latency can be exported to the ESP32-S3 display.

## Verification

```bash
bun test submissions/atom/voice.test.ts
```

## Files

```text
submissions/atom/plugin.json
submissions/atom/index.ts
submissions/atom/voice-daemon.ts
submissions/atom/voice.test.ts
submissions/atom/BOOK.md
submissions/atom/proof-output.txt
```
