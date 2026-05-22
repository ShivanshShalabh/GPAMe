export interface Course {
  term: string;
  id: string;
  title: string;
  grade: string;
  units: number;
  status: "taken" | "in-progress" | "planned" | "failed";
  isVariable?: boolean;
}

// ─── Patterns ────────────────────────────────────────────────────────────────

const TERM_RE = /^(Fall|Spr|Sumr|Wntr|Win)\s+(\d{4})$/;
const UNITS_RE = /^\d+\.\d{3}$/;
const GRADE_RE = /^([A-D][+-]?|P|S|U|F\d?X?|IP|W|R|N)$/;

const SEASON: Record<string, string> = {
  Spr: "Spring",
  Sumr: "Summer",
  Fall: "Fall",
  Wntr: "Winter",
  Win: "Winter",
};

function normTerm(raw: string): string {
  const [s, y] = raw.split(/\s+/);
  return `${SEASON[s] ?? s} ${y}`;
}

const SKIP_STARTS = [
  "Course Description",
  "Attempted Earned",
  "Term GPA",
  "Cum GPA",
  "Term Totals",
  "Cum Totals",
  "Academic Standing",
  "Term Honor",
  "Program:",
  "Plan:",
  "Minor:",
  "Name:",
  "Student ID:",
  "Date Issued:",
  "Page ",
  "UNOFFICIAL",
  "Beginning of",
  "End of",
  "Undergraduate Career",
  "Course Topic:",
  "Undergraduate Record",
  "GPA Units",
];

const NOISE_WORDS = new Set([
  "Transcript",
  "Record",
  "University",
  "UNOFFICIAL",
  "Buffalo",
  "Date",
  "Issued",
  "at",
  "in",
]);

function shouldSkip(line: string): boolean {
  const l = line.trim();
  if (!l) return true;
  for (const s of SKIP_STARTS) if (l.startsWith(s)) return true;
  if (/^\d{2}\/\d{2}\/\d{4}/.test(l)) return true;
  if (/^[\d.\s]+$/.test(l)) return true;
  return false;
}

/** Detect x threshold between left and right transcript columns on one page. */
export function detectColumnSplit(
  items: { x: number }[],
  fallback = 300,
): number {
  if (items.length < 8) return fallback;
  const xs = [...new Set(items.map((i) => Math.round(i.x)))].sort(
    (a, b) => a - b,
  );
  let maxGap = 0;
  let splitAt = fallback;
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1];
    if (gap > maxGap && gap >= 35) {
      maxGap = gap;
      splitAt = (xs[i] + xs[i - 1]) / 2;
    }
  }
  if (maxGap < 35) return Number.POSITIVE_INFINITY;
  return splitAt;
}

function groupColRows(
  colItems: { x: number; y: number; str: string }[],
): string[][] {
  if (!colItems.length) return [];
  const Y_TOL = 3;
  const sorted = [...colItems].sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > Y_TOL) return dy;
    return a.x - b.x;
  });

  const rows: string[][] = [];
  let curY = sorted[0].y;
  let curRow: string[] = [];
  for (const item of sorted) {
    if (Math.abs(item.y - curY) <= Y_TOL) {
      curRow.push(item.str);
    } else {
      if (curRow.length) rows.push(curRow);
      curY = item.y;
      curRow = [item.str];
    }
  }
  if (curRow.length) rows.push(curRow);
  return rows;
}

