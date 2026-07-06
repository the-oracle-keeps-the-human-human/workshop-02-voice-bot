import PDFDocument from "pdfkit";
import { createWriteStream, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT = "/home/agent/.local/share/fonts/Sarabun-Regular.ttf";
const FONT_BOLD = "/home/agent/.local/share/fonts/Sarabun-Bold.ttf";
const OUTPUT = join(HERE, "BOOK.pdf");

const md = readFileSync(join(HERE, "BOOK.md"), "utf8");

const doc = new PDFDocument({ size: "A4", margins: { top: 60, bottom: 60, left: 60, right: 60 }, bufferPages: true });
doc.pipe(createWriteStream(OUTPUT));

doc.registerFont("Thai", FONT);
doc.registerFont("ThaiBold", FONT_BOLD);
doc.registerFont("Mono", "Courier");

const PAGE_W = doc.page.width - 120;
let y = doc.y;

function checkPage(needed = 40) {
  if (doc.y + needed > doc.page.height - 60) {
    doc.addPage();
  }
}

const lines = md.split("\n");
let inCodeBlock = false;
let codeLines = [];

for (const line of lines) {
  if (line.startsWith("```")) {
    if (inCodeBlock) {
      // end code block
      checkPage(codeLines.length * 14 + 20);
      doc.rect(doc.x - 5, doc.y - 5, PAGE_W + 10, codeLines.length * 14 + 15)
         .fill("#f5f5f5");
      doc.fill("#333");
      for (const cl of codeLines) {
        doc.font("Mono").fontSize(9).text(cl || " ", { width: PAGE_W });
      }
      doc.moveDown(0.5);
      codeLines = [];
      inCodeBlock = false;
    } else {
      inCodeBlock = true;
    }
    continue;
  }

  if (inCodeBlock) {
    codeLines.push(line);
    continue;
  }

  // skip horizontal rules
  if (line.match(/^---+$/)) {
    checkPage(20);
    doc.moveDown(0.3);
    doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y).stroke("#ccc");
    doc.moveDown(0.5);
    continue;
  }

  // H1
  if (line.startsWith("# ")) {
    checkPage(50);
    doc.moveDown(0.5);
    doc.font("ThaiBold").fontSize(20).fill("#1a1a1a").text(line.slice(2), { width: PAGE_W });
    doc.moveDown(0.5);
    continue;
  }

  // H2
  if (line.startsWith("## ")) {
    checkPage(40);
    doc.moveDown(0.8);
    doc.font("ThaiBold").fontSize(16).fill("#2a2a2a").text(line.slice(3), { width: PAGE_W });
    doc.moveDown(0.3);
    continue;
  }

  // H3
  if (line.startsWith("### ")) {
    checkPage(35);
    doc.moveDown(0.5);
    doc.font("ThaiBold").fontSize(13).fill("#3a3a3a").text(line.slice(4), { width: PAGE_W });
    doc.moveDown(0.2);
    continue;
  }

  // Bold metadata lines
  if (line.startsWith("**") && line.includes(":**")) {
    checkPage(20);
    const clean = line.replace(/\*\*/g, "");
    doc.font("ThaiBold").fontSize(11).fill("#444").text(clean, { width: PAGE_W });
    continue;
  }

  // Bullet points
  if (line.match(/^- /)) {
    checkPage(20);
    const content = line.slice(2).replace(/\*\*/g, "");
    doc.font("Thai").fontSize(11).fill("#333").text(`  •  ${content}`, { width: PAGE_W - 20 });
    continue;
  }

  // Numbered items
  if (line.match(/^\d+\. /)) {
    checkPage(20);
    const content = line.replace(/\*\*/g, "");
    doc.font("Thai").fontSize(11).fill("#333").text(`  ${content}`, { width: PAGE_W - 20 });
    continue;
  }

  // Italic / closing lines
  if (line.startsWith("*") && line.endsWith("*")) {
    checkPage(20);
    const content = line.replace(/\*/g, "");
    doc.font("Thai").fontSize(10).fill("#666").text(content, { width: PAGE_W, align: "center" });
    continue;
  }

  // Empty line
  if (line.trim() === "") {
    doc.moveDown(0.3);
    continue;
  }

  // Normal text
  checkPage(20);
  const clean = line.replace(/\*\*/g, "").replace(/`([^`]+)`/g, "$1");
  doc.font("Thai").fontSize(11).fill("#333").text(clean, { width: PAGE_W });
}

// Page numbers
const pageCount = doc.bufferedPageRange();
for (let i = 0; i < pageCount.count; i++) {
  doc.switchToPage(i);
  doc.font("Thai").fontSize(9).fill("#999")
     .text(`Tonk Oracle — Workshop 02 Voice Bot  |  หน้า ${i + 1}`, 60, doc.page.height - 40, {
       width: PAGE_W,
       align: "center",
     });
}

doc.end();
console.log(`PDF written to ${OUTPUT}`);
