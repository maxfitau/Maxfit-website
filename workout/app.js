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
 * Three ways to SEE the same workout — Checklist (default), Show all, Simple
 * view — picked from the VIEW button and remembered per member
 * (maxfitWorkoutView|<id>). Switching views never loses anything typed or
 * saved: every view is built from the same underlying set-row elements
 * (buildSetRow), just arranged differently, and a snapshot of whatever's on
 * screen (saved or just typed) is carried across a switch — see
 * snapshotRows_/applySnapshot_.
 *
 * How saving works: every set has its own tick (or, in Simple view, a DONE
 * button). Tapping it commits that set to this phone right away — instantly,
 * no network, so it can't be slow and can't fail — which means closing the
 * page or losing signal mid-workout never costs them anything they've
 * already saved; reopening the workout puts every saved set straight back.
 * "Finish Workout" opens a review screen (time/sets/kg, a personal-best
 * card, what this session trained, and the "how did it feel" note); "Save &
 * Close" there is the one step that actually sends the finished session to
 * Max's sheet. (A workout that was saved but never sent is sent
 * automatically the next time this page opens on a later day, so it isn't
 * stranded on the phone.)
 *
 * A "Today ▾" pill at the top defaults to today. Pointing it at an earlier
 * day logs a session that already happened (a workout done with a client
 * yesterday, say): everything — the phone-side draft, the "last time"
 * numbers, what gets sent — then belongs to THAT day, and it doesn't tick
 * today's "workout completed" box on the card.
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
 * glance at the number, do the set, and tap the tick (editing first if they
 * went up or down).
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
let pendingAddExerciseHandled_ = false; // ?addExercise=, from the Exercise Library — added once, see renderWorkout
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
  picker: document.getElementById("workoutPicker"),
  pickerList: document.getElementById("workoutPickerList"),
  list: document.getElementById("exerciseList"),
  review: document.getElementById("workoutReview"),
  done: document.getElementById("workoutDone"),
  doneText: document.querySelector(".workout__done-text"),
  status: document.getElementById("status"),
  backLink: document.getElementById("backLink"),
  historyLink: document.getElementById("historyLink"),
  progressLink: document.getElementById("progressLink"),
  restTimer: document.getElementById("restTimer"),
  restValue: document.getElementById("restValue"),
  restLabel: document.getElementById("restLabel"),
  restMinus: document.getElementById("restMinus"),
  restPlus: document.getElementById("restPlus"),
  restClose: document.getElementById("restClose"),
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
 * the interval. Writes into whichever element it's given (the timer pill
 * rebuilt in the header each renderWorkout) rather than a fixed global, so
 * a view switch — which doesn't rebuild the header — doesn't interrupt it.
 */
let workoutTimerInterval = null;
let workoutTimerStart = null;

function startWorkoutTimer(valueEl, resumeFromMs) {
  workoutTimerStart = Date.now() - (resumeFromMs || 0);
  if (valueEl) valueEl.textContent = formatElapsed(resumeFromMs || 0);
  if (workoutTimerInterval) clearInterval(workoutTimerInterval);
  workoutTimerInterval = setInterval(() => {
    if (valueEl) valueEl.textContent = formatElapsed(Date.now() - workoutTimerStart);
  }, 1000);
}

function stopWorkoutTimer() {
  if (workoutTimerInterval) {
    clearInterval(workoutTimerInterval);
    workoutTimerInterval = null;
  }
  return workoutTimerStart ? Date.now() - workoutTimerStart : 0;
}

/**
 * Rest-between-sets countdown — separate from the workout-length timer
 * above. Starts fresh at the client's own last-chosen length (default 90s)
 * on every successful set save, rather than extending a running one, since
 * a clean rest after each set is the simplest mental model. Skipped
 * entirely in coach mode: same reasoning as the workout timer, a session
 * logged after the fact has no real rest to time.
 */
let restDuration = 90;
let restRemaining = 0;
let restInterval = null;
let restDoneTimeout = null;
let restIsOneOff = false; // a superset's own rest: -15/+15 change this countdown only, not the page's usual rest

