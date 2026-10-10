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
  sideFigs: document.getElementById("builderSideFigs"),
  sideHeatList: document.getElementById("builderSideHeatList"),
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

/**
 * The visible exercise control — a button, not a text input, so the only
 * way to set a name is to pick one from ExercisePicker (or add a new one
 * through it). That's what guarantees "Bench Press" is spelled the same
 * way every time it's assigned, so its logged history is never split by a
 * typo. The actual name travels in nameValueInput (a hidden input, read by
 * the save handler below) so the picked name survives the same as any
 * other field even though it isn't typed.
 *
 * No per-row muscle chip list any more (2026-10-05) — that detail used to
 * be spelled out on every single row ("Mid Chest, Lower Chest, Front
 * Delt..."), which made a long workout very tall for little reason once
 * the side "Muscles Worked" panel shows the same thing once, aggregated,
 * for the whole workout. The picked primary/secondary keys still travel
 * with the row (on wrap.dataset) so refreshMuscleLoadPanel_ can read them.
 *
 * A row with a name but no primary AND no secondary muscles — whether its
 * name never resolved in the Exercises catalog at all, or it resolved to a
 * real row that just has no muscle data set yet — shows a small warning
 * (2026-10-09) rather than silently contributing nothing to the panel with
 * no explanation. No separate "fix it" control needed: the row is already
 * a button that reopens the picker on tap, so tapping it is the fix.
 */
function buildExerciseControl(exercise) {
  const wrap = document.createElement("button");
  wrap.type = "button";
  wrap.className = "builder__row-exercise";

  const top = document.createElement("span");
  top.className = "builder__row-exercise-top";

  const dot = document.createElement("span");
  dot.className = "exercise-dot";
  dot.hidden = true;

  const label = document.createElement("span");
  label.className = "builder__row-exercise-label";

  const warning = document.createElement("span");
  warning.className = "builder__row-exercise-warning";
  warning.textContent = "⚠ No muscle data — won't count. Tap to fix.";
  warning.hidden = true;

  const nameValueInput = document.createElement("input");
  nameValueInput.type = "hidden";
  nameValueInput.className = "builder__row-name-value";

  function setChosen(name, movement, bodyPart, primaryMuscles, secondaryMuscles, muscleWeights) {
    nameValueInput.value = name || "";
    wrap.dataset.exerciseName = name || "";
    wrap.dataset.movement = movement || "";
    wrap.dataset.bodyPart = bodyPart || "";
    wrap.dataset.primaryMuscles = (primaryMuscles || []).join(",");
    wrap.dataset.secondaryMuscles = (secondaryMuscles || []).join(",");
    wrap.dataset.muscleWeights = muscleWeights || "";
    warning.hidden = !name || Boolean((primaryMuscles && primaryMuscles.length) || (secondaryMuscles && secondaryMuscles.length) || muscleWeights);
    if (name) {
      label.textContent = name;
      wrap.classList.remove("builder__row-exercise--empty");
      if (bodyPart) {
        dot.style.background = ExercisePicker.colorFor(bodyPart);
        dot.hidden = false;
      } else {
        dot.hidden = true;
      }
    } else {
      label.textContent = "Choose exercise";
      wrap.classList.add("builder__row-exercise--empty");
      dot.hidden = true;
    }
  }

  setChosen(
    (exercise && exercise.name) || "",
    exercise && exercise.movement,
    exercise && exercise.bodyPart,
    exercise && exercise.primaryMuscles,
    exercise && exercise.secondaryMuscles,
    exercise && exercise.muscleWeights
  );

  wrap.addEventListener("click", () => {
    ExercisePicker.open({
      onChoose: (picked) => {
        setChosen(picked.name, picked.movement, picked.bodyPart, picked.primaryMuscles, picked.secondaryMuscles, picked.muscleWeights);
        refreshMuscleLoadPanel_();
      },
    });
  });

  top.appendChild(dot);
  top.appendChild(label);
  wrap.appendChild(top);
  wrap.appendChild(warning);
  return { control: wrap, nameValueInput };
}

