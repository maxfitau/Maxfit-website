/*
 * MaxFit workout logger.
 *
 * Opened from the membership card's "Today's Workout" tile
 * (maxfit.now/workout/?id=<client-slug>), or directly if that's ever
 * bookmarked. Identity works exactly like the card: ?id= in the URL, or —
 * failing that — whatever was remembered in localStorage the last time the
 * card itself loaded on this phone (same storage key, same origin, so it's
 * already there for anyone who's opened their card even once before).
 *
 * A client can have several named workouts (a push/pull/legs split, say) —
 * if so, this opens on a picker so they choose which one they're doing
 * today; a client with only one skips straight to it.
 *
 * The whole point of the logging screen itself is the weight prefill: every
 * set opens with a weight already filled in from the client's own most
 * recent logged set for that exact exercise — regardless of which named
 * workout it was logged under — not just "last time this exact workout
 * ran". On a normal week they glance at the number, do the set, type in
 * reps. Moving the weight up or down is just editing that field before
 * logging.
 */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";
const MEMBER_ID_STORAGE_KEY = "maxfitMemberId"; // shared with card/app.js
const WORKOUT_COMPLETE_STORAGE_KEY = "maxfitWorkoutCompleteDate"; // shared with card/app.js
const WEIGHT_STEP = 2.5;

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
  pageTag: document.getElementById("pageTag"),
  picker: document.getElementById("workoutPicker"),
  pickerList: document.getElementById("workoutPickerList"),
  list: document.getElementById("exerciseList"),
  done: document.getElementById("workoutDone"),
  status: document.getElementById("status"),
  backLink: document.getElementById("backLink"),
};

