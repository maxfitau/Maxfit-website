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
  loading: document.getElementById("checkinLoading"),
  invalid: document.getElementById("checkinInvalid"),
  confirm: document.getElementById("checkinConfirm"),
  success: document.getElementById("checkinSuccess"),
  name: document.getElementById("checkinName"),
  groupSessions: document.getElementById("checkinGroupSessions"),
  oneOnOneSessions: document.getElementById("checkinOneOnOneSessions"),
  owing: document.getElementById("checkinOwing"),
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

function showState(state) {
  for (const el of [els.loading, els.invalid, els.confirm, els.success]) {
    el.hidden = el !== state;
  }
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

  const owing = Number((match[col.amountOwing] || "").trim());
  if (Number.isFinite(owing) && owing > 0) {
    els.owing.textContent = `Outstanding balance: $${owing}`;
    els.owing.hidden = false;
  }

  // Loyalty punchcard: every 10th visit (their 10th, 20th, 30th...) is free,
  // and so is their very first ever visit. Pre-tick the box either way —
  // staff can still untick it, or tick it manually for any other reason
  // (e.g. a one-off comp).
  const totalBefore = parseSessions(col.totalAttended >= 0 ? match[col.totalAttended] : "", 0);
  const isFirstVisit = totalBefore === 0;
  const isMilestoneVisit = !isFirstVisit && (totalBefore + 1) % 10 === 0;
  if (isFirstVisit || isMilestoneVisit) {
    els.freeCheckbox.checked = true;
    els.freeRow.classList.add("checkin__free--suggested");
    els.freeLabel.textContent = isFirstVisit
      ? "Free Session (first visit!)"
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
