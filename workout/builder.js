/*
 * MaxFit coach workout builder (Max-only).
 *
 * PIN-gated the same way checkin.html is — same Script Property, same
 * localStorage key even, so a PIN typed on either page is remembered for
 * both. The PIN is only actually verified server-side (see checkPin_ in
 * Code.gs) when Save or Delete is tapped; there's nothing sensitive to
 * protect just by loading this page, only by writing to it.
 *
 * A client can have several named workouts (a push/pull/legs split, say),
 * each edited independently — picking a client shows chips for their
 * existing workout names; picking one loads its exercises for editing,
 * typing a brand-new name starts a new one from blank. Saving only ever
 * replaces the one named workout being edited, never a client's other ones.
 */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";
const STAFF_PIN_STORAGE_KEY = "maxfitStaffPin"; // shared with checkin.js

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const els = {
  clientSelect: document.getElementById("clientSelect"),
  workoutNameInput: document.getElementById("workoutNameInput"),
  workoutNameOptions: document.getElementById("workoutNameOptions"),
  chips: document.getElementById("existingWorkoutChips"),
  daysPicker: document.getElementById("daysPicker"),
  rows: document.getElementById("exerciseRows"),
  addButton: document.getElementById("addExerciseButton"),
  pinRow: document.getElementById("pinRow"),
  pinInput: document.getElementById("pinInput"),
  saveButton: document.getElementById("saveButton"),
  deleteButton: document.getElementById("deleteButton"),
  error: document.getElementById("builderError"),
  success: document.getElementById("builderSuccess"),
  exerciseOptions: document.getElementById("exerciseOptions"),
};

// This client's existing workouts, keyed by lowercased name — refreshed
// every time the client selection changes, and consulted whenever the
// workout name field changes so typing an existing name (or picking its
// chip) loads that workout's exercises for editing.
let clientWorkouts = {};

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
  els.success.hidden = true;
}

function currentPin() {
  try {
    const remembered = localStorage.getItem(STAFF_PIN_STORAGE_KEY);
    if (remembered) return remembered;
  } catch (err) {
    // Fall through to whatever's typed in the field.
  }
  return els.pinInput.value.trim();
}

function addRow(exercise) {
  const row = document.createElement("div");
  row.className = "builder__row";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Exercise";
  nameInput.setAttribute("list", "exerciseOptions");
  nameInput.value = (exercise && exercise.name) || "";

  const setsInput = document.createElement("input");
  setsInput.type = "number";
  setsInput.inputMode = "numeric";
  setsInput.placeholder = "Sets";
  setsInput.value = exercise && exercise.sets ? exercise.sets : "";

  const repsInput = document.createElement("input");
  repsInput.type = "text";
  repsInput.placeholder = "Reps";
  repsInput.value = (exercise && exercise.reps) || "";

  const handle = document.createElement("div");
  handle.className = "builder__row-handle";
  handle.textContent = "⠿";
  handle.setAttribute("aria-label", "Drag to reorder");
  makeRowDraggable(row, handle);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "builder__row-remove";
  removeButton.textContent = "×";
  removeButton.setAttribute("aria-label", "Remove exercise");
  removeButton.addEventListener("click", () => row.remove());

  row.appendChild(nameInput);
  row.appendChild(setsInput);
  row.appendChild(repsInput);
  row.appendChild(handle);
  row.appendChild(removeButton);
  els.rows.appendChild(row);
}

/**
 * Press-and-drag on the grip handle to reorder exercise rows — driven by
 * Pointer Events (not native HTML5 drag-and-drop) so it works the same on
 * touch and mouse. elementFromPoint finds whichever row the pointer is
 * currently over; the dragged row hops before/after it depending on which
 * half of that row the pointer is on.
 */
function makeRowDraggable(row, handle) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    row.classList.add("builder__row--dragging");

    function onMove(moveEvent) {
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest(".builder__row");
      if (!target || target === row || target.parentElement !== els.rows) return;
      const rect = target.getBoundingClientRect();
      const before = moveEvent.clientY < rect.top + rect.height / 2;
      els.rows.insertBefore(row, before ? target : target.nextSibling);
    }

    function onUp() {
      row.classList.remove("builder__row--dragging");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

function clearRows() {
  els.rows.innerHTML = "";
}

/** One toggle chip per weekday, built once — schedules which day(s) this named workout is meant for, so the card can name it instead of just saying "tap to choose". Entirely optional: a workout with no days selected still works exactly as before. */
function buildDaysPicker() {
  els.daysPicker.innerHTML = "";
  for (const day of DAY_ABBR) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "builder__day";
    chip.textContent = day[0];
    chip.setAttribute("aria-label", day);
    chip.dataset.day = day;
    chip.addEventListener("click", () => chip.classList.toggle("builder__day--active"));
    els.daysPicker.appendChild(chip);
  }
}

