/*
 * Workout history calendar — opened from the "Today's Workout" page's
 * history icon (workout/?id=<slug> -> calendar.html?id=<slug>). Same
 * identity resolution as the rest of the workout pages: ?id= in the URL,
 * falling back to whatever the card last remembered in localStorage.
 *
 * Every day this client logged at least one set gets highlighted; tapping
 * one shows exactly what they did that day, grouped by workout name then
 * exercise, sets in order.
 */
const MEMBER_ID_STORAGE_KEY = "maxfitMemberId"; // shared with card/app.js

const params = new URLSearchParams(window.location.search);
let memberId = params.get("id");
if (!memberId) {
  try {
    memberId = localStorage.getItem(MEMBER_ID_STORAGE_KEY);
  } catch (err) {
    // Ignore — memberId stays null, handled below.
  }
}

const els = {
  backLink: document.getElementById("backLink"),
  monthLabel: document.getElementById("monthLabel"),
  prevMonth: document.getElementById("prevMonth"),
  nextMonth: document.getElementById("nextMonth"),
  grid: document.getElementById("calendarGrid"),
  detail: document.getElementById("calendarDetail"),
  detailDate: document.getElementById("calendarDetailDate"),
  detailBody: document.getElementById("calendarDetailBody"),
  detailClose: document.getElementById("calendarDetailClose"),
  status: document.getElementById("status"),
};

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function showStatus(message, isError) {
  els.status.textContent = message;
  els.status.hidden = false;
  els.status.classList.toggle("status--error", Boolean(isError));
}

function formatWeight(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "yyyy-M-d" or "yyyy-MM-dd", whatever the sheet has — normalized to "yyyy-M-d" (no leading zeros) so lookups don't care which the backend happened to write. */
function normalizeDateKey(raw) {
  const parts = String(raw || "").trim().split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

let today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth(); // 0-indexed

// dateKey -> { [workoutName]: { notes, exercises: { [exerciseName]: [{ setNumber, weight, reps }] } } }
let byDate = {};

function addSet(dateKey, workoutName, exerciseName, setNumber, weight, reps, notes) {
  if (!byDate[dateKey]) byDate[dateKey] = {};
  const wName = workoutName || "Workout";
  if (!byDate[dateKey][wName]) byDate[dateKey][wName] = { notes: "", exercises: {} };
  if (!byDate[dateKey][wName].exercises[exerciseName]) byDate[dateKey][wName].exercises[exerciseName] = [];
  byDate[dateKey][wName].exercises[exerciseName].push({ setNumber, weight, reps });
  if (notes) byDate[dateKey][wName].notes = notes;
}

function renderCalendar() {
  els.monthLabel.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
  els.grid.innerHTML = "";

  const firstDay = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startWeekday = firstDay.getDay(); // 0 = Sunday

  for (let i = 0; i < startWeekday; i++) {
    const filler = document.createElement("div");
    filler.className = "calendar__day calendar__day--empty";
    els.grid.appendChild(filler);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${viewYear}-${viewMonth + 1}-${day}`;
    const cell = document.createElement("div");
    cell.className = "calendar__day";
    cell.textContent = String(day);

    const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate();
    if (isToday) cell.classList.add("calendar__day--today");

    if (byDate[dateKey]) {
      cell.classList.add("calendar__day--active");
      cell.addEventListener("click", () => showDetail(dateKey, viewYear, viewMonth, day));
    }

    els.grid.appendChild(cell);
  }
}

function showDetail(dateKey, year, month, day) {
  const dateObj = new Date(year, month, day);
  els.detailDate.textContent = `${MONTH_NAMES[month].slice(0, 3)} ${day}, ${year}`;
  els.detailBody.innerHTML = "";

  const workouts = byDate[dateKey] || {};
  for (const workoutName of Object.keys(workouts)) {
    const section = document.createElement("div");
    section.className = "calendar__detail-workout";

    const name = document.createElement("p");
    name.className = "calendar__detail-workout-name";
    name.textContent = workoutName;
    section.appendChild(name);

    if (workouts[workoutName].notes) {
      const notes = document.createElement("p");
      notes.className = "calendar__detail-notes";
      notes.textContent = workouts[workoutName].notes;
      section.appendChild(notes);
    }

    const exercises = workouts[workoutName].exercises;
    for (const exerciseName of Object.keys(exercises)) {
      const sets = exercises[exerciseName].slice().sort((a, b) => a.setNumber - b.setNumber);

      const exerciseWrap = document.createElement("div");
      exerciseWrap.className = "calendar__detail-exercise";

      const exName = document.createElement("span");
      exName.className = "calendar__detail-exercise-name";
      exName.textContent = exerciseName;
      exerciseWrap.appendChild(exName);

      const setsLine = document.createElement("span");
      setsLine.className = "calendar__detail-exercise-sets";
      setsLine.textContent = sets.map((s) => `${formatWeight(s.weight)}kg × ${s.reps}`).join(", ");
      exerciseWrap.appendChild(setsLine);

      section.appendChild(exerciseWrap);
    }

    els.detailBody.appendChild(section);
  }

  els.detail.hidden = false;
  els.detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  void dateObj; // reserved for future use (e.g. "X days ago"), kept for clarity of intent
}

els.prevMonth.addEventListener("click", () => {
  viewMonth--;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear--;
  }
  els.detail.hidden = true;
  renderCalendar();
});

els.nextMonth.addEventListener("click", () => {
  viewMonth++;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear++;
  }
  els.detail.hidden = true;
  renderCalendar();
});

els.detailClose.addEventListener("click", () => {
  els.detail.hidden = true;
});

async function init() {
  if (!memberId) {
    showStatus("Open this from your membership card.", true);
    return;
  }

  els.backLink.href = `./?id=${encodeURIComponent(memberId)}`;
  const clientSlug = slugify(memberId);

  try {
    const { rows, col } = await fetchLoggedSets();
    for (const r of rows) {
      if (String(r[col.client] || "").trim().toLowerCase() !== clientSlug) continue;

      const dateKey = normalizeDateKey(col.date >= 0 ? r[col.date] : "");
      if (!dateKey) continue;

      const workoutName = col.workoutName >= 0 ? String(r[col.workoutName] || "").trim() : "";
      const exerciseName = (col.exercise >= 0 ? r[col.exercise] : "").trim();
      const setNumber = Number(col.setNumber >= 0 ? r[col.setNumber] : NaN);
      const weight = Number(col.weight >= 0 ? r[col.weight] : NaN);
      const reps = Number(col.reps >= 0 ? r[col.reps] : NaN);
      const notes = col.notes >= 0 ? String(r[col.notes] || "").trim() : "";
      if (!exerciseName || !Number.isFinite(weight) || !Number.isFinite(reps)) continue;

      addSet(dateKey, workoutName, exerciseName, Number.isFinite(setNumber) ? setNumber : 0, weight, reps, notes);
    }
  } catch (err) {
    showStatus("Couldn't load your workout history. Check your connection and reopen.", true);
    return;
  }

  renderCalendar();
}

init();
