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
const DRAFT_KEY_PREFIX = "maxfitWorkoutDraft|"; // same key format as workout/app.js

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
  progressLink: document.getElementById("progressLink"),
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

function addSet(dateKey, workoutName, exerciseName, setNumber, weight, reps, notes, duration, type, distance) {
  if (!byDate[dateKey]) byDate[dateKey] = {};
  const wName = workoutName || "Workout";
  if (!byDate[dateKey][wName]) byDate[dateKey][wName] = { notes: "", exercises: {} };
  if (!byDate[dateKey][wName].exercises[exerciseName]) byDate[dateKey][wName].exercises[exerciseName] = [];
  const list = byDate[dateKey][wName].exercises[exerciseName];
  // The sheet is append-only, so a set that was saved twice appears twice —
  // the later row is the current one. Collapsing them here means a
  // duplicated row never shows as a phantom extra set (and saving the day
  // writes it back once).
  // Mix it up interval/AMRAP rows (2026-11-09) are never merged: the same exercise can legitimately appear twice with the same round number (two blocks), and saving the day must write every one back.
  const timed = type === "interval" || type === "amrap";
  const existing = timed ? null : list.find((s) => s.setNumber === setNumber);
  if (existing) {
    existing.weight = weight;
    existing.reps = reps;
    existing.duration = duration;
    existing.type = type;
    existing.distance = distance;
  } else {
    list.push({ setNumber, weight, reps, duration, type, distance });
  }
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
    // This edit is now the newest word on that day. A copy of the same
    // session still saved on the workout page (from logging it there) would
    // otherwise come back the next time it opens and undo the change.
    try {
      localStorage.removeItem(`${DRAFT_KEY_PREFIX}${dayState.clientSlug}|${workoutName.trim().toLowerCase()}|${dateStr}`);
    } catch (err) {
      // Storage unavailable — there's no local copy to clear.
    }
    const sets = [];
    for (const exerciseName of Object.keys(workout.exercises)) {
      for (const s of workout.exercises[exerciseName]) {
        const set = { exercise: exerciseName, setNumber: s.setNumber, weight: s.weight, reps: s.reps };
        // A boxing round's Duration/Type, or a run/walk's Duration/Type/
        // Distance — carried through so editing one exercise on a day that
        // also has one of these on it doesn't silently strip them back to
        // looking like a normal 0kg/0rep set (saveWorkoutSession replaces
        // the whole day's session at once).
        if (Number.isFinite(s.duration)) set.duration = s.duration;
        if (s.type === "round" || s.type === "pads" || s.type === "run" || s.type === "walk" || s.type === "interval" || s.type === "amrap") set.type = s.type;
        if (Number.isFinite(s.distance)) set.distance = s.distance;
        sets.push(set);
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
    // Mix it up (2026-11-09): "Mix it up · Fight Night · 32 min · Steady", from the workout name and the note the session was saved with ("Mix it up · Boxing · 32 min · Steady — how it felt").
    let noteText = workout.notes;
    if (/^mix it up:/i.test(workoutName)) {
      const parts = String(workout.notes || "").split(" — ");
      const facts = parts[0].split(" · ");
      if (facts.length >= 4 && /^mix it up$/i.test(facts[0])) {
        name.textContent = `Mix it up · ${workoutName.replace(/^mix it up:\s*/i, "")} · ${facts[2]} · ${facts[3]}`;
        noteText = parts.slice(1).join(" — ");
      } else {
        name.textContent = `Mix it up · ${workoutName.replace(/^mix it up:\s*/i, "")}`;
        noteText = "";
      }
    }
    section.appendChild(name);

    if (noteText) {
      const notes = document.createElement("p");
      notes.className = "calendar__detail-notes";
      notes.textContent = noteText;
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

  const sets = dayState.workouts[workoutName].exercises[exerciseName];
  // Boxing rounds (2026-11-07): every row for this exercise is a "round" or
  // "pads" entry — shown as "Heavy Bag · 3 rounds × 2:00" / "Pad work with
  // Max · 6 rounds × 2:00" rather than the usual weight/reps set list.
  // workSeconds is approximated from the longest round actually logged
  // (ended-early rounds run shorter, so this stays accurate for a full one).
  const isBoxing = sets.length > 0 && sets.every((s) => s.type === "round" || s.type === "pads");
  // A run or walk (2026-11-08): always exactly one row, Type "run"/"walk" —
  // shown as "Run · 5.2 km · 32:10 · 6:11 /km" rather than the usual
  // weight/reps set list, same treatment as a boxing block above.
  const isCardio = sets.length === 1 && (sets[0].type === "run" || sets[0].type === "walk");
  // Mix it up (2026-11-09): "Goblet squats · 3 rounds × 0:40" for intervals, "Plank · 5 rounds" for an AMRAP.
  const isInterval = sets.length > 0 && sets.every((s) => s.type === "interval");
  const isAmrap = sets.length > 0 && sets.every((s) => s.type === "amrap");
  const exName = document.createElement("span");
  exName.className = "calendar__detail-exercise-name";
  if (isInterval) {
    const sec = Math.max(0, ...sets.map((s) => (Number.isFinite(s.duration) ? s.duration : 0)));
    exName.textContent = `${exerciseName} · ${sets.length} round${sets.length === 1 ? "" : "s"} × ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  } else if (isAmrap) {
    const rounds = sets.reduce((n, s) => n + (Number(s.reps) || 0), 0);
    exName.textContent = `${exerciseName} · ${rounds} round${rounds === 1 ? "" : "s"}`;
  } else if (isBoxing) {
    const isPads = sets[0].type === "pads";
    const workSeconds = Math.max(0, ...sets.map((s) => (Number.isFinite(s.duration) ? s.duration : 0)));
    const mins = Math.floor(workSeconds / 60);
    const secs = workSeconds % 60;
    const workText = secs ? `${mins}:${String(secs).padStart(2, "0")}` : `${mins} min`;
    exName.textContent = `${exerciseName}${isPads ? " with Max" : ""} · ${sets.length} round${sets.length === 1 ? "" : "s"} × ${workText}`;
  } else if (isCardio) {
    const s = sets[0];
    const totalSeconds = Math.max(0, Number(s.duration) || 0);
    const timeText = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
    const km = Number(s.distance) || 0;
    let paceText = "";
    if (km > 0 && totalSeconds > 0) {
      const perKm = totalSeconds / km;
      paceText = ` · ${Math.floor(perKm / 60)}:${String(Math.round(perKm % 60)).padStart(2, "0")} /km`;
    }
    exName.textContent = `${s.type === "walk" ? "Walk" : "Run"} · ${km.toFixed(1)} km · ${timeText}${paceText}`;
  } else {
    exName.textContent = exerciseName;
  }
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

  const { rows, col } = await fetchLoggedSets(clientSlug);
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
    const duration = col.duration >= 0 ? Number(r[col.duration]) : NaN;
    const type = col.type >= 0 ? String(r[col.type] || "").trim() : "";
    const distance = col.distance >= 0 ? Number(r[col.distance]) : NaN;

    addSet(dateKey, workoutName, exerciseName, Number.isFinite(setNumber) ? setNumber : 0, weight, reps, notes, Number.isFinite(duration) ? duration : undefined, type || undefined, Number.isFinite(distance) ? distance : undefined);
  }
}

async function init() {
  if (!memberId) {
    showStatus("Open this from your membership card.", true);
    return;
  }

  els.backLink.href = `./?id=${encodeURIComponent(memberId)}`;
  els.progressLink.href = `progress.html?id=${encodeURIComponent(memberId)}`;

  try {
    await reloadHistory_();
  } catch (err) {
    showStatus("Couldn't load your workout history. Check your connection and reopen.", true);
    return;
  }

  renderCalendar();
}

init();
