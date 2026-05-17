import assert from "node:assert/strict";
import {
  gpaForCourses,
  selectCoursesForGpa,
  type GpaCourse,
} from "../../src/gpa.ts";

function c(
  term: string,
  id: string,
  grade: string,
  units = 3,
): GpaCourse {
  return { term, id, grade, units };
}

function assertGpa(courses: GpaCourse[], expected: number) {
  const { gpa } = gpaForCourses(courses);
  assert.ok(gpa !== null, "expected GPA");
  assert.ok(
    Math.abs(gpa - expected) < 0.001,
    `expected ${expected}, got ${gpa}`,
  );
}

// F then A — only A counts
assertGpa(
  [c("Fall 2020", "CSE 115", "F", 4), c("Spring 2021", "CSE 115", "A", 4)],
  4.0,
);
assert.equal(selectCoursesForGpa([
  c("Fall 2020", "CSE 115", "F", 4),
  c("Spring 2021", "CSE 115", "A", 4),
]).length, 1);

// A then B (grade improvement) — only B counts
assertGpa(
  [c("Fall 2020", "MTH 141", "A", 4), c("Spring 2021", "MTH 141", "B", 4)],
  3.0,
);

// F then F — only second F counts
assertGpa(
  [c("Fall 2020", "PHY 107", "F", 4), c("Spring 2021", "PHY 107", "F", 4)],
  0.0,
);
assert.equal(
  selectCoursesForGpa([
    c("Fall 2020", "PHY 107", "F", 4),
    c("Spring 2021", "PHY 107", "F", 4),
  ]).length,
  1,
);

// F, F, F — two failed repeats count
assert.equal(
  selectCoursesForGpa([
    c("Fall 2020", "PHY 107", "F", 4),
    c("Spring 2021", "PHY 107", "F", 4),
    c("Fall 2021", "PHY 107", "F", 4),
  ]).length,
  2,
);

// F, F, A — only A counts
assertGpa(
  [
    c("Fall 2020", "PHY 107", "F", 4),
    c("Spring 2021", "PHY 107", "F", 4),
    c("Fall 2021", "PHY 107", "A", 4),
  ],
  4.0,
);

// Repeat with W on second attempt — first still counts
assertGpa(
  [c("Fall 2020", "CSE 220", "B", 4), c("Spring 2021", "CSE 220", "W", 4)],
  3.0,
);

// Single enrollment unchanged
assertGpa([c("Fall 2023", "CSE 115", "A", 4)], 4.0);

console.log("All repeat GPA tests passed.");