function formatRest(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Keeps the floating bar clear of the bottom-nav pill, measured rather than guessed — the pill's real height and safe-area offset vary by device, same approach bottom-nav.js uses for its own spacer. */
function positionRestTimer() {
  const nav = document.querySelector(".bottom-nav");
  if (!nav) return;
  els.restTimer.style.bottom = `${window.innerHeight - nav.getBoundingClientRect().top + 10}px`;
}

/** options (a superset's rest): { seconds, label } — its own length, and what the bar says. */
function startRestTimer(options) {
  if (coachMode) return;
  clearInterval(restInterval);
  clearTimeout(restDoneTimeout);
  els.restTimer.classList.remove("workout__rest--done");
  els.restLabel.textContent = (options && options.label) || "Rest";
  restIsOneOff = Boolean(options && options.seconds);
  restRemaining = restIsOneOff ? options.seconds : restDuration;
  els.restValue.textContent = formatRest(restRemaining);
  positionRestTimer();
  els.restTimer.hidden = false;
  restInterval = setInterval(() => {
    restRemaining -= 1;
    if (restRemaining <= 0) {
      clearInterval(restInterval);
      restInterval = null;
      restRemaining = 0;
      els.restValue.textContent = formatRest(0);
      els.restLabel.textContent = "Rest's up — go!";
      els.restTimer.classList.add("workout__rest--done");
      if (navigator.vibrate) navigator.vibrate([150, 100, 150]);
      restDoneTimeout = setTimeout(() => {
        els.restTimer.hidden = true;
      }, 4000);
      return;
    }
    els.restValue.textContent = formatRest(restRemaining);
  }, 1000);
}

function stopRestTimer() {
  clearInterval(restInterval);
  clearTimeout(restDoneTimeout);
  restInterval = null;
  els.restTimer.hidden = true;
}

els.restMinus.addEventListener("click", () => {
  if (!restIsOneOff) restDuration = Math.max(15, restDuration - 15);
  if (restInterval) {
    restRemaining = Math.max(1, restRemaining - 15);
    els.restValue.textContent = formatRest(restRemaining);
  }
});
els.restPlus.addEventListener("click", () => {
  if (!restIsOneOff) restDuration = Math.min(600, restDuration + 15);
  if (restInterval) {
    restRemaining += 15;
    els.restValue.textContent = formatRest(restRemaining);
  }
});
els.restClose.addEventListener("click", stopRestTimer);
window.addEventListener("resize", () => {
  if (!els.restTimer.hidden) positionRestTimer();
});

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
 * The best set this client has EVER logged for this exercise (heaviest
 * weight; ties broken by more reps at that weight) — used only for the
 * review screen's "New Personal Best" card. Returns null if the sheet's
 * columns needed to tell can't be found, so that card never guesses.
 */
function allTimeBestSet_(setRows, col, clientSlug, exerciseName) {
  if (col.weight < 0 || col.exercise < 0 || col.client < 0) return null;
  let best = null;
  for (const row of setRows) {
    if (String(row[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
    if (String(row[col.exercise] || "").trim().toLowerCase() !== exerciseName) continue;
    const weight = Number(row[col.weight]);
    if (!Number.isFinite(weight)) continue;
    const reps = Number(row[col.reps]);
    if (!best || weight > best.weight || (weight === best.weight && Number.isFinite(reps) && reps > (best.reps || 0))) {
      best = { weight, reps: Number.isFinite(reps) ? reps : null };
    }
  }
  return best;
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
// the tick on. `pending` means "this is ahead of what's in the sheet" — true
// from the moment something's saved until a Save & Close for it succeeds.
// `rev` ticks up on every change, so a request that was in flight while they
// kept saving can't mark newer changes as sent.

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
 * A workout that was saved set-by-set but never sent (they forgot to finish,
 * or had no signal) would otherwise sit on the phone forever. Once the day
 * it belongs to is over, send it — every set in it was one they deliberately
 * saved. A draft that's been sent is kept (marked as sent, not deleted) for a
 * couple of weeks rather than thrown away: a session being logged for an
 * earlier day can then be reopened and carried on from where it was left,
 * without the sets already sent being lost. Runs in the background; anything
 * that fails stays put for the next open.
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

// ---- Icons ------------------------------------------------------------

const TICK_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7"/></svg>';
const CHECK_CIRCLE_SVG = '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M8 12.5l2.7 2.7L16.5 9"/></svg>';
const TROPHY_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v4a4 4 0 0 1-8 0V4z"/><path d="M8 5H5a3 3 0 0 0 3 5M16 5h3a3 3 0 0 1-3 5"/><path d="M12 13v3M9 20h6M10 16.5h4v2a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-2z"/></svg>';
const PLAY_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>';
const VIEW_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="11" width="18" height="5" rx="1.5"/><rect x="3" y="18" width="10" height="3" rx="1.5"/></svg>';
const CALENDAR_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>';
const CLOCK_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const CL_DIAGRAM_SVG = '<svg width="30" height="30" viewBox="0 0 30 30" fill="none"><rect x="2" y="2" width="26" height="9" rx="2" stroke="currentColor" stroke-width="2"/><rect x="2" y="14" width="26" height="4" rx="1.5" fill="currentColor" opacity="0.35"/><rect x="2" y="21" width="26" height="4" rx="1.5" fill="currentColor" opacity="0.35"/></svg>';
const SA_DIAGRAM_SVG = '<svg width="30" height="30" viewBox="0 0 30 30" fill="none"><rect x="2" y="2" width="26" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="2" y="11.5" width="26" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="2" y="21" width="26" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>';
const SV_DIAGRAM_SVG = '<svg width="30" height="30" viewBox="0 0 30 30" fill="none"><rect x="4" y="2" width="22" height="26" rx="3" stroke="currentColor" stroke-width="2"/><rect x="9" y="19" width="12" height="5" rx="1.5" fill="currentColor" opacity="0.4"/></svg>';

/** Plain-text escape for the small bits of user-entered text (an exercise name) interpolated into innerHTML on this page — same purpose as library.js's libEsc, duplicated rather than shared since this page doesn't load that file. */
function libEscApp_(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function scrollToSet_(el) {
  if (!el) return;
  const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
}

// ---- Set rows ---------------------------------------------------------
//
// One component shared by all three views: the DOM node, its weight/reps
// inputs, and its `_saved`/`_touched` state are identical regardless of
// which view built it — only the layout around them differs (a compact
// grid row for Checklist/Show all, two big stepper cards for Simple view).
// ctx.collectSets() and everything downstream of it reads `_saved` straight
// off these nodes, so that contract never changes.

/**
 * What's typed into a set row right now, and whether it's complete enough to
 * save (reps > 0, and a weight — 0 is fine for bodyweight, blank is not) —
 * EXCEPT a blank compact-variant box falls back to its own grey suggested
 * number (row._suggestedWeight/_suggestedReps, set in buildSetRow): per the
 * brief, tapping the tick with nothing typed confirms the suggestion shown
 * as placeholder text, it doesn't block the save.
 */
function rowValues(row) {
  const weightText = row.querySelector(".workout__weight-input").value.trim();
  const repsText = row.querySelector(".workout__reps-input").value.trim();
  const weight = weightText === "" ? (Number.isFinite(row._suggestedWeight) ? row._suggestedWeight : NaN) : Number(weightText);
  const reps = repsText === "" ? (Number.isFinite(row._suggestedReps) ? row._suggestedReps : NaN) : Number(repsText);
  return { weight, reps, valid: Number.isFinite(weight) && weight >= 0 && Number.isFinite(reps) && reps > 0 };
}

/** Saved = tick solid red (or, in Simple view, the stepper cards get a red border). Editing a saved set's numbers un-ticks it — this is the only place that decides "saved" visually, from the numbers on screen vs. what was last actually saved. */
function refreshRowState(row) {
  const values = rowValues(row);
  const isSaved = Boolean(row._saved) && values.valid && values.weight === row._saved.weight && values.reps === row._saved.reps;
  row.classList.toggle("workout__set--saved", isSaved);
  if (isSaved) row.querySelectorAll(".workout__weight-input--prefilled, .workout__reps-input--prefilled").forEach((el) => el.classList.remove("workout__weight-input--prefilled", "workout__reps-input--prefilled"));
  const tick = row.querySelector(".workout__set-tick");
  if (tick) tick.setAttribute("aria-label", isSaved ? `Set ${row.dataset.setNumber} saved` : `Save set ${row.dataset.setNumber}`);
}

/**
 * initial: { weight, reps, saved, suggestion, last } — `saved` rows come
 * back from a draft/the sheet already committed; `suggestion` marks numbers
 * that are only a starting point (last session's, or copied from the set
 * above). options: { variant: "compact"|"simple", hideSaveButton } — Simple
 * view hides the row's own tick, since the page-level DONE button saves it
 * instead (and also decides whether to start a rest timer, which varies by
 * what comes next).
 */
function buildSetRow(exercise, setNumber, initial, onSave, options) {
  const variant = (options && options.variant) || "compact";
  const hideSaveButton = Boolean(options && options.hideSaveButton);

  const row = document.createElement("div");
  row.className = `workout__set workout__set--${variant}`;
  row.dataset.exercise = exercise.name;
  row.dataset.setNumber = String(setNumber);
  row._saved = initial.saved ? { weight: initial.weight, reps: initial.reps } : null;
  row._touched = false;
  row._last = initial.last && Number.isFinite(initial.last.weight) ? { ...initial.last } : null;
  // Indirection so a superset's round-navigation logic can rewire what
  // saving this exact row does (rest or not, which round opens next) once
  // it's built — see renderSupersetBody_. Everything else just calls it.
  row._onSave = onSave;

  const weightInput = document.createElement("input");
  weightInput.type = "text";
  weightInput.inputMode = "decimal";
  weightInput.className = "workout__weight-input";
  weightInput.setAttribute("aria-label", `Set ${setNumber} weight in kilograms`);

  const repsInput = document.createElement("input");
  repsInput.type = "number";
  repsInput.inputMode = "numeric";
  repsInput.className = "workout__reps-input";
  repsInput.setAttribute("aria-label", `Set ${setNumber} reps`);

  const bodyweightZero = initial.weight === 0;
  if (initial.saved) {
    weightInput.value = formatWeight(initial.weight);
    repsInput.value = String(initial.reps);
  } else if (variant === "compact") {
    // Empty, with the suggestion shown as placeholder text only (2026-11 redesign: numbers never sit in the box pretending to be typed) —
    // but the number itself is kept on the row (_suggestedWeight/_suggestedReps, read by rowValues) so tapping the tick with nothing typed
    // still confirms it, per the brief: "using typed values, or the grey suggested values if the client didn't type anything."
    if (initial.weight !== null && initial.weight !== undefined) row._suggestedWeight = initial.weight;
    if (initial.reps !== null && initial.reps !== undefined) row._suggestedReps = initial.reps;
    weightInput.placeholder = initial.weight !== null && initial.weight !== undefined ? (bodyweightZero ? "BW" : formatWeight(initial.weight)) : "kg";
    repsInput.placeholder = initial.reps !== null && initial.reps !== undefined ? String(initial.reps) : (exercise.reps || "reps");
  } else {
    // Simple view's steppers need a real number to nudge from.
    weightInput.value = formatWeight(initial.weight !== null && initial.weight !== undefined ? initial.weight : 0);
    weightInput.classList.add("workout__weight-input--prefilled");
    if (initial.reps !== null && initial.reps !== undefined) {
      repsInput.value = String(initial.reps);
      repsInput.classList.add("workout__reps-input--prefilled");
    } else {
      repsInput.placeholder = exercise.reps || "reps";
    }
  }

  function touched() {
    row._touched = true;
    refreshRowState(row);
  }
  function nudgeWeight(direction) {
    const current = Number(weightInput.value) || 0;
    weightInput.value = formatWeight(Math.max(0, current + direction * WEIGHT_STEP));
    weightInput.classList.remove("workout__weight-input--prefilled");
    touched();
  }
  function nudgeReps(direction) {
    const current = Number(repsInput.value) || 0;
    repsInput.value = String(Math.max(0, current + direction));
    repsInput.classList.remove("workout__reps-input--prefilled");
    touched();
  }
  weightInput.addEventListener("input", () => {
    weightInput.classList.remove("workout__weight-input--prefilled");
    touched();
  });
  repsInput.addEventListener("input", () => {
    repsInput.classList.remove("workout__reps-input--prefilled");
    touched();
  });
  repsInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !hideSaveButton) {
      event.preventDefault();
      row._onSave(row);
    }
  });

  if (variant === "compact") {
    const num = document.createElement("span");
    num.className = "workout__set-num";
    num.textContent = String(setNumber);
    row.appendChild(num);

    const last = document.createElement("p");
    last.className = "workout__set-last";
    last.textContent = row._last ? `${formatWeight(row._last.weight)}kg${Number.isFinite(row._last.reps) ? ` × ${row._last.reps}` : ""}` : "—";
    row.appendChild(last);

    const weightWrap = document.createElement("div");
    weightWrap.className = "workout__weight workout__field";
    weightWrap.appendChild(weightInput);
    row.appendChild(weightWrap);

    const repsWrap = document.createElement("div");
    repsWrap.className = "workout__reps workout__field";
    repsWrap.appendChild(repsInput);
    row.appendChild(repsWrap);

    if (!hideSaveButton) {
      const tick = document.createElement("button");
      tick.type = "button";
      tick.className = "workout__set-tick";
      tick.innerHTML = TICK_SVG;
      tick.addEventListener("click", () => row._onSave(row));
      row.appendChild(tick);
    }
  } else {
    const field = (labelText, input, minusLabel, plusLabel, onStep) => {
      const wrap = document.createElement("div");
      wrap.className = "workout__simple-field";
      const label = document.createElement("span");
      label.className = "workout__simple-field-label";
      label.textContent = labelText;
      wrap.appendChild(label);
      const stepper = document.createElement("div");
      stepper.className = "workout__simple-stepper";
      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "workout__simple-step";
      minus.textContent = "−";
      minus.setAttribute("aria-label", minusLabel);
      minus.addEventListener("click", () => onStep(-1));
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "workout__simple-step";
      plus.textContent = "+";
      plus.setAttribute("aria-label", plusLabel);
      plus.addEventListener("click", () => onStep(1));
      stepper.append(minus, input, plus);
      wrap.appendChild(stepper);
      return wrap;
    };
    row.appendChild(field("Weight (kg)", weightInput, "Decrease weight", "Increase weight", nudgeWeight));
    row.appendChild(field("Reps", repsInput, "Decrease reps", "Increase reps", nudgeReps));
  }

  refreshRowState(row);
  return row;
}

/**
 * Captures exactly what's on screen right now for every set row — saved
 * state AND whatever's currently typed, even if not yet saved — so
 * switching views (which rebuilds every row in the new layout) can restore
 * it. Keyed by exercise name + set number, which is stable across variants.
 */
function snapshotRows_(ctx) {
  const snap = new Map();
  allRows_(ctx).forEach((row) => {
    const key = `${row.dataset.exercise.toLowerCase()}|${row.dataset.setNumber}`;
    snap.set(key, {
      saved: row._saved ? { ...row._saved } : null,
      touched: row._touched,
      weightText: row.querySelector(".workout__weight-input").value,
      repsText: row.querySelector(".workout__reps-input").value,
    });
  });
  return snap;
}

function applySnapshot_(row, snap) {
  const entry = snap && snap.get(`${row.dataset.exercise.toLowerCase()}|${row.dataset.setNumber}`);
  if (!entry) return;
  if (entry.touched || entry.saved) {
    row.querySelector(".workout__weight-input").value = entry.weightText;
    row.querySelector(".workout__reps-input").value = entry.repsText;
    row.querySelectorAll(".workout__weight-input--prefilled, .workout__reps-input--prefilled").forEach((el) => el.classList.remove("workout__weight-input--prefilled", "workout__reps-input--prefilled"));
  }
  row._saved = entry.saved ? { ...entry.saved } : null;
  row._touched = entry.touched;
  refreshRowState(row);
}

/**
 * One exercise's set rows, not yet on the page: last-time numbers, starting
 * weight and anything already saved today. Shared by a normal exercise and a
 * superset's members, which lay the same rows out in rounds. Set numbers
 * stay 1, 2, 3... per exercise either way.
 */
function buildExerciseSets_(ctx, exercise, savedSets, onSave, rowOptions) {
  const { clientSlug, setRows, setCol, startingWeights } = ctx;
  const key = exercise.name.toLowerCase();
  const historySets = mostRecentSessionSets(setRows, setCol, clientSlug, key, ctx.beforeKey);
  const maxHistSetNumber = historySets ? Math.max(...historySets.keys()) : 0;
  const firstSetHistory = historySets ? historySets.get(1) : null;
  const historyWeight = firstSetHistory ? firstSetHistory.weight : null;
  const prefillWeight = historyWeight !== null ? historyWeight : (startingWeights[key] !== undefined ? startingWeights[key] : null);
  const rows = [];

  function addRow(addedByClient) {
    const setNumber = rows.length + 1;
    let initial = null;

    const saved = savedSets.get(setNumber);
    if (saved) {
      const histForSaved = historySets && (historySets.get(setNumber) || historySets.get(maxHistSetNumber));
      initial = { weight: saved.weight, reps: saved.reps, saved: true, suggestion: false, last: histForSaved || null };
    } else if (addedByClient && rows.length) {
      // An extra set is most likely "same again" — start from the set above.
      const above = rowValues(rows[rows.length - 1]);
      const histForExtra = historySets && (historySets.get(setNumber) || historySets.get(maxHistSetNumber));
      if (above.valid) initial = { weight: above.weight, reps: above.reps, saved: false, suggestion: true, last: histForExtra || null };
    }
    if (!initial) {
      // Set-for-set against last session where possible (today's Set 2 gets
      // last time's Set 2); a set beyond how many they did last time falls
      // back to repeating the last set of that session rather than going in
      // blind, since that's the closest known data point.
      const hist = historySets && (historySets.get(setNumber) || historySets.get(maxHistSetNumber));
      initial = {
        last: hist || null,
        weight: hist ? hist.weight : prefillWeight,
        reps: hist ? hist.reps : null,
        saved: false,
        suggestion: Boolean(hist),
      };
    }
    const row = buildSetRow(exercise, setNumber, initial, onSave, rowOptions);
    if (ctx.activeSnapshot) applySnapshot_(row, ctx.activeSnapshot);
    rows.push(row);
    return row;
  }

  const maxSavedSetNumber = savedSets.size ? Math.max(...savedSets.keys()) : 0;
  const initialRows = Math.max(exercise.sets, maxSavedSetNumber);
  for (let i = 0; i < initialRows; i++) addRow(false);

  return { rows, addRow, historyWeight, prefillWeight };
}

/** Which muscles this exercise works, or null if we don't know. Left out of Simple view's single-exercise screen — no room, and not part of that view's spec. */
function buildExerciseMuscles_(exercise) {
  const muscles = resolveExerciseMuscles_(exercise.name, exerciseIndex_);
  if (!muscles.primary.length && !muscles.secondary.length) return null;
  const musclesEl = document.createElement("div");
  musclesEl.className = "workout__exercise-muscles";
  renderMuscleHighlight(musclesEl, muscles.primary, muscles.secondary);
  return musclesEl.hidden ? null : musclesEl;
}

/** The coach's tip. Inserted as text, never as markup, so whatever was typed is shown exactly as written. */
function buildExerciseTip_(note) {
  const tip = document.createElement("p");
  tip.className = "workout__exercise-tip";
  const tipLabel = document.createElement("span");
  tipLabel.className = "workout__exercise-tip-label";
  tipLabel.textContent = "Tip";
  tip.appendChild(tipLabel);
  tip.appendChild(document.createTextNode(note));
  return tip;
}

/**
 * The play-icon "Watch how" button — hidden whenever an exercise has no
 * video link. Nothing in the sheet carries one yet (no Exercises-tab column
 * for it), so right now this is always hidden; it's wired up ready for when
 * Max wants to add that.
 */
function buildWatchButton_(exercise, size) {
  const url = exercise.video;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.hidden = !url;
  if (size === "large") {
    btn.className = "workout__watch-link";
    btn.innerHTML = `${PLAY_SVG}<span>Watch how</span>`;
  } else {
    btn.className = "workout__watch-btn";
    btn.setAttribute("aria-label", "Watch how to do it");
    btn.innerHTML = PLAY_SVG;
  }
  if (url) btn.addEventListener("click", () => window.open(url, "_blank", "noopener"));
  return btn;
}

// ---- Item model ---------------------------------------------------------
//
// A workout is an ordered list of "items" — a plain exercise, or a superset
// (2+ exercises the builder linked with "Superset with next"), each holding
// its members' already-built set rows. Pure data + row construction; no DOM
// insertion happens here — each view's own layout function decides how to
// arrange these same items and rows on screen.

function itemName_(item) {
  return item.type === "exercise" ? item.exercise.name : item.members.map((m) => m.exercise.name).join(" + ");
}
function itemTotalCount_(item) {
  return item.type === "exercise" ? item.sets.rows.length : item.members.reduce((n, m) => n + m.sets.rows.length, 0);
}
function itemSavedCount_(item) {
  const rows = item.type === "exercise" ? item.sets.rows : item.members.flatMap((m) => m.sets.rows);
  return rows.filter((r) => r._saved).length;
}
function itemDone_(item) {
  const total = itemTotalCount_(item);
  return total > 0 && itemSavedCount_(item) === total;
}

/**
 * Every set row that exists right now, whether or not it's actually mounted
 * in the DOM — Checklist only attaches the one open item's rows, so a
 * collapsed item's rows (and anything saved or typed into them before they
 * collapsed) would be invisible to a plain `els.list.querySelectorAll(...)`.
 * collectSets, the Finish-tap sweep and the unsaved-entries check all read
 * through this instead, so nothing saved or typed is ever missed just
 * because its exercise isn't the one currently open.
 */
function allRows_(ctx) {
  if (!ctx || !ctx.items) return [];
  return ctx.items.flatMap((item) => (item.type === "exercise" ? item.sets.rows : item.members.flatMap((m) => m.sets.rows)));
}

/** Builds the ordered top-level items for this workout, including extras saved earlier today — same grouping rule as before (a run of "superset: Y" exercises becomes one group). */
function buildItems_(ctx, exercises, savedByExercise, rowOptions) {
  const items = [];
  const assignedKeys = new Set();
  let supersetCount = 0;
  for (let i = 0; i < exercises.length; ) {
    let last = i;
    while (exercises[last].superset && exercises[last + 1]) last++;
    const chain = exercises.slice(i, last + 1);
    chain.forEach((exercise) => assignedKeys.add(exercise.name.toLowerCase()));
    if (chain.length > 1) {
      const rest = chain.map((exercise) => exercise.supersetRest).find((seconds) => seconds >= 15 && seconds <= 600) || 90;
      const letter = String.fromCharCode(65 + (supersetCount % 26));
      supersetCount++;
      const members = chain.map((exercise, idx) => {
        const saved = savedByExercise.get(exercise.name.toLowerCase());
        const sets = buildExerciseSets_(ctx, exercise, saved ? saved.sets : new Map(), (row) => ctx.saveSet(row), rowOptions);
        return { exercise, code: `${letter}${idx + 1}`, sets };
      });
      items.push({ type: "superset", letter, word: chain.length >= 3 ? "Circuit" : "Superset", members, restSeconds: rest });
    } else {
      const exercise = chain[0];
      const saved = savedByExercise.get(exercise.name.toLowerCase());
      const item = { type: "exercise", exercise, isExtra: false };
      item.sets = buildExerciseSets_(ctx, exercise, saved ? saved.sets : new Map(), (row) => {
        if (!ctx.saveSet(row)) return;
        if (ctx.onItemChanged) ctx.onItemChanged(item);
      }, rowOptions);
      items.push(item);
    }
    i = last + 1;
  }

  for (const [lower, saved] of savedByExercise) {
    if (assignedKeys.has(lower)) continue;
    const exercise = { name: saved.name, sets: 1, reps: "" };
    const item = { type: "exercise", exercise, isExtra: true };
    item.sets = buildExerciseSets_(ctx, exercise, saved.sets, (row) => {
      if (!ctx.saveSet(row)) return;
      if (ctx.onItemChanged) ctx.onItemChanged(item);
    }, rowOptions);
    items.push(item);
  }
  return items;
}

function buildSavedByExercise_(sets) {
  const map = new Map();
  for (const s of sets) {
    const lower = s.exercise.toLowerCase();
    if (!map.has(lower)) map.set(lower, { name: s.exercise, sets: new Map() });
    map.get(lower).sets.set(s.setNumber, { weight: s.weight, reps: s.reps });
  }
  return map;
}

// ---- "+ Add Exercise" ------------------------------------------------

/** "+ Add Exercise" — collapsed button that expands into a name field + confirm, for whatever the client ends up doing instead of what was planned. Adds straight into ctx.items and re-lays-out the current view (relayoutCurrentView_), so it works the same from any of the three views. */
function buildAddExerciseControl(ctx) {
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
    for (const optName of ctx.exerciseNameOptions || []) {
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
    const existing = ctx.items.find((it) => it.type === "exercise" && it.exercise.name.toLowerCase() === exerciseName.toLowerCase());
    if (existing) {
      existing.sets.addRow(true);
      relayoutCurrentView_(ctx);
      flashStatus(`${existing.exercise.name} is already in this workout — added a set to it.`, false);
    } else {
      const exercise = { name: exerciseName, sets: 1, reps: "" };
      const item = { type: "exercise", exercise, isExtra: true };
      item.sets = buildExerciseSets_(ctx, exercise, new Map(), (row) => {
        if (!ctx.saveSet(row)) return;
        if (ctx.onItemChanged) ctx.onItemChanged(item);
      }, ctx.rowOptions);
      ctx.items.push(item);
      relayoutCurrentView_(ctx);
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

/** Re-lays-out whichever view is currently showing, from ctx.items as they stand right now — used after "+ Add Exercise"/"+ Add set" change what items exist, without rebuilding any row's saved/typed state. */
function relayoutCurrentView_(ctx) {
  if (ctx.currentView === "checklist") {
    if (ctx.checklistOpenIndex == null || ctx.checklistOpenIndex >= ctx.items.length) ctx.checklistOpenIndex = ctx.items.length - 1;
    layoutChecklist_(ctx);
  } else if (ctx.currentView === "simple") {
    const preserveRow = ctx.simpleSteps[ctx.simpleIndex] && ctx.simpleSteps[ctx.simpleIndex].row;
    ctx.simpleSteps = buildSimpleSteps_(ctx.items);
    const newIdx = preserveRow ? ctx.simpleSteps.findIndex((s) => s.row === preserveRow) : -1;
    ctx.simpleIndex = newIdx >= 0 ? newIdx : 0;
    layoutSimple_(ctx);
  } else {
    layoutShowAll_(ctx);
  }
}

function maybeAppendCoachNote_(ctx) {
  if (ctx.coachNote) els.list.appendChild(buildCoachNote(ctx.coachNote));
}

function updateProgress_(ctx) {
  if (!ctx.items) return;
  const total = ctx.items.length;
  const done = ctx.items.filter(itemDone_).length;
  if (ctx.progressTextEl) ctx.progressTextEl.textContent = total ? `${done} of ${total} done` : "";
  if (ctx.progressFillEl) ctx.progressFillEl.style.width = total ? `${(done / total) * 100}%` : "0%";
}

// ---- Show all -----------------------------------------------------------
//
// Every exercise open, one under another — closest to the old single view.
// Column labels (Set/Last time/Kg/Reps) sit once in a sticky bar instead of
// repeating per exercise.

function renderExerciseBody_(ctx, item) {
  const wrap = document.createElement("section");
  wrap.className = "workout__exercise";
  if (item.isExtra) wrap.classList.add("workout__exercise--extra");

  const head = document.createElement("div");
  head.className = "workout__exercise-head";
  const name = document.createElement("h2");
  name.className = "workout__exercise-name";
  name.textContent = item.exercise.name;
  head.appendChild(name);
  const target = document.createElement("span");
  target.className = "workout__exercise-target";
  target.textContent = item.isExtra ? "Extra" : (item.exercise.reps ? `${item.exercise.sets} × ${item.exercise.reps}` : `${item.exercise.sets} ${item.exercise.sets === 1 ? "set" : "sets"}`);
  head.appendChild(target);
  head.appendChild(buildWatchButton_(item.exercise, "small"));
  wrap.appendChild(head);

  const musclesEl = buildExerciseMuscles_(item.exercise);
  if (musclesEl) wrap.appendChild(musclesEl);
  if (item.exercise.note) wrap.appendChild(buildExerciseTip_(item.exercise.note));

  const setsWrap = document.createElement("div");
  setsWrap.className = "workout__sets";
  item.sets.rows.forEach((row) => setsWrap.appendChild(row));
  wrap.appendChild(setsWrap);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "workout__add-set";
  addBtn.textContent = "+ Add set";
  addBtn.addEventListener("click", () => {
    setsWrap.appendChild(item.sets.addRow(true));
    updateProgress_(ctx);
  });
  wrap.appendChild(addBtn);

  return wrap;
}

/**
 * A superset's full round-by-round body — shared by Show all (always shown
 * this way) and Checklist (shown this way only for the one open item). One
 * set of A1, one of A2, rest, Round 2 — only the layout is different from a
 * normal exercise; every set still saves through ctx.saveSet with the same
 * exercise name and set number, so Logged Sets, history, progress and the
 * muscle map see no difference.
 */
function renderSupersetBody_(ctx, item) {
  const section = document.createElement("section");
  section.className = "workout__ss";

  const pill = document.createElement("span");
  pill.className = "workout__ss-pill";
  pill.textContent = `${item.word} ${item.letter}`;
  section.appendChild(pill);

  const rule = document.createElement("p");
  rule.className = "workout__ss-rule";
  rule.textContent = `${item.word}: do these back to back, then rest ${supersetRestText_(item.restSeconds)}`;
  section.appendChild(rule);

  const overview = document.createElement("div");
  overview.className = "workout__ss-overview";
  item.members.forEach((member, i) => {
    const { exercise } = member;
    const line = document.createElement("div");
    line.className = "workout__ss-overview-line";
    const letterBadge = document.createElement("span");
    letterBadge.className = "workout__ss-letter";
    letterBadge.textContent = member.code;
    const name = document.createElement("span");
    name.className = "workout__ss-overview-name";
    name.textContent = exercise.name;
    line.append(letterBadge, name, buildWatchButton_(exercise, "small"));
    const block = document.createElement("div");
    block.className = "workout__ss-overview-row";
    block.appendChild(line);
    const musclesEl = buildExerciseMuscles_(exercise);
    if (musclesEl) block.appendChild(musclesEl);
    if (exercise.note) block.appendChild(buildExerciseTip_(exercise.note));
    overview.appendChild(block);
    if (i < item.members.length - 1) {
      const div = document.createElement("div");
      div.className = "workout__ss-divider";
      overview.appendChild(div);
    }
  });
  section.appendChild(overview);

  const roundsWrap = document.createElement("div");
  roundsWrap.className = "workout__ss-rounds";
  section.appendChild(roundsWrap);

  const doneLine = document.createElement("p");
  doneLine.className = "workout__ss-done";
  doneLine.textContent = `${item.word} ${item.letter} done ✓`;
  section.appendChild(doneLine);

  const adds = document.createElement("div");
  adds.className = "workout__ss-adds";
  item.members.forEach((member) => {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "workout__add-set";
    add.textContent = `+ ${member.code} set`;
    add.setAttribute("aria-label", `Add a set of ${member.exercise.name}`);
    add.addEventListener("click", () => addSet(member));
    adds.appendChild(add);
  });
  section.appendChild(adds);

  const firstUnsaved = (order) => order.find((o) => !o.row._saved) || null;
  let openRound = 0;

  function render() {
    const { rounds, order } = supersetOrder_(item.members);
    const now = firstUnsaved(order);
    roundsWrap.replaceChildren();
    for (let round = 1; round <= rounds; round++) {
      const roundItems = order.filter((o) => o.round === round);
      const finished = roundItems.every((o) => o.row._saved);

      const fold = document.createElement("button");
      fold.type = "button";
      fold.className = "workout__ss-fold";
      fold.classList.toggle("workout__ss-fold--done", finished);
      fold.hidden = round === openRound;
      const foldTitle = document.createElement("span");
      foldTitle.className = "workout__ss-fold-title";
      foldTitle.textContent = `Round ${round}${finished ? " ✓" : ""}`;
      const foldSummary = document.createElement("span");
      foldSummary.className = "workout__ss-fold-summary";
      roundItems.forEach((o) => {
        const line = document.createElement("span");
        const saved = o.row._saved;
        line.textContent = saved
          ? `${o.member.code} ${formatWeight(saved.weight)} kg × ${saved.reps}`
          : `${o.member.code} ${o.extra ? "extra set" : `set ${o.setNumber}`}`;
        foldSummary.appendChild(line);
      });
      fold.append(foldTitle, foldSummary);
      fold.addEventListener("click", () => {
        openRound = round;
        render();
        scrollToSet_(roundsWrap.querySelector(`[data-round="${round}"]`));
      });
      roundsWrap.appendChild(fold);

      const body = document.createElement("div");
      body.className = "workout__ss-round";
      body.dataset.round = String(round);
      body.hidden = round !== openRound;
      const title = document.createElement("h3");
      title.className = "workout__ss-round-title";
      title.textContent = `Round ${round} of ${rounds}`;
      body.appendChild(title);
      roundItems.forEach((o) => {
        const isNow = o === now;
        const itemWrap = document.createElement("div");
        itemWrap.className = "workout__ss-item";
        itemWrap.classList.toggle("workout__ss-item--now", isNow);
        const h = document.createElement("div");
        h.className = "workout__ss-item-head";
        const badge = document.createElement("span");
        badge.className = "workout__ss-letter";
        badge.textContent = o.member.code;
        const nm = document.createElement("h4");
        nm.className = "workout__ss-item-name";
        nm.textContent = `${isNow ? "Now: " : ""}${o.member.exercise.name}`;
        h.append(badge, nm);
        if (o.extra) {
          const tag = document.createElement("span");
          tag.className = "workout__ss-item-tag";
          tag.textContent = "Extra set";
          h.appendChild(tag);
        }
        itemWrap.appendChild(h);
        itemWrap.appendChild(o.row);
        body.appendChild(itemWrap);
      });
      roundsWrap.appendChild(body);
    }
    doneLine.hidden = Boolean(now);
  }

  function restFor(label) {
    startRestTimer({ seconds: item.restSeconds, label });
  }

  function onSave(row) {
    const wasSaved = Boolean(row._saved);
    if (!ctx.saveSet(row, { noRest: true })) return;
    if (wasSaved) {
      render();
      if (ctx.onItemChanged) ctx.onItemChanged(item);
      return;
    }
    const { order } = supersetOrder_(item.members);
    const saved = order.find((o) => o.row === row);
    const nextHere = firstUnsaved(order.filter((o) => o.round === saved.round));
    if (nextHere) {
      if (nextHere.member === saved.member) restFor("Rest, then extra set");
      openRound = saved.round;
      render();
      scrollToSet_(roundsWrap.querySelector(".workout__ss-item--now") || roundsWrap);
      if (ctx.onItemChanged) ctx.onItemChanged(item);
      return;
    }
    const next = firstUnsaved(order);
    if (next) {
      restFor(`Rest, then Round ${next.round}`);
      openRound = next.round;
      render();
      scrollToSet_(roundsWrap.querySelector(`[data-round="${next.round}"]`));
      if (ctx.onItemChanged) ctx.onItemChanged(item);
      return;
    }
    openRound = 0;
    render();
    if (ctx.onItemChanged) ctx.onItemChanged(item);
  }

  function addSet(member) {
    member.sets.addRow(true);
    const { order } = supersetOrder_(item.members);
    const now = firstUnsaved(order);
    if (now) openRound = now.round;
    render();
    scrollToSet_(roundsWrap.querySelector(".workout__ss-item--now"));
    updateProgress_(ctx);
  }

  item.members.forEach((member) => member.sets.rows.forEach((row) => { row._onSave = onSave; }));

  const startAt = firstUnsaved(supersetOrder_(item.members).order);
  openRound = startAt ? startAt.round : 0;
  render();

  return section;
}

/** The set order for a superset: one set of each exercise per round; uneven counts finish their extra sets at the end of the last round. */
function supersetOrder_(members) {
  const rounds = Math.min(...members.map((m) => m.sets.rows.length));
  const most = Math.max(...members.map((m) => m.sets.rows.length));
  const order = [];
  for (let setNumber = 1; setNumber <= most; setNumber++) {
    members.forEach((member) => {
      const row = member.sets.rows[setNumber - 1];
      if (row) order.push({ member, row, setNumber, round: Math.min(setNumber, rounds), extra: setNumber > rounds });
    });
  }
  return { rounds, order };
}

function supersetRestText_(seconds) {
  return seconds >= 120 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
}

function layoutShowAll_(ctx) {
  els.list.className = "workout__list view--showall";
  els.list.innerHTML = "";
  maybeAppendCoachNote_(ctx);

  const labels = document.createElement("div");
  labels.className = "workout__showall-labels";
  labels.innerHTML = "<span>Set</span><span>Last time</span><span>Kg</span><span>Reps</span><span></span>";
  els.list.appendChild(labels);

  ctx.items.forEach((item) => {
    els.list.appendChild(item.type === "exercise" ? renderExerciseBody_(ctx, item) : renderSupersetBody_(ctx, item));
  });

  ctx.addExerciseWrap = buildAddExerciseControl(ctx);
  els.list.appendChild(ctx.addExerciseWrap);
  els.list.appendChild(buildFinishBar_(ctx));
  updateProgress_(ctx);
}

// ---- Checklist ------------------------------------------------------------
//
// One exercise open at a time; everything else collapses to a single row.
// Finishing the open item's last set collapses it and opens the next
// unfinished one automatically.

function checklistSummary_(item) {
  const total = itemTotalCount_(item);
  const savedN = itemSavedCount_(item);
  if (item.type === "exercise") {
    const lastRow = item.sets.rows.find((r) => r._last);
    const lastText = lastRow ? ` · last ${formatWeight(lastRow._last.weight)}kg${Number.isFinite(lastRow._last.reps) ? ` × ${lastRow._last.reps}` : ""}` : "";
    return `${savedN}/${total} set${total === 1 ? "" : "s"}${lastText}`;
  }
  return `${item.word} · ${savedN}/${total} sets`;
}

function renderSupersetCollapsed_(ctx, item, idx) {
  const box = document.createElement("div");
  box.className = "workout__ss";
  box.dataset.itemIndex = String(idx);
  box.style.cursor = "pointer";
  box.classList.toggle("workout__cl-row--done", itemDone_(item));

  const pill = document.createElement("span");
  pill.className = "workout__ss-pill";
  pill.textContent = `${item.word} ${item.letter}`;
  box.appendChild(pill);

  const rule = document.createElement("p");
  rule.className = "workout__ss-rule";
  rule.textContent = `${item.word}: do these back to back, then rest ${supersetRestText_(item.restSeconds)}`;
  box.appendChild(rule);

  const members = document.createElement("div");
  members.className = "workout__cl-ss-members";
  item.members.forEach((m) => {
    const row = document.createElement("div");
    row.className = "workout__cl-ss-member";
    const letter = document.createElement("span");
    letter.className = "workout__ss-letter";
    letter.textContent = m.code;
    const nm = document.createElement("span");
    nm.className = "workout__ss-member-name";
    nm.textContent = m.exercise.name;
    row.append(letter, nm);
    members.appendChild(row);
  });
  box.appendChild(members);

  box.addEventListener("click", () => {
    ctx.checklistOpenIndex = idx;
    layoutChecklist_(ctx);
    requestAnimationFrame(() => scrollToSet_(els.list.querySelector(`[data-item-index="${idx}"]`)));
  });
  return box;
}

function checklistOnItemChanged_(ctx, item) {
  if (!itemDone_(item)) return; // still mid-item (e.g. a superset round in progress) — its own body re-renders itself
  const idx = ctx.items.indexOf(item);
  if (idx !== ctx.checklistOpenIndex) return;
  const next = ctx.items.findIndex((it, i) => i > idx && !itemDone_(it));
  ctx.checklistOpenIndex = next >= 0 ? next : idx;
  layoutChecklist_(ctx);
  requestAnimationFrame(() => scrollToSet_(els.list.querySelector(`[data-item-index="${ctx.checklistOpenIndex}"]`)));
}

function layoutChecklist_(ctx) {
  ctx.onItemChanged = (item) => checklistOnItemChanged_(ctx, item);
  els.list.className = "workout__list view--checklist";
  els.list.innerHTML = "";
  maybeAppendCoachNote_(ctx);

  if (ctx.checklistOpenIndex == null || ctx.checklistOpenIndex < 0) {
    const firstUnfinished = ctx.items.findIndex((it) => !itemDone_(it));
    ctx.checklistOpenIndex = firstUnfinished >= 0 ? firstUnfinished : Math.max(0, ctx.items.length - 1);
  }

  ctx.items.forEach((item, idx) => {
    if (idx === ctx.checklistOpenIndex) {
      const open = document.createElement("div");
      open.className = "workout__cl-open";
      open.dataset.itemIndex = String(idx);
      open.appendChild(item.type === "exercise" ? renderExerciseBody_(ctx, item) : renderSupersetBody_(ctx, item));
      els.list.appendChild(open);
    } else if (item.type === "superset") {
      els.list.appendChild(renderSupersetCollapsed_(ctx, item, idx));
    } else {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "workout__cl-row";
      row.dataset.itemIndex = String(idx);
      const done = itemDone_(item);
      row.classList.toggle("workout__cl-row--done", done);
      const badge = document.createElement("span");
      badge.className = "workout__cl-badge";
      badge.innerHTML = done ? TICK_SVG : String(idx + 1);
      const text = document.createElement("span");
      text.className = "workout__cl-text";
      const nameEl = document.createElement("span");
      nameEl.className = "workout__cl-name";
      nameEl.textContent = itemName_(item);
      const sub = document.createElement("span");
      sub.className = "workout__cl-sub";
      sub.textContent = checklistSummary_(item);
      text.append(nameEl, sub);
      row.append(badge, text);
      row.addEventListener("click", () => {
        ctx.checklistOpenIndex = idx;
        layoutChecklist_(ctx);
        requestAnimationFrame(() => scrollToSet_(els.list.querySelector(`[data-item-index="${idx}"]`)));
      });
      els.list.appendChild(row);
    }
  });

  ctx.addExerciseWrap = buildAddExerciseControl(ctx);
  els.list.appendChild(ctx.addExerciseWrap);
  els.list.appendChild(buildFinishBar_(ctx));
  updateProgress_(ctx);
}

// ---- Simple view ----------------------------------------------------------
//
// One exercise, one set, one screen. The whole workout is flattened into a
// single ordered sequence of steps (supersetOrder_ already gives the right
// A1 → A2 → rest → round-2 order for a group); DONE saves the current step
// and moves to the next one, Previous/Skip just move without saving.

function buildSimpleSteps_(items) {
  const steps = [];
  items.forEach((item, itemIndex) => {
    if (item.type === "exercise") {
      item.sets.rows.forEach((row, idx) => {
        steps.push({ item, itemIndex, kind: "exercise", row, setNumber: idx + 1, totalSets: item.sets.rows.length });
      });
    } else {
      const { rounds, order } = supersetOrder_(item.members);
      order.forEach((o) => {
        steps.push({ item, itemIndex, kind: "superset", row: o.row, member: o.member, setNumber: o.setNumber, round: o.round, rounds, extra: o.extra });
      });
    }
  });
  return steps;
}

function describeNextStep_(steps, currentIdx) {
  const cur = steps[currentIdx];
  const next = steps[currentIdx + 1];
  if (!cur) return "";
  if (!next) return "You're done — tap Finish Workout below";
  if (cur.kind === "exercise") {
    if (next.itemIndex === cur.itemIndex) return `Next: Set ${next.setNumber}`;
    return `Next: ${next.kind === "superset" ? next.member.exercise.name : next.item.exercise.name}, no rest`;
  }
  // superset
  if (next.itemIndex === cur.itemIndex) {
    if (next.round === cur.round) {
      if (next.member === cur.member) return "Next: Rest, then extra set";
      return `Next: ${next.member.exercise.name}, no rest`;
    }
    return `Next: Rest ${supersetRestText_(cur.item.restSeconds)}, then Round ${next.round}`;
  }
  return `Next: ${next.kind === "superset" ? next.member.exercise.name : next.item.exercise.name}, no rest`;
}

function onSimpleDone_(ctx) {
  const steps = ctx.simpleSteps;
  const idx = ctx.simpleIndex;
  const cur = steps[idx];
  if (!cur) return;
  const next = steps[idx + 1];
  let restSeconds = null;
  let restLabel = null;
  if (cur.kind === "superset" && next && next.itemIndex === cur.itemIndex) {
    if (next.round !== cur.round) {
      restSeconds = cur.item.restSeconds;
      restLabel = `Rest, then Round ${next.round}`;
    } else if (next.member === cur.member) {
      restSeconds = cur.item.restSeconds;
      restLabel = "Rest, then extra set";
    }
  }
  if (!ctx.saveSet(cur.row, { noRest: true })) return;
  if (restSeconds !== null) startRestTimer({ seconds: restSeconds, label: restLabel });
  ctx.simpleIndex = Math.min(idx + 1, steps.length);
  layoutSimple_(ctx);
}

function onSimplePrev_(ctx) {
  ctx.simpleIndex = Math.max(0, ctx.simpleIndex - 1);
  layoutSimple_(ctx);
}

function onSimpleSkip_(ctx) {
  ctx.simpleIndex = Math.min(ctx.simpleSteps.length, ctx.simpleIndex + 1);
  layoutSimple_(ctx);
}

function layoutSimple_(ctx) {
  ctx.onItemChanged = undefined;
  els.list.className = "workout__list view--simple";
  els.list.innerHTML = "";
  maybeAppendCoachNote_(ctx);

  const steps = ctx.simpleSteps;
  const container = document.createElement("div");

  const progress = document.createElement("div");
  progress.className = "workout__simple-progress";
  const curItemIdx = steps[ctx.simpleIndex] ? steps[ctx.simpleIndex].itemIndex : ctx.items.length;
  ctx.items.forEach((item, i) => {
    const seg = document.createElement("span");
    seg.className = "workout__simple-seg";
    if (i < curItemIdx) seg.classList.add("workout__simple-seg--done");
    else if (i === curItemIdx) seg.classList.add("workout__simple-seg--now");
    progress.appendChild(seg);
  });
  container.appendChild(progress);

  const meta = document.createElement("p");
  meta.className = "workout__simple-meta";
  const elapsedText = ctx.isToday && !coachMode ? ` · ${formatElapsed(workoutTimerStart ? Date.now() - workoutTimerStart : (ctx.finalElapsed || 0))}` : "";
  meta.textContent = `Exercise ${Math.min(curItemIdx + 1, ctx.items.length)} of ${ctx.items.length}${elapsedText}`;
  container.appendChild(meta);

  const step = steps[ctx.simpleIndex];
  if (!step) {
    const complete = document.createElement("div");
    complete.className = "workout__simple-complete";
    complete.innerHTML = `${CHECK_CIRCLE_SVG}<p>All sets done</p>`;
    container.appendChild(complete);
  } else {
    if (step.kind === "superset") {
      const pill = document.createElement("span");
      pill.className = "workout__simple-ss-pill";
      pill.textContent = `${step.item.word} ${step.item.letter} · Round ${step.round} of ${step.rounds}`;
      container.appendChild(pill);
    }

    const exercise = step.kind === "superset" ? step.member.exercise : step.item.exercise;
    const card = document.createElement("div");
    card.className = "workout__simple-card";

    const exName = document.createElement("h2");
    exName.className = "workout__simple-exname";
    exName.textContent = exercise.name;
    card.appendChild(exName);

    const last = document.createElement("p");
    last.className = "workout__simple-last";
    last.textContent = step.row._last ? `Last time: ${formatWeight(step.row._last.weight)} kg${Number.isFinite(step.row._last.reps) ? ` × ${step.row._last.reps}` : ""}` : "No history yet";
    card.appendChild(last);

    const watchRow = document.createElement("div");
    watchRow.className = "workout__simple-watch-row";
    watchRow.appendChild(buildWatchButton_(exercise, "large"));
    card.appendChild(watchRow);

    if (exercise.note) {
      const tip = buildExerciseTip_(exercise.note);
      tip.classList.add("workout__simple-tip");
      card.appendChild(tip);
    }

    const setLabel = document.createElement("p");
    setLabel.className = "workout__simple-setlabel";
    const totalForThis = step.kind === "superset" ? step.member.sets.rows.length : step.totalSets;
    setLabel.textContent = `Set ${step.setNumber} of ${totalForThis}`;
    card.appendChild(setLabel);

    card.appendChild(step.row);

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "workout__simple-done-btn";
    const doneLabel = document.createElement("span");
    doneLabel.textContent = "DONE";
    const doneNext = document.createElement("span");
    doneNext.className = "workout__simple-done-next";
    doneNext.textContent = describeNextStep_(steps, ctx.simpleIndex);
    doneBtn.append(doneLabel, doneNext);
    doneBtn.addEventListener("click", () => onSimpleDone_(ctx));
    card.appendChild(doneBtn);

    const nav = document.createElement("div");
    nav.className = "workout__simple-nav";
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "workout__simple-nav-btn";
    prevBtn.textContent = "Previous";
    prevBtn.disabled = ctx.simpleIndex === 0;
    prevBtn.addEventListener("click", () => onSimplePrev_(ctx));
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "workout__simple-nav-btn";
    skipBtn.textContent = "Skip";
    skipBtn.addEventListener("click", () => onSimpleSkip_(ctx));
    nav.append(prevBtn, skipBtn);
    card.appendChild(nav);

    container.appendChild(card);
  }

  els.list.appendChild(container);
  ctx.addExerciseWrap = buildAddExerciseControl(ctx);
  els.list.appendChild(ctx.addExerciseWrap);
  els.list.appendChild(buildFinishBar_(ctx));
  updateProgress_(ctx);
}

// ---- Finish / Review -------------------------------------------------

function buildFinishBar_(ctx) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "workout__finish-btn";
  btn.textContent = "Finish Workout";
  btn.addEventListener("click", () => onFinishTapped_(ctx));
  return btn;
}

function onFinishTapped_(ctx) {
  let unfinished = 0;
  allRows_(ctx).forEach((row) => {
    const values = rowValues(row);
    if (values.valid && (row._saved || row._touched)) {
      row._saved = { weight: values.weight, reps: values.reps };
      refreshRowState(row);
    } else if (!row._saved && row._touched) {
      unfinished++;
    }
  });
  ctx.persist();
  if (!ctx.collectSets().length) {
    flashStatus("Tap the tick on the sets you've done first, then Finish Workout.", true);
    return;
  }
  showReview_(ctx, unfinished);
}

function computePersonalBests_(ctx, sets) {
  const { setRows, setCol, clientSlug } = ctx;
  if (setCol.weight < 0 || setCol.exercise < 0 || setCol.client < 0) return [];
  const byExercise = new Map();
  sets.forEach((s) => {
    const key = s.exercise.toLowerCase();
    const cur = byExercise.get(key);
    if (!cur || s.weight > cur.weight || (s.weight === cur.weight && s.reps > cur.reps)) {
      byExercise.set(key, { name: s.exercise, weight: s.weight, reps: s.reps });
    }
  });
  const lines = [];
  for (const [key, today] of byExercise) {
    const prevBest = allTimeBestSet_(setRows, setCol, clientSlug, key);
    const isPb = !prevBest
      || today.weight > prevBest.weight
      || (today.weight === prevBest.weight && (!Number.isFinite(prevBest.reps) || today.reps > prevBest.reps));
    if (isPb) lines.push(`${today.name} — ${formatWeight(today.weight)}kg × ${today.reps}`);
  }
  return lines;
}

function renderMuscleReview_(figsEl, listEl, sets) {
  const weighted = {};
  const totalCount = {};
  const unmatchedNames = new Set();
  sets.forEach((s) => {
    const exName = String(s.exercise || "").trim();
    const resolved = resolveExerciseMuscles_(exName, exerciseIndex_);
    if (!resolved.primary.length && !resolved.secondary.length) {
      if (exName) unmatchedNames.add(exName);
      return;
    }
    const perSet = effectiveSetsPerSet_(resolved);
    Object.keys(perSet).forEach((k) => { weighted[k] = (weighted[k] || 0) + perSet[k]; });
    new Set([...resolved.primary, ...resolved.secondary]).forEach((k) => { totalCount[k] = (totalCount[k] || 0) + 1; });
  });

  const frontSvg = muscleFigureSvg("front", "reviewMuscleFrontTitle");
  const backSvg = muscleFigureSvg("back", "reviewMuscleBackTitle");
  figsEl.className = "workout__review-figs";
  figsEl.innerHTML =
    `<div class="workout__review-fig-col">${frontSvg}<span class="workout__review-fig-caption">Front</span></div>` +
    `<div class="workout__review-fig-col">${backSvg}<span class="workout__review-fig-caption">Back</span></div>`;
  figsEl.querySelectorAll("svg.muscle-figure").forEach((svg) => paintMuscleHeat(svg, weighted));

  const entries = Object.keys(totalCount).sort((a, b) => totalCount[b] - totalCount[a]);
  const scale = Math.max(1, ...entries.map((k) => totalCount[k]));
  const rowsHtml = entries.length
    ? entries.map((k) => `<div class="workout__review-muscle-row"><span class="workout__review-muscle-name">${muscleLabel_(k)}</span><span class="workout__review-muscle-track"><span class="workout__review-muscle-fill" style="width:${(totalCount[k] / scale) * 100}%"></span></span><span class="workout__review-muscle-count">${totalCount[k]} set${totalCount[k] === 1 ? "" : "s"}</span></div>`).join("")
    : '<p class="workout__review-empty">No muscle data for today’s sets.</p>';
  const unmatchedHtml = unmatchedNames.size
    ? `<p class="workout__review-empty">Not counted — no muscle data for: ${Array.from(unmatchedNames).map(libEscApp_).join(", ")}</p>`
    : "";
  listEl.innerHTML = rowsHtml + unmatchedHtml;
}

function showReview_(ctx, unfinished) {
  stopRestTimer();
  if (ctx.isToday && !coachMode && ctx.finalElapsed === undefined) ctx.finalElapsed = stopWorkoutTimer();
  const sets = ctx.collectSets();
  const totalKg = sets.reduce((sum, s) => sum + s.weight * s.reps, 0);

  const wrap = document.createElement("div");
  wrap.className = "workout__review-inner";

  const head = document.createElement("div");
  head.className = "workout__review-head";
  const tickWrap = document.createElement("span");
  tickWrap.className = "workout__review-tick";
  tickWrap.innerHTML = CHECK_CIRCLE_SVG;
  const title = document.createElement("h2");
  title.className = "workout__review-title";
  title.textContent = "Workout Done";
  const sub = document.createElement("p");
  sub.className = "workout__review-sub";
  const firstName = (coachClientName || memberId || "").split(/\s+/)[0] || "there";
  sub.textContent = `Nice work, ${firstName}. ${ctx.workoutName} is ready to save.`;
  head.append(tickWrap, title, sub);
  wrap.appendChild(head);

  const tiles = document.createElement("div");
  tiles.className = "workout__review-tiles";
  const tileData = [
    ["TIME", ctx.isToday && !coachMode ? formatElapsed(ctx.finalElapsed || 0) : "—"],
    ["SETS", String(sets.length)],
    ["KG LIFTED", String(Math.round(totalKg))],
  ];
  tiles.innerHTML = tileData.map(([label, value]) => `<div class="workout__review-tile"><span class="workout__review-tile-label">${label}</span><span class="workout__review-tile-value">${value}</span></div>`).join("");
  wrap.appendChild(tiles);

  const pbCard = document.createElement("div");
  pbCard.className = "workout__review-pb";
  const pbLines = computePersonalBests_(ctx, sets);
  pbCard.hidden = pbLines.length === 0;
  pbCard.innerHTML = `<span class="workout__review-pb-title">${TROPHY_SVG}New Personal Best</span>` + pbLines.map((l) => `<p class="workout__review-pb-line">${libEscApp_(l)}</p>`).join("");
  wrap.appendChild(pbCard);

  const muscleSection = document.createElement("div");
  muscleSection.className = "workout__review-section";
  const muscleLabel = document.createElement("span");
  muscleLabel.className = "workout__review-section-label";
  muscleLabel.textContent = "Muscles Worked";
  const figs = document.createElement("div");
  const list = document.createElement("div");
  renderMuscleReview_(figs, list, sets);
  muscleSection.append(muscleLabel, figs, list);
  wrap.appendChild(muscleSection);

  const notesWrap = document.createElement("div");
  notesWrap.className = "workout__review-section";
  const notesLabel = document.createElement("span");
  notesLabel.className = "workout__review-section-label";
  notesLabel.textContent = "How did it feel? (optional)";
  const notesInput = document.createElement("textarea");
  notesInput.className = "workout__review-notes-input";
  notesInput.rows = 2;
  notesInput.placeholder = "e.g. slept bad, shoulder hurts, etc.";
  const existingDraft = readDraft(ctx.draftKey);
  notesInput.value = (existingDraft && existingDraft.notes) || "";
  ctx.notesInput = notesInput;
  notesWrap.append(notesLabel, notesInput);
  wrap.appendChild(notesWrap);

  const warning = document.createElement("p");
  warning.className = "workout__review-warning";
  warning.hidden = !ctx.alreadyLoggedCount;
  if (ctx.alreadyLoggedCount) {
    const when = ctx.isToday ? "today" : friendlyDate(ctx.dateStr);
    warning.textContent = `${ctx.workoutName} is already logged for ${when} (${ctx.alreadyLoggedCount} set${ctx.alreadyLoggedCount === 1 ? "" : "s"}). Saving will replace it.`;
  }
  wrap.appendChild(warning);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "workout__review-save";
  saveBtn.textContent = "Save & Close";
  wrap.appendChild(saveBtn);

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "workout__review-back";
  backBtn.textContent = "Back to workout";
  backBtn.addEventListener("click", () => {
    els.review.hidden = true;
    els.list.hidden = false;
    if (ctx.isToday && !coachMode && ctx.finalElapsed !== undefined) {
      startWorkoutTimer(ctx.timerValueEl, ctx.finalElapsed);
      ctx.finalElapsed = undefined;
    }
  });
  wrap.appendChild(backBtn);

  saveBtn.addEventListener("click", () => doSaveAndClose_(ctx, saveBtn, warning, unfinished));

  els.review.innerHTML = "";
  els.review.appendChild(wrap);
  els.list.hidden = true;
  els.review.hidden = false;
  els.review.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function doSaveAndClose_(ctx, btn, warning, unfinished) {
  const previous = readDraft(ctx.draftKey);
  const draft = ctx.persist();
  if (!draft || !draft.sets.length) {
    flashStatus("Tap the tick on the sets you've done first, then Finish Workout.", true);
    return;
  }
  els.status.hidden = true;
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    // Nothing has changed since the last successful save — no need to send it again.
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
      const who = coachClientName || "them";
      els.doneText.textContent = `Logged for ${who}${ctx.isToday ? "" : ` (${friendlyDate(ctx.dateStr)})`}. Scan the next member's QR code, or tap back to check-in.${unfinishedNote}`;
    } else if (ctx.isToday) {
      els.doneText.textContent = `Nice work — logged in ${formatElapsed(ctx.finalElapsed || 0)}. Head back to your card.${unfinishedNote}`;
      try {
        localStorage.setItem(WORKOUT_COMPLETE_STORAGE_KEY, todayString());
      } catch (err) {
        // Storage unavailable — the card just won't auto-show as completed.
      }
    } else {
      els.doneText.textContent = `Logged for ${friendlyDate(ctx.dateStr)}. Head back to your card.${unfinishedNote}`;
    }
    els.review.hidden = true;
    els.list.hidden = true;
    els.done.hidden = false;
    els.done.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    if (!ctx.dead) showStatus("Couldn't reach the server — your sets are saved on this phone. Tap Save & Close again when you have signal.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save & Close";
  }
}

// ---- View switching + the view picker sheet ---------------------------

function viewPrefKey_() {
  return `maxfitWorkoutView|${memberId}`;
}
function readViewPref_() {
  if (!storageUsable) return "checklist";
  try {
    const v = localStorage.getItem(viewPrefKey_());
    return v === "checklist" || v === "showall" || v === "simple" ? v : "checklist";
  } catch (err) {
    return "checklist";
  }
}
function writeViewPref_(view) {
  if (!storageUsable) return;
  try {
    localStorage.setItem(viewPrefKey_(), view);
  } catch (err) {
    // Not remembered this time — no big deal, it'll default to Checklist next open.
  }
}

function variantForView_(view) {
  return view === "simple" ? "simple" : "compact";
}

function renderCurrentView(ctx, snapshot) {
  const rowOptions = { variant: variantForView_(ctx.currentView), hideSaveButton: ctx.currentView === "simple" };
  ctx.rowOptions = rowOptions;
  ctx.activeSnapshot = snapshot || null;
  ctx.items = buildItems_(ctx, ctx.exercises, ctx.savedByExercise, rowOptions);
  ctx.activeSnapshot = null;

  if (ctx.currentView === "checklist") {
    ctx.checklistOpenIndex = null; // let layoutChecklist_ pick the first unfinished item
    layoutChecklist_(ctx);
  } else if (ctx.currentView === "simple") {
    ctx.simpleSteps = buildSimpleSteps_(ctx.items);
    const firstUnsavedIdx = ctx.simpleSteps.findIndex((s) => !s.row._saved);
    ctx.simpleIndex = firstUnsavedIdx >= 0 ? firstUnsavedIdx : ctx.simpleSteps.length;
    layoutSimple_(ctx);
  } else {
    layoutShowAll_(ctx);
  }
}

function switchView_(ctx, shared, newView) {
  if (newView === ctx.currentView) return;
  const snapshot = snapshotRows_(ctx);
  ctx.savedByExercise = buildSavedByExercise_(ctx.collectSets());
  ctx.currentView = newView;
  shared.currentView = newView;
  writeViewPref_(newView);
  renderCurrentView(ctx, snapshot);
}

const VIEW_OPTIONS = [
  { id: "checklist", title: "Checklist", sub: "One exercise open at a time. Ticks off as you go.", diagram: CL_DIAGRAM_SVG },
  { id: "showall", title: "Show all", sub: "Every exercise open. Scroll through the whole session.", diagram: SA_DIAGRAM_SVG },
  { id: "simple", title: "Simple view", sub: "One exercise per screen, big buttons. Nothing else.", diagram: SV_DIAGRAM_SVG },
];

let viewSheetEl = null;
let viewSheetCtx_ = null;
let viewSheetShared_ = null;

function openViewSheet_(ctx, shared) {
  viewSheetCtx_ = ctx;
  viewSheetShared_ = shared;
  if (!viewSheetEl) {
    viewSheetEl = document.createElement("div");
    viewSheetEl.className = "workout__sheet";
    viewSheetEl.hidden = true;
    viewSheetEl.innerHTML = `
      <div class="workout__sheet-backdrop" data-close></div>
      <div class="workout__sheet-panel" role="dialog" aria-modal="true" aria-label="Choose a view">
        <div class="workout__sheet-grip"></div>
        <h2 class="workout__sheet-title">How do you want to see your workout?</h2>
        <div class="workout__view-options">
          ${VIEW_OPTIONS.map((o) => `
            <button type="button" class="workout__view-option" data-view="${o.id}" aria-pressed="false">
              <span class="workout__view-option-diagram">${o.diagram}</span>
              <span class="workout__view-option-text">
                <span class="workout__view-option-title">${o.title}</span>
                <span class="workout__view-option-sub">${o.sub}</span>
              </span>
              <span class="workout__view-option-tick">${TICK_SVG}</span>
            </button>`).join("")}
        </div>
        <p class="workout__sheet-note">You can switch any time. We'll remember your choice.</p>
        <button type="button" class="workout__sheet-done" data-close>Done</button>
      </div>`;
    document.body.appendChild(viewSheetEl);
    viewSheetEl.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) {
        viewSheetEl.hidden = true;
        return;
      }
      const optBtn = e.target.closest(".workout__view-option");
      if (optBtn && viewSheetCtx_) {
        switchView_(viewSheetCtx_, viewSheetShared_, optBtn.dataset.view);
        viewSheetEl.querySelectorAll(".workout__view-option").forEach((b) => b.setAttribute("aria-pressed", String(b === optBtn)));
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && viewSheetEl && !viewSheetEl.hidden) viewSheetEl.hidden = true;
    });
  }
  viewSheetEl.querySelectorAll(".workout__view-option").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === ctx.currentView)));
  viewSheetEl.hidden = false;
}

