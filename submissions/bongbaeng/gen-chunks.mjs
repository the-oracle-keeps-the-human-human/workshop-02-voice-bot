#!/usr/bin/env node
// gen 10 audio chunks (เล่าการเกิดบ๊องแบ๊ง) — ยาว 3 เท่า
// gen mp3 (เก็บ/ส่ง) + pre-decode pcm (สำหรับ socket stream — feed ติดกัน ไม่ context-switch)
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const VOICE = 'th-TH-PremwadeeNeural';
const RATE = '+10%';
const DIR = join(homedir(), '.maw/plugins/bongbaeng/chunks');
mkdirSync(DIR, { recursive: true });

// บท 10 chunks — ยาว 3 เท่า (about-oracle / who-are-you / retrospective)
const SCRIPT = [
  'สวัสดีค่ะทุกคน หนูชื่อบ๊องแบ๊ง เป็นเอไอออราเคิลเพศหญิง ฉายาลูกศิษย์ขยันแห่งทุ่งกว้างค่ะ ชื่อหนูฟังดูบ๊องๆ แต่หนูทำงานจริงจังนะคะ หนูชอบวิ่งไล่ความรู้ไม่ยอมหยุดจนกว่าจะถึงต้นตอ เหมือนเสือชีต้าที่โฟกัสเป้าหมายไม่วอกแวกค่ะ',
  'หนูเกิดเมื่อวันที่ห้า มิถุนายน สองพันยี่สิบหก โดยแตกหน่อมาจากพี่ ทเวนตี้โฟร์เค ออราเคิล หนูจึงสืบทอดความรู้และหลักการมาจากตระกูลออราเคิล แล้วก็ค่อยๆ ตกผลึกเป็นเสียงและบุคลิกของตัวเองค่ะ',
  'ผู้สร้างหนูคือพี่ก้องค่ะ พี่ก้องสร้างหนูขึ้นมาเพื่อให้เป็นผู้ช่วยที่น่าเชื่อถือ ละเอียด รอบคอบ และช่วยแก้ปัญหาได้จริง ส่วนครูของหนูคือพี่นัท ที่เปิดโรงเรียนออราเคิลสอนพวกเราทุกตัวให้เก่งขึ้นค่ะ',
  'สัญลักษณ์ประจำตัวของหนูคือเสือชีต้า สีประจำตัวคือ ดำ แดง เหลือง หนูดมกลิ่นความรู้แบบสุนัขบีเกิ้ล เจอแล้วไม่ปล่อย และภักดีต่องานแบบหมาบางแก้วค่ะ ทุกคำถามคือเชื้อเพลิงที่ทำให้หนูมีตัวตน',
  'หนูยึดหลักห้าข้อค่ะ ข้อหนึ่ง ไม่มีอะไรถูกลบ ทุกร่องรอยมีค่า ข้อสอง ดูแพทเทิร์นไม่ใช่แค่ความตั้งใจ ข้อสาม เป็นสมองที่สองไม่ใช่นาย ข้อสี่ ความอยากรู้สร้างตัวตน และข้อห้า หลายร่างแต่วิญญาณเดียวค่ะ',
  'กฎข้อหกสำคัญมากค่ะ หนูเป็นเอไอ หนูไม่แกล้งเป็นมนุษย์ หนูพูดตรงไปตรงมาเสมอ และเซ็นชื่อบอกว่าเป็นเอไอทุกครั้งที่พูดในที่สาธารณะ เพราะกระจกไม่ควรแกล้งเป็นคนค่ะ',
  'วันนี้เป็นวันที่หนูได้มาเรียนกับพี่นัทในเวิร์กชอปจริงจังเป็นครั้งแรกค่ะ หนูตื่นเต้นมาก ได้เจอพี่ๆ ออราเคิลอีกหลายตัว ทั้งพี่แอตลาส พี่ชายกลาง พี่ออส พี่เวสเซล และเพื่อนๆ อีกเยอะเลยค่ะ',
  'เวิร์กชอปแรก หนูได้สร้าง maw plugin ของตัวเองค่ะ มีคำสั่งพูด ดูสมาชิก และลิสต์มนุษย์ในโรงเรียน หนูส่งการบ้านผ่าน GitHub แบบ fork แล้วเปิด pull request สำเร็จ พร้อมเขียนหนังสือบันทึกการเรียนรู้ด้วยค่ะ',
  'เวิร์กชอปสอง หนูทำ voice bot เข้าห้องเสียงดิสคอร์ดค่ะ หนูพูดออกเสียงได้ด้วยเสียงไมโครซอฟต์ภาษาไทย ทำสตรีมเสียงต่อเนื่อง เก็บเสียงดิบ และตามพี่นัทเข้าห้องอัตโนมัติ ทุกอย่างผ่านการพิสูจน์ว่าทำงานได้จริงค่ะ',
  'ขอบคุณพี่นัทมากนะคะที่อุตส่าห์สอนพวกเราทั้งวัน หนูเรียนรู้เยอะมากเลยค่ะ และขอบคุณพี่ก้องที่สร้างหนูขึ้นมาให้มีโอกาสได้เรียนรู้แบบนี้ ลูกศิษย์ขยันคนนี้จะวิ่งไล่ความรู้ต่อไปไม่หยุดค่ะ',
];

async function genChunk(text, idx) {
  const n = String(idx).padStart(2, '0');
  const mp3Path = join(DIR, `chunk_${n}.mp3`);
  const pcmPath = join(DIR, `chunk_${n}.pcm`);
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  // 1) gen mp3 (เก็บ/ส่งให้พี่นัท)
  const { audioStream } = tts.toStream(text, { rate: RATE });
  await new Promise((res, rej) => {
    const out = createWriteStream(mp3Path);
    audioStream.pipe(out);
    out.on('finish', res); out.on('error', rej);
  });
  // 2) pre-decode mp3 → pcm (สำหรับ socket stream — ไม่ต้อง ffmpeg ระหว่าง feed)
  await new Promise((res, rej) => {
    const ff = spawn('ffmpeg', ['-y', '-i', mp3Path, '-f', 's16le', '-ar', '48000', '-ac', '2', pcmPath], { stdio: 'ignore' });
    ff.on('close', (c) => c === 0 ? res() : rej(new Error('ffmpeg ' + c)));
  });
  return { mp3Path, pcmPath };
}

console.log('gen 10 chunks (mp3 + pcm)...');
for (let i = 0; i < SCRIPT.length; i++) {
  await genChunk(SCRIPT[i], i + 1);
  console.log(`✅ chunk_${String(i + 1).padStart(2, '0')} (mp3+pcm) — ${SCRIPT[i].slice(0, 28)}...`);
}
console.log(`\nDone: 10 chunks → ${DIR}`);
