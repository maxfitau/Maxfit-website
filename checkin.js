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
const APPS_SCRIPT_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";

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

  showState(els.confirm);

  els.groupButton.addEventListener("click", () => submitCheckIn("group"));
  els.oneOnOneButton.addEventListener("click", () => submitCheckIn("one-on-one"));
}

async function submitCheckIn(sessionType) {
  // Disable both — a tap on either should block the other, not just itself.
  els.groupButton.disabled = true;
  els.oneOnOneButton.disabled = true;
  const tappedButton = sessionType === "group" ? els.groupButton : els.oneOnOneButton;
  tappedButton.textContent = "Checking In…";
  els.submitError.hidden = true;

  let result;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify({ token, sessionType }),
    });
    result = await res.json();
  } catch (err) {
    showRetry(tappedButton, sessionType, "Couldn't reach the check-in system. Check your connection and try again.");
    return;
  }

  if (result.status === "success") {
    els.successTitle.textContent = "Checked In";
    els.successText.textContent = Number.isFinite(result.sessionsRemaining)
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