/**
 * The "+ Superset with next" toggle at the bottom of a row — lives inside
 * the row (not a separate element between rows) so it travels automatically
 * with drag-reordering and the up/down buttons, same as everything else on
 * the row. Means "this exercise and whichever one ends up right after it
 * are done back-to-back, minimal rest" — chains naturally for a tri-set by
 * marking every exercise but the last in the group, and never goes stale
 * when rows are reordered since it's not a separate named group to keep in
 * sync. The last row in the list never gets to be "linked to next" (there
 * is no next) — refreshSupersetAvailability_ keeps that in sync.
 */
function buildSupersetToggle_(row, initial) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "builder__superset-toggle";
  row.dataset.superset = initial ? "true" : "false";

  function render() {
    const on = row.dataset.superset === "true";
    btn.classList.toggle("builder__superset-toggle--on", on);
    btn.textContent = on ? "⚡ Superset with next — tap to unlink" : "+ Superset with next exercise";
  }
  render();

  btn.addEventListener("click", () => {
    row.dataset.superset = row.dataset.superset === "true" ? "false" : "true";
    render();
  });

  return btn;
}

/** Hides the superset toggle on whichever row is currently last — there's no "next" for it to link to. Call after any add/remove/reorder. */
function refreshSupersetAvailability_() {
  const rows = Array.from(els.rows.children);
  rows.forEach((row, i) => {
    const btn = row.querySelector(".builder__superset-toggle");
    if (!btn) return;
    const isLast = i === rows.length - 1;
    btn.hidden = isLast;
    if (isLast) row.dataset.superset = "false"; // nothing to link to — don't silently save a stale "true"
  });
}

// How many weighted sets (primary counts 1, secondary 0.5 — same weighting
// as the Muscle Heatmap, workout/heatmap.js) reads as "fully red" on the
// side panel's figure. A single workout, not a week, so a much lower cap
// than the heatmap's own.
const BUILDER_MUSCLE_LOAD_CAP_ = 7;

/**
 * The side panel's live "Muscles Worked" summary — every row's own
 * primary/secondary muscles (stashed on wrap.dataset by setChosen above),
 * weighted by that row's own Sets value and summed across the whole
 * workout currently being built. Pure client side, no network call, same
 * as every other muscle-map computation in this app. Call after anything
 * that changes which exercises are in the workout or how many sets they
 * have: addRow, a row's remove button, a Sets edit, and an exercise being
 * (re)picked (see the onChoose handler above).
 */