function getSelectedDays() {
  return Array.from(els.daysPicker.querySelectorAll(".builder__day--active")).map((chip) => chip.dataset.day);
}

function setSelectedDays(days) {
  const wanted = new Set(days || []);
  els.daysPicker.querySelectorAll(".builder__day").forEach((chip) => {
    chip.classList.toggle("builder__day--active", wanted.has(chip.dataset.day));
  });
}

async function loadClientList() {
  try {
    const { rows, col } = await fetchSheet();
    const names = rows
      .map((r) => (col.name >= 0 ? String(r[col.name] || "").trim() : ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    els.clientSelect.innerHTML = '<option value="">Choose a client…</option>';
    for (const name of names) {
      const option = document.createElement("option");
      option.value = slugify(name);
      option.textContent = name;
      els.clientSelect.appendChild(option);
    }
  } catch (err) {
    els.clientSelect.innerHTML = '<option value="">Couldn\'t load clients</option>';
  }
}

async function loadExerciseOptions() {
  try {
    const { rows, col } = await fetchExercises();
    els.exerciseOptions.innerHTML = "";
    for (const row of rows) {
      const name = col.name >= 0 ? String(row[col.name] || "").trim() : "";
      if (!name) continue;
      const option = document.createElement("option");
      option.value = name;
      els.exerciseOptions.appendChild(option);
    }
  } catch (err) {
    // No autocomplete list — free-text entry still works fine without it.
  }
}

/** Loads every workout name this client already has, grouped into { lowercaseName: { name, exercises } }. */
async function loadClientWorkouts(clientSlug) {
  clientWorkouts = {};
  if (!clientSlug) return;

  try {
    const { rows, col } = await fetchWorkoutExercises();
    const clientRows = rows
      .filter((r) => String(r[col.client] || "").trim().toLowerCase() === clientSlug)
      .map((r) => ({
        workoutName: (col.workoutName >= 0 ? r[col.workoutName] : "") || "",
        name: (r[col.exercise] || "").trim(),
        sets: parseSessions(r[col.sets], ""),
        reps: (r[col.reps] || "").trim(),
        order: parseSessions(r[col.order], 0),
        days: (col.days >= 0 ? String(r[col.days] || "") : "").split(",").map((d) => d.trim()).filter(Boolean),
        workoutOrder: col.workoutOrder >= 0 ? Number(r[col.workoutOrder]) : NaN,
      }))
      .filter((ex) => ex.name && ex.workoutName);

    for (const ex of clientRows) {
      const key = ex.workoutName.toLowerCase();
      if (!clientWorkouts[key]) {
        clientWorkouts[key] = { name: ex.workoutName, exercises: [], days: ex.days, order: ex.workoutOrder };
      }
      clientWorkouts[key].exercises.push(ex);
    }
    for (const key of Object.keys(clientWorkouts)) {
      clientWorkouts[key].exercises.sort((a, b) => a.order - b.order);
    }
  } catch (err) {
    // Couldn't check for existing workouts — fine, builder just starts blank.
  }
}

function renderChipsAndOptions() {
  els.chips.innerHTML = "";
  els.workoutNameOptions.innerHTML = "";

  const currentName = els.workoutNameInput.value.trim().toLowerCase();
  // Infinity - Infinity is NaN, an invalid sort comparator result — a
  // large finite fallback keeps unordered workouts tied (and stable)
  // instead of relying on how a given engine happens to handle NaN here.
  const UNORDERED = Number.MAX_SAFE_INTEGER;
  const sortedKeys = Object.keys(clientWorkouts).sort(
    (a, b) => (Number.isFinite(clientWorkouts[a].order) ? clientWorkouts[a].order : UNORDERED)
      - (Number.isFinite(clientWorkouts[b].order) ? clientWorkouts[b].order : UNORDERED)
  );

  for (const key of sortedKeys) {
    const workout = clientWorkouts[key];

    const option = document.createElement("option");
    option.value = workout.name;
    els.workoutNameOptions.appendChild(option);

    els.chips.appendChild(buildChip(workout, key === currentName));
  }
}

/**
 * One workout-name chip — tap to load it for editing, or press-and-drag to
 * reorder it among the client's other workouts (same pointer-driven
 * dragging as the exercise rows below). A drag that never moves past a
 * small threshold is treated as a plain tap so the two don't conflict.
 */
function buildChip(workout, isActive) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "builder__chip";
  if (isActive) chip.classList.add("builder__chip--active");
  chip.textContent = workout.name;
  chip.dataset.workoutName = workout.name;

  const DRAG_THRESHOLD = 6;

  chip.addEventListener("pointerdown", (event) => {
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    chip.setPointerCapture(event.pointerId);

    function onMove(moveEvent) {
      if (!dragging) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        chip.classList.add("builder__chip--dragging");
      }
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest(".builder__chip");
      if (!target || target === chip || target.parentElement !== els.chips) return;
      const rect = target.getBoundingClientRect();
      const before = moveEvent.clientX < rect.left + rect.width / 2;
      els.chips.insertBefore(chip, before ? target : target.nextSibling);
    }

    function onUp() {
      chip.removeEventListener("pointermove", onMove);
      chip.removeEventListener("pointerup", onUp);
      chip.removeEventListener("pointercancel", onUp);
      if (dragging) {
        chip.classList.remove("builder__chip--dragging");
        persistChipOrder_();
      } else {
        els.workoutNameInput.value = workout.name;
        loadNamedWorkoutIntoRows(workout.name);
      }
    }

    chip.addEventListener("pointermove", onMove);
    chip.addEventListener("pointerup", onUp);
    chip.addEventListener("pointercancel", onUp);
  });

  return chip;
}

