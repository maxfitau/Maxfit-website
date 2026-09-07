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

const els = {
  clientSelect: document.getElementById("clientSelect"),
  workoutNameInput: document.getElementById("workoutNameInput"),
  workoutNameOptions: document.getElementById("workoutNameOptions"),
  chips: document.getElementById("existingWorkoutChips"),
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

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "builder__row-remove";
  removeButton.textContent = "×";
  removeButton.setAttribute("aria-label", "Remove exercise");
  removeButton.addEventListener("click", () => row.remove());

  row.appendChild(nameInput);
  row.appendChild(setsInput);
  row.appendChild(repsInput);
  row.appendChild(removeButton);
  els.rows.appendChild(row);
}

function clearRows() {
  els.rows.innerHTML = "";
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
      }))
      .filter((ex) => ex.name && ex.workoutName);

    for (const ex of clientRows) {
      const key = ex.workoutName.toLowerCase();
      if (!clientWorkouts[key]) clientWorkouts[key] = { name: ex.workoutName, exercises: [] };
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
  for (const key of Object.keys(clientWorkouts)) {
    const workout = clientWorkouts[key];

    const option = document.createElement("option");
    option.value = workout.name;
    els.workoutNameOptions.appendChild(option);

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "builder__chip";
    if (key === currentName) chip.classList.add("builder__chip--active");
    chip.textContent = workout.name;
    chip.addEventListener("click", () => {
      els.workoutNameInput.value = workout.name;
      loadNamedWorkoutIntoRows(workout.name);
    });
    els.chips.appendChild(chip);
  }
}

function loadNamedWorkoutIntoRows(workoutName) {
  const key = workoutName.trim().toLowerCase();
  const workout = clientWorkouts[key];
  clearRows();
  if (workout && workout.exercises.length) {
    workout.exercises.forEach(addRow);
    els.deleteButton.hidden = false;
  } else {
    addRow();
    els.deleteButton.hidden = true;
  }
  renderChipsAndOptions();
}

els.clientSelect.addEventListener("change", async () => {
  els.workoutNameInput.value = "";
  clearRows();
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
      body: JSON.stringify({ action: "assignWorkout", pin, clientSlug, workoutName, exercises }),
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

  loadClientList();
  loadExerciseOptions();
  addRow();
})();
