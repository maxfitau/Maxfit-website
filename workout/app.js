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
 * A "Workout date" row at the top defaults to today. Pointing it at an earlier
 * day logs a session that already happened (a workout done with a client
 * yesterday, say): everything — the phone-side draft, the "last time"
 * numbers, the Log Workout that sends it — then belongs to THAT day, and it
 * doesn't tick today's "workout completed" box on the card.
 *
 * Coach mode (?coach=1): opened from the check-in page (checkin.html) after
 * Max scans a client's QR code, so he can log THEIR workout on his own phone.
 * It's the same page with the same client id — plus ?workout= to open one
 * workout directly, ?name= for the "Logging for ..." banner, and ?back= so the
 * back arrow returns to the check-in screen. It has no timer (he may be logging
 * after the fact) and never ticks the "workout completed" box, which lives on
 * whichever phone this is.
 *
 * The coach can attach a tip to any exercise and a note to the whole workout
 * (workout/builder.html); they show under the exercise / above the list.
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
const DRAFT_SCHEMA = 2; // bump to make every older draft on every phone get ignored + discarded
const WEIGHT_STEP = 2.5;
const LOG_TIMEOUT_MS = 30000;

/**
 * The ?v= tag this script was loaded with, shown at the bottom of the page so
 * it's obvious which copy a phone is really running — a phone holding an
 * old cached copy shows an older number, or none at all.
 */
const APP_VERSION = (() => {
  try {
    return new URL(document.currentScript.src).searchParams.get("v") || "";
  } catch (err) {
    return "";
  }
})();

const params = new URLSearchParams(window.location.search);
let memberId = params.get("id");
if (!memberId) {
  try {
    memberId = localStorage.getItem(MEMBER_ID_STORAGE_KEY);
  } catch (err) {
    // Ignore — memberId stays null, handled below.
  }
}

// Coach mode: see the header comment. None of this grants anything — it only changes what's shown.
const coachMode = params.get("coach") === "1";
const coachClientName = (params.get("name") || "").trim();
const presetWorkoutName = (params.get("workout") || "").trim();

