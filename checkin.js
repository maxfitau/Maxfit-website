/*
 * MaxFit front-desk check-in page.
 *
 * Opened by scanning a member's QR code (their card links here with
 * ?token=<their Check-in Token from the sheet>). Read-only on load — it
 * only looks the member up and shows a confirmation screen. The actual
 * write (decrement sessions, log attendance) only happens if someone taps
 * one of the two check-in buttons, via a POST to the Apps Script Web App
 * below. Nothing here holds credentials — the script runs under the sheet
 * owner's own Apps Script authorization, which is the entire point of
 * this approach.
 *
 * Below the check-in buttons (and still there after checking in) sits a "Log
 * <name>'s workout" button for each workout that member has been assigned, so
 * Max can go straight from the scan to logging their session on his phone —
 * see the coach mode in workout/app.js. It's built from the same sheet the
 * page already reads, after the check-in screen is up, and if anything about
 * it fails the check-in itself is unaffected.
 *
 * Two buttons, not one, because Group and 1-on-1 sessions are tracked (and
 * priced) separately — the front desk picks which type this visit is, and
 * only that column gets decremented.
 *
 * *** PASTE YOUR DEPLOYED APPS SCRIPT WEB APP URL BELOW ***
 * (Extensions > Apps Script > Deploy > Web app > copy the /exec URL.)
 */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";

/*
 * Staff PIN: gates who can actually confirm a check-in, since the page
 * itself is public (anyone with a member's QR could otherwise tap the
 * button). The correct PIN lives only in the Apps Script's Script
 * Properties, checked server-side — this page never knows whether a PIN
 * it sends is right until the server says so. Once a device enters a PIN
 * that works, it's remembered here so staff don't retype it every scan;
 * a member's own phone, which has never entered it, still gets asked.
 */
const STAFF_PIN_STORAGE_KEY = "maxfitStaffPin";

const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const els = {
  main: document.getElementById("checkin"),
  loading: document.getElementById("checkinLoading"),
  invalid: document.getElementById("checkinInvalid"),
  confirm: document.getElementById("checkinConfirm"),
  success: document.getElementById("checkinSuccess"),
  name: document.getElementById("checkinName"),
  groupSessions: document.getElementById("checkinGroupSessions"),
  oneOnOneSessions: document.getElementById("checkinOneOnOneSessions"),
  pinRow: document.getElementById("checkinPinRow"),
  pinInput: document.getElementById("checkinPinInput"),
  freeRow: document.getElementById("checkinFreeRow"),
  freeCheckbox: document.getElementById("checkinFreeCheckbox"),
  freeLabel: document.getElementById("checkinFreeLabel"),
  groupButton: document.getElementById("checkinGroupButton"),
  oneOnOneButton: document.getElementById("checkinOneOnOneButton"),
  submitError: document.getElementById("checkinSubmitError"),
  successTitle: document.getElementById("checkinSuccessTitle"),
  successText: document.getElementById("checkinSuccessText"),
};

const BUTTON_LABELS = {
  group: "Check In — Group",
  "one-on-one": "Check In — 1-on-1",
};

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let currentState = null;
let workoutsSection = null; // the "Log <name>'s workout" block, once it's been built

function showState(state) {
  currentState = state;
  for (const el of [els.loading, els.invalid, els.confirm, els.success]) {
    el.hidden = el !== state;
  }
  syncWorkoutsVisibility();
}

/** The workout buttons belong with the member on screen — before and after check-in — and nowhere else (not while loading, not on an invalid code). */
function syncWorkoutsVisibility() {
  if (workoutsSection) workoutsSection.hidden = !(currentState === els.confirm || currentState === els.success);
}

/**
 * This member's assigned workouts, in the order set up in the builder, each
 * with its exercise count. If exactly one is scheduled for today's weekday it's
 * flagged and moved to the front (the same rule the card uses to name today's
 * workout). An exercise needs a name and at least one set to count — the same
 * filter the workout page applies — so the count matches what Max will see.
 */