function refreshMuscleLoadPanel_() {
  const weighted = {};
  const primaryCount = {};
  const secondaryCount = {};
  // Per muscle, how much each exercise NAME in this workout contributes —
  // the figure tooltip's "top 3 contributing exercises" (Goal 4, 2026-10-09).
  const contributionsByMuscle = {};

  Array.from(els.rows.children).forEach((row) => {
    const control = row.querySelector(".builder__row-exercise");
    const setsInput = row.querySelector("input");
    const sets = setsInput ? Number(setsInput.value) : NaN;
    if (!control || !Number.isFinite(sets) || sets <= 0) return;

    const primary = (control.dataset.primaryMuscles || "").split(",").filter(Boolean);
    const secondary = (control.dataset.secondaryMuscles || "").split(",").filter(Boolean);
    const muscleWeights = control.dataset.muscleWeights || "";
    const exerciseName = control.dataset.exerciseName || "";
    // Effective-sets model (2026-10-09) — same engine the Muscles tab's
    // weekly heatmap and the live Train panel use, so a planned workout
    // previews exactly what logging it will actually score. Caps a single
    // set's contribution to any muscle GROUP at 1.0 even when the exercise
    // lists more than one fine head for it, then scales by how many sets
    // this row plans. primaryCount/secondaryCount stay the plain
    // catalog-role tally the red/orange segments show.
    const perSet = effectiveSetsPerSet_({ catalogName: exerciseName, primary, secondary, muscleWeights });
    Object.keys(perSet).forEach((k) => {
      const contribution = perSet[k] * sets;
      weighted[k] = (weighted[k] || 0) + contribution;
      const byExercise = (contributionsByMuscle[k] = contributionsByMuscle[k] || {});
      byExercise[exerciseName] = (byExercise[exerciseName] || 0) + contribution;
    });
    new Set(primary).forEach((k) => {
      primaryCount[k] = (primaryCount[k] || 0) + sets;
    });
    new Set(secondary).forEach((k) => {
      secondaryCount[k] = (secondaryCount[k] || 0) + sets;
    });
  });

  // Any open tooltip is anchored to a shape from the figure we're about to
  // throw away below (muscleFigureSvg builds fresh DOM every call).
  muscleTooltipHide_();

  const frontSvg = muscleFigureSvg("front", "builderSideFrontTitle");
  const backSvg = muscleFigureSvg("back", "builderSideBackTitle");
  els.sideFigs.innerHTML =
    `<div class="builder__side-fig-col">${frontSvg}<span class="builder__side-fig-caption">Front</span></div>` +
    `<div class="builder__side-fig-col">${backSvg}<span class="builder__side-fig-caption">Back</span></div>`;
  const sideSvgs = els.sideFigs.querySelectorAll("svg.muscle-figure");
  sideSvgs.forEach((svg) => paintMuscleHeat(svg, weighted, BUILDER_MUSCLE_LOAD_CAP_));

  // Goal 4 (2026-10-09): hover/tap a shape for its own breakdown. No weekly
  // target here (a single planned workout, not a week) and no group list to
  // expand (this panel is a flat list), so just the value/split/exercises.
  sideSvgs.forEach((svg) =>
    wireMuscleTooltips_(svg, (key) => {
      if (!weighted[key] || weighted[key] <= 0) return null;
      return muscleTooltipContentHtml_(key, weighted[key], primaryCount[key], secondaryCount[key], muscleTopContributions_(contributionsByMuscle[key]), null);
    })
  );

  const entries = Object.keys(weighted).sort((a, b) => weighted[b] - weighted[a]);
  els.sideHeatList.innerHTML = entries.length
    ? entries.map((k) => builderHeatRowHtml_(k, primaryCount[k] || 0, secondaryCount[k] || 0)).join("")
    : '<p class="builder__side-empty">Add exercises to see what this workout trains</p>';
}

/**
 * One row of the side panel's breakdown list — the same red/orange
 * "primary + secondary set count" shape the Muscles tab's weekly list used
 * before it moved to target-status colouring (heatWeekTargetRowHtml_,
 * workout/library.js, 2026-10-09) — this panel stays a direct-count view,
 * scoped to just this one workout, not a weekly target. Each count sits
 * directly under its own segment (2026-10-05, was a
 * combined "3+5" off to the side) so it's unambiguous which number is
 * which. A zero-count side renders no number — an empty segment already
 * shows zero.
 */
function builderHeatRowHtml_(key, primaryN, secondaryN) {
  const primaryPct = Math.max(0, Math.min(100, (primaryN / BUILDER_MUSCLE_LOAD_CAP_) * 100));
  const secondaryPct = Math.max(0, Math.min(100 - primaryPct, (secondaryN / BUILDER_MUSCLE_LOAD_CAP_) * 100));
  return `
    <div class="builder__side-heat-row">
      <span class="builder__side-heat-row__name">${muscleLabel_(key)}</span>
      <span class="builder__side-heat-row__bar">
        <span class="builder__side-heat-row__track">
          <span class="builder__side-heat-row__fill--primary" style="width:${primaryPct}%"></span>
          <span class="builder__side-heat-row__fill--secondary" style="width:${secondaryPct}%"></span>
        </span>
        <span class="builder__side-heat-row__nums">
          ${primaryN > 0 ? `<span class="builder__side-heat-row__segnum--primary" style="width:${primaryPct}%">${primaryN}</span>` : ""}
          ${secondaryN > 0 ? `<span class="builder__side-heat-row__segnum--secondary" style="width:${secondaryPct}%">${secondaryN}</span>` : ""}
        </span>
      </span>
    </div>`;
}

