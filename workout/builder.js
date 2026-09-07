/*
 * MaxFit coach workout builder (Max-only).
 *
 * PIN-gated the same way checkin.html is — same Script Property, same
 * localStorage key even, so a PIN typed on either page is remembered for
 * both. The PIN is only actually verified server-side (see checkPin_ in
 * Code.gs) when Save is tapped; there's nothing sensitive to protect just
 * by loading this page, only by writing to it.
 *
 * Picking a client loads their current assigned workout (if any) straight
 * into the rows below, so adjusting an existing plan is just editing what's
 * already there rather than rebuilding it from scratch every time.
 *
 * Saving replaces that client's entire workout outright — there's only
 * ever one "current" one, matching the single "Today's Workout" tile on
 * their card.
 */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";
const STAFF_PIN_STORAGE_KEY = "maxfitStaffPin"; // shared with checkin.js

const els = {
  clientSelect: document.getElementById("clientSelect"),
  rows: document.getElementById("exerciseRows"),
  addButton: document.getElementById("addExerciseButton"),
  pinRow: document.getElementById("pinRow"),
  pinInput: document.getElementById("pinInput"),
  saveButton: document.getElementById("saveButton"),
  error: document.getElementById("builderError"),
  success: document.getElementById("builderSuccess"),
  exerciseOptions: document.getElementById("exerciseOptions"),
};

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

async function loadClientWorkout(clientSlug) {
  clearRows();
  if (!clientSlug) return;

  try {
    const { rows, col } = await fetchWorkoutExercises();
    const existing = rows
      .filter((r) => String(r[col.client] || "").trim().toLowerCase() === clientSlug)
      .map((r) => ({
        name: (r[col.exercise] || "").trim(),
        sets: parseSessions(r[col.sets], ""),
        reps: (r[col.reps] || "").trim(),
        order: parseSessions(r[col.order], 0),
      }))
      .filter((ex) => ex.name)
      .sort((a, b) => a.order - b.order);

    if (existing.length) {
      existing.forEach(addRow);
      return;
    }
  } catch (err) {
    // Couldn't check for an existing workout — fine, just start blank below.
  }

  addRow();
}

els.clientSelect.addEventListener("change", () => {
  loadClientWorkout(els.clientSelect.value);
});

els.addButton.addEventListener("click", () => addRow());

els.saveButton.addEventListener("click", async () => {
  const clientSlug = els.clientSelect.value;
  if (!clientSlug) {
    showError("Pick a client first.");
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
      body: JSON.stringify({ action: "assignWorkout", pin, clientSlug, exercises }),
    });
    result = await res.json();
  } catch (err) {
    showError("Couldn't reach the server — check your connection and try again.");
    els.saveButton.disabled = false;
    els.saveButton.textContent = "Save Workout";
    return;
  }

  if (result.status === "unauthorized") {
    try {
      localStorage.removeItem(STAFF_PIN_STORAGE_KEY);
    } catch (err) {
      // Ignore — worst case they retype an already-wrong PIN once more.
    }
    els.pinRow.hidden = false;
    els.pinInput.value = "";
    els.pinInput.focus();
    showError("Incorrect PIN.");
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

  if (pin) {
    try {
      localStorage.setItem(STAFF_PIN_STORAGE_KEY, pin);
    } catch (err) {
      // Ignore — this device just asks for the PIN again next time.
    }
  }

  els.pinRow.hidden = true;
  els.success.hidden = false;
  els.saveButton.disabled = false;
  els.saveButton.textContent = "Save Workout";
});

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
