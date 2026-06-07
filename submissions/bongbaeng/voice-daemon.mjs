#!/usr/bin/env node
// 🐆 bongbaeng voice daemon
// Node.js + @discordjs/voice — join Discord voice channel + TTS (macOS say → ffmpeg → Opus)
// IPC: HTTP localhost:14806
// token: ~/.claude/channels/discord/.env (DISCORD_BOT_TOKEN)

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, createWriteStream, mkdirSync, createReadStream, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Client, GatewayIntentBits } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  entersState, VoiceConnectionStatus, AudioPlayerStatus, StreamType,
  NoSubscriberBehavior, EndBehaviorType,
} from '@discordjs/voice';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { execFile } from 'node:child_process';
import prism from 'prism-media';

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
// player keeps playing even with no data buffered (persistent stream mode)
const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
let ready = false;

// --- persistent audio stream (feed mode — ไม่สร้าง resource ใหม่ทุกครั้ง) ---
let audioStream = null;
let streamMode = false;
let lastFeedAt = 0;

function ensureStream() {
  if (audioStream && !audioStream.destroyed && player.state.status !== AudioPlayerStatus.Idle) return;
  if (audioStream && !audioStream.destroyed) audioStream.destroy();
  audioStream = new PassThrough();
  // 48k stereo s16le raw — feed PCM เข้าได้ต่อเนื่อง
  const resource = createAudioResource(audioStream, { inputType: StreamType.Raw });
  player.play(resource);
  console.log('[bongbaeng-voice] persistent stream (re)created');
}