async function loadClientWorkouts(memberName) {
  const clientSlug = slugify(memberName);
  const { rows, col } = await fetchWorkoutExercises();

  const groups = new Map();
  for (const r of rows) {
    if (String(r[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
    if (!(r[col.exercise] || "").trim() || parseSessions(r[col.sets], 0) <= 0) continue;

    const name = (col.workoutName >= 0 ? String(r[col.workoutName] || "").trim() : "") || "Today's Workout";
    if (!groups.has(name)) groups.set(name, { name, count: 0, order: NaN, days: new Set() });
    const group = groups.get(name);
    group.count++;
    if (!Number.isFinite(group.order) && col.workoutOrder >= 0) group.order = Number(r[col.workoutOrder]);
    if (col.days >= 0) {
      String(r[col.days] || "").split(",").map((d) => d.trim()).filter(Boolean).forEach((d) => group.days.add(d));
    }
  }

  // Unordered workouts tie at a large finite number (Infinity - Infinity would be NaN).
  const UNORDERED = Number.MAX_SAFE_INTEGER;
  const list = Array.from(groups.values()).sort(
    (a, b) => (Number.isFinite(a.order) ? a.order : UNORDERED) - (Number.isFinite(b.order) ? b.order : UNORDERED)
  );

  const today = DAY_ABBR[new Date().getDay()];
  const scheduledToday = list.filter((g) => g.days.has(today));
  const todayGroup = scheduledToday.length === 1 ? scheduledToday[0] : null;
  if (todayGroup) {
    list.splice(list.indexOf(todayGroup), 1);
    list.unshift(todayGroup);
  }
  return { list, todayName: todayGroup ? todayGroup.name : "" };
}

/** Builds the "Log <name>'s workout" block under the check-in screen. Fire-and-forget: failing to load it must never get in the way of checking someone in. */
async function showWorkoutLinks(memberName) {
  let result;
  try {
    result = await loadClientWorkouts(memberName);
  } catch (err) {
    return;
  }

  const section = document.createElement("div");
  section.className = "checkin__workouts";
  section.hidden = true;

  const label = document.createElement("span");
  label.className = "card__label";
  label.textContent = `Log ${memberName.trim().split(/\s+/)[0] || "their"}'s workout`;
  section.appendChild(label);

  if (!result.list.length) {
    const none = document.createElement("p");
    none.className = "checkin__no-workout";
    none.appendChild(document.createTextNode("No workout assigned yet. "));
    const build = document.createElement("a");
    build.href = "workout/builder.html";
    build.textContent = "Build one";
    none.appendChild(build);
    section.appendChild(none);
  } else {
    for (const group of result.list) {
      const isToday = group.name === result.todayName;
      const link = document.createElement("a");
      link.className = "checkin__workout";
      if (isToday) link.classList.add("checkin__workout--today");
      // coach=1 puts the workout page in coach mode; back returns to this
      // exact check-in screen (the workout page only honours same-site URLs).
      link.href = "workout/?" + new URLSearchParams({
        id: slugify(memberName),
        workout: group.name,
        coach: "1",
        name: memberName,
        back: window.location.href,
      }).toString();

      const name = document.createElement("span");
      name.className = "checkin__workout-name";
      name.textContent = group.name;
      link.appendChild(name);

      const meta = document.createElement("span");
      meta.className = "checkin__workout-meta";
      meta.textContent = isToday ? "Today" : `${group.count} exercise${group.count === 1 ? "" : "s"}`;
      link.appendChild(meta);

      section.appendChild(link);
    }
  }

  els.main.appendChild(section);
  workoutsSection = section;
  syncWorkoutsVisibility();
}

async function init() {
  if (!token) {
    showState(els.invalid);
    return;
  }

  let match;
  let col;
  try {
    const sheet = await fetchSheet();
    col = sheet.col;
    if (col.checkInToken < 0) {
      // "Check-in Token" column doesn't exist in the sheet yet.
      showState(els.invalid);
      return;
    }
    match = sheet.rows.find((r) => r[col.checkInToken] && r[col.checkInToken].trim() === token);
  } catch (err) {
    showState(els.invalid);
    return;
  }

  if (!match) {
    showState(els.invalid);
    return;
  }

  els.name.textContent = match[col.name];
  const groupSessions = parseSessions(match[col.groupSessions], "N/A");
  const oneOnOneSessions = parseSessions(match[col.oneOnOneSessions], "N/A");
  els.groupSessions.textContent = groupSessions;
  els.oneOnOneSessions.textContent = oneOnOneSessions;

  // Nothing sensible to decrement for a session type this member doesn't
  // have tracked at all — disable that button rather than let it fire.
  els.groupButton.disabled = groupSessions === "N/A";
  els.oneOnOneButton.disabled = oneOnOneSessions === "N/A";

  // Loyalty punchcard: every 10th visit (their 10th, 20th, 30th...) is free,
  // and so is their very first ever visit. Pre-tick the box either way —
  // staff can still untick it, or tick it manually for any other reason
  // (e.g. a one-off comp).
  // The card counts class visits PLUS nutrition punches earned in FUEL
  // (5 green days in a week = 1 punch). If a nutrition punch is what filled
  // the card, "Free Session Owed" is Y and this visit is the free one.
  const totalBefore = parseSessions(col.totalAttended >= 0 ? match[col.totalAttended] : "", 0);
  const punches = col.nutritionPunches >= 0 ? parseSessions(match[col.nutritionPunches], 0) : 0;
  const freeOwed = col.freeOwed >= 0 && String(match[col.freeOwed] || "").trim().toUpperCase() === "Y";
  const cardBefore = totalBefore + punches;
  const isFirstVisit = totalBefore === 0;
  const isMilestoneVisit = !isFirstVisit && (cardBefore + 1) % 10 === 0;
  if (isFirstVisit || isMilestoneVisit || freeOwed) {
    els.freeCheckbox.checked = true;
    els.freeRow.classList.add("checkin__free--suggested");
    els.freeLabel.textContent = freeOwed
      ? "Free Session (earned with Fuel!)"
      : isFirstVisit
      ? "Free Session (first visit!)"
      : punches
      ? "Free Session (card complete!)"
      : `Free Session (visit #${totalBefore + 1}!)`;
  }

  let rememberedPin = "";
  try {
    rememberedPin = localStorage.getItem(STAFF_PIN_STORAGE_KEY) || "";
  } catch (err) {
    // Ignore — just means this device will need the PIN typed each time.
  }
  if (rememberedPin) {
    els.pinRow.hidden = true;
  } else {
    els.pinInput.focus();
  }

  showState(els.confirm);
  showWorkoutLinks(match[col.name]);

  els.groupButton.addEventListener("click", () => submitCheckIn("group"));
  els.oneOnOneButton.addEventListener("click", () => submitCheckIn("one-on-one"));
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

async function submitCheckIn(sessionType) {
  // Disable both — a tap on either should block the other, not just itself.
  els.groupButton.disabled = true;
  els.oneOnOneButton.disabled = true;
  const tappedButton = sessionType === "group" ? els.groupButton : els.oneOnOneButton;
  tappedButton.textContent = "Checking In…";
  els.submitError.hidden = true;

  const pin = currentPin();
  const freeSession = els.freeCheckbox.checked;

  let result;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify({ token, sessionType, pin, freeSession }),
    });
    result = await res.json();
  } catch (err) {
    showRetry(tappedButton, sessionType, "Couldn't reach the check-in system. Check your connection and try again.");
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
    showRetry(tappedButton, sessionType, "Incorrect PIN — check with the gym owner.");
    return;
  }

  // Reaching any of these three means the PIN was accepted server-side,
  // regardless of the outcome — worth remembering it for next time either way.
  if (["success", "already-checked-in", "no-sessions"].includes(result.status) && pin) {
    try {
      localStorage.setItem(STAFF_PIN_STORAGE_KEY, pin);
    } catch (err) {
      // Ignore — this device just asks for the PIN again next time.
    }
  }

  if (result.status === "success") {
    els.successTitle.textContent = result.freeSession ? "Checked In — Free Session!" : "Checked In";
    els.successText.textContent = result.freeSession
      ? "On the house. Enjoy!"
      : Number.isFinite(result.sessionsRemaining)
        ? `${result.sessionsRemaining} session${result.sessionsRemaining === 1 ? "" : "s"} left.`
        : "Enjoy your session.";
    showState(els.success);
    return;
  }

  if (result.status === "already-checked-in") {
    els.successTitle.textContent = "Already Checked In";
    els.successText.textContent = "This member already checked in today.";
    showState(els.success);
    return;
  }

  if (result.status === "no-sessions") {
    els.successTitle.textContent = "No Sessions Left";
    els.successText.textContent = "This member has no sessions remaining — sort payment before their session.";
    showState(els.success);
    return;
  }

  showRetry(tappedButton, sessionType, "Something went wrong — try again or check in manually.");
}

function showRetry(button, sessionType, message) {
  els.submitError.textContent = message;
  els.submitError.hidden = false;
  els.groupButton.disabled = els.groupSessions.textContent === "N/A";
  els.oneOnOneButton.disabled = els.oneOnOneSessions.textContent === "N/A";
  button.textContent = BUTTON_LABELS[sessionType];
}

init();