async function persistChipOrder_() {
  const clientSlug = els.clientSelect.value;
  if (!clientSlug) return;

  const order = Array.from(els.chips.querySelectorAll(".builder__chip")).map((chip) => chip.dataset.workoutName);
  const pin = currentPin();

  let result;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "reorderWorkouts", pin, clientSlug, order }),
    });
    result = await res.json();
  } catch (err) {
    showError("Couldn't reach the server — check your connection and try again.");
    return;
  }

  if (result.status === "unauthorized") {
    handleUnauthorized_();
    return;
  }
  if (result.status !== "success") {
    showError(result.message || "Couldn't save the new order — try again.");
    return;
  }

  rememberPin_(pin);
  // Keep clientWorkouts' own order values in sync with what's now on the
  // sheet, so a later renderChipsAndOptions() (e.g. after saving an edit)
  // doesn't undo the drag by re-sorting on stale data.
  order.forEach((name, i) => {
    const key = name.toLowerCase();
    if (clientWorkouts[key]) clientWorkouts[key].order = i;
  });
}

function loadNamedWorkoutIntoRows(workoutName) {
  const key = workoutName.trim().toLowerCase();
  const workout = clientWorkouts[key];
  clearRows();
  if (workout && workout.exercises.length) {
    workout.exercises.forEach(addRow);
    setSelectedDays(workout.days);
    els.deleteButton.hidden = false;
  } else {
    addRow();
    setSelectedDays([]);
    els.deleteButton.hidden = true;
  }
  renderChipsAndOptions();
}

els.clientSelect.addEventListener("change", async () => {
  els.workoutNameInput.value = "";
  clearRows();
  setSelectedDays([]);
  els.deleteButton.hidden = true;
  els.chips.innerHTML = "";
  await loadClientWorkouts(els.clientSelect.value);
  renderChipsAndOptions();
  addRow();
});

els.workoutNameInput.addEventListener("change", () => {
  if (!els.clientSelect.value) return;
  loadNamedWorkoutIntoRows(els.workoutNameInput.value);
});

els.addButton.addEventListener("click", () => addRow());

