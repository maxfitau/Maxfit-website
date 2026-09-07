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
 * The whole point of this page is the weight prefill: every set opens with
 * a weight already filled in from the client's own most recent logged set
 * for that exact exercise (not just "last time this exact workout ran") —
 * on a normal week they glance at the number, do the set, type in reps.
 * Moving the weight up or down is just editing that field before logging.
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

/** Picks whichever logged row for this exercise has the latest timestamp/date — history can come back in any order from the sheet. */
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

function buildSetRow(clientSlug, exercise, setNumber, prefillWeight, isFromHistory, onLogged) {
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

function renderWorkout(clientSlug, exercises, setRows, setCol, startingWeights) {
  els.list.innerHTML = "";

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
      const row = buildSetRow(clientSlug, exercise, setNumber, prefillWeight, historyWeight !== null, () => {
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

async function init() {
  if (!memberId) {
    showStatus("Open this from your membership card.", true);
    return;
  }

  els.backLink.href = `../card/?id=${encodeURIComponent(memberId)}`;
  const clientSlug = slugify(memberId);

  let exercises;
  let setRows, setCol;
  let startingWeights;

  try {
    const [workout, sets, exerciseDefaults] = await Promise.all([
      fetchWorkoutExercises(),
      fetchLoggedSets(),
      fetchExercises(),
    ]);

    exercises = workout.rows
      .filter((r) => String(r[workout.col.client] || "").trim().toLowerCase() === clientSlug)
      .map((r) => ({
        name: (r[workout.col.exercise] || "").trim(),
        sets: parseSessions(r[workout.col.sets], 0),
        reps: (r[workout.col.reps] || "").trim(),
        order: parseSessions(r[workout.col.order], 0),
      }))
      .filter((ex) => ex.name && ex.sets > 0)
      .sort((a, b) => a.order - b.order);

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

  if (!exercises.length) {
    showStatus("No workout assigned yet — check with Max.", false);
    return;
  }

  renderWorkout(clientSlug, exercises, setRows, setCol, startingWeights);
}

init();
