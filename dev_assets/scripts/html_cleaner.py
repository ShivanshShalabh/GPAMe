import json

INPUT_FILE = "courses.json"
OUTPUT_FILE = "trimmed_courses.json"

with open(INPUT_FILE, "r", encoding="utf-8") as f:
    courses = json.load(f)

trimmed = []

for course in courses:
    raw = course.get("rawHtml", "")

    start = raw.find("<div><h3>")
    end = raw.find("</div>", start)

    extracted = ""

    if start != -1 and end != -1:
        extracted = raw[start:end + len("</div>")]

    trimmed.append({
        "coid": course.get("coid"),
        "html": extracted
    })

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(trimmed, f, indent=2, ensure_ascii=False)

print(f"Saved {len(trimmed)} entries to {OUTPUT_FILE}")