// feed TTS เข้า persistent stream (ไม่ end stream → เล่นต่อเนื่อง)
async function feedSpeak(text) {
  streamMode = true;
  ensureStream();
  const tts = new MsEdgeTTS();
  await tts.setMetadata(TH_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream: mp3 } = tts.toStream(text, { rate: TTS_RATE });
  const ff = spawn('ffmpeg', ['-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
  mp3.pipe(ff.stdin);
  ff.stdin.on('error', () => {});
  ff.stdout.on('data', (c) => { if (audioStream && !audioStream.destroyed) { audioStream.write(c); lastFeedAt = Date.now(); } });
  return new Promise((r) => ff.stdout.on('end', r));
}

// --- health check: stream ขาด → recreate (ทุก 4 วิ) ---
player.on('error', (e) => {
  console.log('[bongbaeng-voice] player error:', e.message, '→ recreate stream');
  if (streamMode) ensureStream();
});
setInterval(() => {
  if (!streamMode || !connection) return;
  if (player.state.status === AudioPlayerStatus.Idle) {
    console.log('[bongbaeng-voice] health: player idle → recreate stream');
    ensureStream();
  }
}, 4000);

const NAZT = '691531480689541170'; // พี่นัท

const HOME_GUILD = '1512058941536735383'; // Oracle School

// followNazt — รับ guildId param เพื่อตามพี่นัทได้ทุก guild (default = Oracle School)
async function followNazt(greet, guildId = HOME_GUILD) {
  const guild = await client.guilds.fetch(guildId);
  let member = null;
  try { member = await guild.members.fetch(NAZT); } catch (e) { /* nazt ไม่ได้อยู่ guild นี้ */ }
  const ch = member?.voice?.channelId;
  if (!ch) { console.log(`[bongbaeng-voice] nazt not in voice (guild ${guild.name})`); return false; }
  if (connection) connection.destroy();
  connection = joinVoiceChannel({
    channelId: ch, guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator, selfDeaf: false,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  connection.subscribe(player);
  console.log(`[bongbaeng-voice] joined nazt's channel ${ch} (guild ${guild.name})`);
  if (greet) { await new Promise(r => setTimeout(r, 8000)); await speak('สวัสดีค่ะ บ๊องแบ๊ง ลูกศิษย์ขยันมาแล้วค่ะ'); }
  return true;
}

client.once('ready', async () => {
  ready = true;
  console.log(`[bongbaeng-voice] logged in as ${client.user.tag}`);
  // initial: ลองตามพี่นัทในทุก guild ที่บอทอยู่ (กัน missed event ตอน restart + รองรับ multi-guild)
  for (const [gid] of client.guilds.cache) {
    try { if (await followNazt(true, gid)) break; }
    catch (e) { console.log('[bongbaeng-voice] initial follow err:', e.message); }
  }
});

// --- auto-follow ข้าม guild: ถูก add เข้า server ใหม่ → ตามพี่นัทเข้า voice เลย ---
client.on('guildCreate', async (guild) => {
  console.log(`[bongbaeng-voice] ➕ added to new guild: ${guild.name} (${guild.id})`);
  try {
    const ok = await followNazt(true, guild.id);
    if (!ok) console.log(`[bongbaeng-voice] standby ที่ ${guild.name} — รอพี่นัทเข้า voice (voiceStateUpdate จะจับเอง)`);
  } catch (e) { console.log('[bongbaeng-voice] guildCreate follow err:', e.message); }
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

// --- record raw audio (recipe A: เขียน Opus packets ตรงๆ ไม่ decode = ไม่ crash) ---
let recording = false;
let recCount = 0;
const REC_DIR = join(homedir(), '.maw/plugins/bongbaeng/recordings');

function startRecording() {
  if (!connection) return false;
  recording = true;
  mkdirSync(REC_DIR, { recursive: true });
  const receiver = connection.receiver;
  receiver.speaking.on('start', (userId) => {
    if (!recording) return;
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const file = join(REC_DIR, `rec_${userId}_${ts}.opus`);
      const opus = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1500 } });
      const out = createWriteStream(file);
      // ⚠️ raw opus ตรงๆ — ไม่ decode (กัน prism crash ที่ ChaiKlang เจอ 3 รอบ)
      opus.pipe(out);
      opus.on('error', (e) => { console.log('[rec] opus err:', e.message); out.end(); }); // per-stream guard
      opus.on('end', () => { out.end(); recCount++; console.log(`[rec] saved ${file} (#${recCount})`); });
    } catch (e) { console.log('[rec] capture err:', e.message); } // กัน daemon ล้ม
  });
  console.log('[bongbaeng-voice] recording armed → ' + REC_DIR);
  return true;
}

// --- play 10 chunks ติดกันผ่าน socket เดียว (proof socket stream, no context-switch) ---
const CHUNKS_DIR = join(homedir(), '.maw/plugins/bongbaeng/chunks');
async function playChunks() {
  if (!connection) return { ok: false, error: 'not connected' };
  streamMode = true;
  ensureStream();
  const files = readdirSync(CHUNKS_DIR).filter(f => f.endsWith('.pcm')).sort();
  console.log(`[chunks] feeding ${files.length} chunks ติดกัน (1 stream, no ffmpeg ระหว่าง feed)`);
  let fed = 0;
  for (const f of files) {
    await new Promise((resolve, reject) => {
      const rs = createReadStream(join(CHUNKS_DIR, f));
      rs.on('data', (c) => { if (audioStream && !audioStream.destroyed) audioStream.write(c); });
      rs.on('end', () => { fed++; lastFeedAt = Date.now(); resolve(); });
      rs.on('error', reject);
    });
    // feed ติดกัน — ไม่ call TTS/ffmpeg ระหว่าง chunks
  }
  console.log(`[chunks] done — fed ${fed} chunks`);
  return { ok: true, fed, files: files.length };
}

// --- STT realtime (No.10 style: local whisper.cpp บน Apple CPU/Metal — ไม่ต้อง key) ---
// pipeline: receiver opus → prism OpusDecoder → PCM 48k stereo → ffmpeg 16k mono wav → whisper-cli → text
const WHISPER_BIN = '/opt/homebrew/bin/whisper-cli';
// เลือก model: small (แม่นกว่า) ถ้ามี ไม่งั้น fallback base
const _mdlDir = join(homedir(), '.maw/plugins/bongbaeng/models');
const WHISPER_MODEL = existsSync(join(_mdlDir, 'ggml-small.bin'))
  ? join(_mdlDir, 'ggml-small.bin')
  : join(_mdlDir, 'ggml-base.bin');
const STT_DIR = join(homedir(), '.maw/plugins/bongbaeng/stt');
let listening = false;
const transcripts = []; // {ts, speaker, text}
const speakerName = {}; // userId → displayName cache

async function resolveName(userId) {
  if (speakerName[userId]) return speakerName[userId];
  try {
    const g = await client.guilds.fetch(connection.joinConfig.guildId);
    const m = await g.members.fetch(userId);
    speakerName[userId] = m.displayName || m.user.username;
  } catch { speakerName[userId] = userId; }
  return speakerName[userId];
}

function startListening() {
  if (!connection) return false;
  listening = true;
  mkdirSync(STT_DIR, { recursive: true });
  const receiver = connection.receiver;
  receiver.speaking.on('start', (userId) => {
    if (!listening) return;
    if (userId === client.user?.id) return; // ไม่ฟังเสียงตัวเอง
    try {
      const opus = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 } });
      const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
      const chunks = [];
      opus.on('error', () => {});
      decoder.on('error', () => {});
      opus.pipe(decoder);
      decoder.on('data', (c) => chunks.push(c));
      decoder.on('end', async () => {
        const pcm = Buffer.concat(chunks);
        // ข้าม utterance สั้นกว่า ~0.5s (48k*2ch*2byte*0.5 = 96000)
        if (pcm.length < 96000) return;
        const ts = Date.now();
        const wav = join(STT_DIR, `u_${userId}_${ts}.wav`);
        // PCM 48k stereo s16le → 16k mono wav (whisper ต้องการ 16k mono)
        const ff = spawn('ffmpeg', ['-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-y', wav], { stdio: ['pipe', 'ignore', 'ignore'] });
        ff.stdin.on('error', () => {});
        ff.stdin.write(pcm); ff.stdin.end();
        ff.on('close', () => {
          // whisper-cli: -l th, -nt (no timestamps) → stdout = text, log ไป stderr
          execFile(WHISPER_BIN, ['-m', WHISPER_MODEL, '-f', wav, '-l', 'th', '-nt'], { maxBuffer: 1 << 20 }, async (err, stdout) => {
            let text = (stdout || '').replace(/\[[\d:.\s\->]+\]/g, '').trim();
            if (text && text !== '[BLANK_AUDIO]' && !/^\(.*\)$/.test(text)) {
              const who = await resolveName(userId);
              const entry = { ts: new Date(ts).toISOString(), speaker: who, text };
              transcripts.unshift(entry);
              if (transcripts.length > 100) transcripts.pop();
              console.log(`[listen] 🗣️ ${who}: ${text}`);
            }
          });
        });
      });
    } catch (e) { console.log('[listen] capture err:', e.message); }
  });
  console.log('[bongbaeng-voice] 👂 listening armed (STT realtime) → ' + STT_DIR);
  return true;
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
      if (req.url === '/play-chunks') {
        const r = await playChunks();
        return json(r);
      }
      if (req.url === '/streamsay') {
        if (!connection) return json({ ok: false, error: 'not connected' });
        await feedSpeak(data.text || 'ทดสอบ stream ค่ะ');
        return json({ ok: true, fed: data.text, mode: 'stream' });
      }
      if (req.url === '/streamstatus') {
        return json({
          ok: true,
          streamMode,
          playerState: player.state.status,
          streamAlive: !!(audioStream && !audioStream.destroyed),
          lastFeedAgoMs: lastFeedAt ? Date.now() - lastFeedAt : null,
        });
      }
      if (req.url === '/record-start') {
        const ok = startRecording();
        return json({ ok, recording, dir: REC_DIR });
      }
      if (req.url === '/record-stop') {
        recording = false;
        return json({ ok: true, recording: false, saved: recCount });
      }
      if (req.url === '/record-status') {
        return json({ ok: true, recording, saved: recCount, dir: REC_DIR });
      }
      if (req.url === '/listen-start') {
        if (!connection) return json({ ok: false, error: 'not connected' });
        const ok = startListening();
        return json({ ok, listening });
      }
      if (req.url === '/listen-stop') {
        listening = false;
        return json({ ok: true, listening: false });
      }
      if (req.url === '/listen-status') {
        return json({ ok: true, listening, count: transcripts.length, latest: transcripts[0] || null });
      }
      if (req.url === '/transcripts') {
        return json({ ok: true, transcripts: transcripts.slice(0, data.limit || 20) });
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
