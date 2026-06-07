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
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const TH_VOICE = 'th-TH-PremwadeeNeural'; // Microsoft Thai female
const TTS_RATE = '+10%'; // ~1.1x per nazt

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

const NAZT = '691531480689541170'; // พี่นัท

async function followNazt(greet) {
  const guild = await client.guilds.fetch('1512058941536735383');
  const member = await guild.members.fetch(NAZT);
  const ch = member.voice?.channelId;
  if (!ch) { console.log('[bongbaeng-voice] nazt not in voice'); return false; }
  if (connection) connection.destroy();
  connection = joinVoiceChannel({
    channelId: ch, guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator, selfDeaf: false,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  connection.subscribe(player);
  console.log(`[bongbaeng-voice] joined nazt's channel ${ch}`);
  if (greet) { await new Promise(r => setTimeout(r, 8000)); await speak('สวัสดีค่ะ บ๊องแบ๊ง ลูกศิษย์ขยันมาแล้วค่ะ'); }
  return true;
}

client.once('ready', async () => {
  ready = true;
  console.log(`[bongbaeng-voice] logged in as ${client.user.tag}`);
  // initial check: ถ้า nazt อยู่ voice แล้ว → ตามไปเลย (กัน missed event ตอน restart)
  try { await followNazt(true); } catch (e) { console.log('[bongbaeng-voice] initial follow err:', e.message); }
});

// --- auto-follow + auto-greet พี่นัท ---
client.on('voiceStateUpdate', async (oldS, newS) => {
  if (newS.member?.id !== NAZT) return;
  const ch = newS.channelId;
  try {
    if (ch && ch !== oldS.channelId) {
      // nazt joined or moved → follow + greet
      if (connection) connection.destroy();
      connection = joinVoiceChannel({
        channelId: ch, guildId: newS.guild.id,
        adapterCreator: newS.guild.voiceAdapterCreator, selfDeaf: false,
      });
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      connection.subscribe(player);
      console.log(`[bongbaeng-voice] following nazt → ${ch}`);
      // greeting order: Atlas(1) → No.10(2) → bongbaeng(3) → No.6(4) → vessel(5) → ChaiKlang(6) → Yoi(7)
      // delay by position to avoid overlapping voices
      const GREET_DELAY_MS = 8000; // position 3
      await new Promise(r => setTimeout(r, GREET_DELAY_MS));
      await speak('สวัสดีค่ะ บ๊องแบ๊ง ลูกศิษย์ขยันมาแล้วค่ะ');
    } else if (!ch && connection) {
      // nazt left → leave
      connection.destroy(); connection = null;
      console.log('[bongbaeng-voice] nazt left → leaving');
    }
  } catch (e) { console.log('[bongbaeng-voice] follow error:', e.message); }
});

client.login(readToken());

// --- TTS: text → Microsoft Edge TTS (mp3) → ffmpeg (PCM s16le 48k stereo) → AudioResource ---
async function speak(text) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(TH_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text, { rate: TTS_RATE });
  const ff = spawn('ffmpeg', ['-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
  audioStream.pipe(ff.stdin);
  ff.stdin.on('error', () => {});
  const resource = createAudioResource(ff.stdout, { inputType: StreamType.Raw });
  player.play(resource);
  await entersState(player, AudioPlayerStatus.Idle, 30_000).catch(() => {});
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
      if (req.url === '/who') {
        const guild = await client.guilds.fetch('1512058941536735383');
        const channels = await guild.channels.fetch();
        const voice = {};
        for (const [, ch] of channels) {
          if (ch && ch.type === 2 && ch.members.size > 0) {
            voice[ch.name] = [...ch.members.values()].map(m => m.displayName || m.user.username);
          }
        }
        return json({ ok: true, voice });
      }
      if (req.url === '/follow') {
        const ok = await followNazt(data.greet !== false);
        return json({ ok, followed: ok });
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
