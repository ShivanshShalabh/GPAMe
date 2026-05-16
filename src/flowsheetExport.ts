export type FlowsheetCourse = {
  term: string;
  id: string;
  title: string;
  grade: string;
  units: number;
  status: "taken" | "in-progress" | "planned" | "failed";
};

const STATUS_FILL: Record<FlowsheetCourse["status"], string> = {
  taken: "FFD1FAE5",
  "in-progress": "FFDBEAFE",
  failed: "FFFEE2E2",
  planned: "FFE0F2FE",
};

const STATUS_BORDER: Record<FlowsheetCourse["status"], string> = {
  taken: "FF10B981",
  "in-progress": "FF3B82F6",
  failed: "FFEF4444",
  planned: "FF0EA5E9",
};

const THIN = { style: "thin" as const, color: { argb: "FF94A3B8" } };
const cellBorder = {
  top: THIN,
  left: THIN,
  bottom: THIN,
  right: THIN,
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function usesGradeFormatting(
  status: FlowsheetCourse["status"],
  showGrades: boolean,
): boolean {
  if (showGrades) return true;
  return status === "in-progress" || status === "planned";
}

const NEUTRAL_FILL = "FFF8FAFC";
const NEUTRAL_BORDER = "FFCBD5E1";

export async function downloadFlowsheetExcel(
  termsSorted: string[],
  byTerm: Record<string, FlowsheetCourse[]>,
  showGrades = true,
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;

  const terms = termsSorted;
  const n = terms.length;
  if (n === 0) return;

  const maxCourses = Math.max(
    0,
    ...terms.map((t) => (byTerm[t] || []).length),
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GPAMe";
  const sheet = workbook.addWorksheet("Course Flowsheet", {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  terms.forEach((_, i) => {
    sheet.getColumn(i + 1).width = 28;
  });

  const legendParts = showGrades
    ? ["Taken", "In Progress", "Failed", "Planned"]
    : ["In Progress", "Planned"];
  sheet.mergeCells(1, 1, 1, n);
  const legendCell = sheet.getCell(1, 1);
  legendCell.value = `Legend: ${legendParts.join(" · ")}`;
  legendCell.font = { size: 10, color: { argb: "FF475569" } };
  legendCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF1F5F9" },
  };
  legendCell.alignment = { vertical: "middle", wrapText: true };
  legendCell.border = cellBorder;

  const termHeaderRow = 2;
  terms.forEach((term, i) => {
    const cell = sheet.getCell(termHeaderRow, i + 1);
    cell.value = term;
    cell.font = { bold: true, size: 12, color: { argb: "FF047857" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD1FAE5" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = cellBorder;
  });
  sheet.getRow(termHeaderRow).height = 26;

  const unitsRow = 3;
  terms.forEach((term, i) => {
    const u = (byTerm[term] || []).reduce((s, c) => s + c.units, 0);
    const cell = sheet.getCell(unitsRow, i + 1);
    cell.value = `Units: ${u}`;
    cell.font = { size: 10, color: { argb: "FF64748B" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE8F5E9" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = cellBorder;
  });
  sheet.getRow(unitsRow).height = 20;

  let r = 4;
  for (let slot = 0; slot < maxCourses; slot++) {
    terms.forEach((term, colIdx) => {
      const courses = byTerm[term] || [];
      const course = courses[slot];
      const cell = sheet.getCell(r, colIdx + 1);
      if (!course) {
        cell.value = "";
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
        cell.border = cellBorder;
        return;
      }

      const styled = usesGradeFormatting(course.status, showGrades);
      const borderArgb = styled
        ? STATUS_BORDER[course.status]
        : NEUTRAL_BORDER;
      const borderColor = { argb: borderArgb };
      cell.border = {
        top: { style: styled ? "medium" : "thin", color: borderColor },
        left: { style: styled ? "medium" : "thin", color: borderColor },
        bottom: { style: styled ? "medium" : "thin", color: borderColor },
        right: { style: styled ? "medium" : "thin", color: borderColor },
      };

      const gradePart = showGrades && course.grade
        ? [
            { text: "  ", font: { size: 10 } },
            {
              text: course.grade,
              font: { bold: true, size: 11, color: { argb: "FF059669" } },
            },
          ]
        : [];

      const unitsPart = course.units > 0
        ? [
            {
              text: `${course.units} CR`,
              font: { size: 10, color: { argb: "FF64748B" } },
            },
          ]
        : [];

      cell.value = {
        richText: [
          {
            text: course.id,
            font: { bold: true, size: 11, color: { argb: "FF0F172A" } },
          },
          { text: "\n", font: { size: 11 } },
          {
            text: course.title,
            font: { size: 9, color: { argb: "FF64748B" } },
          },
          { text: "\n", font: { size: 10 } },
          ...unitsPart,
          ...gradePart,
        ],
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: styled ? STATUS_FILL[course.status] : NEUTRAL_FILL,
        },
      };
      cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    });
    sheet.getRow(r).height = 72;
    r++;
  }

  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, "gpame_flowsheet.xlsx");
}

/** Expand clone so scrollable / clipped layout is fully painted for capture. */
function unwrapFlowsheetClone(_clonedDoc: Document, clonedEl: HTMLElement) {
  clonedEl.style.overflow = "visible";
  clonedEl.style.height = "auto";
  clonedEl.style.maxHeight = "none";
  clonedEl.style.width = "max-content";
  clonedEl.style.maxWidth = "none";

  const columns = clonedEl.querySelector(
    ".flowsheet-columns",
  ) as HTMLElement | null;
  if (columns) {
    columns.style.overflow = "visible";
    columns.style.width = "max-content";
    columns.style.maxWidth = "none";
    columns.style.flexWrap = "nowrap";
    columns.style.height = "auto";
  }

  clonedEl.querySelectorAll(".flowsheet-col").forEach((node) => {
    const el = node as HTMLElement;
    el.style.overflow = "visible";
    el.style.flexShrink = "0";
  });

  clonedEl.querySelectorAll(".fcard-title").forEach((node) => {
    const el = node as HTMLElement;
    el.style.display = "block";
    el.style.overflow = "visible";
    el.style.maxHeight = "none";
    el.style.webkitLineClamp = "unset";
    el.style.whiteSpace = "normal";
    el.style.textOverflow = "clip";
    el.style.webkitBoxOrient = "unset";
  });
}

export async function captureFlowsheetElement(
  element: HTMLElement,
  theme: "light" | "dark",
): Promise<HTMLCanvasElement> {
  const html2canvas = (await import("html2canvas")).default;
  const bg = theme === "dark" ? "#141418" : "#f1f5f9";

  const pad = 80;
  const winW = Math.max(element.scrollWidth, element.getBoundingClientRect().width) + pad;
  const winH = Math.max(element.scrollHeight, element.getBoundingClientRect().height) + pad;

  return html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: bg,
    scrollX: 0,
    scrollY: 0,
    windowWidth: winW,
    windowHeight: winH,
    onclone: (clonedDoc, clonedEl) => {
      clonedDoc.documentElement.style.overflow = "visible";
      clonedDoc.body.style.overflow = "visible";
      clonedDoc.body.style.width = "max-content";
      clonedDoc.body.style.height = "auto";
      unwrapFlowsheetClone(clonedDoc, clonedEl);
    },
  });
}

export async function downloadFlowsheetPdf(
  canvas: HTMLCanvasElement,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const imgData = canvas.toDataURL("image/png", 1);
  const iw = canvas.width;
  const ih = canvas.height;
  const ptW = (iw * 72) / 96;
  const ptH = (ih * 72) / 96;

  const pdf = new jsPDF({
    orientation: ptW >= ptH ? "landscape" : "portrait",
    unit: "pt",
    format: [ptW, ptH],
  });
  pdf.addImage(imgData, "PNG", 0, 0, ptW, ptH, undefined, "FAST");
  pdf.save("gpame_flowsheet.pdf");
}

export function downloadFlowsheetPng(canvas: HTMLCanvasElement): void {
  canvas.toBlob((blob) => {
    if (blob) triggerDownload(blob, "gpame_flowsheet.png");
  }, "image/png");
}
