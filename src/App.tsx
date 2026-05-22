import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  BookOpen,
  Calendar,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FileSpreadsheet,
  FileType,
  Moon,
  Shield,
  Sun,
  Trash2,
  Upload,
  UploadCloud,
  X,
  Menu,
  AlertTriangle,
  Award,
} from "lucide-react";
import {
  captureFlowsheetElement,
  downloadFlowsheetExcel,
  downloadFlowsheetPdf,
  downloadFlowsheetPng,
} from "./flowsheetExport";
import {
  extractTranscriptFromPdf,
  TranscriptParseError,
} from "./pdfTranscript";
import {
  enrollmentKey,
  gpaForCourses,
  GRADE_POINTS,
  repeatGpaSummary,
  selectCoursesForGpa,
  sortTerms,
  sumGpaTotals,
  isExcludedFromGpa,
} from "./gpa";

interface Course {
  term: string;
  id: string;
  title: string;
  grade: string;
  units: number;
  status: "taken" | "in-progress" | "planned" | "failed";
  isVariable?: boolean;
  isHonors?: boolean;
}

interface HonorsPetition {
  id: string;
  description: string;
  credits: number;
}

interface AppState {
  courses: Course[];
  honorsTrackerEnabled?: boolean;
  honorsCreditsRequired?: number;
  honorsPetitions?: HonorsPetition[];
}

const DEFAULT_STATE: AppState = { courses: [] };

const DEFAULT_HONORS_CREDITS_REQUIRED = 21;

function courseCountsTowardHonors(c: Course): boolean {
  if (c.status === "failed") return false;
  if (c.grade && ["F", "FX", "W", "R"].includes(c.grade.toUpperCase())) return false;
  return (
    c.status === "taken" || c.status === "in-progress" || c.status === "planned"
  );
}

function isGraduate(id: string): boolean {
  const match = id.match(/^[A-Z]+\s*(\d{3})/i);
  if (!match) return false;
  const num = parseInt(match[1], 10);
  return num >= 500;
}

function isAutoHonorsCourse(id: string): boolean {
  const startsWithList = ["HON", "UBE 102", "CSE 199", "EAS 199", "AED 199"];
  ["481", "482", "483", "484", "485"].forEach((i) => startsWithList.push("OPR " + i));
  const includesList = ["496", "498", "495", "499"];
  
  return (
    startsWithList.some((prefix) => id.startsWith(prefix)) ||
    includesList.some((substring) => id.includes(substring)) ||
    isGraduate(id)
  );
}

function honorsStatusLabel(status: Course["status"]): string {
  if (status === "taken") return "Taken";
  if (status === "in-progress") return "In Progress";
  if (status === "planned") return "Planned";
  return status;
}

const NON_GPA_GRADES = ["P", "S", "R"];
const VALID_GRADES = [...Object.keys(GRADE_POINTS), ...NON_GPA_GRADES];

