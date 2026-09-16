/*
 * Workout history calendar — opened from the workout page's "View Previous
 * Sessions" button (workout/?id=<slug> -> calendar.html?id=<slug>). Same
 * identity resolution as the rest of the workout pages: ?id= in the URL,
 * falling back to whatever the card last remembered in localStorage.
 *
 * Every day this client logged at least one set gets highlighted; tapping
 * one opens it for editing — add a set, remove one, remove a whole
 * exercise, or just fix a number. Every change auto-saves immediately
 * (there's no separate Save button to forget to press, and nothing is
 * lost by just closing the panel), and Undo steps back through whatever
 * was changed in this viewing session.
 */
const MEMBER_ID_STORAGE_KEY = "maxfitMemberId"; // shared with card/app.js
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";

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
  undoBtn: document.getElementById("calendarUndoBtn"),
  saveStatus: document.getElementById("calendarSaveStatus"),
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

/** The exact "yyyy-MM-dd" form the backend writes and matches on — built locally rather than trusting whatever string the sheet happened to have, so a save always targets the right row regardless of how that got there. */
function backendDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
      cell.addEventListener("click", () => openDay(dateKey, viewYear, viewMonth, day));
    }

    els.grid.appendChild(cell);
  }
}

// ---- Editable day detail ------------------------------------------------

// The day currently open in the detail panel. { clientSlug, year, month,
// day, workouts: { [workoutName]: { notes, exercises: { [name]: [{setNumber, weight, reps}]} } } }
let dayState = null;
let undoStack = [];
let clientSlugForEdits = "";

function snapshotForUndo_() {
  undoStack.push(JSON.parse(JSON.stringify(dayState.workouts)));
  if (undoStack.length > 25) undoStack.shift();
  els.undoBtn.hidden = false;
}

function showSaveStatus_(text, isError) {
  els.saveStatus.textContent = text;
  els.saveStatus.hidden = false;
  els.saveStatus.classList.toggle("calendar__save-status--error", Boolean(isError));
  if (!isError) {
    clearTimeout(showSaveStatus_._t);
    showSaveStatus_._t = setTimeout(() => {
      els.saveStatus.hidden = true;
    }, 1500);
  }
}

/** Saves every workout group present in the currently-open day — small (usually 1-2 groups), and simplest to keep all of them consistent with dayState after any edit. */
async function saveDay_() {
  if (!dayState) return;
  showSaveStatus_("Saving…", false);

  const dateStr = backendDateStr(dayState.year, dayState.month, dayState.day);
  const requests = Object.keys(dayState.workouts).map((workoutName) => {
    const workout = dayState.workouts[workoutName];
    const sets = [];
    for (const exerciseName of Object.keys(workout.exercises)) {
      for (const s of workout.exercises[exerciseName]) {
        sets.push({ exercise: exerciseName, setNumber: s.setNumber, weight: s.weight, reps: s.reps });
      }
    }
    return fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "saveWorkoutSession",
        clientSlug: dayState.clientSlug,
        workoutName,
        date: dateStr,
        sets,
        notes: workout.notes || "",
      }),
    }).then((res) => res.json());
  });

  try {
    const results = await Promise.all(requests);
    if (results.some((r) => r.status !== "success")) throw new Error("save failed");
    showSaveStatus_("Saved", false);
  } catch (err) {
    showSaveStatus_("Couldn't save — check your connection", true);
  }
}

function renumberSets_(sets) {
  sets.sort((a, b) => a.setNumber - b.setNumber);
  sets.forEach((s, i) => {
    s.setNumber = i + 1;
  });
}

/**
 * Keeps the calendar's own highlighted-day cache in sync with whatever's
 * just been edited, so closing and reopening the same day (without a full
 * page reload) shows the current state, and a day edited down to nothing
 * stops being highlighted immediately.
 */
function commitDayChange_() {
  renderDay_();
  const dateKey = `${dayState.year}-${dayState.month + 1}-${dayState.day}`;
  const hasAnything = Object.values(dayState.workouts).some((w) => Object.keys(w.exercises).length);
  if (hasAnything) {
    byDate[dateKey] = JSON.parse(JSON.stringify(dayState.workouts));
  } else {
    delete byDate[dateKey];
  }
  renderCalendar();
  saveDay_();
}

function renderDay_() {
  const { year, month, day, workouts } = dayState;
  els.detailDate.textContent = `${MONTH_NAMES[month].slice(0, 3)} ${day}, ${year}`;
  els.detailBody.innerHTML = "";

  const workoutNames = Object.keys(workouts);
  if (!workoutNames.length) {
    const empty = document.createElement("p");
    empty.className = "calendar__detail-empty";
    empty.textContent = "Nothing logged this day anymore.";
    els.detailBody.appendChild(empty);
    return;
  }

  for (const workoutName of workoutNames) {
    const workout = workouts[workoutName];
    const section = document.createElement("div");
    section.className = "calendar__detail-workout";

    const name = document.createElement("p");
    name.className = "calendar__detail-workout-name";
    name.textContent = workoutName;
    section.appendChild(name);

    if (workout.notes) {
      const notes = document.createElement("p");
      notes.className = "calendar__detail-notes";
      notes.textContent = workout.notes;
      section.appendChild(notes);
    }

    const exerciseNames = Object.keys(workout.exercises);
    if (!exerciseNames.length) {
      const empty = document.createElement("p");
      empty.className = "calendar__detail-empty";
      empty.textContent = "No exercises left for this workout.";
      section.appendChild(empty);
    }

    for (const exerciseName of exerciseNames) {
      section.appendChild(buildExerciseEditor_(workoutName, exerciseName));
    }

    els.detailBody.appendChild(section);
  }
}

