/*
 * MaxFit front-desk check-in page.
 *
 * Opened by scanning a member's QR code (their card links here with
 * ?token=<their Check-in Token from the sheet>). Read-only on load — it
 * only looks the member up and shows a confirmation screen. The actual
 * write (decrement sessions, log attendance) only happens if someone taps
 * "Confirm Check-In", via a POST to the Apps Script Web App below. Nothing
 * here holds credentials — the script runs under the sheet owner's own
 * Apps Script authorization, which is the entire point of this approach.
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
  button: document.getElementById("checkinButton"),
  submitError: document.getElementById("checkinSubmitError"),
  successTitle: document.getElementById("checkinSuccessTitle"),
  successText: document.getElementById("checkinSuccessText"),
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
  els.groupSessions.textContent = parseSessions(match[col.groupSessions], "N/A");
  els.oneOnOneSessions.textContent = parseSessions(match[col.oneOnOneSessions], "N/A");

  const owing = Number((match[col.amountOwing] || "").trim());
  if (Number.isFinite(owing) && owing > 0) {
    els.owing.textContent = `Outstanding balance: $${owing}`;
    els.owing.hidden = false;
  }

  showState(els.confirm);

  els.button.addEventListener("click", () => submitCheckIn(token));
}

async function submitCheckIn(token) {
  els.button.disabled = true;
  els.button.textContent = "Checking In…";
  els.submitError.hidden = true;

  let result;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify({ token }),
    });
    result = await res.json();
  } catch (err) {
    els.submitError.textContent = "Couldn't reach the check-in system. Check your connection and try again.";
    els.submitError.hidden = false;
    els.button.disabled = false;
    els.button.textContent = "Confirm Check-In";
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

  els.submitError.textContent = "Something went wrong — try again or check in manually.";
  els.submitError.hidden = false;
  els.button.disabled = false;
  els.button.textContent = "Confirm Check-In";
}

init();