function flowsheetUsesGradeFormatting(
  status: Course["status"],
  showGrades: boolean,
): boolean {
  if (showGrades) return true;
  return status === "in-progress" || status === "planned";
}

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem("gpame_data");
    return saved ? JSON.parse(saved) : DEFAULT_STATE;
  });
  const [isDragging, setIsDragging] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("gpame_theme") as "light" | "dark") || "dark";
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isHonorsEditMode, setIsHonorsEditMode] = useState(false);

  const [viewCount, setViewCount] = useState<number | null>(null);
  const [uploadCount, setUploadCount] = useState<number | null>(null);

  useEffect(() => {
    // Increment page views
    fetch(
      "https://api.counterapi.dev/v2/shivansh-shalabhs-team-4143/gpame-views/up",
    )
      .then((res) => res.json())
      .then((data) => setViewCount(data.data.up_count))
      .catch(console.error);

    // Fetch transcript uploads (get current count without incrementing)
    fetch(
      "https://api.counterapi.dev/v2/shivansh-shalabhs-team-4143/gpame-transcripts",
    )
      .then((res) => res.json())
      .then((data) => setUploadCount(data.data.up_count))
      .catch(() => setUploadCount(0));
  }, []);

  const [flowsheetExporting, setFlowsheetExporting] = useState(false);
  const [showFlowsheetGrades, setShowFlowsheetGrades] = useState(() => {
    const saved = localStorage.getItem("gpame_show_flowsheet_grades");
    return saved !== "false";
  });
  const flowsheetCaptureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.className = theme;
    localStorage.setItem("gpame_theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(
      "gpame_show_flowsheet_grades",
      String(showFlowsheetGrades),
    );
  }, [showFlowsheetGrades]);

  const currentYear = new Date().getFullYear();
  const [newPlan, setNewPlan] = useState({
    termSeason: "Fall",
    termYear: currentYear,
    id: "",
    title: "",
    units: 3,
    isVariable: false,
  });
  const [courseOptions, setCourseOptions] = useState<any[]>([]);
  const [courseSearch, setCourseSearch] = useState("");
  const [newPetition, setNewPetition] = useState({
    description: "",
    credits: 3,
  });

  // Move-course modal state
  const [movingCourse, setMovingCourse] = useState<Course | null>(null);
  const [moveSeason, setMoveSeason] = useState("Fall");
  const [moveYear, setMoveYear] = useState(currentYear);

  // Drag state for flowsheet reordering
  const dragCourse = useRef<Course | null>(null);
  const [dropTargetTerm, setDropTargetTerm] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("gpame_data", JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}courses.json`)
      .then((r) => r.json())
      .then((data) => setCourseOptions(data))
      .catch(console.error);
  }, []);

  // ── PDF Upload ──────────────────────────────────────────────────────────────
  const handleFileUpload = async (file: File) => {
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      alert("Please upload a PDF file.");
      return;
    }
    try {
      const { courses, debug } = await extractTranscriptFromPdf(file);
      console.info("[GPAMe] Transcript parsed successfully", debug);
      setState((prev) => ({
        ...prev,
        courses: [
          ...prev.courses.filter((c) => c.status === "planned"),
          ...courses,
        ],
      }));

      fetch(
        "https://api.counterapi.dev/v2/shivansh-shalabhs-team-4143/gpame-transcripts/up",
      )
        .then((res) => res.json())
        .then((data) => setUploadCount(data.data.up_count))
        .catch(console.error);
    } catch (err) {
      console.error("[GPAMe] Transcript parse failed", err);
      if (err instanceof TranscriptParseError) {
        alert(err.toUserMessage());
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        alert(
          `Could not parse PDF (unknown error).\n\n${msg}\n\nOpen the browser console (F12) for details.`,
        );
      }
    }
  };

  // ── Planner actions ─────────────────────────────────────────────────────────
  const addPlannedCourse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlan.id || !newPlan.title) return;
    setState((prev) => ({
      ...prev,
      courses: [
        ...prev.courses,
        {
          term: `${newPlan.termSeason} ${newPlan.termYear}`,
          id: newPlan.id,
          title: newPlan.title,
          units: newPlan.units,
          grade: "",
          status: "planned",
          isVariable: newPlan.isVariable,
        },
      ],
    }));
    setNewPlan({ ...newPlan, id: "", title: "", units: 3, isVariable: false });
    setCourseSearch("");
  };

  const removePlannedCourse = (term: string, id: string) => {
    setState((prev) => ({
      ...prev,
      courses: prev.courses.filter(
        (c) => !(c.term === term && c.id === id && c.status === "planned"),
      ),
    }));
  };

  const openMoveModal = (course: Course) => {
    const [s, y] = course.term.split(" ");
    setMovingCourse(course);
    setMoveSeason(s);
    setMoveYear(parseInt(y));
  };

  const confirmMove = () => {
    if (!movingCourse) return;
    const newTerm = `${moveSeason} ${moveYear}`;
    setState((prev) => ({
      ...prev,
      courses: prev.courses.map((c) =>
        c.term === movingCourse.term &&
        c.id === movingCourse.id &&
        c.status === "planned"
          ? { ...c, term: newTerm }
          : c,
      ),
    }));
    setMovingCourse(null);
  };

  const updateCourse = (term: string, id: string, updates: Partial<Course>) => {
    setState((prev) => ({
      ...prev,
      courses: prev.courses.map((c) =>
        c.term === term && c.id === id ? { ...c, ...updates } : c,
      ),
    }));
  };

  const toggleCourseHonors = (term: string, id: string) => {
    setState((prev) => ({
      ...prev,
      courses: prev.courses.map((c) => {
        if (c.term === term && c.id === id) {
          const currentHonors = c.isHonors !== undefined ? c.isHonors : isAutoHonorsCourse(c.id);
          return { ...c, isHonors: !currentHonors };
        }
        return c;
      }),
    }));
  };

  const setHonorsTrackerEnabled = (enabled: boolean) => {
    setState((prev) => ({ ...prev, honorsTrackerEnabled: enabled }));
  };

  const setHonorsCreditsRequired = (credits: number) => {
    setState((prev) => ({
      ...prev,
      honorsCreditsRequired:
        Number.isFinite(credits) && credits >= 0
          ? credits
          : DEFAULT_HONORS_CREDITS_REQUIRED,
    }));
  };

  const addHonorsPetition = (e: React.FormEvent) => {
    e.preventDefault();
    const description = newPetition.description.trim();
    const credits = parseFloat(String(newPetition.credits));
    if (!description || !Number.isFinite(credits) || credits <= 0) return;
    setState((prev) => ({
      ...prev,
      honorsPetitions: [
        ...(prev.honorsPetitions ?? []),
        {
          id: `petition-${Date.now()}`,
          description,
          credits,
        },
      ],
    }));
    setNewPetition({ description: "", credits: 3 });
  };

  const removeHonorsPetition = (id: string) => {
    setState((prev) => ({
      ...prev,
      honorsPetitions: (prev.honorsPetitions ?? []).filter((p) => p.id !== id),
    }));
  };

  // ── Drag-and-drop for planned course flowsheet ──────────────────────────────
  const handleDragStart = (course: Course) => {
    dragCourse.current = course;
  };
  const handleDragOver = (e: React.DragEvent, term: string) => {
    e.preventDefault();
    setDropTargetTerm(term);
  };
  const handleDrop = (e: React.DragEvent, targetTerm: string) => {
    e.preventDefault();
    setDropTargetTerm(null);
    const c = dragCourse.current;
    if (!c || c.term === targetTerm || c.status !== "planned") return;
    setState((prev) => ({
      ...prev,
      courses: prev.courses.map((course) =>
        course.term === c.term &&
        course.id === c.id &&
        course.status === "planned"
          ? { ...course, term: targetTerm }
          : course,
      ),
    }));
    dragCourse.current = null;
  };
  const handleDragLeave = () => setDropTargetTerm(null);

  // ── Export / Clear ──────────────────────────────────────────────────────────
  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gpame_data.json";
    a.click();
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedState = JSON.parse(event.target?.result as string);
        if (importedState && Array.isArray(importedState.courses)) {
          setState(importedState);
        } else {
          alert("Invalid file format.");
        }
      } catch (err) {
        alert("Failed to parse JSON file.");
      }
    };
    reader.readAsText(file);
  };

  const clearData = () => {
    if (
      confirm("Are you sure you want to clear all data? This cannot be undone.")
    )
      setState(DEFAULT_STATE);
  };

  // ── Derived data ─────────────────────────────────────────────────────────────
  const plannedCourses = state.courses.filter((c) => c.status === "planned");
  const plannedByTerm: Record<string, Course[]> = {};
  plannedCourses.forEach((c) => {
    (plannedByTerm[c.term] = plannedByTerm[c.term] || []).push(c);
  });
  const plannedTermsSorted = sortTerms(Object.keys(plannedByTerm));

  // Include all courses (including planned) in the flowsheet
  const flowsheetCourses = state.courses;
  const flowsheetByTerm: Record<string, Course[]> = {};
  flowsheetCourses.forEach((c) => {
    (flowsheetByTerm[c.term] = flowsheetByTerm[c.term] || []).push(c);
  });
  const flowsheetTermsSorted = sortTerms(Object.keys(flowsheetByTerm));

  const ipAndPlanned = state.courses.filter(
    (c) => c.status === "planned" || c.status === "in-progress",
  );
  const calculatorByTerm: Record<string, Course[]> = {};
  ipAndPlanned.forEach((c) => {
    (calculatorByTerm[c.term] = calculatorByTerm[c.term] || []).push(c);
  });
  const calculatorTermsSorted = sortTerms(Object.keys(calculatorByTerm));

  const repeatGpa = repeatGpaSummary(state.courses);
  const cumulativeGpa = gpaForCourses(state.courses);
  const gpaRoundedQp = Math.round(cumulativeGpa.qualityPoints * 100) / 100;
  const gpaStats = {
    qualityPointsStr:
      cumulativeGpa.credits <= 0 ? "0.00" : gpaRoundedQp.toFixed(2),
    creditsStr:
      cumulativeGpa.credits <= 0
        ? "0"
        : cumulativeGpa.credits % 1 === 0
          ? String(cumulativeGpa.credits)
          : cumulativeGpa.credits.toFixed(1),
    gpaStr: cumulativeGpa.gpa !== null ? cumulativeGpa.gpa.toFixed(3) : "0.000",
  };

  const coursesByTerm: Record<string, Course[]> = {};
  state.courses.forEach((c) => {
    (coursesByTerm[c.term] = coursesByTerm[c.term] || []).push(c);
  });
  const coursesForGpa = selectCoursesForGpa(state.courses);
  const gpaCountableKeys = new Set(coursesForGpa.map(enrollmentKey));
  const termGpaList = sortTerms(Object.keys(coursesByTerm)).map((term) => {
    const termCourses = coursesByTerm[term].filter((c) =>
      gpaCountableKeys.has(enrollmentKey(c)),
    );
    const { gpa, credits } = sumGpaTotals(termCourses);
    return {
      term,
      gpaStr: gpa !== null ? gpa.toFixed(3) : null,
      credits,
    };
  });

  const honorsTrackerEnabled = state.honorsTrackerEnabled ?? false;
  const honorsCreditsRequired =
    state.honorsCreditsRequired ?? DEFAULT_HONORS_CREDITS_REQUIRED;
  const honorsPetitions = state.honorsPetitions ?? [];
  const honorsFlaggedCourses = state.courses
    .filter((c) => {
      const counts = c.isHonors !== undefined ? c.isHonors : isAutoHonorsCourse(c.id);
      return counts && courseCountsTowardHonors(c);
    })
    .sort((a, b) => {
      const td = sortTerms([a.term, b.term]);
      if (a.term !== b.term) return td.indexOf(a.term) - td.indexOf(b.term);
      return a.id.localeCompare(b.id);
    });
  const honorsCourseCredits = honorsFlaggedCourses.reduce(
    (s, c) => s + c.units,
    0,
  );
  const honorsPetitionCredits = honorsPetitions.reduce(
    (s, p) => s + p.credits,
    0,
  );
  const honorsCreditsEarned = honorsCourseCredits + honorsPetitionCredits;
  const honorsRemaining = Math.max(
    0,
    honorsCreditsRequired - honorsCreditsEarned,
  );
  const honorsProgressPct =
    honorsCreditsRequired > 0
      ? Math.min(100, (honorsCreditsEarned / honorsCreditsRequired) * 100)
      : 0;

  const runVisualFlowsheetExport = async (kind: "pdf" | "png") => {
    if (flowsheetTermsSorted.length === 0) {
      alert("Add courses to your flowsheet before exporting.");
      return;
    }
    const el = flowsheetCaptureRef.current;
    if (!el) return;
    setFlowsheetExporting(true);
    try {
      const canvas = await captureFlowsheetElement(el, theme);
      if (kind === "pdf") await downloadFlowsheetPdf(canvas);
      else downloadFlowsheetPng(canvas);
    } catch (e) {
      console.error(e);
      alert("Could not create export. Try again or use Excel export.");
    } finally {
      setFlowsheetExporting(false);
    }
  };

  const exportFlowsheetExcel = async () => {
    if (flowsheetTermsSorted.length === 0) {
      alert("Add courses to your flowsheet before exporting.");
      return;
    }
    setFlowsheetExporting(true);
    try {
      await downloadFlowsheetExcel(
        flowsheetTermsSorted,
        flowsheetByTerm,
        showFlowsheetGrades,
      );
    } catch (e) {
      console.error(e);
      alert("Could not create Excel file.");
    } finally {
      setFlowsheetExporting(false);
    }
  };

  return (
    <div className="app-container">
      <div className="privacy-banner" role="status">
        <Shield className="privacy-banner-icon" size={18} strokeWidth={2.5} />
        <p className="privacy-banner-text">
          <strong>100% local.</strong> No data of yours is ever sent out of this
          device.
        </p>
      </div>
      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-content">
          <div className="nav-brand">
            <div className="logo-icon">G</div>
            <span className="logo-text">GPAMe</span>
          </div>
          <button
            className="mobile-menu-btn"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <div className={`nav-actions ${isMobileMenuOpen ? "open" : ""}`}>
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="btn btn-secondary"
              title="Toggle Theme"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <label
              className="btn btn-secondary"
              title="Import JSON"
              style={{ cursor: "pointer" }}
            >
              <UploadCloud size={18} /> Import
              <input
                type="file"
                accept=".json"
                onChange={importData}
                style={{ display: "none" }}
              />
            </label>
            <button
              onClick={exportData}
              className="btn btn-secondary"
              title="Export Data"
            >
              <Download size={18} /> Export
            </button>
            <button
              onClick={clearData}
              className="btn btn-danger"
              title="Clear Data"
            >
              <Trash2 size={18} /> Clear Data
            </button>
          </div>
        </div>
      </nav>

      <main className="main-layout">
        <div className="disclaimer-banner">
          <AlertTriangle className="disclaimer-icon" size={20} />
          <div className="disclaimer-text">
            <strong className="disclaimer-heading">Disclaimer:</strong> This
            tool is <strong>not affiliated</strong> with the University at
            Buffalo. It is intended for planning purposes only and should{" "}
            <strong>not</strong> be used for critical academic decisions (e.g.,
            scholarship eligibility, academic standing, or graduation
            clearance). Always consult your <strong>Academic Advisor</strong> or
            the official HUB Student Center for authoritative academic records
            and GPA calculations.
          </div>
        </div>
        {/* ── Left Sidebar ── */}
        <div className="column-left">
          {/* Upload */}
          <section className="glass-panel upload-section">
            <div className="panel-glow"></div>
            <h2>
              <Upload size={20} className="icon-sky" /> Upload Transcript
            </h2>
            <p className="upload-hint">
              Upload your{" "}
              <strong>University at Buffalo Unofficial Transcript</strong>{" "}
              (PDF). Don't have it?{" "}
              <a
                href="https://www.buffalo.edu/registrar/instructions-for-using-HUB/transcript-view-unofficial.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                Follow these instructions
              </a>{" "}
              to download it from HUB.
            </p>
            <label
              className={`drop-zone ${isDragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files[0]) {
                  handleFileUpload(e.dataTransfer.files[0]);
                }
              }}
            >
              <div className="drop-icon">
                <Upload size={24} />
              </div>
              <div className="drop-text">
                <p className="drop-title">
                  Drop your Unofficial Transcript PDF here
                </p>
                <p className="drop-subtitle">or click to browse</p>
              </div>
              <input
                type="file"
                className="hidden-input"
                accept="application/pdf"
                onChange={(e) =>
                  e.target.files?.[0] && handleFileUpload(e.target.files[0])
                }
              />
            </label>
          </section>

          {/* GPA Card */}
          <section className="glass-panel gpa-card">
            <div className="gpa-glow"></div>
            <h2 className="gpa-title">Cumulative GPA</h2>
            <div className="gpa-value">{gpaStats.gpaStr}</div>
            <div className="gpa-breakdown" aria-label="GPA breakdown">
              <div className="gpa-breakdown-row gpa-breakdown-header">
                <span>Quality Points</span>
                <span>Credits</span>
                <span>GPA</span>
              </div>
              <div className="gpa-breakdown-row gpa-breakdown-values">
                <span>{gpaStats.qualityPointsStr}</span>
                <span>{gpaStats.creditsStr}</span>
                <span>{gpaStats.gpaStr}</span>
              </div>
            </div>
            {termGpaList.length > 0 && (
              <div className="term-gpa-list" aria-label="Term GPA by semester">
                <h3 className="term-gpa-heading">Term GPA</h3>
                <ul className="term-gpa-rows">
                  {termGpaList.map(({ term, gpaStr, credits }) => (
                    <li key={term} className="term-gpa-row">
                      <span className="term-gpa-term">{term}</span>
                      <span className="term-gpa-value">
                        {gpaStr ?? "—"}
                        {gpaStr && credits > 0 && (
                          <span className="term-gpa-credits">
                            {" "}
                            ({credits % 1 === 0
                              ? credits
                              : credits.toFixed(1)}{" "}
                            cr)
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="gpa-subtitle">
              {coursesForGpa.length === 0 ? (
                "No letter-graded enrollments yet."
              ) : repeatGpa.repeatCourseCount > 0 ? (
                <>
                  {coursesForGpa.length} enrollment
                  {coursesForGpa.length === 1 ? "" : "s"} count toward GPA.
                  {repeatGpa.excludedCount > 0 && (
                    <>
                      {" "}
                      {repeatGpa.excludedCount} earlier repeat
                      {repeatGpa.excludedCount === 1 ? "" : "s"} excluded (UB
                      repeat policy).
                    </>
                  )}
                </>
              ) : (
                <>
                  Based on {coursesForGpa.length} graded enrollment
                  {coursesForGpa.length === 1 ? "" : "s"}.
                </>
              )}
            </p>
          </section>

          {/* GPA Calculator */}
          <section className="glass-panel gpa-calculator-section">
            <div className="panel-glow"></div>
            <h2>
              <Calendar size={20} className="icon-blue" /> GPA Calculator
            </h2>
            <p
              style={{
                marginBottom: "16px",
                fontSize: "0.875rem",
                color: "var(--text-muted)",
              }}
            >
              Set grades for planned or in-progress courses to estimate your
              GPA.
              {repeatGpa.repeatCourseCount > 0 && (
                <>
                  {" "}
                  Repeated courses use the{" "}
                  <a
                    href="https://catalogs.buffalo.edu/content.php?catoid=11&navoid=571#repeat-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    UB repeat policy
                  </a>{" "}
                  (only the counting attempt per course is included).
                </>
              )}
            </p>
            <div className="calculator-list">
              {ipAndPlanned.length === 0 ? (
                <div className="empty-state">
                  <p>No planned or in-progress courses.</p>
                </div>
              ) : (
                calculatorTermsSorted.map((term) => (
                  <div key={term} className="calc-term-group">
                    <div className="calc-term-header">{term}</div>
                    <div className="calc-term-courses">
                      {calculatorByTerm[term].map((c, idx) => (
                        <div
                          key={`${term}-${c.id}-${idx}`}
                          className="calc-course-row"
                        >
                          <span className="calc-course-id">{c.id}</span>
                          <input
                            type="number"
                            value={c.units}
                            onChange={(e) =>
                              updateCourse(c.term, c.id, {
                                units: parseFloat(e.target.value) || 0,
                              })}
                            className={`calc-units-input ${
                              c.isVariable ? "variable-units" : ""
                            }`}
                            title="Credits"
                            min="1"
                            step="0.5"
                          />
                          <select
                            value={c.grade || ""}
                            onChange={(e) =>
                              updateCourse(c.term, c.id, {
                                grade: e.target.value,
                              })}
                            className="calc-grade-select"
                          >
                            <option value="">Grade</option>
                            {VALID_GRADES.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Add to Plan */}
          <section className="glass-panel planner-section">
            <h2>
              <Calendar className="icon-blue" /> Plan a Course
            </h2>
            <form onSubmit={addPlannedCourse} className="planner-form">
              <div className="planner-term-row">
                <select
                  value={newPlan.termSeason}
                  onChange={(e) =>
                    setNewPlan({ ...newPlan, termSeason: e.target.value })
                  }
                  className="input-field"
                >
                  {["Winter", "Spring", "Summer", "Fall"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={newPlan.termYear}
                  onChange={(e) =>
                    setNewPlan({
                      ...newPlan,
                      termYear: parseInt(e.target.value),
                    })
                  }
                  className="input-field"
                >
                  {Array.from({ length: 10 }, (_, i) => currentYear + i).map(
                    (y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <input
                type="text"
                list="course-options"
                placeholder="Search Course (e.g. CSE 442)"
                value={courseSearch}
                onChange={(e) => {
                  const val = e.target.value;
                  setCourseSearch(val);
                  const matched = courseOptions.find((c) => c.title === val);
                  if (matched) {
                    const parts = matched.title.split(" - ");
                    const id = parts[0].trim();
                    const title = parts.slice(1).join(" - ").trim();
                    const creditMatch =
                      matched.html.match(/Credits:\s*([\d.-]+)/);
                    let units = 3,
                      isVar = false;
                    if (creditMatch) {
                      const cr = creditMatch[1];
                      if (cr.includes("-")) {
                        units = 1;
                        isVar = true;
                      } else units = parseFloat(cr) || 3;
                    }
                    setNewPlan((p) => ({
                      ...p,
                      id,
                      title,
                      units,
                      isVariable: isVar,
                    }));
                  } else {
                    setNewPlan((p) => ({
                      ...p,
                      id: val,
                      title: "Custom Course",
                      units: 3,
                      isVariable: false,
                    }));
                  }
                }}
                className="input-field"
                required
              />
              <datalist id="course-options">
                {courseSearch.length >= 2 &&
                  courseOptions
                    .filter((c) =>
                      c.title
                        .toLowerCase()
                        .includes(courseSearch.toLowerCase()),
                    )
                    .slice(0, 50)
                    .map((c) => <option key={c.coid} value={c.title} />)}
              </datalist>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: "100%" }}
              >
                Add to Plan
              </button>
            </form>
          </section>

          {/* Honors Experience Tracker */}
          <section className="glass-panel honors-section">
            <div className="honors-section-header">
              <h2>
                <Award size={20} className="icon-amber" /> Honors Experience
                Tracker
              </h2>
              <label
                className="honors-enable-toggle"
                title="Enable honors tracking on flowsheet"
              >
                <input
                  type="checkbox"
                  checked={honorsTrackerEnabled}
                  onChange={(e) => setHonorsTrackerEnabled(e.target.checked)}
                />
                <span className="honors-enable-slider" />
              </label>
            </div>
            {honorsTrackerEnabled ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <p className="section-hint" style={{ margin: 0 }}>
                    Flag courses on the flowsheet. Taken, in-progress, and planned
                    courses count toward honors experience.
                  </p>
                  <button
                    className={`btn ${isHonorsEditMode ? "btn-primary" : "btn-secondary"} btn-sm`}
                    onClick={() => setIsHonorsEditMode(!isHonorsEditMode)}
                  >
                    {isHonorsEditMode ? "Done Editing" : "Edit Honors"}
                  </button>
                </div>
                <div className="honors-credits-row">
                  <label
                    className="honors-field-label"
                    htmlFor="honors-credits-required"
                  >
                    Credits to satisfy
                  </label>
                  <input
                    id="honors-credits-required"
                    type="number"
                    min="0"
                    step="0.5"
                    className="input-field honors-credits-input"
                    value={honorsCreditsRequired}
                    onChange={(e) =>
                      setHonorsCreditsRequired(parseFloat(e.target.value))
                    }
                  />
                </div>
                <div className="honors-progress-wrap">
                  <div className="honors-progress-labels">
                    <span>
                      {honorsCreditsEarned % 1 === 0
                        ? honorsCreditsEarned
                        : honorsCreditsEarned.toFixed(1)}{" "}
                      / {honorsCreditsRequired} credits
                    </span>
                    <span>{Math.round(honorsProgressPct)}%</span>
                  </div>
                  <div className="honors-progress-bar">
                    <div
                      className="honors-progress-fill"
                      style={{ width: `${honorsProgressPct}%` }}
                    />
                  </div>
                </div>
                <div className="honors-flagged-list">
                  <h3 className="honors-subheading">Flagged courses</h3>
                  {honorsFlaggedCourses.length === 0 ? (
                    <p className="honors-empty-hint">
                      No courses flagged yet. Use the honors checkbox on the
                      flowsheet.
                    </p>
                  ) : (
                    honorsFlaggedCourses.map((c) => (
                      <div
                        key={`${c.term}-${c.id}`}
                        className="honors-flagged-item"
                      >
                        <div className="honors-flagged-top">
                          <span className="honors-flagged-id">{c.id}</span>
                          <span className="honors-flagged-units">
                            {c.units} CR
                          </span>
                        </div>
                        <div className="honors-flagged-meta">
                          <span>{c.term}</span>
                          <span className={`honors-status-tag tag-${c.status}`}>
                            {honorsStatusLabel(c.status)}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <form
                  onSubmit={addHonorsPetition}
                  className="honors-petition-form"
                >
                  <h3 className="honors-subheading">Honors petition credits</h3>
                  <p className="honors-petition-hint">
                    Counts toward honors experience only—not GPA or transcript
                    credits.
                  </p>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Description (e.g. Study abroad petition)"
                    value={newPetition.description}
                    onChange={(e) =>
                      setNewPetition({
                        ...newPetition,
                        description: e.target.value,
                      })
                    }
                    required
                  />
                  <div className="honors-petition-credits-row">
                    <input
                      type="number"
                      className="input-field"
                      placeholder="Credits"
                      min="0.5"
                      step="0.5"
                      value={newPetition.credits}
                      onChange={(e) =>
                        setNewPetition({
                          ...newPetition,
                          credits: parseFloat(e.target.value) || 0,
                        })
                      }
                      required
                    />
                    <button type="submit" className="btn btn-primary">
                      Add
                    </button>
                  </div>
                </form>
                {honorsPetitions.length > 0 && (
                  <ul className="honors-petition-list">
                    {honorsPetitions.map((p) => (
                      <li key={p.id} className="honors-petition-item">
                        <div>
                          <div className="honors-petition-desc">
                            {p.description}
                          </div>
                          <div className="honors-petition-meta">
                            Petition · {p.credits} CR
                          </div>
                        </div>
                        <button
                          type="button"
                          className="card-action-btn delete-btn"
                          title="Remove petition"
                          onClick={() => removeHonorsPetition(p.id)}
                        >
                          <X size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="honors-remaining">
                  <span className="honors-remaining-label">
                    Honors experience to complete
                  </span>
                  <span className="honors-remaining-value">
                    {honorsRemaining % 1 === 0
                      ? honorsRemaining
                      : honorsRemaining.toFixed(1)}{" "}
                    credits
                  </span>
                </div>
              </>
            ) : (
              <p className="honors-disabled-hint">
                Turn on the tracker to flag honors courses on your flowsheet and
                monitor progress toward your honors experience requirement.
              </p>
            )}
          </section>
        </div>

        {/* ── Right Column ── */}
        <div className="column-right">
          {/* ── Planned Courses Section ── */}
          {plannedTermsSorted.length > 0 && (
            <section className="glass-panel planned-section">
              <h2>
                <Calendar size={20} className="icon-sky" /> Planned Courses
              </h2>
              <p className="section-hint">
                Drag cards between semesters, or use the move icon to reassign.
              </p>
              <div className="planned-flowsheet">
                {plannedTermsSorted.map((term) => (
                  <div
                    key={term}
                    className={`planned-term-col ${
                      dropTargetTerm === term ? "drop-target" : ""
                    }`}
                    onDragOver={(e) => handleDragOver(e, term)}
                    onDrop={(e) => handleDrop(e, term)}
                    onDragLeave={handleDragLeave}
                  >
                    <div className="planned-term-header">
                      <span className="planned-term-label">{term}</span>
                      <span className="planned-term-units">
                        {plannedByTerm[term].reduce((s, c) => s + c.units, 0)}{" "}
                        CR
                      </span>
                    </div>
                    <div className="planned-cards">
                      {plannedByTerm[term].map((course) => (
                        <div
                          key={`${course.term}-${course.id}`}
                          className="planned-card"
                          draggable
                          onDragStart={() => handleDragStart(course)}
                        >
                          <div className="planned-card-actions">
                            <button
                              className="card-action-btn move-btn"
                              title="Move to another semester"
                              onClick={() => openMoveModal(course)}
                            >
                              <ArrowRightLeft size={13} />
                            </button>
                            <button
                              className="card-action-btn delete-btn"
                              title="Remove from plan"
                              onClick={() =>
                                removePlannedCourse(course.term, course.id)
                              }
                            >
                              <X size={13} />
                            </button>
                          </div>
                          <div className="planned-card-id">{course.id}</div>
                          <div className="planned-card-title">
                            {course.title}
                          </div>
                          <div className="planned-card-units">
                            {course.units} CR
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Course Flowsheet ── */}
          <section className="glass-panel flowsheet-section">
            <div className="flowsheet-section-heading">
              <h2>
                <BookOpen className="icon-green" /> Course Flowsheet
              </h2>
              <div className="flowsheet-toolbar">
                <button
                  type="button"
                  className={`btn btn-secondary flowsheet-grade-toggle ${
                    showFlowsheetGrades ? "active" : ""
                  }`}
                  title={
                    showFlowsheetGrades
                      ? "Hide grades and pass/fail styling"
                      : "Show grades and pass/fail styling"
                  }
                  onClick={() => setShowFlowsheetGrades((v) => !v)}
                  aria-pressed={showFlowsheetGrades}
                >
                  {showFlowsheetGrades ? (
                    <EyeOff size={16} />
                  ) : (
                    <Eye size={16} />
                  )}
                  {showFlowsheetGrades ? "Hide grades" : "Show grades"}
                </button>
                <div className="flowsheet-export-actions">
                  <button
                    type="button"
                    className="btn btn-secondary flowsheet-export-btn"
                    title="Download formatted Excel"
                    disabled={
                      flowsheetExporting || flowsheetTermsSorted.length === 0
                    }
                    onClick={() => void exportFlowsheetExcel()}
                  >
                    <FileSpreadsheet size={16} /> Excel
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary flowsheet-export-btn"
                    title="Download as PDF"
                    disabled={
                      flowsheetExporting || flowsheetTermsSorted.length === 0
                    }
                    onClick={() => void runVisualFlowsheetExport("pdf")}
                  >
                    <FileType size={16} /> PDF
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary flowsheet-export-btn"
                    title="Download as PNG image"
                    disabled={
                      flowsheetExporting || flowsheetTermsSorted.length === 0
                    }
                    onClick={() => void runVisualFlowsheetExport("png")}
                  >
                    <FileImage size={16} /> Image
                  </button>
                </div>
              </div>
            </div>
            <div
              ref={flowsheetCaptureRef}
              className={`flowsheet-capture-area ${
                showFlowsheetGrades ? "" : "flowsheet-grades-hidden"
              }`}
            >
              <div className="legend">
                {showFlowsheetGrades && (
                  <>
                    <div className="legend-item">
                      <span className="indicator indicator-taken"></span> Taken
                    </div>
                    <div className="legend-item">
                      <span className="indicator indicator-failed"></span>{" "}
                      Failed
                    </div>
                  </>
                )}
                <div className="legend-item">
                  <span className="indicator indicator-ip"></span> In Progress
                </div>
                <div className="legend-item">
                  <span className="indicator indicator-planned"></span> Planned
                </div>
              </div>

              {flowsheetTermsSorted.length === 0 ? (
                <div className="empty-state flowsheet-empty">
                  <BookOpen size={48} className="empty-icon" />
                  <p>Upload your transcript to see your flowsheet.</p>
                </div>
              ) : (
                <div className="flowsheet-columns">
                  {flowsheetTermsSorted.map((term) => (
                    <div key={term} className="flowsheet-col">
                      <div className="flowsheet-col-header">
                        <div className="flowsheet-col-term">{term}</div>
                        <div className="flowsheet-col-units">
                          Units:{" "}
                          {flowsheetByTerm[term].reduce(
                            (s, c) => s + c.units,
                            0,
                          )}
                        </div>
                      </div>
                      <div className="flowsheet-col-cards">
                        {flowsheetByTerm[term].map((course, i) => {
                          const useStatusStyle = flowsheetUsesGradeFormatting(
                            course.status,
                            showFlowsheetGrades,
                          );
                          const countsAsHonors = course.isHonors !== undefined ? course.isHonors : isAutoHonorsCourse(course.id);
                          const canFlagHonors =
                            honorsTrackerEnabled &&
                            isHonorsEditMode &&
                            courseCountsTowardHonors(course);
                          const gpaExcluded = isExcludedFromGpa(
                            course,
                            state.courses,
                          );
                          return (
                            <div
                              key={`${term}-${i}`}
                              className={[
                                "flowsheet-card",
                                useStatusStyle ? `fcard-${course.status}` : "",
                                honorsTrackerEnabled && countsAsHonors && courseCountsTowardHonors(course) ? "fcard-honors" : "",
                                gpaExcluded ? "fcard-gpa-excluded" : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              title={
                                gpaExcluded
                                  ? "Earlier repeat — excluded from GPA (UB repeat policy)"
                                  : undefined
                              }
                            >
                              {canFlagHonors && (
                                <label
                                  className="fcard-honors-check"
                                  title="Count toward honors experience"
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!countsAsHonors}
                                    onChange={() =>
                                      toggleCourseHonors(course.term, course.id)
                                    }
                                  />
                                  <span>Honors</span>
                                </label>
                              )}
                              <div className="fcard-top">
                                <span className="fcard-id">{course.id}</span>
                                {useStatusStyle && (
                                  <span
                                    className={`fcard-status-dot dot-${course.status}`}
                                  ></span>
                                )}
                              </div>
                              <div className="fcard-title">{course.title}</div>
                              <div className="fcard-bottom">
                                <span className="fcard-units">
                                  {course.units > 0 ? `${course.units} CR` : ""}
                                </span>
                                {showFlowsheetGrades && course.grade && (
                                  <span className="fcard-grade">
                                    {course.grade}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* ── Move Course Modal ── */}
      {movingCourse && (
        <div className="modal-overlay" onClick={() => setMovingCourse(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                Move <span className="modal-course-id">{movingCourse.id}</span>
              </h3>
              <button
                className="modal-close"
                onClick={() => setMovingCourse(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="modal-subtitle">
              Currently in <strong>{movingCourse.term}</strong>
            </p>
            <div className="modal-selects">
              <select
                value={moveSeason}
                onChange={(e) => setMoveSeason(e.target.value)}
                className="input-field"
              >
                {["Winter", "Spring", "Summer", "Fall"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={moveYear}
                onChange={(e) => setMoveYear(parseInt(e.target.value))}
                className="input-field"
              >
                {Array.from({ length: 10 }, (_, i) => currentYear + i).map(
                  (y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setMovingCourse(null)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={confirmMove}>
                Move Course
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Footer ── */}
      <footer className="app-footer">
        <p style={{ marginBottom: "4px" }}>
          <a
            href="https://forms.gle/fcmcj3hYyvAKeiSb8"
            target="_blank"
            rel="noopener noreferrer"
          >
            Report a Bug / Suggestion
          </a>
        </p>
        <p>
          Developed with ❤️ by{" "}
          <a
            href="https://github.com/ShivanshShalabh"
            target="_blank"
            rel="noopener noreferrer"
          >
            Shivansh Shalabh
          </a>{" "}
          |{" "}
          <a
            href="https://www.linkedin.com/in/shivansh-shalabh/"
            target="_blank"
            rel="noopener noreferrer"
          >
            LinkedIn
          </a>
        </p>
        <div
          style={{
            marginTop: "12px",
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            opacity: 0.8,
            display: "flex",
            justifyContent: "center",
            gap: "16px",
          }}
        >
          <span>
            👁️ {viewCount !== null ? viewCount.toLocaleString() : "..."} Views
          </span>
          <span>
            📄 {uploadCount !== null ? uploadCount.toLocaleString() : "..."}{" "}
            Transcripts Parsed
          </span>
        </div>
      </footer>
    </div>
  );
}
