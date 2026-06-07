const PORT = 4570;
const clients = new Set<any>();
const transcriptions: Array<{ts: string, speaker: string, text: string, oracle: string}> = [];

const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live Transcription 🎙️</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'JetBrains Mono',monospace;background:#1a1410;color:#f5ead9;min-height:100dvh;padding:1.5rem}
.wrap{max-width:900px;margin:0 auto}
h1{color:#f0b73d;font-size:1.8rem;margin-bottom:.3rem}
.sub{color:#9a8a72;font-size:.8rem;margin-bottom:1rem}
.status{color:#9bc28b;font-size:.8rem;margin-bottom:1rem}
.status.off{color:#e89999}
#feed{min-height:60vh}
.line{padding:.5rem 0;border-bottom:1px solid #2d2219;font-size:.95rem;line-height:1.6;animation:fadein .3s}
@keyframes fadein{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
time{color:#9a8a72;margin-right:.8rem;font-size:.8rem}
.spk{font-weight:700;margin-right:.5rem;color:#f0b73d}
.empty{color:#9a8a72;padding:2rem;text-align:center;font-size:.9rem}
</style></head><body><div class="wrap">
<h1>🎙️ Live Transcription</h1>
<p class="sub">WebSocket realtime — ไม่ต้อง refresh</p>
<div id="status" class="status">connecting...</div>
<div id="feed"><div class="empty">รอ transcription...</div></div>
</div><script>
const feed = document.getElementById('feed');
const status = document.getElementById('status');
let ws;
function connect() {
  ws = new WebSocket('ws://' + location.host + '/ws');
  ws.onopen = () => { status.textContent = '🟢 connected'; status.className = 'status'; };
  ws.onclose = () => { status.textContent = '🔴 disconnected — reconnecting...'; status.className = 'status off'; setTimeout(connect, 2000); };
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.type === 'history') { feed.innerHTML = d.data.map(renderLine).join(''); return; }
    if (d.type === 'transcription') {
      if (feed.querySelector('.empty')) feed.innerHTML = '';
      feed.innerHTML = renderLine(d.data) + feed.innerHTML;
    }
  };
}
function renderLine(d) {
  return '<div class="line"><time>' + (d.ts||'').slice(11,19) + '</time><span class="spk">' + (d.speaker||d.oracle||'?') + '</span>' + (d.text||'') + '</div>';
}
connect();
</script></body></html>`;

Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws" && server.upgrade(req)) return;

    if (url.pathname === "/api/transcribe" && req.method === "POST") {
      return (async () => {
        const body = await req.json();
        const entry = {
          ts: body.ts || new Date().toISOString(),
          speaker: body.data?.speaker || body.speaker || body.oracle || "?",
          text: body.data?.text || body.text || "",
          oracle: body.oracle || "unknown",
        };
        transcriptions.unshift(entry);
        if (transcriptions.length > 200) transcriptions.pop();

        for (const client of clients) {
          client.send(JSON.stringify({ type: "transcription", data: entry }));
        }
        return Response.json({ ok: true, ts: entry.ts });
      })();
    }

    return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      ws.send(JSON.stringify({ type: "history", data: transcriptions.slice(0, 50) }));
    },
    close(ws) { clients.delete(ws); },
    message() {},
  },
});

console.log(`🎙️ Transcribe server: http://localhost:${PORT}`);
console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
console.log(`   POST transcriptions: http://localhost:${PORT}/api/transcribe`);
