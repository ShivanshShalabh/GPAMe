export interface Course {
  term: string;
  id: string;
  title: string;
  grade: string;
  units: number;
  status: 'taken' | 'in-progress' | 'planned' | 'failed';
  isVariable?: boolean;
}

// ─── Patterns ────────────────────────────────────────────────────────────────

const TERM_RE  = /^(Fall|Spr|Sumr|Wntr|Win)\s+(\d{4})$/;
const UNITS_RE = /^\d+\.\d{3}$/;
const GRADE_RE = /^([A-D][+-]?|P|S|U|F\d?X?|IP|W|R|N)$/;

const SEASON: Record<string, string> = {
  Spr: 'Spring', Sumr: 'Summer', Fall: 'Fall', Wntr: 'Winter', Win: 'Winter',
};

function normTerm(raw: string): string {
  const [s, y] = raw.split(/\s+/);
  return `${SEASON[s] ?? s} ${y}`;
}

const SKIP_STARTS = [
  'Course Description', 'Attempted Earned', 'Term GPA', 'Cum GPA',
  'Term Totals', 'Cum Totals', 'Academic Standing', 'Term Honor',
  'Program:', 'Plan:', 'Minor:', 'Name:', 'Student ID:', 'Date Issued:',
  'Page ', 'UNOFFICIAL', 'Beginning of', 'End of', 'Undergraduate Career',
  'Course Topic:',
];

// Words that appear in continuation/noise rows but are NOT title words
const NOISE_WORDS = new Set([
  'Transcript', 'Record', 'University', 'UNOFFICIAL', 'Buffalo',
  'Date', 'Issued', 'at',
]);

function shouldSkip(line: string): boolean {
  const l = line.trim();
  if (!l) return true;
  for (const s of SKIP_STARTS) if (l.startsWith(s)) return true;
  if (/^\d{2}\/\d{2}\/\d{4}/.test(l)) return true; // dates
  if (/^[\d.\s]+$/.test(l)) return true;             // pure numbers
  return false;
}

// ─── Column parser ────────────────────────────────────────────────────────────
// Each "column" is a list of rows (string[]) sorted top-to-bottom.
// initialTerm allows continuing a term from the previous column on the same page.

function parseColumn(rows: string[][], initialTerm = ''): { courses: Course[]; lastTerm: string } {
  const courses: Course[] = [];
  const seen = new Set<string>();
  let curTerm = initialTerm;

  for (const tokens of rows) {
    const line = tokens.join(' ').trim();

    // Term header
    if (TERM_RE.test(line)) {
      curTerm = normTerm(line);
      continue;
    }

    if (shouldSkip(line)) continue;

    // Course row: DEPT NUM title... Attempted Earned [Grade] Points
    if (
      tokens.length >= 3 &&
      /^[A-Z]{2,4}$/.test(tokens[0]) &&
      /^\d{3}\w*$/.test(tokens[1])
    ) {
      const id = `${tokens[0]} ${tokens[1]}`;
      const rest = tokens.slice(2);

      // Find the numeric tail from the right edge
      // The tail matches: float float (grade?) float  —OR—  float float float (no grade, in-progress)
      let numStart = rest.length;
      for (let k = rest.length - 1; k >= 0; k--) {
        if (UNITS_RE.test(rest[k]) || (GRADE_RE.test(rest[k]) && !UNITS_RE.test(rest[k]))) {
          numStart = k;
        } else {
          break;
        }
      }

      const titleTokens = rest.slice(0, numStart);
      const numTokens   = rest.slice(numStart);

      const nums   = numTokens.filter(t => UNITS_RE.test(t));
      const grades = numTokens.filter(t => GRADE_RE.test(t) && !UNITS_RE.test(t));

      const attempted = nums.length >= 1 ? parseFloat(nums[0]) : 0;
      const earned    = nums.length >= 2 ? parseFloat(nums[1]) : 0;
      const grade     = grades.length   ? grades[0]            : '';
      const title     = titleTokens.join(' ').trim();

      // Determine status
      let status: Course['status'] = 'taken';
      if (!grade && earned === 0 && attempted > 0) {
        status = 'in-progress';
      } else if (/^F/.test(grade) || grade === 'U') {
        status = 'failed';
      }

      const key = `${curTerm}||${id}`;
      if (curTerm && !seen.has(key)) {
        seen.add(key);
        courses.push({ term: curTerm, id, title, grade, units: attempted, status });
      }
      continue;
    }

    // Continuation row: word-wrapped title (short, no numbers, not noise)
    const allNonNumeric = tokens.every(t => !UNITS_RE.test(t) && !GRADE_RE.test(t));
    const isNoise = tokens.some(t => NOISE_WORDS.has(t));
    if (allNonNumeric && !isNoise && tokens.length <= 5 && courses.length > 0) {
      const last = courses[courses.length - 1];
      // Only append if last course has same term
      if (last.term === curTerm) {
        last.title = (last.title + ' ' + line).trim();
      }
    }
  }

  return { courses, lastTerm: curTerm };
}

