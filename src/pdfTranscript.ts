import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  detectColumnSplit,
  extractDataFromText,
  type Course,
} from "./parser";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export type TranscriptParseStage =
  | "file_read"
  | "pdf_load"
  | "pdf_extract"
  | "parse"
  | "empty";

export interface TranscriptParseDebug {
  fileName?: string;
  fileSizeBytes?: number;
  numPages?: number;
  textItemCount?: number;
  columnSplits?: number[];
  coursesFound?: number;
  sampleLines?: string[];
  cause?: string;
}

export class TranscriptParseError extends Error {
  readonly stage: TranscriptParseStage;
  readonly debug: TranscriptParseDebug;

  constructor(
    stage: TranscriptParseStage,
    message: string,
    debug: TranscriptParseDebug = {},
  ) {
    super(message);
    this.name = "TranscriptParseError";
    this.stage = stage;
    this.debug = debug;
  }

  toUserMessage(): string {
    const lines = [
      `Could not read this transcript (${this.stage}).`,
      "",
      this.message,
    ];
    const d = this.debug;
    const details: string[] = [];
    if (d.fileName) details.push(`File: ${d.fileName}`);
    if (d.fileSizeBytes != null) {
      details.push(`Size: ${(d.fileSizeBytes / 1024).toFixed(1)} KB`);
    }
    if (d.numPages != null) details.push(`Pages: ${d.numPages}`);
    if (d.textItemCount != null) details.push(`Text fragments: ${d.textItemCount}`);
    if (d.columnSplits?.length) {
      details.push(`Column splits (per page): ${d.columnSplits.map((s) => s.toFixed(0)).join(", ")}`);
    }
    if (d.coursesFound != null) details.push(`Courses extracted: ${d.coursesFound}`);
    if (d.cause) details.push(`Cause: ${d.cause}`);
    if (d.sampleLines?.length) {
      details.push("", "Sample extracted lines:");
      for (const line of d.sampleLines.slice(0, 6)) {
        details.push(`  • ${line.slice(0, 100)}`);
      }
    }
    if (details.length) {
      lines.push("", "Debug info:", ...details.map((x) => `  ${x}`));
    }
    lines.push(
      "",
      "Tip: Use the unofficial transcript PDF from HUB (not a screenshot).",
      "Open the browser console (F12) for the full error object.",
    );
    return lines.join("\n");
  }
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(result);
      else reject(new TranscriptParseError(
        "file_read",
        "FileReader returned an unexpected result type.",
        { fileName: file.name, fileSizeBytes: file.size },
      ));
    };
    reader.onerror = () => {
      reject(new TranscriptParseError(
        "file_read",
        reader.error?.message || "Failed to read the file from disk.",
        {
          fileName: file.name,
          fileSizeBytes: file.size,
          cause: reader.error?.name,
        },
      ));
    };
    reader.readAsArrayBuffer(file);
  });
}

export async function extractTranscriptFromPdf(
  file: File,
): Promise<{ courses: Course[]; debug: TranscriptParseDebug }> {
  const baseDebug: TranscriptParseDebug = {
    fileName: file.name,
    fileSizeBytes: file.size,
  };

  if (file.size === 0) {
    throw new TranscriptParseError(
      "file_read",
      "The selected file is empty.",
      baseDebug,
    );
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await readFileAsArrayBuffer(file);
  } catch (e) {
    if (e instanceof TranscriptParseError) throw e;
    throw new TranscriptParseError(
      "file_read",
      e instanceof Error ? e.message : "Failed to read file.",
      baseDebug,
    );
  }

  let pdf: pdfjsLib.PDFDocumentProxy;
  try {
    const typedarray = new Uint8Array(buffer);
    pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isWorker = /worker|Loading task/i.test(msg);
    throw new TranscriptParseError(
      "pdf_load",
      isWorker
        ? "PDF.js worker failed to load. Check your network or try refreshing the page."
        : `PDF could not be opened: ${msg}`,
      {
        ...baseDebug,
        cause: isWorker ? "worker" : msg,
      },
    );
  }

  const allItems: { x: number; y: number; str: string }[] = [];
  const columnSplits: number[] = [];
  let pageYOffset = 0;

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const pageItems: { x: number; y: number; str: string }[] = [];

      for (const item of textContent.items) {
        if (!("str" in item)) continue;
        const str = item.str?.trim();
        if (!str) continue;
        const transform = item.transform;
        pageItems.push({
          x: transform[4],
          y: transform[5] + pageYOffset,
          str,
        });
      }

      columnSplits.push(detectColumnSplit(pageItems));
      allItems.push(...pageItems);
      pageYOffset -= viewport.height + 100;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new TranscriptParseError(
      "pdf_extract",
      `Failed to extract text from PDF: ${msg}`,
      {
        ...baseDebug,
        numPages: pdf.numPages,
        textItemCount: allItems.length,
        cause: msg,
      },
    );
  }

  if (allItems.length === 0) {
    throw new TranscriptParseError(
      "pdf_extract",
      "No text could be extracted. The PDF may be scanned/image-only (not selectable text).",
      {
        ...baseDebug,
        numPages: pdf.numPages,
        textItemCount: 0,
      },
    );
  }

  let courses: Course[];
  try {
    const result = extractDataFromText("", allItems);
    courses = result.courses;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new TranscriptParseError(
      "parse",
      `Transcript parser error: ${msg}`,
      {
        ...baseDebug,
        numPages: pdf.numPages,
        textItemCount: allItems.length,
        columnSplits,
        cause: msg,
      },
    );
  }

  const debug: TranscriptParseDebug = {
    ...baseDebug,
    numPages: pdf.numPages,
    textItemCount: allItems.length,
    columnSplits,
    coursesFound: courses.length,
  };

  if (courses.length === 0) {
    const sampleLines = buildSampleLines(allItems);
    throw new TranscriptParseError(
      "empty",
      "No courses were recognized in this PDF. It may not be a UB unofficial transcript, or the layout is unsupported.",
      { ...debug, sampleLines },
    );
  }

  return { courses, debug };
}

function buildSampleLines(
  items: { x: number; y: number; str: string }[],
): string[] {
  const byY = new Map<number, { x: number; str: string }[]>();
  for (const it of items) {
    const yk = Math.round(it.y);
    if (!byY.has(yk)) byY.set(yk, []);
    byY.get(yk)!.push({ x: it.x, str: it.str });
  }
  const lines: string[] = [];
  for (const y of [...byY.keys()].sort((a, b) => b - a).slice(0, 25)) {
    const parts = byY.get(y)!.sort((a, b) => a.x - b.x);
    lines.push(parts.map((p) => p.str).join(" "));
  }
  return lines;
}
