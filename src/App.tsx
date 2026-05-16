import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  BookOpen,
  Calendar,
  Download,
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
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import {
  captureFlowsheetElement,
  downloadFlowsheetExcel,
  downloadFlowsheetPdf,
  downloadFlowsheetPng,
} from "./flowsheetExport";
import { extractDataFromText } from "./parser";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface Course {
  term: string;
  id: string;
  title: string;
  grade: string;
  units: number;
  status: "taken" | "in-progress" | "planned" | "failed";
  isVariable?: boolean;
}

interface AppState {
  courses: Course[];
}

const DEFAULT_STATE: AppState = { courses: [] };

const GRADE_POINTS: Record<string, number> = {
  "A": 4.0,
  "A-": 3.667,
  "B+": 3.333,
  "B": 3.0,
  "B-": 2.667,
  "C+": 2.333,
  "C": 2.0,
  "C-": 1.667,
  "D+": 1.333,
  "D": 1.0,
  "F": 0.0,
  "U": 0.0,
};

const NON_GPA_GRADES = ["P", "S", "R"];
const VALID_GRADES = [...Object.keys(GRADE_POINTS), ...NON_GPA_GRADES];

// Season order: Winter < Spring < Summer < Fall
const SEASON_ORDER: Record<string, number> = {
  Winter: 0,
  Spring: 1,
  Summer: 2,
  Fall: 3,
};