// ─── Main export ─────────────────────────────────────────────────────────────
export function extractDataFromText(
  _text: string,
  rawItems?: { x: number; y: number; str: string }[]
): { courses: Course[]; unmet: string[] } {

  if (!rawItems || rawItems.length === 0) {
    return { courses: [], unmet: [] };
  }

  return { courses: extractFromPositioned(rawItems), unmet: [] };
}

// ─── Column-aware extraction from PDF.js positioned items ────────────────────
// The Unofficial Transcript uses a 2-column layout per page.
// Left column: x < COL_SPLIT  (PDF.js transform[4])
// Right column: x >= COL_SPLIT
// Y values (transform[5]) are bottom-up in PDF space.
// Items are grouped per page using page-offset y values, then processed independently.

function extractFromPositioned(items: { x: number; y: number; str: string }[]): Course[] {
  // We use pageId to separate pages — items from different pages must not mix
  // The caller encodes page separation via large y gaps (pageOffset += height + 100)
  // We detect page boundaries as large y jumps (> 200pt gap)
  const COL_SPLIT = 415;
  const Y_TOL = 3;

  // Split into per-page item groups by detecting large y discontinuities
  // (each page's y is offset by height+100, creating visible gaps)
  const sortedByY = [...items].sort((a, b) => b.y - a.y); // descending y (top of first page first)
  
  const pages: { x: number; y: number; str: string }[][] = [];
  let curPage: typeof items = [];
  let lastY = sortedByY.length ? sortedByY[0].y : 0;
  
  for (const item of sortedByY) {
    if (lastY - item.y > 150) { // large gap = page boundary
      if (curPage.length) pages.push(curPage);
      curPage = [];
    }
    curPage.push(item);
    lastY = item.y;
  }
  if (curPage.length) pages.push(curPage);

  function groupColRows(colItems: { x: number; y: number; str: string }[]): string[][] {
    if (!colItems.length) return [];
    // Sort top-to-bottom (descending y in PDF space)
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

  const seen = new Set<string>();
  const all: Course[] = [];

  for (const pageItems of pages) {
    const leftItems  = pageItems.filter(it => it.x < COL_SPLIT);
    const rightItems = pageItems.filter(it => it.x >= COL_SPLIT);

    const leftRows  = groupColRows(leftItems);
    const rightRows = groupColRows(rightItems);

    // Parse left column, then pass its last term to right column
    // (right column may start mid-term without its own term header)
    const { courses: leftCourses, lastTerm } = parseColumn(leftRows);
    const { courses: rightCourses } = parseColumn(rightRows, lastTerm);

    for (const course of [...leftCourses, ...rightCourses]) {
      const key = `${course.term}||${course.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(course);
      }
    }
  }

  // Sort chronologically
  const SEASON_ORDER: Record<string, number> = {
    Spring: 0, Summer: 1, Fall: 2, Winter: 3,
  };
  all.sort((a, b) => {
    const [aS, aY] = a.term.split(' ');
    const [bS, bY] = b.term.split(' ');
    const yearDiff = parseInt(aY) - parseInt(bY);
    if (yearDiff !== 0) return yearDiff;
    return (SEASON_ORDER[aS] ?? 4) - (SEASON_ORDER[bS] ?? 4);
  });

  return all;
}