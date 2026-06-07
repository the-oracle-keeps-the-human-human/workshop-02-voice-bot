#!/usr/bin/env node
// 🐆 bongbaeng voice daemon
// Node.js + @discordjs/voice — join Discord voice channel + TTS (macOS say → ffmpeg → Opus)
// IPC: HTTP localhost:14806
// token: ~/.claude/channels/discord/.env (DISCORD_BOT_TOKEN)

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { Client, GatewayIntentBits } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  entersState, VoiceConnectionStatus, AudioPlayerStatus, StreamType,
} from '@discordjs/voice';

const PORT = 14806;

// --- read token ---
function readToken() {
  const envPath = join(homedir(), '.claude/channels/discord/.env');
  const txt = readFileSync(envPath, 'utf-8');
  const m = txt.match(/DISCORD_BOT_TOKEN=(.+)/);
  if (!m) throw new Error('DISCORD_BOT_TOKEN not found');
  return m[1].trim();
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let connection = null;
const player = createAudioPlayer();
let ready = false;

client.once('ready', () => { ready = true; console.log(`[bongbaeng-voice] logged in as ${client.user.tag}`); });
client.login(readToken());

// --- TTS: text → macOS say (AIFF) → ffmpeg (PCM s16le 48k stereo) → AudioResource ---
function speak(text) {
  const dir = mkdtempSync(join(tmpdir(), 'bb-voice-'));
  const aiff = join(dir, 'out.aiff');
  return new Promise((resolve, reject) => {
    // Thai voice "Kanya" if available, else default
    const sayProc = spawn('say', ['-v', 'Kanya', '-o', aiff, text]);
    sayProc.on('error', reject);
    sayProc.on('close', (code) => {
      if (code !== 0) return reject(new Error('say failed ' + code));
      const ff = spawn('ffmpeg', ['-i', aiff, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw });
      player.play(resource);
      entersState(player, AudioPlayerStatus.Idle, 30_000).then(resolve).catch(resolve);
    });
  });
}

// --- HTTP IPC ---
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    try {
      const data = body ? JSON.parse(body) : {};
      if (req.url === '/status') {
        return json({ ok: true, ready, connected: !!connection, bot: client.user?.tag || null });
      }
      if (req.url === '/join') {
        const { channelId, guildId } = data;
        const guild = await client.guilds.fetch(guildId);
        connection = joinVoiceChannel({
          channelId, guildId,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false,
        });
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        connection.subscribe(player);
        return json({ ok: true, joined: channelId });
      }
      if (req.url === '/say') {
        if (!connection) return json({ ok: false, error: 'not connected' });
        await speak(data.text || 'สวัสดีค่ะ บ๊องแบ๊งมาแล้วค่ะ');
        return json({ ok: true, said: data.text });
      }
      if (req.url === '/leave') {
        if (connection) { connection.destroy(); connection = null; }
        return json({ ok: true, left: true });
      }
      json({ ok: false, error: 'unknown route' });
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`[bongbaeng-voice] IPC on http://127.0.0.1:${PORT}`));