/** Where the back arrow goes from the top level: the check-in page that sent us here (this site only — anything else is ignored), else the client's card. */
function homeHref() {
  if (coachMode) {
    const back = params.get("back");
    if (back) {
      try {
        const url = new URL(back, window.location.href);
        if (url.origin === window.location.origin) return url.href;
      } catch (err) {
        // Not a usable URL — fall through to the card.
      }
    }
  }
  return `../card/?id=${encodeURIComponent(memberId)}`;
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

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_BACKLOG_DAYS = 365; // how far back a session can be logged

/** "2026-09-19" -> "Sat 19 Sep". */
function friendlyDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAY_ABBR[weekday]} ${d} ${MONTH_ABBR[m - 1]}`;
}

/** A "yyyy-MM-dd" date moved by whole days — plain calendar arithmetic, so no timezone or daylight-saving surprises. */
function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
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
 * it's filed under. Only sessions strictly BEFORE `beforeKey` (the day being
 * logged) count: for today that's everything up to yesterday — sets already
 * saved today are restored separately, and the prefill is meant to show what
 * they did LAST time — and when logging a past day it's what they did before
 * THAT day, never anything after it.
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
function mostRecentSessionSets(setRows, col, clientSlug, exerciseName, beforeKey) {
  let bestKey = -1;
  for (const row of setRows) {
    if (String(row[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
    if (String(row[col.exercise] || "").trim().toLowerCase() !== exerciseName) continue;
    const key = col.date >= 0 ? dateSortKey(row[col.date]) : NaN;
    if (!Number.isFinite(key) || key >= beforeKey) continue;
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
 * How many distinct sets the sheet already holds for this client + workout +
 * day — used ONLY to warn that logging is about to replace them (say, the
 * client already logged that session from their own phone). It's a count,
 * never something put on screen as sets. Rows from before the sheet had a
 * Workout Name column can't be told apart by workout, so they aren't counted.
 */
function existingLogCount(setRows, col, clientSlug, workoutName, dateStr) {
  if (col.workoutName < 0 || col.date < 0) return 0;
  const wantedDate = dateSortKey(dateStr);
  const wantedName = workoutName.trim().toLowerCase();
  const seen = new Set();
  for (const row of setRows) {
    if (String(row[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
    if (dateSortKey(row[col.date]) !== wantedDate) continue;
    if (String(row[col.workoutName] || "").trim().toLowerCase() !== wantedName) continue;
    seen.add(`${String(row[col.exercise] || "").trim().toLowerCase()}|${row[col.setNumber]}`);
  }
  return seen.size;
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

/**
 * A draft only counts if it was written by this schema. The first release of
 * per-set saving could fill a draft with sets it had copied out of the sheet
 * rather than sets the client tapped Save on (a bug — those showed up as
 * pre-ticked rows and phantom "Extra" exercises), so anything without the
 * marker is treated as if it doesn't exist and gets cleaned up by
 * flushOldDrafts, never displayed and never sent anywhere.
 */
function readDraft(key) {
  let draft = null;
  if (!storageUsable) {
    draft = memoryDrafts.get(key) || null;
  } else {
    try {
      const raw = localStorage.getItem(key);
      draft = raw ? JSON.parse(raw) : null;
    } catch (err) {
      draft = null;
    }
  }
  return draft && draft.schema === DRAFT_SCHEMA ? draft : null;
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

const DRAFT_KEEP_MS = 14 * 24 * 60 * 60 * 1000; // sent drafts are kept this long, then cleaned up

/**
 * A workout that was saved set-by-set but never logged (they forgot the final
 * button, or had no signal when they pressed it) would otherwise sit on the
 * phone forever. Once the day it belongs to is over, send it — every set in
 * it was one they deliberately saved. A draft that's been sent is kept (marked
 * as sent, not deleted) for a couple of weeks rather than thrown away: a
 * session being logged for an earlier day can then be reopened and carried on
 * from where it was left, without the sets already sent being lost. Runs in
 * the background; anything that fails stays put for the next open.
 */
async function flushOldDrafts(todayStr) {
  for (const key of allDraftKeys()) {
    const draft = readDraft(key);
    if (!draft) {
      removeDraft(key); // empty, unreadable, or written by an older schema (see readDraft)
      continue;
    }
    if (draft.date === todayStr) continue;

    if (draft.pending && Array.isArray(draft.sets) && draft.sets.length) {
      try {
        await postSession(draft);
        const latest = readDraft(key);
        if (latest && latest.rev === draft.rev) writeDraft(key, { ...latest, pending: false });
      } catch (err) {
        // Offline, or the server's busy — try again next time the page opens.
      }
      continue;
    }
    if (Date.now() - (draft.updatedAt || 0) > DRAFT_KEEP_MS) removeDraft(key);
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
  const historySets = mostRecentSessionSets(setRows, setCol, clientSlug, key, ctx.beforeKey);
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

  // The coach's tip for this exercise, if there is one. Inserted as text, never
  // as markup, so whatever was typed is shown exactly as written.
  if (exercise.note) {
    const tip = document.createElement("p");
    tip.className = "workout__exercise-tip";
    const tipLabel = document.createElement("span");
    tipLabel.className = "workout__exercise-tip-label";
    tipLabel.textContent = "Tip";
    tip.appendChild(tipLabel);
    tip.appendChild(document.createTextNode(exercise.note));
    section.appendChild(tip);
  }

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

  // Only when the sheet already has this workout for this day and this phone has
  // no draft of it (so it wasn't logged from here): logging would replace it.
  const warning = document.createElement("p");
  warning.className = "workout__save-warning";
  warning.hidden = !ctx.alreadyLoggedCount;
  if (ctx.alreadyLoggedCount) {
    const when = ctx.isToday ? "today" : friendlyDate(ctx.dateStr);
    warning.textContent = `${ctx.workoutName} is already logged for ${when} (${ctx.alreadyLoggedCount} set${ctx.alreadyLoggedCount === 1 ? "" : "s"}). Log Workout will replace it.`;
  }
  wrap.appendChild(warning);

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

      // The date was changed (or they went back) while this was sending — the
      // draft above is already marked sent, but this screen isn't theirs anymore.
      if (ctx.dead) return;

      warning.hidden = true; // it's this phone's own log now
      const unfinishedNote = unfinished
        ? ` (${unfinished} set${unfinished === 1 ? "" : "s"} had no weight or reps, so ${unfinished === 1 ? "it wasn't" : "they weren't"} logged.)`
        : "";
      if (coachMode) {
        // Logged by the coach for a client: no timer text, and the "workout
        // completed" box (which belongs to whichever phone this is) stays alone.
        const who = coachClientName || "them";
        els.doneText.textContent = `Logged for ${who}${ctx.isToday ? "" : ` (${friendlyDate(ctx.dateStr)})`}. Scan the next member's QR code, or tap back to check-in.${unfinishedNote}`;
      } else if (ctx.isToday) {
        if (ctx.finalElapsed === undefined) ctx.finalElapsed = stopWorkoutTimer();
        els.timerValue.textContent = formatElapsed(ctx.finalElapsed);
        els.doneText.textContent = `Nice work — logged in ${formatElapsed(ctx.finalElapsed)}. Head back to your card.${unfinishedNote}`;
        try {
          localStorage.setItem(WORKOUT_COMPLETE_STORAGE_KEY, todayString());
        } catch (err) {
          // Storage unavailable — the card just won't auto-show as completed.
        }
      } else {
        // A session for an earlier day isn't today's workout: no timer, and
        // the card's "workout completed" box is left alone.
        els.doneText.textContent = `Logged for ${friendlyDate(ctx.dateStr)}. Head back to your card.${unfinishedNote}`;
      }
      els.done.hidden = false;
      els.done.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      if (!ctx.dead) showStatus("Couldn't reach the server — your sets are saved on this phone. Tap Log Workout again when you have signal.", true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Log Workout";
    }
  });

  return wrap;
}

