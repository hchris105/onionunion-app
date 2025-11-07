// scripts/slice-composer.cjs
// 依《合成器.pdf》章節關鍵詞做語義切 + 固定長度切，輸出 data/chunks.json（CommonJS 版）

const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const crypto = require("crypto");

// ---- CLI 參數：--pdf --out；預設用 data/pdfs/合成器.pdf 與 data/chunks.json
function arg(name, def) {
  const i = process.argv.findIndex(a => a === `--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}
const CWD = process.cwd();
const PDF_REL = arg("pdf", "data/pdfs/合成器.pdf");
const OUT_REL = arg("out", "data/chunks.json");
const PDF = path.resolve(CWD, PDF_REL);
const OUT = path.resolve(CWD, OUT_REL);

// 章節/規則標記（針對你的《合成器》）
const HEAD_MARKERS = [
  /分流器/i,
  /Anzariyah/i,
  /Mustahisla\b/i,
  /Kuleed\s*Ahtam/i,
  /Tajrid/i,
  /Qaida\s*Takrar/i,
  /Haruf\s*jawab/i,
  /rubaat/i,
  /meezan/i,
  /Aiqagh/i,
  /—{2,}|——+|⸻+/,
];

const CHUNK_SIZE = 3200;  // 每塊目標長度（字元）
const OVERLAP = 320;      // 重疊 10%

function sha1(s){ return crypto.createHash("sha1").update(s,"utf8").digest("hex"); }

function normalizeText(t) {
  return t
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ ]*\n[ ]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readPdfText(absPath) {
  console.log("[INFO] 工作目錄:", CWD);
  console.log("[INFO] PDF 路徑:", absPath);
  if (!fs.existsSync(absPath)) {
    throw new Error("找不到 PDF 檔案：" + absPath);
  }
  const buf = fs.readFileSync(absPath);
  console.log("[INFO] PDF 大小(bytes):", buf.length);
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error("PDF 檔案讀取為空：" + absPath);
  }
  // 一定傳 Buffer 進 pdf()，避免讀到內建測試檔
  const parsed = await pdf(buf);
  const text = normalizeText(parsed.text || "");
  if (!text) throw new Error("pdf-parse 未解析到任何文字：" + absPath);
  return text;
}

function splitByHeadings(text) {
  const lines = text.split("\n");
  const out = [];
  let buf = [];
  const isHeading = (line) => HEAD_MARKERS.some(re => re.test(line));

  for (const line of lines) {
    if (isHeading(line)) {
      if (buf.length) out.push(buf.join("\n").trim());
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) out.push(buf.join("\n").trim());
  return out.filter(s => s && s.replace(/\s+/g,"").length > 30);
}

function chunkWithinSection(section, size=CHUNK_SIZE, overlap=OVERLAP) {
  const paras = section.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const chunks = [];
  let buf = "";

  const flush = (s) => {
    if (!s.trim()) return;
    if (s.length <= size) { chunks.push(s.trim()); return; }
    // 單段過長，硬切＋overlap
    let i = 0;
    while (i < s.length) {
      const piece = s.slice(i, i + size);
      chunks.push(piece.trim());
      if (i + size >= s.length) break;
      i += size - overlap;
    }
  };

  for (const p of paras) {
    const next = buf ? (buf + "\n\n" + p) : p;
    if (next.length <= size) buf = next;
    else { flush(buf); buf = p; }
  }
  flush(buf);

  // 相鄰塊加入 overlap
  const withOverlap = [];
  for (let i=0; i<chunks.length; i++) {
    let cur = chunks[i];
    if (i>0 && overlap>0) {
      const tail = chunks[i-1].slice(-overlap);
      if (!cur.startsWith(tail)) cur = tail + (tail.endsWith("\n")?"":"\n") + cur;
    }
    withOverlap.push(cur.trim());
  }
  return withOverlap;
}

async function main() {
  try {
    const text = await readPdfText(PDF);
    const sections = splitByHeadings(text);
    console.log("[INFO] 語義章節數:", sections.length);

    const all = [];
    sections.forEach((sec, si) => {
      const parts = chunkWithinSection(sec);
      parts.forEach((part, pj) => {
        all.push({
          id: `${(si+1).toString().padStart(3,"0")}-${(pj+1).toString().padStart(3,"0")}-${sha1(part).slice(0,10)}`,
          text: part
        });
      });
    });

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(all, null, 2), "utf8");
    console.log(`[OK] 章節=${sections.length}；chunks=${all.length} → ${OUT}`);
  } catch (e) {
    console.error("[切片失敗]", e.message);
    process.exit(1);
  }
}

main();