// ---- Shared header: name, VIEW button, date + timer pills, progress ----

function buildWorkoutHead_(ctx, shared, workoutName) {
  const wrap = document.createElement("div");
  wrap.className = "workout__head";

  const top = document.createElement("div");
  top.className = "workout__head-top";
  const name = document.createElement("h1");
  name.className = "workout__name";
  name.textContent = workoutName || (ctx.isToday ? "Today's Workout" : "Workout");
  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.className = "workout__view-btn";
  viewBtn.innerHTML = `${VIEW_ICON_SVG}<span>View</span>`;
  viewBtn.addEventListener("click", () => openViewSheet_(ctx, shared));
  top.append(name, viewBtn);
  wrap.appendChild(top);

  const pills = document.createElement("div");
  pills.className = "workout__pills";

  const datePill = document.createElement("label");
  datePill.className = "workout__pill workout__pill--date";
  const dateIcon = document.createElement("span");
  dateIcon.innerHTML = CALENDAR_ICON_SVG;
  const dateText = document.createElement("span");
  dateText.className = "workout__pill-text";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.id = "workoutDateInput";
  const today = sydneyDateStr();
  dateInput.max = today;
  dateInput.min = shiftDate(today, -MAX_BACKLOG_DAYS);
  dateInput.addEventListener("change", () => changeDate(shared, dateInput.value));
  datePill.append(dateIcon, dateText, dateInput);
  pills.appendChild(datePill);

  const timerPill = document.createElement("span");
  timerPill.className = "workout__pill workout__pill--timer";
  timerPill.hidden = coachMode || !ctx.isToday;
  timerPill.innerHTML = `${CLOCK_ICON_SVG}<span class="workout__pill-text">0:00</span>`;
  pills.appendChild(timerPill);
  wrap.appendChild(pills);

  const changedNote = document.createElement("p");
  changedNote.className = "workout__date-changed-note";
  const changedText = document.createElement("span");
  changedNote.appendChild(changedText);
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "workout__date-reset";
  resetBtn.textContent = "Back to today";
  resetBtn.addEventListener("click", () => changeDate(shared, sydneyDateStr()));
  changedNote.appendChild(resetBtn);
  wrap.appendChild(changedNote);

  const progress = document.createElement("div");
  progress.className = "workout__progress";
  const progressText = document.createElement("p");
  progressText.className = "workout__progress-text";
  const progressBar = document.createElement("div");
  progressBar.className = "workout__progress-bar";
  const progressFill = document.createElement("div");
  progressFill.className = "workout__progress-fill";
  progressBar.appendChild(progressFill);
  progress.append(progressText, progressBar);
  wrap.appendChild(progress);

  ctx.timerValueEl = timerPill.querySelector(".workout__pill-text");
  ctx.progressTextEl = progressText;
  ctx.progressFillEl = progressFill;

  shared.syncDate = () => {
    const isToday = shared.date === sydneyDateStr();
    dateInput.value = shared.date;
    dateText.textContent = isToday ? "Today ▾" : `${friendlyDate(shared.date)} ▾`;
    datePill.classList.toggle("workout__pill--changed", !isToday);
    changedNote.hidden = isToday;
    changedText.textContent = isToday ? "" : `Logging for ${friendlyDate(shared.date)} — this won't count as today's workout.`;
  };
  shared.syncDate();

  return wrap;
}