function showStatus(message, isError) {
  els.status.textContent = message;
  els.status.hidden = false;
  els.status.classList.toggle("status--error", Boolean(isError));
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** Picks whichever logged row for this exercise has the latest timestamp/date — history can come back in any order from the sheet, and can span every named workout, not just the one open right now. */
function mostRecentWeight(setRows, col, clientSlug, exerciseName) {
  let best = null;
  for (const row of setRows) {
    if (String(row[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
    if (String(row[col.exercise] || "").trim().toLowerCase() !== exerciseName) continue;

    const weight = Number(row[col.weight]);
    if (!Number.isFinite(weight)) continue;

    const rawWhen = (col.timestamp >= 0 && row[col.timestamp]) || (col.date >= 0 && row[col.date]) || "";
    const when = Date.parse(rawWhen) || 0;

    if (!best || when >= best.when) {
      best = { weight, when };
    }
  }
  return best ? best.weight : null;
}

function formatWeight(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function buildSetRow(clientSlug, workoutName, exercise, setNumber, prefillWeight, isFromHistory, onLogged) {
  const row = document.createElement("div");
  row.className = "workout__set";

  const label = document.createElement("span");
  label.className = "workout__set-num";
  label.textContent = `Set ${setNumber}`;
  row.appendChild(label);

  const weightWrap = document.createElement("div");
  weightWrap.className = "workout__weight";

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "workout__step";
  minus.textContent = "−";
  minus.setAttribute("aria-label", "Decrease weight");

  const weightInput = document.createElement("input");
  weightInput.type = "text";
  weightInput.inputMode = "decimal";
  weightInput.className = "workout__weight-input";
  if (prefillWeight !== null) {
    weightInput.value = formatWeight(prefillWeight);
    if (isFromHistory) weightInput.classList.add("workout__weight-input--prefilled");
  } else {
    weightInput.placeholder = "kg";
  }

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "workout__step";
  plus.textContent = "+";
  plus.setAttribute("aria-label", "Increase weight");

  function nudge(direction) {
    const current = Number(weightInput.value) || 0;
    const next = Math.max(0, current + direction * WEIGHT_STEP);
    weightInput.value = formatWeight(next);
    weightInput.classList.remove("workout__weight-input--prefilled");
  }
  minus.addEventListener("click", () => nudge(-1));
  plus.addEventListener("click", () => nudge(1));
  weightInput.addEventListener("input", () => weightInput.classList.remove("workout__weight-input--prefilled"));

  weightWrap.appendChild(minus);
  weightWrap.appendChild(weightInput);
  weightWrap.appendChild(plus);
  row.appendChild(weightWrap);

  const repsInput = document.createElement("input");
  repsInput.type = "number";
  repsInput.inputMode = "numeric";
  repsInput.className = "workout__reps-input";
  repsInput.placeholder = exercise.reps || "reps";
  row.appendChild(repsInput);

  const logButton = document.createElement("button");
  logButton.type = "button";
  logButton.className = "workout__log-btn";
  logButton.textContent = "Log";
  row.appendChild(logButton);

  logButton.addEventListener("click", async () => {
    const weight = Number(weightInput.value);
    const reps = Number(repsInput.value);

    if (!Number.isFinite(weight) || weight <= 0) {
      weightInput.focus();
      return;
    }
    if (!Number.isFinite(reps) || reps <= 0) {
      repsInput.focus();
      return;
    }

    logButton.disabled = true;
    logButton.textContent = "…";

    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
        body: JSON.stringify({
          action: "logSet",
          clientSlug,
          workoutName,
          exercise: exercise.name,
          setNumber,
          weight,
          reps,
        }),
      });
      const result = await res.json();
      if (result.status !== "success") throw new Error("log failed");
    } catch (err) {
      logButton.disabled = false;
      logButton.textContent = "Log";
      showStatus("Couldn't save that set — check your connection and try again.", true);
      return;
    }

    weightInput.disabled = true;
    repsInput.disabled = true;
    minus.disabled = true;
    plus.disabled = true;
    weightInput.classList.remove("workout__weight-input--prefilled");
    row.classList.add("workout__set--done");
    logButton.textContent = "✓";
    onLogged();
  });

  return row;
}

function renderWorkout(clientSlug, workoutName, exercises, setRows, setCol, startingWeights) {
  els.status.hidden = true;
  els.list.innerHTML = "";
  els.list.hidden = false;
  els.pageTag.textContent = workoutName || "Today's Workout";

  let totalSets = 0;
  let loggedSets = 0;

  function updateDoneState() {
    const allDone = totalSets > 0 && loggedSets >= totalSets;
    els.done.hidden = !allDone;
    if (allDone) {
      try {
        localStorage.setItem(WORKOUT_COMPLETE_STORAGE_KEY, todayString());
      } catch (err) {
        // Storage unavailable — the card just won't auto-show as completed.
      }
    }
  }

  for (const exercise of exercises) {
    const key = exercise.name.toLowerCase();
    const historyWeight = mostRecentWeight(setRows, setCol, clientSlug, key);
    const prefillWeight = historyWeight !== null ? historyWeight : (startingWeights[key] !== undefined ? startingWeights[key] : null);

    const section = document.createElement("section");
    section.className = "workout__exercise";

    const head = document.createElement("div");
    head.className = "workout__exercise-head";

    const name = document.createElement("h2");
    name.className = "workout__exercise-name";
    name.textContent = exercise.name;
    head.appendChild(name);

    const target = document.createElement("span");
    target.className = "workout__exercise-target";
    target.textContent = exercise.reps ? `${exercise.sets} × ${exercise.reps}` : `${exercise.sets} sets`;
    head.appendChild(target);

    section.appendChild(head);

    const hint = document.createElement("p");
    hint.className = "workout__exercise-hint";
    hint.textContent = historyWeight !== null
      ? `Last time: ${formatWeight(historyWeight)}kg`
      : prefillWeight !== null
        ? `Starting weight: ${formatWeight(prefillWeight)}kg`
        : "New exercise — enter your starting weight";
    section.appendChild(hint);

    const setsWrap = document.createElement("div");
    setsWrap.className = "workout__sets";

    for (let setNumber = 1; setNumber <= exercise.sets; setNumber++) {
      totalSets++;
      const row = buildSetRow(clientSlug, workoutName, exercise, setNumber, prefillWeight, historyWeight !== null, () => {
        loggedSets++;
        updateDoneState();
      });
      setsWrap.appendChild(row);
    }

    section.appendChild(setsWrap);
    els.list.appendChild(section);
  }

  updateDoneState();
}

function showPicker(clientSlug, workoutGroups, setRows, setCol, startingWeights) {
  els.status.hidden = true;
  els.list.hidden = true;
  els.done.hidden = true;
  els.pageTag.textContent = "Choose Your Workout";
  els.picker.hidden = false;
  els.pickerList.innerHTML = "";
  els.backLink.href = `../card/?id=${encodeURIComponent(memberId)}`;

  for (const name of Object.keys(workoutGroups)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "workout__picker-option";

    const label = document.createElement("span");
    label.textContent = name;
    button.appendChild(label);

    const count = document.createElement("span");
    count.className = "workout__picker-option-count";
    const exerciseCount = workoutGroups[name].length;
    count.textContent = `${exerciseCount} exercise${exerciseCount === 1 ? "" : "s"}`;
    button.appendChild(count);

    button.addEventListener("click", () => {
      els.picker.hidden = true;
      // From inside a specific workout, "back" returns to this picker
      // rather than straight to the card — easy to switch if they tapped
      // the wrong day.
      els.backLink.href = "#";
      els.backLink.onclick = (event) => {
        event.preventDefault();
        showPicker(clientSlug, workoutGroups, setRows, setCol, startingWeights);
      };
      renderWorkout(clientSlug, name, workoutGroups[name], setRows, setCol, startingWeights);
    });

    els.pickerList.appendChild(button);
  }
}

async function init() {
  if (!memberId) {
    showStatus("Open this from your membership card.", true);
    return;
  }

  els.backLink.href = `../card/?id=${encodeURIComponent(memberId)}`;
  const clientSlug = slugify(memberId);

  let workoutGroups;
  let setRows, setCol;
  let startingWeights;

  try {
    const [workout, sets, exerciseDefaults] = await Promise.all([
      fetchWorkoutExercises(),
      fetchLoggedSets(),
      fetchExercises(),
    ]);

    const clientExercises = workout.rows
      .filter((r) => String(r[workout.col.client] || "").trim().toLowerCase() === clientSlug)
      .map((r) => ({
        workoutName: (workout.col.workoutName >= 0 ? r[workout.col.workoutName] : "") || "Today's Workout",
        name: (r[workout.col.exercise] || "").trim(),
        sets: parseSessions(r[workout.col.sets], 0),
        reps: (r[workout.col.reps] || "").trim(),
        order: parseSessions(r[workout.col.order], 0),
      }))
      .filter((ex) => ex.name && ex.sets > 0);

    workoutGroups = {};
    for (const ex of clientExercises) {
      if (!workoutGroups[ex.workoutName]) workoutGroups[ex.workoutName] = [];
      workoutGroups[ex.workoutName].push(ex);
    }
    for (const name of Object.keys(workoutGroups)) {
      workoutGroups[name].sort((a, b) => a.order - b.order);
    }

    setRows = sets.rows;
    setCol = sets.col;

    startingWeights = {};
    for (const row of exerciseDefaults.rows) {
      const name = (row[exerciseDefaults.col.name] || "").trim().toLowerCase();
      const weight = Number(row[exerciseDefaults.col.startingWeight]);
      if (name && Number.isFinite(weight)) startingWeights[name] = weight;
    }
  } catch (err) {
    showStatus("Couldn't load your workout. Check your connection and reopen.", true);
    return;
  }

  const workoutNames = Object.keys(workoutGroups);
  if (!workoutNames.length) {
    showStatus("No workout assigned yet — check with Max.", false);
    return;
  }

  if (workoutNames.length === 1) {
    renderWorkout(clientSlug, workoutNames[0], workoutGroups[workoutNames[0]], setRows, setCol, startingWeights);
    return;
  }

  showPicker(clientSlug, workoutGroups, setRows, setCol, startingWeights);
}

init();