function addRow(exercise) {
  const row = document.createElement("div");
  row.className = "builder__row";

  const { control: nameControl, nameValueInput } = buildExerciseControl(exercise);

  const setsInput = document.createElement("input");
  setsInput.type = "number";
  setsInput.inputMode = "numeric";
  setsInput.placeholder = "Sets";
  setsInput.value = exercise && exercise.sets ? exercise.sets : "";
  setsInput.addEventListener("input", refreshMuscleLoadPanel_);

  const repsInput = document.createElement("input");
  repsInput.type = "text";
  repsInput.placeholder = "Reps";
  repsInput.value = (exercise && exercise.reps) || "";

  // An optional coaching cue shown to the client under this exercise. Added to
  // the row LAST, so the name/sets/reps inputs stay the first three inputs.
  const tipInput = document.createElement("input");
  tipInput.type = "text";
  tipInput.className = "builder__row-tip";
  tipInput.placeholder = "Tip for the client (optional) — e.g. keep your elbows tucked";
  tipInput.maxLength = 300;
  tipInput.value = (exercise && exercise.note) || "";

  const handle = document.createElement("div");
  handle.className = "builder__row-handle";
  handle.textContent = "⠿";
  handle.setAttribute("aria-label", "Drag to reorder");
  makeRowDraggable(row, handle);

  // Belt-and-suspenders alongside the drag handle — a precise, unambiguous
  // way to move a row by exactly one spot, for whenever a drag feels
  // fiddly (or just isn't landing right on a given device).
  const moveWrap = document.createElement("div");
  moveWrap.className = "builder__row-move";

  const upButton = document.createElement("button");
  upButton.type = "button";
  upButton.className = "builder__row-move-btn";
  upButton.textContent = "▲";
  upButton.setAttribute("aria-label", "Move exercise up");
  upButton.addEventListener("click", () => {
    const prev = row.previousElementSibling;
    if (prev) els.rows.insertBefore(row, prev);
    refreshSupersetAvailability_();
  });

  const downButton = document.createElement("button");
  downButton.type = "button";
  downButton.className = "builder__row-move-btn";
  downButton.textContent = "▼";
  downButton.setAttribute("aria-label", "Move exercise down");
  downButton.addEventListener("click", () => {
    const next = row.nextElementSibling;
    if (next) els.rows.insertBefore(next, row);
    refreshSupersetAvailability_();
  });

  moveWrap.appendChild(upButton);
  moveWrap.appendChild(downButton);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "builder__row-remove";
  removeButton.textContent = "×";
  removeButton.setAttribute("aria-label", "Remove exercise");
  removeButton.addEventListener("click", () => {
    row.remove();
    refreshSupersetAvailability_();
    refreshMuscleLoadPanel_();
  });

  const supersetToggle = buildSupersetToggle_(row, exercise && exercise.superset);

  row.appendChild(nameControl);
  row.appendChild(setsInput);
  row.appendChild(repsInput);
  row.appendChild(handle);
  row.appendChild(moveWrap);
  row.appendChild(removeButton);
  row.appendChild(tipInput);
  row.appendChild(supersetToggle);
  // Last, and hidden — keeps the elements above in the exact DOM order the
  // CSS's nth-child row layout (builder.css) already expects, and keeps
  // the picked name out of the save handler's positional input lookup below.
  row.appendChild(nameValueInput);
  els.rows.appendChild(row);
  refreshSupersetAvailability_();
  refreshMuscleLoadPanel_();
}

/**
 * Press-and-drag on the grip handle to reorder exercise rows — driven by
 * Pointer Events (not native HTML5 drag-and-drop) so it works the same on
 * touch and mouse. The row visually follows the cursor (via a CSS
 * transform) so it actually reads as a drag rather than just silently
 * reordering once you happen to cross into a neighbor — pointer-events is
 * turned off on it while dragging so elementFromPoint can "see through" it
 * to whichever row is really underneath the cursor.
 */
