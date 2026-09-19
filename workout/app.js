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
 * How saving works: every set has its own Save button. Tapping it commits
 * that set to this phone right away — instantly, no network, so it can't be
 * slow and can't fail — which means closing the page or losing signal
 * mid-workout never costs them anything they've already saved; reopening the
 * workout puts every saved set straight back. "Log Workout" at the end is the
 * one step that sends the finished session to Max's sheet. (A workout that
 * was saved but never logged is sent automatically the next time this page
 * opens on a later day, so it isn't stranded on the phone.)
 *
 * The weight prefill is what makes a normal week quick: every set opens with
 * the numbers from the client's most recent PREVIOUS session of that exact
 * exercise — regardless of which named workout it was logged under — so they
 * glance at the number, do the set, and tap Save (editing first if they went
 * up or down).
 */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";
const MEMBER_ID_STORAGE_KEY = "maxfitMemberId"; // shared with card/app.js
const WORKOUT_COMPLETE_STORAGE_KEY = "maxfitWorkoutCompleteDate"; // shared with card/app.js
const DRAFT_KEY_PREFIX = "maxfitWorkoutDraft|"; // calendar.js clears drafts by this same key format
const WEIGHT_STEP = 2.5;
const LOG_TIMEOUT_MS = 30000;

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
  timer: document.getElementById("workoutTimer"),
  timerValue: document.getElementById("workoutTimerValue"),
  picker: document.getElementById("workoutPicker"),
  pickerList: document.getElementById("workoutPickerList"),
  list: document.getElementById("exerciseList"),
  done: document.getElementById("workoutDone"),
  doneText: document.querySelector(".workout__done-text"),
  status: document.getElementById("status"),
  backLink: document.getElementById("backLink"),
  historyLink: document.getElementById("historyLink"),
};

function showStatus(message, isError) {
  clearTimeout(showStatus._t);
  els.status.textContent = message;
  els.status.hidden = false;
  els.status.classList.toggle("status--error", Boolean(isError));
}

/** A short-lived nudge ("add the reps first") that clears itself, unlike showStatus which stays until replaced. */
function flashStatus(message, isError) {
  showStatus(message, isError);
  showStatus._t = setTimeout(() => {
    els.status.hidden = true;
  }, 3000);
}

/** Local-date key ("2026-9-19") for the card's "workout completed" checkbox — same format card/app.js writes. */
function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/**
 * Today as "yyyy-MM-dd" in SYDNEY time — the same day the backend stamps
 * every logged row with, whatever timezone the phone happens to be in, so
 * "today's sets" means the same thing here as it does in the sheet.
 */
