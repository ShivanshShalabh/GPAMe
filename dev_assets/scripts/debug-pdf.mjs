import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = process.argv[2] ||
  path.join(__dirname, "../AM_SSR_TSRPT (1).pdf");

const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;
console.log("pages:", pdf.numPages);

const allItems = [];
let pageYOffset = 0;
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  console.log(`\n=== Page ${i} (${textContent.items.length} items, w=${viewport.width.toFixed(0)} h=${viewport.height.toFixed(0)}) ===`);
  for (const item of textContent.items) {
    const str = item.str?.trim();
    if (!str) continue;
    const x = item.transform[4];
    const y = item.transform[5] + pageYOffset;
    allItems.push({ x, y, str });
  }
  // sample rows by y
  const byY = new Map();
  for (const it of textContent.items) {
    const s = it.str?.trim();
    if (!s) continue;
    const yk = Math.round(it.transform[5]);
    if (!byY.has(yk)) byY.set(yk, []);
    byY.get(yk).push({ x: it.transform[4].toFixed(0), s });
  }
  const ys = [...byY.keys()].sort((a, b) => b - a);
  for (const y of ys.slice(0, 40)) {
    const parts = byY.get(y).sort((a, b) => a.x - b.x);
    console.log(`y=${y}: ${parts.map((p) => `[${p.x}]${p.s}`).join(" ")}`);
  }
  pageYOffset += viewport.height + 100;
}

console.log("\nTotal items:", allItems.length);
