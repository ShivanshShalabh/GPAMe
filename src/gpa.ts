/**
 * UB undergraduate repeat policy (GPA / credits attempted).
 * @see https://www.buffalo.edu/academics/policies.course-enrollment.html (Repeat Policy)
 */

export type GpaCourse = {
  term: string;
  id: string;
  grade: string;
  units: number;
  status?: string;
};

export const GRADE_POINTS: Record<string, number> = {
  A: 4.0,
  "A-": 3.667,
  "B+": 3.333,
  B: 3.0,
  "B-": 2.667,
  "C+": 2.333,
  C: 2.0,
  "C-": 1.667,
  "D+": 1.333,
  D: 1.0,
  F: 0.0,
  U: 0.0,
};

const SEASON_ORDER: Record<string, number> = {
  Winter: 0,
  Spring: 1,
  Summer: 2,
  Fall: 3,
};

export function sortTerms(terms: string[]): string[] {
  return [...terms].sort((a, b) => {
    const [aS, aY] = a.split(" ");
    const [bS, bY] = b.split(" ");
    const yd = parseInt(aY) - parseInt(bY);
    if (yd !== 0) return yd;
    return (SEASON_ORDER[aS] ?? 4) - (SEASON_ORDER[bS] ?? 4);
  });
}

export function enrollmentKey(c: GpaCourse): string {
  return `${c.term}||${c.id}`;
}

/** Letter grades that earn GPA quality points (D- through A, F, U). */
export function hasGpaPoints(grade: string): boolean {
  return grade in GRADE_POINTS;
}

/** Passing for repeat policy: D or higher, or P/S (no GPA points but completes course). */
export function isPassingForRepeat(grade: string): boolean {
  if (!grade) return false;
  if (grade === "F" || grade === "U") return false;
  if (grade in GRADE_POINTS) return true;
  if (grade === "P" || grade === "S") return true;
  return false;
}

export function isFailingForRepeat(grade: string): boolean {
  return grade === "F" || grade === "U";
}

/** Repeat not finalized — first attempt may still count toward GPA. */
export function isPendingRepeatGrade(grade: string): boolean {
  return !grade || grade === "I" || grade === "N" || grade === "R" || grade === "W";
}

/**
 * Which enrollments count toward UB GPA after applying repeat rules per course ID.
 * Groups all rows with the same course id (e.g. CSE 220LLB) across terms.
 */
export function selectCoursesForGpa(courses: GpaCourse[]): GpaCourse[] {
  const byCourseId = new Map<string, GpaCourse[]>();
  for (const c of courses) {
    const list = byCourseId.get(c.id) ?? [];
    list.push(c);
    byCourseId.set(c.id, list);
  }

  const selected: GpaCourse[] = [];
  for (const enrollments of byCourseId.values()) {
    selected.push(...selectEnrollmentsForGpa(enrollments));
  }
  return selected;
}

function selectEnrollmentsForGpa(enrollments: GpaCourse[]): GpaCourse[] {
  if (enrollments.length === 0) return [];
  if (enrollments.length === 1) {
    return hasGpaPoints(enrollments[0].grade) ? [enrollments[0]] : [];
  }

  const sorted = sortByTerm(enrollments);
  const last = sorted[sorted.length - 1];

  // Repeat attempt still open: prior enrollments are not replaced yet.
  if (isPendingRepeatGrade(last.grade)) {
    return sorted.filter((c) => hasGpaPoints(c.grade));
  }

  // Last attempt passed (D+ or P/S): only the latest enrollment counts.
  if (isPassingForRepeat(last.grade)) {
    return hasGpaPoints(last.grade) ? [last] : [];
  }

  // Last attempt failed: first enrollment excluded; each failed repeat counts.
  if (isFailingForRepeat(last.grade)) {
    return sorted
      .slice(1)
      .filter((c) => isFailingForRepeat(c.grade) && hasGpaPoints(c.grade));
  }

  // Other grades (e.g. in-progress with no letter grade on last attempt).
  return sorted
    .slice(0, -1)
    .filter((c) => hasGpaPoints(c.grade));
}

function sortByTerm(courses: GpaCourse[]): GpaCourse[] {
  const order = sortTerms([...new Set(courses.map((c) => c.term))]);
  const rank = new Map(order.map((t, i) => [t, i]));
  return [...courses].sort(
    (a, b) => (rank.get(a.term) ?? 0) - (rank.get(b.term) ?? 0),
  );
}

export function sumGpaTotals(courses: GpaCourse[]): {
  qualityPoints: number;
  credits: number;
  gpa: number | null;
} {
  let qualityPoints = 0;
  let credits = 0;
  for (const c of courses) {
    if (hasGpaPoints(c.grade)) {
      qualityPoints += GRADE_POINTS[c.grade] * c.units;
      credits += c.units;
    }
  }
  return {
    qualityPoints,
    credits,
    gpa: credits > 0 ? qualityPoints / credits : null,
  };
}

/** Cumulative GPA with UB repeat policy applied across all enrollments. */
export function gpaForCourses(courses: GpaCourse[]): {
  qualityPoints: number;
  credits: number;
  gpa: number | null;
} {
  return sumGpaTotals(selectCoursesForGpa(courses));
}

export function isExcludedFromGpa(
  course: GpaCourse,
  allCourses: GpaCourse[],
): boolean {
  if (!hasGpaPoints(course.grade)) return false;
  const counting = selectCoursesForGpa(allCourses);
  const keys = new Set(counting.map(enrollmentKey));
  return !keys.has(enrollmentKey(course));
}

export function repeatGpaSummary(allCourses: GpaCourse[]): {
  excludedCount: number;
  repeatCourseCount: number;
} {
  const byId = new Map<string, GpaCourse[]>();
  for (const c of allCourses) {
    const list = byId.get(c.id) ?? [];
    list.push(c);
    byId.set(c.id, list);
  }
  let repeatCourseCount = 0;
  let excludedCount = 0;
  const countingKeys = new Set(
    selectCoursesForGpa(allCourses).map(enrollmentKey),
  );
  for (const [, enrollments] of byId) {
    if (enrollments.length < 2) continue;
    repeatCourseCount++;
    for (const e of enrollments) {
      if (hasGpaPoints(e.grade) && !countingKeys.has(enrollmentKey(e))) {
        excludedCount++;
      }
    }
  }
  return { excludedCount, repeatCourseCount };
}