function sydneyDateStr() {
  try {
    const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch (err) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
}

/** "2026-09-16" / "2026-9-16" -> 20260916 (so dates compare and sort as plain numbers), or NaN if it isn't a date. */
function dateSortKey(raw) {
  const parts = String(raw || "").trim().split("-");
  if (parts.length !== 3) return NaN;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if (!y || !m || !d) return NaN;
  return y * 10000 + m * 100 + d;
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const paddedMins = hours > 0 ? String(mins).padStart(2, "0") : String(mins);
  const paddedSecs = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${paddedMins}:${paddedSecs}` : `${paddedMins}:${paddedSecs}`;
}

/**
 * Counts up from when the client opens their actual workout (not the
 * picker) — based on wall-clock time each tick rather than counting ticks,
 * so it stays accurate even if the tab is backgrounded and iOS throttles
 * the interval.
 */
let workoutTimerInterval = null;
let workoutTimerStart = null;

function startWorkoutTimer() {
  workoutTimerStart = Date.now();
  els.timer.hidden = false;
  els.timerValue.textContent = formatElapsed(0);
  if (workoutTimerInterval) clearInterval(workoutTimerInterval);
  workoutTimerInterval = setInterval(() => {
    els.timerValue.textContent = formatElapsed(Date.now() - workoutTimerStart);
  }, 1000);
}

function stopWorkoutTimer() {
  if (workoutTimerInterval) {
    clearInterval(workoutTimerInterval);
    workoutTimerInterval = null;
  }
  return workoutTimerStart ? Date.now() - workoutTimerStart : 0;
}

function formatWeight(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Finds this client's most recent PREVIOUS session that included this
 * exercise — "session" meaning every row sharing the same Date value, since
 * one log writes every set of that visit with an identical one. Deliberately
 * not scoped to the workout currently open: a client who does Bench Press
 * under both "Push" and "Upper" should see the same last-session numbers
 * either way, since it's the same lift regardless of which named workout
 * it's filed under. Today's own rows are skipped (`excludeKey`) — sets they've
 * already saved today are restored separately, and the prefill is meant to
 * show what they did LAST time.
 *
 * "Most recent" is decided by comparing the Date column itself, not by row
 * position: editing an old day in the history calendar re-appends that day's
 * rows at the bottom of the sheet, so the last row is not necessarily the
 * latest date. (Nor does this use Date.parse() on the Timestamp column —
 * Sheets exports that in this sheet's Australian DD/MM/YYYY, which
 * Date.parse() misreads or fails on.)
 *
 * Returns a Map of set number -> { weight, reps } for that one session, or
 * null if this exercise has never been logged before.
 */
function mostRecentSessionSets(setRows, col, clientSlug, exerciseName, excludeKey) {
  let bestKey = -1;
  for (const row of setRows) {
    if (String(row[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
    if (String(row[col.exercise] || "").trim().toLowerCase() !== exerciseName) continue;
    const key = col.date >= 0 ? dateSortKey(row[col.date]) : NaN;
    if (!Number.isFinite(key) || key === excludeKey) continue;
    if (key > bestKey) bestKey = key;
  }
  if (bestKey < 0) return null;

  const bySetNumber = new Map();
  for (const row of setRows) {
    if (String(row[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
    if (String(row[col.exercise] || "").trim().toLowerCase() !== exerciseName) continue;
    if (dateSortKey(col.date >= 0 ? row[col.date] : "") !== bestKey) continue;

    const setNumber = Number(row[col.setNumber]);
    const weight = Number(row[col.weight]);
    if (!Number.isFinite(setNumber) || !Number.isFinite(weight)) continue;
    const reps = Number(row[col.reps]);
    bySetNumber.set(setNumber, { weight, reps: Number.isFinite(reps) ? reps : null });
  }
  return bySetNumber.size ? bySetNumber : null;
}

/**
 * Whatever's already in the sheet for this client + workout + today — used to
 * put a workout back the way it was when it's opened on a phone that has no
 * local draft of it (a different browser, cleared site data). Rows logged
 * before the sheet had a Workout Name column have it blank, and count for any
 * workout — the same rule the backend uses when it replaces a session.
 */
function savedSetsFromRows(setRows, col, clientSlug, workoutName, todayKey) {
  const wanted = workoutName.trim().toLowerCase();
  const byKey = new Map();
  let notes = "";
  for (const row of setRows) {
    if (String(row[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
    if (dateSortKey(col.date >= 0 ? row[col.date] : "") !== todayKey) continue;
    const rowWorkout = col.workoutName >= 0 ? String(row[col.workoutName] || "").trim().toLowerCase() : "";
    if (rowWorkout && rowWorkout !== wanted) continue;

    const exercise = String(row[col.exercise] || "").trim();
    const setNumber = Number(row[col.setNumber]);
    const weight = Number(row[col.weight]);
    const reps = Number(row[col.reps]);
    if (!exercise || !Number.isFinite(setNumber) || !Number.isFinite(weight) || !Number.isFinite(reps)) continue;

    byKey.set(`${exercise.toLowerCase()}|${setNumber}`, { exercise, setNumber, weight, reps });
    if (col.notes >= 0 && row[col.notes]) notes = String(row[col.notes]).trim();
  }
  return { sets: Array.from(byKey.values()), notes };
}

// ---- Drafts: the session as it's been saved on this phone -----------------
//
// One draft per (client, workout, day): { clientSlug, workoutName, date, sets,
// notes, rev, pending, updatedAt }. `sets` are only the ones they've tapped
// Save on. `pending` means "this is ahead of what's in the sheet" — true from
// the moment something's saved until a Log Workout for it succeeds. `rev`
// ticks up on every change, so a request that was in flight while they kept
// saving can't mark newer changes as sent.

let storageUsable = true;
try {
  localStorage.setItem("maxfitStorageProbe", "1");
  localStorage.removeItem("maxfitStorageProbe");
} catch (err) {
  storageUsable = false; // private mode etc. — drafts then live only until the page closes
}
const memoryDrafts = new Map();

function draftKey(clientSlug, workoutName, dateStr) {
  return `${DRAFT_KEY_PREFIX}${clientSlug}|${workoutName.trim().toLowerCase()}|${dateStr}`;
}

function readDraft(key) {
  if (!storageUsable) return memoryDrafts.get(key) || null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function writeDraft(key, draft) {
  if (!storageUsable) {
    memoryDrafts.set(key, draft);
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch (err) {
    memoryDrafts.set(key, draft); // storage full or blocked — at least keep it for this visit
  }
}

function removeDraft(key) {
  memoryDrafts.delete(key);
  try {
    localStorage.removeItem(key);
  } catch (err) {
    // Nothing to clean up.
  }
}

function allDraftKeys() {
  const keys = new Set(memoryDrafts.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DRAFT_KEY_PREFIX)) keys.add(key);
    }
  } catch (err) {
    // Storage unavailable — memory-only drafts are all there is.
  }
  return Array.from(keys);
}

/** Sends one session to the sheet. Throws on anything but a clean success (offline, timeout, server error). */
async function postSession(draft) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOG_TIMEOUT_MS);
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      signal: controller.signal,
      body: JSON.stringify({
        action: "saveWorkoutSession",
        clientSlug: draft.clientSlug,
        workoutName: draft.workoutName,
        date: draft.date,
        sets: draft.sets,
        notes: draft.notes || "",
      }),
    });
    const result = await res.json();
    if (result.status !== "success") throw new Error(result.message || "log failed");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * A workout that was saved set-by-set but never logged (they forgot the final
 * button, or had no signal when they pressed it) would otherwise sit on the
 * phone forever. Once the day it belongs to is over, send it — every set in
 * it was one they deliberately saved. Older drafts that were already logged
 * are just cleaned up. Runs in the background; anything that fails stays put
 * for the next open.
 */
async function flushOldDrafts(todayStr) {
  for (const key of allDraftKeys()) {
    const draft = readDraft(key);
    if (!draft || draft.date === todayStr) {
      if (!draft) removeDraft(key);
      continue;
    }
    if (!draft.pending || !Array.isArray(draft.sets) || !draft.sets.length) {
      removeDraft(key);
      continue;
    }
    try {
      await postSession(draft);
      removeDraft(key);
    } catch (err) {
      // Offline, or the server's busy — try again next time the page opens.
    }
  }
}

// ---- Set rows -------------------------------------------------------------

/** What's typed into a set row right now, and whether it's complete enough to save (reps > 0, and a weight — 0 is fine for bodyweight, blank is not). */
function rowValues(row) {
  const weightText = row.querySelector(".workout__weight-input").value.trim();
  const repsText = row.querySelector(".workout__reps-input").value.trim();
  const weight = weightText === "" ? NaN : Number(weightText);
  const reps = repsText === "" ? NaN : Number(repsText);
  return { weight, reps, valid: Number.isFinite(weight) && weight >= 0 && Number.isFinite(reps) && reps > 0 };
}

/** Save button reads "Save" until the row's current numbers match what was last saved, then a tick — edit a saved set and it goes back to "Save". */
function refreshRowState(row) {
  const values = rowValues(row);
  const isSaved = Boolean(row._saved) && values.valid && values.weight === row._saved.weight && values.reps === row._saved.reps;
  row.classList.toggle("workout__set--saved", isSaved);
  const btn = row.querySelector(".workout__set-save");
  btn.textContent = isSaved ? "✓" : "Save";
  btn.setAttribute("aria-label", isSaved ? `Set ${row.dataset.setNumber} saved` : `Save set ${row.dataset.setNumber}`);
}

/**
 * initial: { weight, reps, saved, suggestion } — `saved` rows come back from
 * a draft/the sheet already committed; `suggestion` marks numbers that are
 * only a starting point (last session's, or copied from the set above), which
 * show dimmed until touched. Nothing here counts as done until Save is tapped.
 */
function buildSetRow(exercise, setNumber, initial, onSave) {
  const row = document.createElement("div");
  row.className = "workout__set";
  row.dataset.exercise = exercise.name;
  row.dataset.setNumber = String(setNumber);
  row._saved = initial.saved ? { weight: initial.weight, reps: initial.reps } : null;
  row._touched = false;

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
  if (initial.weight !== null && initial.weight !== undefined) {
    weightInput.value = formatWeight(initial.weight);
    if (initial.suggestion) weightInput.classList.add("workout__weight-input--prefilled");
  } else {
    weightInput.placeholder = "kg";
  }

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "workout__step";
  plus.textContent = "+";
  plus.setAttribute("aria-label", "Increase weight");

  const repsInput = document.createElement("input");
  repsInput.type = "number";
  repsInput.inputMode = "numeric";
  repsInput.className = "workout__reps-input";
  if (initial.reps !== null && initial.reps !== undefined) {
    repsInput.value = String(initial.reps);
    if (initial.suggestion) repsInput.classList.add("workout__reps-input--prefilled");
  } else {
    repsInput.placeholder = exercise.reps || "reps";
  }

  function touched() {
    row._touched = true;
    refreshRowState(row);
  }
  function nudge(direction) {
    const current = Number(weightInput.value) || 0;
    weightInput.value = formatWeight(Math.max(0, current + direction * WEIGHT_STEP));
    weightInput.classList.remove("workout__weight-input--prefilled");
    touched();
  }
  minus.addEventListener("click", () => nudge(-1));
  plus.addEventListener("click", () => nudge(1));
  weightInput.addEventListener("input", () => {
    weightInput.classList.remove("workout__weight-input--prefilled");
    touched();
  });
  repsInput.addEventListener("input", () => {
    repsInput.classList.remove("workout__reps-input--prefilled");
    touched();
  });
  repsInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSave(row);
    }
  });

  weightWrap.appendChild(minus);
  weightWrap.appendChild(weightInput);
  weightWrap.appendChild(plus);
  row.appendChild(weightWrap);
  row.appendChild(repsInput);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "workout__set-save";
  saveBtn.addEventListener("click", () => onSave(row));
  row.appendChild(saveBtn);

  refreshRowState(row);
  return row;
}

/**
 * Builds one exercise's section (name/target/hint + its set rows) and drops
 * it into the list. Shared by the assigned-workout render loop, by
 * "+ Add Exercise" (a client who finds their machine taken can log whatever
 * they did instead — it prefills/tracks history exactly like an assigned
 * exercise would), and by restoring extras they'd already saved earlier
 * today. Every exercise gets "+ Add Set" for when they do more than planned.
 */
function addExerciseSection(ctx, exercise, opts) {
  const { clientSlug, setRows, setCol, startingWeights } = ctx;
  const isExtra = Boolean(opts && opts.isExtra);
  const savedSets = (opts && opts.savedSets) || new Map(); // setNumber -> { weight, reps }
  const key = exercise.name.toLowerCase();
  const historySets = mostRecentSessionSets(setRows, setCol, clientSlug, key, ctx.todayKey);
  const maxHistSetNumber = historySets ? Math.max(...historySets.keys()) : 0;
  const firstSetHistory = historySets ? historySets.get(1) : null;
  const historyWeight = firstSetHistory ? firstSetHistory.weight : null;
  const prefillWeight = historyWeight !== null ? historyWeight : (startingWeights[key] !== undefined ? startingWeights[key] : null);

  const section = document.createElement("section");
  section.className = "workout__exercise";
  if (isExtra) section.classList.add("workout__exercise--extra");

  const head = document.createElement("div");
  head.className = "workout__exercise-head";

  const name = document.createElement("h2");
  name.className = "workout__exercise-name";
  name.textContent = exercise.name;
  head.appendChild(name);

  const target = document.createElement("span");
  target.className = "workout__exercise-target";
  target.textContent = isExtra
    ? "Extra"
    : exercise.reps
      ? `${exercise.sets} × ${exercise.reps}`
      : `${exercise.sets} sets`;
  head.appendChild(target);

  section.appendChild(head);

  const hint = document.createElement("p");
  hint.className = "workout__exercise-hint";
  hint.textContent = historyWeight !== null
    ? `Last time: ${formatWeight(historyWeight)}kg${Number.isFinite(firstSetHistory.reps) ? ` × ${firstSetHistory.reps}` : ""}`
    : prefillWeight !== null
      ? `Starting weight: ${formatWeight(prefillWeight)}kg`
      : "New exercise — enter your starting weight";
  section.appendChild(hint);

  const setsWrap = document.createElement("div");
  setsWrap.className = "workout__sets";
  section.appendChild(setsWrap);

  let setCount = 0;
  function appendSetRow(addedByClient) {
    setCount++;
    let initial = null;

    const saved = savedSets.get(setCount);
    if (saved) {
      initial = { weight: saved.weight, reps: saved.reps, saved: true, suggestion: false };
    } else if (addedByClient && setsWrap.lastElementChild) {
      // An extra set is most likely "same again" — start from the set above.
      const above = rowValues(setsWrap.lastElementChild);
      if (above.valid) initial = { weight: above.weight, reps: above.reps, saved: false, suggestion: true };
    }
    if (!initial) {
      // Set-for-set against last session where possible (today's Set 2 gets
      // last time's Set 2); a set beyond how many they did last time falls
      // back to repeating the last set of that session rather than going in
      // blind, since that's the closest known data point.
      const hist = historySets && (historySets.get(setCount) || historySets.get(maxHistSetNumber));
      initial = {
        weight: hist ? hist.weight : prefillWeight,
        reps: hist ? hist.reps : null,
        saved: false,
        suggestion: Boolean(hist),
      };
    }
    setsWrap.appendChild(buildSetRow(exercise, setCount, initial, ctx.saveSet));
  }

  const maxSavedSetNumber = savedSets.size ? Math.max(...savedSets.keys()) : 0;
  const initialRows = Math.max(exercise.sets, maxSavedSetNumber);
  for (let i = 0; i < initialRows; i++) appendSetRow(false);

  const addSetBtn = document.createElement("button");
  addSetBtn.type = "button";
  addSetBtn.className = "workout__add-set";
  addSetBtn.textContent = "+ Add Set";
  addSetBtn.addEventListener("click", () => appendSetRow(true));
  section.appendChild(addSetBtn);

  ctx.sections.set(key, { section, name: exercise.name, addSet: () => appendSetRow(true) });
  ctx.list.insertBefore(section, ctx.addExerciseWrap);
  return section;
}

/** "+ Add Exercise" — collapsed button that expands into a name field + confirm, for whatever the client ends up doing instead of what was planned. */
function buildAddExerciseControl(ctx, exerciseNameOptions) {
  const wrap = document.createElement("div");
  wrap.className = "workout__add-exercise";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "workout__add-exercise-toggle";
  toggleBtn.textContent = "+ Add Exercise";
  wrap.appendChild(toggleBtn);

  const form = document.createElement("div");
  form.className = "workout__add-exercise-form";
  form.hidden = true;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "workout__add-exercise-input";
  input.placeholder = "Exercise name";
  input.setAttribute("list", "extraExerciseOptions");
  form.appendChild(input);

  if (!document.getElementById("extraExerciseOptions")) {
    const datalist = document.createElement("datalist");
    datalist.id = "extraExerciseOptions";
    for (const optName of exerciseNameOptions) {
      const option = document.createElement("option");
      option.value = optName;
      datalist.appendChild(option);
    }
    document.body.appendChild(datalist);
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "workout__add-exercise-confirm";
  confirmBtn.textContent = "Add";
  form.appendChild(confirmBtn);

  wrap.appendChild(form);

  toggleBtn.addEventListener("click", () => {
    form.hidden = false;
    toggleBtn.hidden = true;
    input.focus();
  });

  function submit() {
    const exerciseName = input.value.trim();
    if (!exerciseName) {
      input.focus();
      return;
    }

    // Two sections for the same lift would fight over the same set numbers
    // when the session is saved — if it's already on the page, add a set to
    // that one instead.
    const existing = ctx.sections.get(exerciseName.toLowerCase());
    if (existing) {
      existing.addSet();
      existing.section.scrollIntoView({ behavior: "smooth", block: "center" });
      flashStatus(`${existing.name} is already in this workout — added a set to it.`, false);
    } else {
      const section = addExerciseSection(ctx, { name: exerciseName, sets: 1, reps: "" }, { isExtra: true });
      section.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    input.value = "";
    form.hidden = true;
    toggleBtn.hidden = false;
  }

  confirmBtn.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });

  return wrap;
}

/** Free-text notes for the whole session — how they're feeling, not tied to any one exercise. Kept with the saved sets, and sent with the rest when they log the workout. */
function buildNotesSection(ctx, initialNotes) {
  const wrap = document.createElement("div");
  wrap.className = "workout__notes";

  const label = document.createElement("span");
  label.className = "workout__notes-label";
  label.textContent = "Notes";
  wrap.appendChild(label);

  const textarea = document.createElement("textarea");
  textarea.className = "workout__notes-input";
  textarea.placeholder = "e.g. slept bad, shoulder hurts, etc.";
  textarea.rows = 2;
  textarea.value = initialNotes || "";
  let saveTimer = null;
  textarea.addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ctx.persist(), 400);
  });
  wrap.appendChild(textarea);

  ctx.notesInput = textarea;
  return wrap;
}

/**
 * The end of the workout: a count of what's saved so far, and the "Log
 * Workout" button that sends it. Anything they filled in but forgot to tap
 * Save on still counts (they clearly did it); a set left as untouched
 * prefill doesn't (that's just last time's numbers, not something they did).
 */
function buildLogSection(ctx) {
  const wrap = document.createElement("div");
  wrap.className = "workout__save-wrap";

  const summary = document.createElement("p");
  summary.className = "workout__save-summary";
  wrap.appendChild(summary);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "workout__save-btn";
  btn.textContent = "Log Workout";
  wrap.appendChild(btn);

  ctx.updateSummary = () => {
    const count = ctx.collectSets().length;
    summary.textContent = count
      ? `${count} set${count === 1 ? "" : "s"} saved — tap Log Workout when you're done.`
      : "Tap Save after each set so nothing gets lost.";
  };
  ctx.updateSummary();

  btn.addEventListener("click", async () => {
    let unfinished = 0;
    ctx.list.querySelectorAll(".workout__set").forEach((row) => {
      const values = rowValues(row);
      if (values.valid && (row._saved || row._touched)) {
        row._saved = { weight: values.weight, reps: values.reps };
        refreshRowState(row);
      } else if (!row._saved && row._touched) {
        unfinished++; // typed something but never gave it both a weight and reps
      }
    });

    const previous = readDraft(ctx.draftKey);
    const draft = ctx.persist();
    if (!draft || !draft.sets.length) {
      flashStatus("Tap Save on the sets you've done first, then Log Workout.", true);
      return;
    }

    els.status.hidden = true;
    btn.disabled = true;
    btn.textContent = "Logging…";
    try {
      // Nothing has changed since the last successful log — no need to send it again.
      const alreadyInSheet = previous && !previous.pending && previous.notes === draft.notes && JSON.stringify(previous.sets) === JSON.stringify(draft.sets);
      if (!alreadyInSheet) await postSession(draft);

      const latest = readDraft(ctx.draftKey);
      if (latest && latest.rev === draft.rev) writeDraft(ctx.draftKey, { ...latest, pending: false });

      if (ctx.finalElapsed === undefined) ctx.finalElapsed = stopWorkoutTimer();
      els.timerValue.textContent = formatElapsed(ctx.finalElapsed);
      els.doneText.textContent = `Nice work — logged in ${formatElapsed(ctx.finalElapsed)}. Head back to your card.`
        + (unfinished ? ` (${unfinished} set${unfinished === 1 ? "" : "s"} had no weight or reps, so ${unfinished === 1 ? "it wasn't" : "they weren't"} logged.)` : "");
      els.done.hidden = false;
      els.done.scrollIntoView({ behavior: "smooth", block: "nearest" });
      try {
        localStorage.setItem(WORKOUT_COMPLETE_STORAGE_KEY, todayString());
      } catch (err) {
        // Storage unavailable — the card just won't auto-show as completed.
      }
    } catch (err) {
      showStatus("Couldn't reach the server — your sets are saved on this phone. Tap Log Workout again when you have signal.", true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Log Workout";
    }
  });

  return wrap;
}

function renderWorkout(shared, workoutName, exercises) {
  const { clientSlug, setRows, setCol, startingWeights, exerciseNameOptions } = shared;
  els.status.hidden = true;
  els.list.innerHTML = "";
  els.list.hidden = false;
  els.done.hidden = true;
  els.pageTag.textContent = workoutName || "Today's Workout";
  startWorkoutTimer();

  const dateStr = sydneyDateStr();
  const key = draftKey(clientSlug, workoutName, dateStr);

  // Whatever they'd already saved today comes back exactly as they left it:
  // from this phone's draft if there is one, otherwise from the sheet (a
  // workout logged from another browser, say).
  const draft = readDraft(key);
  const restored = draft
    ? { sets: draft.sets || [], notes: draft.notes || "" }
    : savedSetsFromRows(setRows, setCol, clientSlug, workoutName, dateSortKey(dateStr));
  const savedByExercise = new Map(); // nameLower -> { name, sets: Map(setNumber -> { weight, reps }) }
  for (const s of restored.sets) {
    const lower = s.exercise.toLowerCase();
    if (!savedByExercise.has(lower)) savedByExercise.set(lower, { name: s.exercise, sets: new Map() });
    savedByExercise.get(lower).sets.set(s.setNumber, { weight: s.weight, reps: s.reps });
  }

  const ctx = {
    clientSlug, workoutName, setRows, setCol, startingWeights,
    list: els.list,
    addExerciseWrap: null,
    notesInput: null,
    sections: new Map(), // nameLower -> { section, name, addSet }
    draftKey: key,
    dateStr,
    todayKey: dateSortKey(dateStr),
    updateSummary: () => {},
  };

  /** Every set they've tapped Save on, in on-screen order — using the numbers as last saved, not whatever's typed in the box right now. */
  ctx.collectSets = () => {
    const sets = [];
    ctx.list.querySelectorAll(".workout__set").forEach((row) => {
      if (row._saved) sets.push({ exercise: row.dataset.exercise, setNumber: Number(row.dataset.setNumber), weight: row._saved.weight, reps: row._saved.reps });
    });
    return sets;
  };

  /** Writes the current saved sets + notes to this phone. Skips writing (returns null) when there's nothing yet to keep: no sets, no notes, no earlier draft. */
  ctx.persist = () => {
    const sets = ctx.collectSets();
    const notes = ctx.notesInput ? ctx.notesInput.value.trim() : "";
    const previous = readDraft(key);
    if (!sets.length && !notes && !previous) return null;
    const next = {
      clientSlug, workoutName, date: dateStr, sets, notes,
      rev: (previous ? previous.rev || 0 : 0) + 1,
      pending: sets.length > 0,
      updatedAt: Date.now(),
    };
    writeDraft(key, next);
    return next;
  };

  ctx.saveSet = (row) => {
    const values = rowValues(row);
    if (!values.valid) {
      const needsWeight = !Number.isFinite(values.weight) || values.weight < 0;
      row.querySelector(needsWeight ? ".workout__weight" : ".workout__reps-input").classList.add("workout__field--invalid");
      setTimeout(() => row.querySelectorAll(".workout__field--invalid").forEach((el) => el.classList.remove("workout__field--invalid")), 1400);
      flashStatus(needsWeight ? "Add the weight first (0 for bodyweight)." : "Add the reps first.", true);
      return;
    }
    row._saved = { weight: values.weight, reps: values.reps };
    refreshRowState(row);
    ctx.persist();
    els.done.hidden = true; // changed since it was logged — needs logging again
    ctx.updateSummary();
  };

  ctx.addExerciseWrap = buildAddExerciseControl(ctx, exerciseNameOptions || []);
  els.list.appendChild(ctx.addExerciseWrap);

  const assignedKeys = new Set();
  for (const exercise of exercises) {
    const lower = exercise.name.toLowerCase();
    assignedKeys.add(lower);
    const saved = savedByExercise.get(lower);
    addExerciseSection(ctx, exercise, { isExtra: false, savedSets: saved ? saved.sets : null });
  }

  // Extras they'd saved earlier TODAY come back with the rest of today's
  // session. (Nothing from a previous workout carries over — those live in
  // the history calendar.)
  for (const [lower, saved] of savedByExercise) {
    if (assignedKeys.has(lower)) continue;
    addExerciseSection(ctx, { name: saved.name, sets: 1, reps: "" }, { isExtra: true, savedSets: saved.sets });
  }

  els.list.appendChild(buildNotesSection(ctx, restored.notes));
  els.list.appendChild(buildLogSection(ctx));
  ctx.updateSummary();
}

function showPicker(shared, workoutGroups, workoutNames) {
  els.status.hidden = true;
  els.list.hidden = true;
  els.done.hidden = true;
  stopWorkoutTimer();
  els.timer.hidden = true;
  els.pageTag.textContent = "Choose Your Workout";
  els.picker.hidden = false;
  els.pickerList.innerHTML = "";
  els.backLink.href = `../card/?id=${encodeURIComponent(memberId)}`;
  els.backLink.onclick = null;

  for (const name of workoutNames) {
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
        showPicker(shared, workoutGroups, workoutNames);
      };
      renderWorkout(shared, name, workoutGroups[name]);
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
  els.historyLink.href = `calendar.html?id=${encodeURIComponent(memberId)}`;
  const clientSlug = slugify(memberId);

  let workoutGroups;
  let workoutOrderByName;
  let setRows, setCol;
  let startingWeights;
  let exerciseNameOptions;

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
        workoutOrder: workout.col.workoutOrder >= 0 ? Number(r[workout.col.workoutOrder]) : NaN,
      }))
      .filter((ex) => ex.name && ex.sets > 0);

    workoutGroups = {};
    workoutOrderByName = {};
    for (const ex of clientExercises) {
      if (!workoutGroups[ex.workoutName]) workoutGroups[ex.workoutName] = [];
      workoutGroups[ex.workoutName].push(ex);
      if (Number.isFinite(ex.workoutOrder) && workoutOrderByName[ex.workoutName] === undefined) {
        workoutOrderByName[ex.workoutName] = ex.workoutOrder;
      }
    }
    for (const name of Object.keys(workoutGroups)) {
      workoutGroups[name].sort((a, b) => a.order - b.order);
    }

    setRows = sets.rows;
    setCol = sets.col;

    startingWeights = {};
    exerciseNameOptions = [];
    for (const row of exerciseDefaults.rows) {
      const rawName = (row[exerciseDefaults.col.name] || "").trim();
      if (!rawName) continue;
      exerciseNameOptions.push(rawName);
      const name = rawName.toLowerCase();
      const weight = Number(row[exerciseDefaults.col.startingWeight]);
      if (Number.isFinite(weight)) startingWeights[name] = weight;
    }
  } catch (err) {
    showStatus("Couldn't load your workout. Check your connection and reopen.", true);
    return;
  }

  // Send off anything from an earlier day that was saved but never logged.
  flushOldDrafts(sydneyDateStr());

  // Infinity - Infinity is NaN, an invalid sort comparator result — a
  // large finite fallback keeps unordered workouts tied (and stable)
  // instead of relying on how a given engine happens to handle NaN here.
  const UNORDERED = Number.MAX_SAFE_INTEGER;
  const workoutNames = Object.keys(workoutGroups).sort(
    (a, b) => (workoutOrderByName[a] ?? UNORDERED) - (workoutOrderByName[b] ?? UNORDERED)
  );
  if (!workoutNames.length) {
    showStatus("No workout assigned yet — check with Max.", false);
    return;
  }

  const shared = { clientSlug, setRows, setCol, startingWeights, exerciseNameOptions };

  if (workoutNames.length === 1) {
    renderWorkout(shared, workoutNames[0], workoutGroups[workoutNames[0]]);
    return;
  }

  showPicker(shared, workoutGroups, workoutNames);
}

init();