els.saveButton.addEventListener("click", async () => {
  const clientSlug = els.clientSelect.value;
  const workoutName = els.workoutNameInput.value.trim();

  if (!clientSlug) {
    showError("Pick a client first.");
    return;
  }
  if (!workoutName) {
    showError("Give this workout a name (e.g. Push, Pull, Legs).");
    return;
  }

  const exercises = Array.from(els.rows.children)
    .map((row) => {
      const [nameInput, setsInput, repsInput] = row.querySelectorAll("input");
      return {
        name: nameInput.value.trim(),
        sets: Number(setsInput.value),
        reps: repsInput.value.trim(),
      };
    })
    .filter((ex) => ex.name);

  if (!exercises.length) {
    showError("Add at least one exercise.");
    return;
  }
  if (exercises.some((ex) => !Number.isFinite(ex.sets) || ex.sets < 1)) {
    showError("Every exercise needs a target number of sets.");
    return;
  }

  const days = getSelectedDays();
  const pin = currentPin();
  els.saveButton.disabled = true;
  els.saveButton.textContent = "Saving…";
  els.error.hidden = true;
  els.success.hidden = true;

  let result;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify({ action: "assignWorkout", pin, clientSlug, workoutName, exercises, days }),
    });
    result = await res.json();
  } catch (err) {
    showError("Couldn't reach the server — check your connection and try again.");
    els.saveButton.disabled = false;
    els.saveButton.textContent = "Save Workout";
    return;
  }

  if (result.status === "unauthorized") {
    handleUnauthorized_();
    els.saveButton.disabled = false;
    els.saveButton.textContent = "Save Workout";
    return;
  }

  if (result.status !== "success") {
    showError(result.message || "Something went wrong — try again.");
    els.saveButton.disabled = false;
    els.saveButton.textContent = "Save Workout";
    return;
  }

  rememberPin_(pin);
  els.pinRow.hidden = true;
  els.success.hidden = false;
  els.saveButton.disabled = false;
  els.saveButton.textContent = "Save Workout";
  els.deleteButton.hidden = false;
  await loadClientWorkouts(clientSlug);
  renderChipsAndOptions();
});

els.deleteButton.addEventListener("click", async () => {
  const clientSlug = els.clientSelect.value;
  const workoutName = els.workoutNameInput.value.trim();
  if (!clientSlug || !workoutName) return;
  if (!window.confirm(`Delete "${workoutName}" for this client? This can't be undone.`)) return;

  const pin = currentPin();
  els.deleteButton.disabled = true;
  els.deleteButton.textContent = "Deleting…";
  els.error.hidden = true;
  els.success.hidden = true;

  let result;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "deleteWorkout", pin, clientSlug, workoutName }),
    });
    result = await res.json();
  } catch (err) {
    showError("Couldn't reach the server — check your connection and try again.");
    els.deleteButton.disabled = false;
    els.deleteButton.textContent = "Delete This Workout";
    return;
  }

  if (result.status === "unauthorized") {
    handleUnauthorized_();
    els.deleteButton.disabled = false;
    els.deleteButton.textContent = "Delete This Workout";
    return;
  }

  if (result.status !== "success") {
    showError(result.message || "Something went wrong — try again.");
    els.deleteButton.disabled = false;
    els.deleteButton.textContent = "Delete This Workout";
    return;
  }

  rememberPin_(pin);
  els.deleteButton.disabled = false;
  els.deleteButton.textContent = "Delete This Workout";
  els.deleteButton.hidden = true;
  els.workoutNameInput.value = "";
  clearRows();
  setSelectedDays([]);
  addRow();
  await loadClientWorkouts(clientSlug);
  renderChipsAndOptions();
});

function handleUnauthorized_() {
  try {
    localStorage.removeItem(STAFF_PIN_STORAGE_KEY);
  } catch (err) {
    // Ignore — worst case they retype an already-wrong PIN once more.
  }
  els.pinRow.hidden = false;
  els.pinInput.value = "";
  els.pinInput.focus();
  showError("Incorrect PIN.");
}

function rememberPin_(pin) {
  if (!pin) return;
  try {
    localStorage.setItem(STAFF_PIN_STORAGE_KEY, pin);
  } catch (err) {
    // Ignore — this device just asks for the PIN again next time.
  }
}

(function init() {
  let rememberedPin = "";
  try {
    rememberedPin = localStorage.getItem(STAFF_PIN_STORAGE_KEY) || "";
  } catch (err) {
    // Ignore — pin row just shows as normal.
  }
  els.pinRow.hidden = Boolean(rememberedPin);

  buildDaysPicker();
  loadClientList();
  loadExerciseOptions();
  addRow();
})();
