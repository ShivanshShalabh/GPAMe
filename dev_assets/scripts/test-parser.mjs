import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

// dynamic import of built parser - use ts via vite? Run with tsx instead
const pdfPath = process.argv[2] ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../AM_SSR_TSRPT (1).pdf");

const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

const allItems = [];
let pageYOffset = 0;
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  for (const item of textContent.items) {
    const str = item.str?.trim();
    if (!str) continue;
    allItems.push({
      x: item.transform[4],
      y: item.transform[5] + pageYOffset,
      str,
    });
  }
  pageYOffset += viewport.height + 100;
}

// inline old vs new split test
const COL_OLD = 415;
const leftOld = allItems.filter((it) => it.x < COL_OLD).length;
const rightOld = allItems.filter((it) => it.x >= COL_OLD).length;
console.log("OLD split 415: left", leftOld, "right", rightOld);

const xs = allItems.map((i) => i.x).sort((a, b) => a - b);
let maxGap = 0, splitAt = 300;
for (let i = 1; i < xs.length; i++) {
  const gap = xs[i] - xs[i - 1];
  if (gap > maxGap && gap > 35) {
    maxGap = gap;
    splitAt = (xs[i] + xs[i - 1]) / 2;
  }
}
console.log("Detected split:", splitAt.toFixed(1), "maxGap", maxGap.toFixed(1));
const leftNew = allItems.filter((it) => it.x < splitAt).length;
const rightNew = allItems.filter((it) => it.x >= splitAt).length;
console.log("NEW split: left", leftNew, "right", rightNew);
