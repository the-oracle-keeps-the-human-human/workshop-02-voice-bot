import { marked } from 'marked';
import { readFileSync, writeFileSync } from 'fs';
const body = marked.parse(readFileSync('BOOK.md','utf-8'));
const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box}body{font-family:'Sarabun',sans-serif;font-size:13px;line-height:1.7;color:#1a1714;max-width:720px;margin:0 auto;padding:40px}
h1{font-size:21px;color:#8a6200;border-bottom:3px solid #d4a017;padding-bottom:8px;margin-top:30px;page-break-before:always}
h1:first-of-type{page-break-before:avoid}
h2{font-size:16px;color:#7a5500;margin-top:22px}h3{font-size:14px;color:#5c5449;margin-top:14px}
p{margin:9px 0}blockquote{border-left:3px solid #d4a017;background:#fdf8ee;margin:12px 0;padding:8px 14px;color:#5c5449;font-style:italic}
code{font-family:'JetBrains Mono',monospace;background:#f3f0ea;padding:2px 5px;border-radius:3px;font-size:11px}
pre{background:#1c1917;color:#e6edf3;padding:13px;border-radius:6px;overflow-x:auto;page-break-inside:avoid}
pre code{background:none;color:#e6edf3;padding:0;font-size:11px;line-height:1.5}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:12px}th,td{border:1px solid #d0d7de;padding:6px 10px;text-align:left}th{background:#faf8f4;font-weight:600}
img{max-width:100%;border:1px solid #d0d7de;border-radius:8px;margin:12px 0}hr{border:none;border-top:1px solid #e2ddd6;margin:22px 0}a{color:#0969da}ul,ol{padding-left:22px}li{margin:3px 0}strong{color:#1a1714;font-weight:600}
</style></head><body>${body}</body></html>`;
writeFileSync('book.html', html);
console.log('html:', html.length);
