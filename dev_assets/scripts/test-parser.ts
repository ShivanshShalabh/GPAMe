import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractDataFromText } from "../../src/parser.ts";

const pdfPath = process.argv[2] ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../AM_SSR_TSRPT (1).pdf");

async function main() {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const allItems: { x: number; y: number; str: string }[] = [];
  let pageYOffset = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    for (const item of textContent.items as { str?: string; transform: number[] }[]) {
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

  const left415 = allItems.filter((it) => it.x < 415).length;
  const right415 = allItems.filter((it) => it.x >= 415).length;
  console.log(`Items: ${allItems.length}, split@415: L=${left415} R=${right415}`);

  const { courses } = extractDataFromText("", allItems);
  console.log(`Courses parsed: ${courses.length}`);
  for (const c of courses) {
    console.log(`  ${c.term} | ${c.id} | ${c.grade || "(IP)"} | ${c.units} | ${c.title.slice(0, 40)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