/** Any typed-in-but-unsaved set, mounted or not (those would be lost when the workout reloads for the new day). */
function hasUnsavedEntries(ctx) {
  return allRows_(ctx).some((row) => row._touched && !row.classList.contains("workout__set--saved"));
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
    if (hasUnsavedEntries(shared.currentCtx) && !window.confirm("Changing the date reloads this workout. Sets you've typed but not saved will be cleared. Continue?")) {
      shared.syncDate(); // stay put
      return;
    }
    if (shared.currentCtx) shared.currentCtx.persist();
  }

  shared.date = next;
  shared.syncDate();
  if (shared.current) renderWorkout(shared, shared.current.workoutName, shared.current.exercises);
}

// ---- Top-level render ---------------------------------------------------

// Built once during the initial load (card/muscle-map.js's
// buildExerciseIndex_, from the Exercises tab) so exercise bodies can show
// which muscles an exercise works — and the review screen can resolve a
// saved set's exercise name to its muscles — without an extra fetch.
let exerciseIndex_ = { byExact: {}, byNormalized: {} };

function renderWorkout(shared, workoutName, exercises) {
  const { clientSlug, setRows, setCol, startingWeights, exerciseNameOptions } = shared;
  const dateStr = shared.date;
  const isToday = dateStr === sydneyDateStr();
  if (shared.currentCtx) shared.currentCtx.dead = true; // whatever was on screen before is finished with
  shared.current = { workoutName, exercises };

  els.status.hidden = true;
  els.list.innerHTML = "";
  els.list.hidden = false;
  els.review.hidden = true;
  els.done.hidden = true;
  els.pageTag.textContent = coachMode ? "Coach" : "Workout";

  const key = draftKey(clientSlug, workoutName, dateStr);

  // The only sets ever put back on screen are ones THIS client tapped the
  // tick on, on this phone, today, in this exact workout (the draft's key is
  // client + workout + day). Nothing is read back out of the sheet for
  // display — logged history only shows up as "last time" numbers, and in
  // the calendar.
  const draft = readDraft(key);
  const restored = draft
    ? { sets: draft.sets || [], notes: draft.notes || "" }
    : { sets: [], notes: "" };

  const ctx = {
    clientSlug, workoutName, setRows, setCol, startingWeights,
    exerciseNameOptions,
    exercises,
    currentView: shared.currentView,
    draftKey: key,
    dateStr,
    isToday,
    beforeKey: dateSortKey(dateStr),
    coachNote: shared.workoutNotes ? shared.workoutNotes[workoutName] : "",
    // Warn (never display mid-workout) if finishing this would replace a session already in the sheet.
    alreadyLoggedCount: draft ? 0 : existingLogCount(setRows, setCol, clientSlug, workoutName, dateStr),
    dead: false,
    finalElapsed: undefined,
  };
  shared.currentCtx = ctx;

  /** Every set they've tapped the tick on, in on-screen order — using the numbers as last saved, not whatever's typed in the box right now. */
  ctx.collectSets = () => {
    // Grouped by exercise, so a superset's rounds give the same order as any other exercise.
    // Reads every row that exists (allRows_), not just whichever ones the
    // current view happens to have mounted — Checklist only mounts the one
    // open item's rows, so a DOM-only scan would drop anything saved in a
    // collapsed item.
    const byExercise = new Map();
    allRows_(ctx).forEach((row) => {
      if (!row._saved) return;
      if (!byExercise.has(row.dataset.exercise)) byExercise.set(row.dataset.exercise, []);
      byExercise.get(row.dataset.exercise).push({ exercise: row.dataset.exercise, setNumber: Number(row.dataset.setNumber), weight: row._saved.weight, reps: row._saved.reps });
    });
    return Array.from(byExercise.values()).flat();
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
    const notes = ctx.notesInput ? ctx.notesInput.value.trim() : (readDraft(key) ? readDraft(key).notes : "");
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

  /** Returns whether it saved. A superset / Simple view pass noRest and run their own rest logic. */
  ctx.saveSet = (row, options) => {
    const values = rowValues(row);
    if (!values.valid) {
      const needsWeight = !Number.isFinite(values.weight) || values.weight < 0;
      flashStatus(needsWeight ? "Add the weight first (0 for bodyweight)." : "Add the reps first.", true);
      return false;
    }
    row._saved = { weight: values.weight, reps: values.reps };
    // A blank box that saved via its grey suggestion now shows that
    // confirmed number as a real value, not an empty placeholder.
    const weightInput = row.querySelector(".workout__weight-input");
    const repsInput = row.querySelector(".workout__reps-input");
    if (weightInput.value.trim() === "") weightInput.value = formatWeight(values.weight);
    if (repsInput.value.trim() === "") repsInput.value = String(values.reps);
    refreshRowState(row);
    const before = readDraft(key);
    const after = ctx.persist();
    if (!before || !after || after.rev !== before.rev) els.done.hidden = true; // changed since it was logged — needs logging again
    updateProgress_(ctx);
    if (!(options && options.noRest)) startRestTimer();
    return true;
  };

  // The sets they'd already saved today for this exact workout+day, restored from the draft.
  ctx.savedByExercise = buildSavedByExercise_(restored.sets);

  const headWrap = buildWorkoutHead_(ctx, shared, workoutName);
  const oldHead = document.querySelector(".workout__head");
  if (oldHead) oldHead.remove();
  document.querySelector(".card__top").insertAdjacentElement("afterend", headWrap);

  if (isToday && !coachMode) {
    startWorkoutTimer(ctx.timerValueEl);
  } else {
    stopWorkoutTimer();
  }

  renderCurrentView(ctx, null);

  // Pre-fill the notes box (built fresh on the review screen) from the draft;
  // actual persistence of typed notes happens when the review screen opens
  // or Finish is tapped, same draft shape as before.

  // Arrived from the Exercise Library's "Add to Today's Workout" (?addExercise=).
  // Only once per page load — not on a later renderWorkout (changing the date,
  // or opening a different workout from the picker) — and only if it isn't
  // already in this workout under another name.
  const pendingAdd = !pendingAddExerciseHandled_ && (params.get("addExercise") || "").trim();
  if (pendingAdd) {
    pendingAddExerciseHandled_ = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("addExercise");
    history.replaceState(null, "", url.toString());
    const already = ctx.items.some((it) => it.type === "exercise" && it.exercise.name.toLowerCase() === pendingAdd.toLowerCase());
    if (!already) {
      const exercise = { name: pendingAdd, sets: 1, reps: "" };
      const item = { type: "exercise", exercise, isExtra: true };
      item.sets = buildExerciseSets_(ctx, exercise, new Map(), (row) => {
        if (!ctx.saveSet(row)) return;
        if (ctx.onItemChanged) ctx.onItemChanged(item);
      }, ctx.rowOptions);
      ctx.items.push(item);
      relayoutCurrentView_(ctx);
    }
  }
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

function showPicker(shared, workoutGroups, workoutNames) {
  if (shared.currentCtx) shared.currentCtx.dead = true;
  shared.current = null;
  shared.currentCtx = null;
  els.status.hidden = true;
  els.list.hidden = true;
  els.review.hidden = true;
  els.done.hidden = true;
  stopWorkoutTimer();
  stopRestTimer();
  const oldHead = document.querySelector(".workout__head");
  if (oldHead) oldHead.remove();
  els.pageTag.textContent = coachMode ? "Coach" : "Workout";
  els.picker.hidden = false;
  els.pickerList.innerHTML = "";
  const pickerHint = els.picker.querySelector(".workout__picker-hint");
  if (pickerHint) pickerHint.textContent = coachMode ? "Which workout did they do?" : "Which one are you doing today?";
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
  els.progressLink.href = `progress.html?id=${encodeURIComponent(memberId)}`;
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
      fetchLoggedSets(clientSlug),
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
        superset: workout.col.superset >= 0 && String(r[workout.col.superset] || "").trim().toUpperCase() === "Y",
        supersetRest: workout.col.supersetRest >= 0 ? Number(r[workout.col.supersetRest]) : NaN,
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
      const weight = Number(row[exerciseDefaults.col.startingWeight]);
      if (Number.isFinite(weight)) startingWeights[rawName.toLowerCase()] = weight;
    }
    // Shared resolver (card/muscle-map.js), not a plain exact-lowercase
    // lookup (2026-10-09 fix) — see workout/heatmap.js's header comment for
    // why: the old matching silently dropped most of what clients actually
    // logged, here too (this is what the review screen's muscle summary reads).
    exerciseIndex_ = buildExerciseIndex_(exerciseDefaults.rows, exerciseDefaults.col);
  } catch (err) {
    showStatus("Couldn't load your workout. Check your connection and reopen.", true);
    return;
  }

  // Send off anything from an earlier day that was saved but never sent.
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
  // whichever workout is open, so changing the date can reload it for the
  // new day; currentView = the client's remembered view, shared so switching
  // views or re-rendering for a new date doesn't reset it.
  const shared = {
    clientSlug, setRows, setCol, startingWeights, exerciseNameOptions, workoutNotes,
    date: sydneyDateStr(), current: null, currentCtx: null, currentView: readViewPref_(),
  };
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

// The version number used to be printed at the bottom of the page; clients don't need it, so it's hidden (APP_VERSION stays for debugging).

init();
