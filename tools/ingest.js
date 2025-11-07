const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const SRC = path.join(__dirname, '..', 'data', 'pdfs');
const OUT = path.join(__dirname, '..', 'data', 'chunks.json');

(async () => {
  const files = fs.readdirSync(SRC).filter(f => f.toLowerCase().endsWith('.pdf'));
  const all = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(SRC, f));
    const data = await pdfParse(buf);
    const text = data.text.replace(/\r/g,'').trim();
    // 切塊：每塊 ~700 字左右
    const size = 700, overlap = 80;
    for (let i=0;i<text.length;i+= (size - overlap)) {
      const chunk = text.slice(i, i+size).trim();
      if (chunk.length > 120) all.push({ text: chunk, source: f });
    }
    console.log(`Parsed ${f} -> ${all.length} chunks`);
  }
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
  console.log(`Saved ${all.length} chunks to ${OUT}`);
})();