function sortTerms(terms: string[]): string[] {
  return [...terms].sort((a, b) => {
    const [aS, aY] = a.split(" ");
    const [bS, bY] = b.split(" ");
    const yd = parseInt(aY) - parseInt(bY);
    if (yd !== 0) return yd;
    return (SEASON_ORDER[aS] ?? 4) - (SEASON_ORDER[bS] ?? 4);
  });
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

  const [viewCount, setViewCount] = useState<number | null>(null);
  const [uploadCount, setUploadCount] = useState<number | null>(null);

  useEffect(() => {
    // Increment page views
    fetch("https://api.counterapi.dev/v2/shivansh-shalabhs-team-4143/gpame-views/up")
      .then((res) => res.json())
      .then((data) => setViewCount(data.data.up_count))
      .catch(console.error);

    // Fetch transcript uploads (get current count without incrementing)
    fetch("https://api.counterapi.dev/v2/shivansh-shalabhs-team-4143/gpame-transcripts")
      .then((res) => res.json())
      .then((data) => setUploadCount(data.data.up_count))
      .catch(() => setUploadCount(0));
  }, []);

  const [flowsheetExporting, setFlowsheetExporting] = useState(false);
  const flowsheetCaptureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.className = theme;
    localStorage.setItem("gpame_theme", theme);
  }, [theme]);

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
    if (file.type !== "application/pdf") {
      alert("Please upload a PDF file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        const allItems: { x: number; y: number; str: string }[] = [];
        let pageYOffset = 0;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          const textContent = await page.getTextContent();
          for (const item of textContent.items as any[]) {
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
        const { courses } = extractDataFromText("", allItems);
        setState((prev) => ({
          ...prev,
          courses: [
            ...prev.courses.filter((c) => c.status === "planned"),
            ...courses,
          ],
        }));

        fetch("https://api.counterapi.dev/v2/shivansh-shalabhs-team-4143/gpame-transcripts/up")
          .then((res) => res.json())
          .then((data) => setUploadCount(data.data.up_count))
          .catch(console.error);
      } catch (err) {
        console.error(err);
        alert("Failed to parse PDF.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── Planner actions ─────────────────────────────────────────────────────────
  const addPlannedCourse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlan.id || !newPlan.title) return;
    setState((prev) => ({
      ...prev,
      courses: [...prev.courses, {
        term: `${newPlan.termSeason} ${newPlan.termYear}`,
        id: newPlan.id,
        title: newPlan.title,
        units: newPlan.units,
        grade: "",
        status: "planned",
        isVariable: newPlan.isVariable,
      }],
    }));
    setNewPlan({ ...newPlan, id: "", title: "", units: 3, isVariable: false });
    setCourseSearch("");
  };

  const removePlannedCourse = (term: string, id: string) => {
    setState((prev) => ({
      ...prev,
      courses: prev.courses.filter((c) =>
        !(c.term === term && c.id === id && c.status === "planned")
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
        c.term === movingCourse.term && c.id === movingCourse.id &&
          c.status === "planned"
          ? { ...c, term: newTerm }
          : c
      ),
    }));
    setMovingCourse(null);
  };

  const updateCourse = (term: string, id: string, updates: Partial<Course>) => {
    setState((prev) => ({
      ...prev,
      courses: prev.courses.map((c) =>
        (c.term === term && c.id === id) ? { ...c, ...updates } : c
      ),
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
        course.term === c.term && course.id === c.id &&
          course.status === "planned"
          ? { ...course, term: targetTerm }
          : course
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
    ) setState(DEFAULT_STATE);
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

  const ipAndPlanned = state.courses.filter((c) =>
    c.status === "planned" || c.status === "in-progress"
  );

  let gpaQualityPoints = 0;
  let gpaGradedCredits = 0;
  state.courses.forEach((c) => {
    if (c.grade in GRADE_POINTS) {
      gpaQualityPoints += GRADE_POINTS[c.grade] * c.units;
      gpaGradedCredits += c.units;
    }
  });
  const gpaRoundedQp = Math.round(gpaQualityPoints * 100) / 100;
  const gpaStats = {
    qualityPointsStr: gpaGradedCredits <= 0
      ? "0.00"
      : gpaRoundedQp.toFixed(2),
    creditsStr: gpaGradedCredits <= 0
      ? "0"
      : gpaGradedCredits % 1 === 0
      ? String(gpaGradedCredits)
      : gpaGradedCredits.toFixed(1),
    gpaStr: gpaGradedCredits > 0
      ? (gpaQualityPoints / gpaGradedCredits).toFixed(3)
      : "0.000",
  };

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
      await downloadFlowsheetExcel(flowsheetTermsSorted, flowsheetByTerm);
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
          <strong>100% local.</strong>{" "}
          No data of yours is ever sent out of this device.
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
              onClick={() => setTheme((t) => t === "dark" ? "light" : "dark")}
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
            <strong className="disclaimer-heading">Disclaimer:</strong> This tool is <strong>not affiliated</strong> with the University at Buffalo. 
            It is intended for planning purposes only and should <strong>not</strong> be used for critical academic 
            decisions (e.g., scholarship eligibility, academic standing, or graduation clearance). 
            Always consult your <strong>Academic Advisor</strong> or the official HUB Student Center for authoritative 
            academic records and GPA calculations.
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
              Upload your <strong>University at Buffalo Unofficial Transcript</strong> (PDF). 
              Don't have it? <a href="https://www.buffalo.edu/registrar/instructions-for-using-HUB/transcript-view-unofficial.html" target="_blank" rel="noopener noreferrer">Follow these instructions</a> to download it from HUB.
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
                if (e.dataTransfer.files[0]) {handleFileUpload(
                    e.dataTransfer.files[0],
                  );}
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
                  e.target.files?.[0] && handleFileUpload(e.target.files[0])}
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
            <p className="gpa-subtitle">
              Based on{" "}
              {state.courses.filter((c) => c.grade in GRADE_POINTS).length}{" "}
              graded courses
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
            </p>
            <div className="calculator-list">
              {ipAndPlanned.length === 0
                ? (
                  <div className="empty-state">
                    <p>No planned or in-progress courses.</p>
                  </div>
                )
                : (
                  ipAndPlanned.map((c, idx) => (
                    <div
                      key={`${c.term}-${c.id}-${idx}`}
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
                          updateCourse(c.term, c.id, { grade: e.target.value })}
                        className="calc-grade-select"
                      >
                        <option value="">Grade</option>
                        {VALID_GRADES.map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
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
                    setNewPlan({ ...newPlan, termSeason: e.target.value })}
                  className="input-field"
                >
                  {["Winter", "Spring", "Summer", "Fall"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select
                  value={newPlan.termYear}
                  onChange={(e) =>
                    setNewPlan({
                      ...newPlan,
                      termYear: parseInt(e.target.value),
                    })}
                  className="input-field"
                >
                  {Array.from({ length: 10 }, (_, i) => currentYear + i).map(
                    (y) => <option key={y} value={y}>{y}</option>
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
                    const creditMatch = matched.html.match(
                      /Credits:\s*([\d.-]+)/,
                    );
                    let units = 3, isVar = false;
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
                {courseSearch.length >= 2 && courseOptions
                  .filter((c) =>
                    c.title.toLowerCase().includes(courseSearch.toLowerCase())
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
                        {plannedByTerm[term].reduce((s, c) => s + c.units, 0)}
                        {" "}
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
                                removePlannedCourse(course.term, course.id)}
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
              <div className="flowsheet-export-actions">
                <button
                  type="button"
                  className="btn btn-secondary flowsheet-export-btn"
                  title="Download formatted Excel"
                  disabled={flowsheetExporting ||
                    flowsheetTermsSorted.length === 0}
                  onClick={() => void exportFlowsheetExcel()}
                >
                  <FileSpreadsheet size={16} /> Excel
                </button>
                <button
                  type="button"
                  className="btn btn-secondary flowsheet-export-btn"
                  title="Download as PDF"
                  disabled={flowsheetExporting ||
                    flowsheetTermsSorted.length === 0}
                  onClick={() => void runVisualFlowsheetExport("pdf")}
                >
                  <FileType size={16} /> PDF
                </button>
                <button
                  type="button"
                  className="btn btn-secondary flowsheet-export-btn"
                  title="Download as PNG image"
                  disabled={flowsheetExporting ||
                    flowsheetTermsSorted.length === 0}
                  onClick={() => void runVisualFlowsheetExport("png")}
                >
                  <FileImage size={16} /> Image
                </button>
              </div>
            </div>
            <div ref={flowsheetCaptureRef} className="flowsheet-capture-area">
              <div className="legend">
                <div className="legend-item">
                  <span className="indicator indicator-taken"></span> Taken
                </div>
                <div className="legend-item">
                  <span className="indicator indicator-ip"></span> In Progress
                </div>
                <div className="legend-item">
                  <span className="indicator indicator-failed"></span> Failed
                </div>
                <div className="legend-item">
                  <span className="indicator indicator-planned"></span> Planned
                </div>
              </div>

              {flowsheetTermsSorted.length === 0
                ? (
                  <div className="empty-state flowsheet-empty">
                    <BookOpen size={48} className="empty-icon" />
                    <p>Upload your transcript to see your flowsheet.</p>
                  </div>
                )
                : (
                  <div className="flowsheet-columns">
                    {flowsheetTermsSorted.map((term) => (
                      <div key={term} className="flowsheet-col">
                        <div className="flowsheet-col-header">
                          <div className="flowsheet-col-term">{term}</div>
                          <div className="flowsheet-col-units">
                            Units: {flowsheetByTerm[term].reduce((s, c) =>
                              s + c.units, 0)}
                          </div>
                        </div>
                        <div className="flowsheet-col-cards">
                          {flowsheetByTerm[term].map((course, i) => (
                            <div
                              key={`${term}-${i}`}
                              className={`flowsheet-card fcard-${course.status}`}
                            >
                              <div className="fcard-top">
                                <span className="fcard-id">{course.id}</span>
                                <span
                                  className={`fcard-status-dot dot-${course.status}`}
                                >
                                </span>
                              </div>
                              <div className="fcard-title">{course.title}</div>
                              <div className="fcard-bottom">
                                <span className="fcard-units">
                                  {course.units > 0
                                    ? `${course.units} CR`
                                    : ""}
                                </span>
                                {course.grade && (
                                  <span className="fcard-grade">
                                    {course.grade}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
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
        <div
          className="modal-overlay"
          onClick={() => setMovingCourse(null)}
        >
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
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={moveYear}
                onChange={(e) => setMoveYear(parseInt(e.target.value))}
                className="input-field"
              >
                {Array.from({ length: 10 }, (_, i) => currentYear + i).map(
                  (y) => <option key={y} value={y}>{y}</option>
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
          <a href="https://forms.gle/fcmcj3hYyvAKeiSb8" target="_blank" rel="noopener noreferrer">Report a Bug / Suggestion</a>
        </p>
        <p>
          Developed with ❤️ by{" "}
          <a href="https://github.com/ShivanshShalabh" target="_blank" rel="noopener noreferrer">Shivansh Shalabh</a> |{" "}
          <a href="https://www.linkedin.com/in/shivansh-shalabh/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
        </p>
        <div style={{ marginTop: "12px", fontSize: "0.8rem", color: "var(--text-muted)", opacity: 0.8, display: "flex", justifyContent: "center", gap: "16px" }}>
          <span>👁️ {viewCount !== null ? viewCount.toLocaleString() : "..."} Views</span>
          <span>📄 {uploadCount !== null ? uploadCount.toLocaleString() : "..."} Transcripts Parsed</span>
        </div>
      </footer>
    </div>
  );
}