function makeRowDraggable(row, handle) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;

    row.classList.add("builder__row--dragging");
    row.style.pointerEvents = "none";

    function onMove(moveEvent) {
      row.style.transform = `translate(${moveEvent.clientX - startX}px, ${moveEvent.clientY - startY}px)`;

      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest(".builder__row");
      if (!target || target === row || target.parentElement !== els.rows) return;
      const rect = target.getBoundingClientRect();
      const before = moveEvent.clientY < rect.top + rect.height / 2;
      els.rows.insertBefore(row, before ? target : target.nextSibling);
    }

    function onUp() {
      row.classList.remove("builder__row--dragging");
      row.style.pointerEvents = "";
      row.style.transform = "";
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      refreshSupersetAvailability_();
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

function clearRows() {
  els.rows.innerHTML = "";
  refreshMuscleLoadPanel_();
}

/**
 * The note shown at the top of the client's workout ("warm up 5 min first,
 * rest 60–90 sec"). Created here rather than in builder.html so this script
 * never depends on markup an older cached copy of the page might not have.
 */
function buildWorkoutNoteField() {
  const field = document.createElement("div");
  field.className = "builder__field";

  const label = document.createElement("span");
  label.className = "card__label";
  label.textContent = "Workout note for the client (optional)";
  field.appendChild(label);

  const textarea = document.createElement("textarea");
  textarea.className = "picker__input builder__note";
  textarea.rows = 2;
  textarea.maxLength = 1000;
  textarea.placeholder = "Shown at the top of their workout — e.g. warm up for 5 minutes first, rest 60–90 seconds between sets.";
  field.appendChild(textarea);

  els.daysPicker.parentElement.insertAdjacentElement("afterend", field);
  els.workoutNote = textarea;
}

function workoutNoteValue() {
  return els.workoutNote ? els.workoutNote.value.trim() : "";
}

function setWorkoutNote(text) {
  if (els.workoutNote) els.workoutNote.value = text || "";
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

// The Workout Exercises tab only stores an exercise's NAME against a
// client, not its category or muscles, so re-opening a saved workout needs
// a name -> {movement, bodyPart, primary, secondary, matched} lookup to
// show the same colour dot and muscle data a freshly-picked exercise gets.
// Built via the shared resolver (buildExerciseIndex_/resolveExerciseMuscles_,
// card/muscle-map.js) — the same one workout/heatmap.js uses — rather than
// this file's own plain exact-lowercase lookup (2026-10-09 fix; see that
// file's header comment for why the old exact-only matching mattered).
//
// Cached as the in-flight PROMISE, not the (eventually-built) index itself
// (2026-10-05 fix, still needed — orthogonal to the matching-logic fix
// above) — loadClientWorkouts below calls exerciseCategoryFor_ for every
// exercise in the workout at once, via Promise.all, so all of them run
// their first synchronous line before any of them finish loading. Caching
// the plain object meant only the very first caller actually waited for
// fetchExercises(): every other exercise in the SAME workout saw a cache
// that already existed but was still empty. Caching the promise itself
// means every concurrent caller awaits the exact same fetch and sees the
// real, fully-built index.
let exerciseIndexPromise_ = null;

function loadExerciseIndex_() {
  if (!exerciseIndexPromise_) {
    exerciseIndexPromise_ = fetchExercises()
      .then(({ rows, col }) => buildExerciseIndex_(rows, col))
      .catch(() => ({ byExact: {}, byNormalized: {} })); // rows just render without a colour dot or muscle data
  }
  return exerciseIndexPromise_;
}

async function exerciseCategoryFor_(name) {
  const index = await loadExerciseIndex_();
  return resolveExerciseMuscles_(name, index);
}

/** Loads every workout name this client already has, grouped into { lowercaseName: { name, exercises } }. */
async function loadClientWorkouts(clientSlug) {
  clientWorkouts = {};
  if (!clientSlug) return;

  try {
    const { rows, col } = await fetchWorkoutExercises();
    const clientRows = await Promise.all(
      rows
        .filter((r) => String(r[col.client] || "").trim().toLowerCase() === clientSlug)
        .map(async (r) => {
          const name = (r[col.exercise] || "").trim();
          const category = await exerciseCategoryFor_(name);
          return {
            workoutName: (col.workoutName >= 0 ? r[col.workoutName] : "") || "",
            name,
            movement: category.movement,
            bodyPart: category.bodyPart,
            primaryMuscles: category.primary,
            secondaryMuscles: category.secondary,
            muscleWeights: category.muscleWeights,
            sets: parseSessions(r[col.sets], ""),
            reps: (r[col.reps] || "").trim(),
            order: parseSessions(r[col.order], 0),
            days: (col.days >= 0 ? String(r[col.days] || "") : "").split(",").map((d) => d.trim()).filter(Boolean),
            workoutOrder: col.workoutOrder >= 0 ? Number(r[col.workoutOrder]) : NaN,
            note: col.notes >= 0 ? String(r[col.notes] || "").trim() : "",
            workoutNote: col.workoutNotes >= 0 ? String(r[col.workoutNotes] || "").trim() : "",
            superset: col.superset >= 0 && String(r[col.superset] || "").trim().toUpperCase() === "Y",
          };
        })
    );
    const validRows = clientRows.filter((ex) => ex.name && ex.workoutName);

    for (const ex of validRows) {
      const key = ex.workoutName.toLowerCase();
      if (!clientWorkouts[key]) {
        clientWorkouts[key] = { name: ex.workoutName, exercises: [], days: ex.days, order: ex.workoutOrder, note: "" };
      }
      if (!clientWorkouts[key].note && ex.workoutNote) clientWorkouts[key].note = ex.workoutNote;
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
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        chip.classList.add("builder__chip--dragging");
        chip.style.pointerEvents = "none";
      }
      // Visually follows the cursor so this actually reads as a drag,
      // rather than only silently swapping once you cross into a
      // neighboring chip with no feedback in between.
      chip.style.transform = `translate(${dx}px, ${dy}px)`;

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
        chip.style.pointerEvents = "";
        chip.style.transform = "";
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
    workout.exercises.forEach((exercise) => addRow(exercise));
    setSelectedDays(workout.days);
    setWorkoutNote(workout.note);
    els.deleteButton.hidden = false;
  } else {
    addRow();
    setSelectedDays([]);
    setWorkoutNote("");
    els.deleteButton.hidden = true;
  }
  renderChipsAndOptions();
}

els.clientSelect.addEventListener("change", async () => {
  els.workoutNameInput.value = "";
  clearRows();
  setSelectedDays([]);
  setWorkoutNote("");
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

  // The row's only 4 <input>s now, in DOM order: sets, reps, tip, then the
  // hidden exercise-name value (see addRow — its visible control is a
  // button, not an input, precisely so it's skipped here and picked up by
  // name below instead).
  const exercises = Array.from(els.rows.children)
    .map((row) => {
      const [setsInput, repsInput, tipInput, nameInput] = row.querySelectorAll("input");
      return {
        name: nameInput.value.trim(),
        sets: Number(setsInput.value),
        reps: repsInput.value.trim(),
        note: tipInput ? tipInput.value.trim() : "",
        superset: row.dataset.superset === "true",
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
  const workoutNote = workoutNoteValue();
  const hasNotes = Boolean(workoutNote) || exercises.some((ex) => ex.note);
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
      body: JSON.stringify({ action: "assignWorkout", pin, clientSlug, workoutName, exercises, days, workoutNote }),
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

  // An Apps Script deployment from before tips existed saves the exercises but
  // silently throws the tips away — say so, rather than let "Saved" imply they're there.
  if (hasNotes && !result.notesSupported) {
    showError("Saved the exercises, but the tips and notes were NOT stored — the Apps Script on Google is out of date. Redeploy it (Deploy → Manage deployments → New version), then Save again.");
  }
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
  setWorkoutNote("");
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
  buildWorkoutNoteField();
  loadClientList();
  addRow();
})();