function buildExerciseEditor_(workoutName, exerciseName) {
  const wrap = document.createElement("div");
  wrap.className = "calendar__edit-exercise";

  const head = document.createElement("div");
  head.className = "calendar__edit-exercise-head";

  const exName = document.createElement("span");
  exName.className = "calendar__detail-exercise-name";
  exName.textContent = exerciseName;
  head.appendChild(exName);

  const removeExerciseBtn = document.createElement("button");
  removeExerciseBtn.type = "button";
  removeExerciseBtn.className = "calendar__remove-exercise";
  removeExerciseBtn.textContent = "Remove exercise";
  removeExerciseBtn.addEventListener("click", () => {
    snapshotForUndo_();
    delete dayState.workouts[workoutName].exercises[exerciseName];
    commitDayChange_();
  });
  head.appendChild(removeExerciseBtn);

  wrap.appendChild(head);

  const setsWrap = document.createElement("div");
  setsWrap.className = "calendar__edit-sets";
  wrap.appendChild(setsWrap);

  const sets = dayState.workouts[workoutName].exercises[exerciseName];
  sets.sort((a, b) => a.setNumber - b.setNumber);
  sets.forEach((set, i) => {
    setsWrap.appendChild(buildSetEditor_(workoutName, exerciseName, i));
  });

  const addSetBtn = document.createElement("button");
  addSetBtn.type = "button";
  addSetBtn.className = "calendar__add-set";
  addSetBtn.textContent = "+ Add Set";
  addSetBtn.addEventListener("click", () => {
    snapshotForUndo_();
    const list = dayState.workouts[workoutName].exercises[exerciseName];
    const last = list[list.length - 1];
    list.push({ setNumber: list.length + 1, weight: last ? last.weight : 0, reps: last ? last.reps : 0 });
    commitDayChange_();
  });
  wrap.appendChild(addSetBtn);

  return wrap;
}

function buildSetEditor_(workoutName, exerciseName, index) {
  const row = document.createElement("div");
  row.className = "calendar__edit-set";

  const set = dayState.workouts[workoutName].exercises[exerciseName][index];

  const label = document.createElement("span");
  label.className = "calendar__edit-set-num";
  label.textContent = `Set ${index + 1}`;
  row.appendChild(label);

  const weightInput = document.createElement("input");
  weightInput.type = "text";
  weightInput.inputMode = "decimal";
  weightInput.className = "calendar__edit-input";
  weightInput.value = formatWeight(set.weight);
  weightInput.addEventListener("change", () => {
    const value = Number(weightInput.value);
    if (!Number.isFinite(value) || value < 0) {
      weightInput.value = formatWeight(set.weight);
      return;
    }
    snapshotForUndo_();
    set.weight = value;
    saveDay_();
  });
  row.appendChild(weightInput);

  const repsInput = document.createElement("input");
  repsInput.type = "number";
  repsInput.inputMode = "numeric";
  repsInput.className = "calendar__edit-input";
  repsInput.value = String(set.reps);
  repsInput.addEventListener("change", () => {
    const value = Number(repsInput.value);
    if (!Number.isFinite(value) || value < 0) {
      repsInput.value = String(set.reps);
      return;
    }
    snapshotForUndo_();
    set.reps = value;
    saveDay_();
  });
  row.appendChild(repsInput);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "calendar__remove-set";
  removeBtn.textContent = "×";
  removeBtn.setAttribute("aria-label", "Remove set");
  removeBtn.addEventListener("click", () => {
    snapshotForUndo_();
    const list = dayState.workouts[workoutName].exercises[exerciseName];
    list.splice(index, 1);
    renumberSets_(list);
    if (!list.length) delete dayState.workouts[workoutName].exercises[exerciseName];
    commitDayChange_();
  });
  row.appendChild(removeBtn);

  return row;
}

function openDay(dateKey, year, month, day) {
  const workouts = byDate[dateKey] || {};
  dayState = {
    clientSlug: clientSlugForEdits,
    year,
    month,
    day,
    workouts: JSON.parse(JSON.stringify(workouts)),
  };
  undoStack = [];
  els.undoBtn.hidden = true;
  els.saveStatus.hidden = true;

  renderDay_();
  els.detail.hidden = false;
  els.detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

els.undoBtn.addEventListener("click", () => {
  if (!undoStack.length) return;
  dayState.workouts = undoStack.pop();
  if (!undoStack.length) els.undoBtn.hidden = true;
  commitDayChange_();
});

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

async function reloadHistory_() {
  const clientSlug = slugify(memberId);
  clientSlugForEdits = clientSlug;
  byDate = {};

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
}

async function init() {
  if (!memberId) {
    showStatus("Open this from your membership card.", true);
    return;
  }

  els.backLink.href = `./?id=${encodeURIComponent(memberId)}`;

  try {
    await reloadHistory_();
  } catch (err) {
    showStatus("Couldn't load your workout history. Check your connection and reopen.", true);
    return;
  }

  renderCalendar();
}

init();