function renderWorkout(shared, workoutName, exercises) {
  const { clientSlug, setRows, setCol, startingWeights, exerciseNameOptions } = shared;
  const dateStr = shared.date;
  const isToday = dateStr === sydneyDateStr();
  if (shared.currentCtx) shared.currentCtx.dead = true; // whatever was on screen before is finished with
  shared.current = { workoutName, exercises };

  els.status.hidden = true;
  els.list.innerHTML = "";
  els.list.hidden = false;
  els.done.hidden = true;
  els.pageTag.textContent = workoutName || (isToday ? "Today's Workout" : "Workout");
  if (isToday && !coachMode) {
    startWorkoutTimer();
  } else {
    stopWorkoutTimer(); // a session logged after the fact (or by the coach) has no meaningful duration
    els.timer.hidden = true;
  }

  const key = draftKey(clientSlug, workoutName, dateStr);

  // The only sets ever put back on screen are ones THIS client tapped Save on,
  // on this phone, today, in this exact workout (the draft's key is client +
  // workout + day). Nothing is read back out of the sheet for display — logged
  // history only shows up as the grey "last time" numbers, and in the calendar.
  const draft = readDraft(key);
  const restored = draft
    ? { sets: draft.sets || [], notes: draft.notes || "" }
    : { sets: [], notes: "" };
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
    isToday,
    beforeKey: dateSortKey(dateStr),
    // Warn (never display) if logging this would replace a session already in the sheet.
    alreadyLoggedCount: draft ? 0 : existingLogCount(setRows, setCol, clientSlug, workoutName, dateStr),
    dead: false,
    updateSummary: () => {},
  };
  shared.currentCtx = ctx;

  /** Every set they've tapped Save on, in on-screen order — using the numbers as last saved, not whatever's typed in the box right now. */
  ctx.collectSets = () => {
    const sets = [];
    ctx.list.querySelectorAll(".workout__set").forEach((row) => {
      if (row._saved) sets.push({ exercise: row.dataset.exercise, setNumber: Number(row.dataset.setNumber), weight: row._saved.weight, reps: row._saved.reps });
    });
    return sets;
  };

  /**
   * Writes the current saved sets + notes to this phone. Returns null when
   * there's nothing yet to keep (no sets, no notes, no earlier draft), and
   * returns the stored draft untouched when nothing has changed since — so
   * calling it "just in case" never flips a draft that has already been sent
   * back to unsent, which would make it get sent again later.
   */
  ctx.persist = () => {
    const sets = ctx.collectSets();
    const notes = ctx.notesInput ? ctx.notesInput.value.trim() : "";
    const previous = readDraft(key);
    if (!sets.length && !notes && !previous) return null;
    if (previous && previous.notes === notes && JSON.stringify(previous.sets) === JSON.stringify(sets)) return previous;
    const next = {
      schema: DRAFT_SCHEMA,
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
    const before = readDraft(key);
    const after = ctx.persist();
    if (!before || !after || after.rev !== before.rev) els.done.hidden = true; // changed since it was logged — needs logging again
    ctx.updateSummary();
  };

  // The coach's note for the whole workout, if there is one, sits above the exercises.
  const coachNote = shared.workoutNotes ? shared.workoutNotes[workoutName] : "";
  if (coachNote) els.list.appendChild(buildCoachNote(coachNote));

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

/** "Logging for <client>" — shown in coach mode so it's always obvious whose workout is being filled in. Text only, never markup. */
function buildCoachBanner(name) {
  const box = document.createElement("div");
  box.className = "workout__coach-banner";

  const label = document.createElement("span");
  label.className = "workout__coach-banner-label";
  label.textContent = "Logging for";
  box.appendChild(label);

  const who = document.createElement("span");
  who.className = "workout__coach-banner-name";
  who.textContent = name || "this client";
  box.appendChild(who);
  return box;
}

/** The coach's note for the whole workout — plain text, line breaks kept. */
function buildCoachNote(text) {
  const box = document.createElement("div");
  box.className = "workout__coach-note";

  const label = document.createElement("span");
  label.className = "workout__coach-note-label";
  label.textContent = "Coach's note";
  box.appendChild(label);

  const body = document.createElement("p");
  body.className = "workout__coach-note-text";
  body.textContent = text;
  box.appendChild(body);
  return box;
}

/**
 * "Workout date" — today unless it's pointed at an earlier day. Built here
 * (not in index.html) so this script never depends on markup an older cached
 * copy of the page might not have. Future days aren't possible, and neither
 * is anything more than a year back (that's a typo, not a backlog).
 */
function buildDateRow(shared) {
  const wrap = document.createElement("div");
  wrap.className = "workout__date";

  const row = document.createElement("div");
  row.className = "workout__date-row";

  const label = document.createElement("label");
  label.className = "workout__date-label";
  label.htmlFor = "workoutDateInput";
  label.textContent = "Workout date";
  row.appendChild(label);

  const input = document.createElement("input");
  input.type = "date";
  input.id = "workoutDateInput";
  input.className = "workout__date-input";
  const today = sydneyDateStr();
  input.max = today;
  input.min = shiftDate(today, -MAX_BACKLOG_DAYS);
  row.appendChild(input);
  wrap.appendChild(row);

  const note = document.createElement("p");
  note.className = "workout__date-note";
  note.hidden = true;
  const noteText = document.createElement("span");
  note.appendChild(noteText);
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "workout__date-reset";
  resetBtn.textContent = "Back to today";
  note.appendChild(resetBtn);
  wrap.appendChild(note);

  shared.syncDate = () => {
    const isToday = shared.date === sydneyDateStr();
    input.value = shared.date;
    note.hidden = isToday;
    noteText.textContent = isToday ? "" : `Logging for ${friendlyDate(shared.date)} — this won't count as today's workout.`;
  };

  input.addEventListener("change", () => changeDate(shared, input.value));
  resetBtn.addEventListener("click", () => changeDate(shared, sydneyDateStr()));
  shared.syncDate();
  return wrap;
}

/** Sets: any typed-in-but-unsaved set on screen (those would be lost when the workout reloads for the new day). */
function hasUnsavedEntries() {
  return Array.from(els.list.querySelectorAll(".workout__set")).some((row) => row._touched && !row.classList.contains("workout__set--saved"));
}

function changeDate(shared, value) {
  const today = sydneyDateStr();
  let next = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today; // cleared or garbled -> today
  if (next > today) next = today; // yyyy-MM-dd strings compare correctly as text
  const earliest = shiftDate(today, -MAX_BACKLOG_DAYS);
  if (next < earliest) next = earliest;

  if (next === shared.date) {
    shared.syncDate();
    return;
  }

  if (shared.current) {
    if (hasUnsavedEntries() && !window.confirm("Changing the date reloads this workout. Sets you've typed but not saved will be cleared. Continue?")) {
      shared.syncDate(); // stay put
      return;
    }
    if (shared.currentCtx) shared.currentCtx.persist(); // keep any notes typed so far with the day they belong to
  }

  shared.date = next;
  shared.syncDate();
  if (shared.current) renderWorkout(shared, shared.current.workoutName, shared.current.exercises);
}

function showPicker(shared, workoutGroups, workoutNames) {
  if (shared.currentCtx) shared.currentCtx.dead = true;
  shared.current = null;
  shared.currentCtx = null;
  els.status.hidden = true;
  els.list.hidden = true;
  els.done.hidden = true;
  stopWorkoutTimer();
  els.timer.hidden = true;
  els.pageTag.textContent = coachMode ? "Choose Workout" : "Choose Your Workout";
  els.picker.hidden = false;
  els.pickerList.innerHTML = "";
  const pickerHint = els.picker.querySelector(".workout__picker-hint");
  if (pickerHint && coachMode) pickerHint.textContent = "Which workout did they do?";
  els.backLink.href = homeHref();
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

  els.backLink.href = homeHref();
  els.historyLink.href = `calendar.html?id=${encodeURIComponent(memberId)}`;
  const clientSlug = slugify(memberId);

  let workoutGroups;
  let workoutOrderByName;
  let workoutNotes;
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
        note: workout.col.notes >= 0 ? String(r[workout.col.notes] || "").trim() : "",
        workoutNote: workout.col.workoutNotes >= 0 ? String(r[workout.col.workoutNotes] || "").trim() : "",
      }))
      .filter((ex) => ex.name && ex.sets > 0);

    workoutGroups = {};
    workoutOrderByName = {};
    workoutNotes = {};
    for (const ex of clientExercises) {
      if (!workoutGroups[ex.workoutName]) workoutGroups[ex.workoutName] = [];
      workoutGroups[ex.workoutName].push(ex);
      if (ex.workoutNote && !workoutNotes[ex.workoutName]) workoutNotes[ex.workoutName] = ex.workoutNote;
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

  // date = the day being logged (today unless changed); current/currentCtx =
  // whichever workout is open, so changing the date can reload it for the new day.
  const shared = { clientSlug, setRows, setCol, startingWeights, exerciseNameOptions, workoutNotes, date: sydneyDateStr(), current: null, currentCtx: null };
  document.querySelector(".card__top").insertAdjacentElement("afterend", buildDateRow(shared));
  if (coachMode) document.querySelector(".card__top").insertAdjacentElement("afterend", buildCoachBanner(coachClientName || memberId));

  // Sent here for one particular workout (the check-in page's buttons): open
  // it straight away. The back arrow already points home, so it returns to
  // the check-in screen to pick a different one.
  const presetKey = presetWorkoutName.toLowerCase();
  const presetMatch = presetKey ? workoutNames.find((n) => n.toLowerCase() === presetKey) : null;
  if (presetMatch) {
    renderWorkout(shared, presetMatch, workoutGroups[presetMatch]);
    return;
  }

  if (workoutNames.length === 1) {
    renderWorkout(shared, workoutNames[0], workoutGroups[workoutNames[0]]);
    return;
  }

  showPicker(shared, workoutGroups, workoutNames);
}

if (APP_VERSION) {
  const stamp = document.createElement("p");
  stamp.className = "workout__version";
  stamp.textContent = `Version ${APP_VERSION}`;
  document.getElementById("workout").appendChild(stamp);
}

init();