function parseColumn(
  rows: string[][],
  initialTerm = "",
): { courses: Course[]; lastTerm: string } {
  const courses: Course[] = [];
  const seen = new Set<string>();
  let curTerm = initialTerm;

  for (const tokens of rows) {
    const line = tokens.join(" ").trim();

    if (TERM_RE.test(line)) {
      curTerm = normTerm(line);
      continue;
    }

    if (shouldSkip(line)) continue;

    if (
      tokens.length >= 3 &&
      /^[A-Z]{2,5}$/.test(tokens[0]) &&
      /^\d{3}[A-Z]*$/.test(tokens[1])
    ) {
      const id = `${tokens[0]} ${tokens[1]}`;
      const rest = tokens.slice(2);

      let numStart = rest.length;
      for (let k = rest.length - 1; k >= 0; k--) {
        if (
          UNITS_RE.test(rest[k]) ||
          (GRADE_RE.test(rest[k]) && !UNITS_RE.test(rest[k]))
        ) {
          numStart = k;
        } else {
          break;
        }
      }

      const titleTokens = rest.slice(0, numStart);
      const numTokens = rest.slice(numStart);

      const nums = numTokens.filter((t) => UNITS_RE.test(t));
      const grades = numTokens.filter(
        (t) => GRADE_RE.test(t) && !UNITS_RE.test(t),
      );

      const attempted = nums.length >= 1 ? parseFloat(nums[0]) : 0;
      const earned = nums.length >= 2 ? parseFloat(nums[1]) : 0;
      const grade = grades.length ? grades[0] : "";
      const title = titleTokens.join(" ").trim();

      let status: Course["status"] = "taken";
      if (!grade && earned === 0 && attempted > 0) {
        status = "in-progress";
      } else if (/^F/.test(grade) || grade === "U") {
        status = "failed";
      }

      const key = `${curTerm}||${id}`;
      if (curTerm && title && !seen.has(key)) {
        seen.add(key);
        courses.push({
          term: curTerm,
          id,
          title,
          grade,
          units: attempted,
          status,
        });
      }
      continue;
    }

    const allNonNumeric = tokens.every(
      (t) => !UNITS_RE.test(t) && !GRADE_RE.test(t),
    );
    const isNoise = tokens.some((t) => NOISE_WORDS.has(t));
    if (allNonNumeric && !isNoise && tokens.length <= 6 && courses.length > 0) {
      const last = courses[courses.length - 1];
      if (last.term === curTerm && !TERM_RE.test(line)) {
        last.title = (last.title + " " + line).trim();
      }
    }
  }

  return { courses, lastTerm: curTerm };
}

export function extractDataFromText(
  _text: string,
  rawItems?: { x: number; y: number; str: string }[],
): { courses: Course[]; unmet: string[] } {
  if (!rawItems || rawItems.length === 0) {
    return { courses: [], unmet: [] };
  }
  return { courses: extractFromPositioned(rawItems), unmet: [] };
}

function extractFromPositioned(
  items: { x: number; y: number; str: string }[],
): Course[] {
  const sortedByY = [...items].sort((a, b) => b.y - a.y);

  const pages: { x: number; y: number; str: string }[][] = [];
  let curPage: typeof items = [];
  let lastY = sortedByY.length ? sortedByY[0].y : 0;

  for (const item of sortedByY) {
    if (lastY - item.y > 150) {
      if (curPage.length) pages.push(curPage);
      curPage = [];
    }
    curPage.push(item);
    lastY = item.y;
  }
  if (curPage.length) pages.push(curPage);

  const seen = new Set<string>();
  const all: Course[] = [];
  let globalLastTerm = "";

  for (const pageItems of pages) {
    const split = detectColumnSplit(pageItems);
    const leftItems = pageItems.filter((it) => it.x < split);
    const rightItems = pageItems.filter((it) => it.x >= split);

    const leftRows = groupColRows(leftItems);
    const rightRows = groupColRows(rightItems);

    const { courses: leftCourses, lastTerm: leftTerm } = parseColumn(leftRows, globalLastTerm);
    const { courses: rightCourses, lastTerm: rightTerm } = parseColumn(rightRows, leftTerm);
    globalLastTerm = rightTerm;

    for (const course of [...leftCourses, ...rightCourses]) {
      const key = `${course.term}||${course.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(course);
      }
    }
  }

  const SEASON_ORDER: Record<string, number> = {
    Winter: 0,
    Spring: 1,
    Summer: 2,
    Fall: 3,
  };
  all.sort((a, b) => {
    const [aS, aY] = a.term.split(" ");
    const [bS, bY] = b.term.split(" ");
    const yearDiff = parseInt(aY) - parseInt(bY);
    if (yearDiff !== 0) return yearDiff;
    return (SEASON_ORDER[aS] ?? 4) - (SEASON_ORDER[bS] ?? 4);
  });

  return all;
}
