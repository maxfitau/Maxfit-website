/**
 * MaxFit check-in — Apps Script Web App.
 *
 * Bound to the "Sessions Remaining" / attendance-log spreadsheet (open it
 * from Extensions > Apps Script to paste this in). Deployed as a Web App
 * with "Anyone" access so the static checkin.html page can POST to it with
 * no login — this script runs under the sheet owner's own Apps Script
 * authorization, so no credentials ever need to live in client-side code.
 *
 * Sheets are looked up by gid (sheetId), not by tab name, so renaming a tab
 * in the Sheets UI doesn't break this.
 */

const SESSIONS_SHEET_GID = 1169726169; // "Sessions Remaining"
const ATTENDANCE_SHEET_GID = 902061668; // attendance log
const REFERRALS_SHEET_GID = 1148655449; // "Refferals"
const LEADS_SHEET_GID = 846176456; // "Leads"
const TIMEZONE = "Australia/Sydney";

// Workout builder/logger tabs — looked up by NAME rather than gid, unlike
// everything above. They don't exist until setupWorkoutSheets() creates
// them (see below), so there's no gid to hardcode ahead of time the way the
// other tabs do — and since nothing else in the sheet references these by
// gid either, a name lookup is fine here specifically.
const EXERCISES_SHEET_NAME = "Exercises";
const WORKOUT_EXERCISES_SHEET_NAME = "Workout Exercises";
const LOGGED_SETS_SHEET_NAME = "Logged Sets";

// Family grocery list — same by-name lookup as the workout tabs above, for
// the same reason (setupGrocerySheet() creates it, so there's no gid yet).
const GROCERY_SHEET_NAME = "Grocery Items";

// Changes whenever this file does, and is shown when you open the deployed
// URL in a browser (see doGet) — the quick way to tell whether a redeploy
// actually took, instead of guessing from behaviour.
const BACKEND_VERSION = "2026-09-26b";

function getSheetByGid_(gid) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheets().find((s) => s.getSheetId() === gid);
  if (!sheet) throw new Error("Sheet with gid " + gid + " not found");
  return sheet;
}

/** Case/whitespace-insensitive header lookup, 0-indexed — mirrors card/sheet.js's findColumn(). */
function findColumn_(header, name) {
  const target = name.toLowerCase();
  for (let i = 0; i < header.length; i++) {
    if (String(header[i]).trim().toLowerCase() === target) return i;
  }
  return -1;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * One-time helper — run manually from the Apps Script editor (pick this
 * function in the toolbar dropdown, then Run) to backfill a unique,
 * unguessable Check-in Token into every existing row that doesn't have one.
 * Safe to re-run any time a new member is added — it only fills blanks,
 * never overwrites an existing token.
 */
function backfillTokens() {
  const sheet = getSheetByGid_(SESSIONS_SHEET_GID);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const nameCol = findColumn_(header, "Name");
  const tokenCol = findColumn_(header, "Check-in Token");

  if (tokenCol < 0) {
    throw new Error('Add a "Check-in Token" column to the sheet first, then run this again.');
  }

  let filled = 0;
  for (let row = 1; row < data.length; row++) {
    if (!data[row][nameCol]) continue; // skip blank rows
    if (data[row][tokenCol]) continue; // already has a token

    sheet.getRange(row + 1, tokenCol + 1).setValue(Utilities.getUuid());
    filled++;
  }
  Logger.log("Backfilled " + filled + " token(s).");
}

/**
 * One-time helper — run manually from the Apps Script editor (pick this
 * function in the toolbar dropdown, then Run) to create the three tabs the
 * workout builder/logger needs, headers already in place. Safe to re-run —
 * it only creates a tab if one by that exact name doesn't already exist yet.
 */
function setupWorkoutSheets() {
  getOrCreateSheetByName_(EXERCISES_SHEET_NAME, ["Name", "Default Starting Weight (kg)"]);
  getOrCreateSheetByName_(WORKOUT_EXERCISES_SHEET_NAME, ["Client", "Workout Name", "Order", "Exercise", "Target Sets", "Target Reps", "Days", "Workout Order", "Exercise Notes", "Workout Notes"]);
  getOrCreateSheetByName_(LOGGED_SETS_SHEET_NAME, ["Client", "Workout Name", "Exercise", "Set Number", "Weight (kg)", "Reps", "Date", "Timestamp", "Notes"]);
  Logger.log("Workout sheets ready.");
}

/**
 * One-time helper — run manually from the Apps Script editor. Adds the
 * "Days" column to an existing Workout Exercises tab that was created
 * before that column existed (setupWorkoutSheets only creates a tab if it's
 * missing entirely, it never adds columns to one that's already there).
 * Safe to re-run — does nothing if the column already exists.
 */
function addDaysColumnToWorkoutExercises() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WORKOUT_EXERCISES_SHEET_NAME);
  if (!sheet) {
    Logger.log("No Workout Exercises tab yet — run setupWorkoutSheets first.");
    return;
  }
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (findColumn_(header, "Days") >= 0) {
    Logger.log("Days column already exists.");
    return;
  }
  sheet.getRange(1, lastCol + 1).setValue("Days");
  Logger.log("Added Days column.");
}

/**
 * One-time helper — run manually from the Apps Script editor. Adds the
 * "Workout Order" column an existing Workout Exercises tab predates —
 * lets the client card / builder chips show workouts in whatever order
 * you've dragged them into, instead of an arbitrary sheet order. Safe to
 * re-run.
 */
function addWorkoutOrderColumnToWorkoutExercises() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WORKOUT_EXERCISES_SHEET_NAME);
  if (!sheet) {
    Logger.log("No Workout Exercises tab yet — run setupWorkoutSheets first.");
    return;
  }
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (findColumn_(header, "Workout Order") >= 0) {
    Logger.log("Workout Order column already exists.");
    return;
  }
  sheet.getRange(1, lastCol + 1).setValue("Workout Order");
  Logger.log("Added Workout Order column.");
}

/**
 * One-time helper — run manually from the Apps Script editor. Adds the
 * "Notes" column to an existing Logged Sets tab that predates it, same
 * reasoning as addDaysColumnToWorkoutExercises above. Safe to re-run.
 */
function addNotesColumnToLoggedSets() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOGGED_SETS_SHEET_NAME);
  if (!sheet) {
    Logger.log("No Logged Sets tab yet — run setupWorkoutSheets first.");
    return;
  }
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (findColumn_(header, "Notes") >= 0) {
    Logger.log("Notes column already exists.");
    return;
  }
  sheet.getRange(1, lastCol + 1).setValue("Notes");
  Logger.log("Added Notes column.");
}

/**
 * One-time helper — run manually from the Apps Script editor to create the
 * "Grocery Items" tab the family grocery list needs. Safe to re-run.
 */
function setupGrocerySheet() {
  getOrCreateSheetByName_(GROCERY_SHEET_NAME, ["ID", "Surname", "Item", "Added By", "Added At"]);
  Logger.log("Grocery sheet ready.");
}

function getOrCreateSheetByName_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Visiting the deployed URL directly in a browser hits this — confirms the deployment is live. */
function doGet(e) {
  return jsonResponse_({ status: "ok", message: "MaxFit check-in API is running.", version: BACKEND_VERSION });
}

// Which sheet column each check-in "sessionType" decrements.
const SESSION_TYPE_COLUMNS = {
  "group": "Group Sessions Remaining",
  "one-on-one": "1 on 1 Remaining",
};
const SESSION_TYPE_NOTES = {
  "group": "Group",
  "one-on-one": "1-on-1",
};

/**
 * The real PIN value is never in this file — this repo is public on
 * GitHub, so anything written here is world-readable. It's stored instead
 * as a Script Property, set via Project Settings > Script Properties in
 * the Apps Script editor (key: STAFF_PIN), which lives only in your
 * Google account, not in git.
 */
function checkPin_(pin) {
  const expected = PropertiesService.getScriptProperties().getProperty("STAFF_PIN");
  if (!expected) return true; // no PIN configured yet — don't lock everyone out by accident
  return String(pin || "").trim() === expected;
}

/**
 * Same idea as checkPin_ but a separate Script Property (key: GROCERY_CODE)
 * — one shared code the whole family uses, unrelated to staff PIN access.
 */
function checkGroceryCode_(code) {
  const expected = PropertiesService.getScriptProperties().getProperty("GROCERY_CODE");
  if (!expected) return true; // not configured yet — don't lock everyone out by accident
  return String(code || "").trim() === expected;
}

/**
 * Single POST endpoint, dispatched by payload.action. checkin.js doesn't
 * send an action (predates this), so "checkin" is the default — anything
 * else (currently just "signup") must say so explicitly.
 */
function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ status: "error", message: "Bad request." });
  }

  const action = payload.action || "checkin";
  if (action === "signup") {
    return withLock_(() => handleSignup_(payload));
  }
  if (action === "assignWorkout") {
    return withLock_(() => handleAssignWorkout_(payload));
  }
  if (action === "reorderWorkouts") {
    return withLock_(() => handleReorderWorkouts_(payload));
  }
  if (action === "deleteWorkout") {
    return withLock_(() => handleDeleteWorkout_(payload));
  }
  if (action === "saveWorkoutSession") {
    return withLock_(() => handleSaveWorkoutSession_(payload));
  }
  if (action === "bookingInfo") {
    return handleBookingInfo_(payload); // read-only, so no lock
  }
  if (action === "bookSession") {
    return withLock_(() => handleBookSession_(payload));
  }
  if (action === "cancelBooking") {
    return withLock_(() => handleCancelBooking_(payload));
  }
  if (action === "checkGroceryCode") {
    return handleCheckGroceryCode_(payload);
  }
  if (action === "addGroceryItem") {
    return withLock_(() => handleAddGroceryItem_(payload));
  }
  if (action === "deleteGroceryItem") {
    return withLock_(() => handleDeleteGroceryItem_(payload));
  }
  // Only the check-in page sends no action at all, so that's the only thing
  // that should ever land in the check-in handler. Anything else is a page
  // asking for an action this deployment doesn't know — better an honest
  // error than quietly being treated as a check-in.
  if (action !== "checkin") {
    return jsonResponse_({ status: "error", message: "Unknown action." });
  }
  return withLock_(() => handleCheckIn_(payload));
}

/**
 * Every handler above that mutates the sheet does a read, then a delete,
 * then a write, as separate steps — if two requests overlap (a client
 * saving a workout while the coach edits it in the builder, two family
 * members hitting the grocery list at once, even just a page firing a
 * request twice), the second one can act on row numbers the first one just
 * shifted or deleted out from under it. That's exactly the shape of an
 * intermittent, hard-to-reproduce "it just didn't save" bug. A script-wide
 * lock serializes every write so only one request touches the sheet at a
 * time; the rest queue briefly rather than racing. If the wait times out
 * (10s — should only happen under genuinely heavy concurrent load), it
 * fails with a clear, visible error instead of silently corrupting data.
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return jsonResponse_({ status: "error", message: "Server's busy right now — try again in a moment." });
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function handleCheckIn_(payload) {
  if (!checkPin_(payload.pin)) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const token = String(payload.token || "").trim();
  const sessionType = String(payload.sessionType || "").trim();
  const freeSession = Boolean(payload.freeSession);
  if (!token) {
    return jsonResponse_({ status: "error", message: "Missing token." });
  }
  if (!SESSION_TYPE_COLUMNS[sessionType]) {
    return jsonResponse_({ status: "error", message: "Missing or invalid sessionType." });
  }

  const sheet = getSheetByGid_(SESSIONS_SHEET_GID);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const col = {
    name: findColumn_(header, "Name"),
    package: findColumn_(header, "Package Type"),
    sessions: findColumn_(header, SESSION_TYPE_COLUMNS[sessionType]),
    lastAttended: findColumn_(header, "Last Attended"),
    checkInToken: findColumn_(header, "Check-in Token"),
    totalAttended: findColumn_(header, "Total Classes Attended"),
    paidSessions: findColumn_(header, "Paid Sessions"),
    hasPaidOneOnOne: findColumn_(header, "Has Paid 1-on-1"),
    referredBy: findColumn_(header, "Referred By"),
    groupSessions: findColumn_(header, "Group Sessions Remaining"),
    paidInClasses: findColumn_(header, "Paid In Classes"),
    tokensOwed: findColumn_(header, "Tokens Owed"),
    freeOwed: findColumn_(header, "Free Session Owed"), // set by the MaxFit Macros script
  };

  if (col.checkInToken < 0) {
    return jsonResponse_({ status: "error", message: 'Sheet has no "Check-in Token" column.' });
  }
  if (col.sessions < 0) {
    return jsonResponse_({ status: "error", message: 'Sheet has no "' + SESSION_TYPE_COLUMNS[sessionType] + '" column.' });
  }

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col.checkInToken]).trim() === token) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex < 0) {
    return jsonResponse_({ status: "invalid" });
  }

  const row = data[rowIndex];
  const today = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");

  // Guards once per day, not once per session type — a member checking in
  // for both a group class and a 1-on-1 on the same day would incorrectly
  // get blocked on the second one. Simpler tradeoff accepted for now;
  // revisit with a per-type guard (e.g. scanning the attendance log
  // instead of this single cell) if that turns out to matter in practice.
  const lastAttendedRaw = col.lastAttended >= 0 ? row[col.lastAttended] : "";
  const lastAttendedStr = lastAttendedRaw instanceof Date
    ? Utilities.formatDate(lastAttendedRaw, TIMEZONE, "yyyy-MM-dd")
    : String(lastAttendedRaw || "").trim();

  if (lastAttendedStr === today) {
    return jsonResponse_({ status: "already-checked-in" });
  }

  const packageType = String(row[col.package] || "").toLowerCase();
  const isUnlimited = packageType.indexOf("unlimited") >= 0;
  const sessionsRaw = String(row[col.sessions] || "").trim();
  const sessionsNum = Number(sessionsRaw);
  const hasNumericSessions = sessionsRaw !== "" && Number.isFinite(sessionsNum);

  let newSessions = null;
  if (!freeSession && !isUnlimited && hasNumericSessions) {
    if (sessionsNum <= 0) {
      return jsonResponse_({ status: "no-sessions" });
    }
    newSessions = sessionsNum - 1;
    sheet.getRange(rowIndex + 1, col.sessions + 1).setValue(newSessions);
  } else if (hasNumericSessions) {
    newSessions = sessionsNum; // free session, or unlimited — count stays as-is
  }
  // Unlimited plan, free session, or blank for this session type: skip the
  // decrement, still log the visit below.

  if (col.lastAttended >= 0) {
    sheet.getRange(rowIndex + 1, col.lastAttended + 1).setValue(today);
  }

  // A nutrition punch (FUEL) completed their card and this is the free
  // session it earned — it's been used now.
  if (freeSession && col.freeOwed >= 0 && String(row[col.freeOwed] || "").trim().toUpperCase() === "Y") {
    sheet.getRange(rowIndex + 1, col.freeOwed + 1).setValue("");
  }

  let totalAttended = null;
  if (col.totalAttended >= 0) {
    const totalRaw = String(row[col.totalAttended] || "").trim();
    const totalNum = Number(totalRaw);
    totalAttended = (totalRaw !== "" && Number.isFinite(totalNum) ? totalNum : 0) + 1;
    sheet.getRange(rowIndex + 1, col.totalAttended + 1).setValue(totalAttended);
  }

  const attendanceSheet = getSheetByGid_(ATTENDANCE_SHEET_GID);
  const attendanceHeader = attendanceSheet.getDataRange().getValues()[0];
  const aCol = {
    date: findColumn_(attendanceHeader, "Date"),
    clientName: findColumn_(attendanceHeader, "Client Name"),
    attended: findColumn_(attendanceHeader, "Attended (Y/N)"),
    notes: findColumn_(attendanceHeader, "Notes"),
  };
  // Class Time and Location are deliberately left blank — this is a walk-in
  // scan check-in, not tied to a scheduled class slot. Flagged back to Max
  // to confirm whether those columns should apply here at all.
  const newRow = new Array(attendanceHeader.length).fill("");
  if (aCol.date >= 0) newRow[aCol.date] = today;
  if (aCol.clientName >= 0) newRow[aCol.clientName] = row[col.name];
  if (aCol.attended >= 0) newRow[aCol.attended] = "Y";
  if (aCol.notes >= 0) {
    newRow[aCol.notes] = SESSION_TYPE_NOTES[sessionType] + (freeSession ? " — Free Session" : "");
  }
  attendanceSheet.appendRow(newRow);

  // "Paid Sessions" only counts real, paid attendance — a free bonus
  // session (freeSession) doesn't move a referred client any closer to
  // their referrer's payout. The referral payout itself runs right here,
  // driven entirely off this count and today's session type — no more
  // manually flipping a Payment Status cell by hand for every client.
  let paidSessionsCount = null;
  if (!freeSession && col.paidSessions >= 0) {
    const paidRaw = String(row[col.paidSessions] || "").trim();
    const paidNum = Number(paidRaw);
    paidSessionsCount = (paidRaw !== "" && Number.isFinite(paidNum) ? paidNum : 0) + 1;
    sheet.getRange(rowIndex + 1, col.paidSessions + 1).setValue(paidSessionsCount);

    // Gates the starred/free-classes reward below — the very first free
    // class a starred referrer earns requires their friend to have paid
    // for a 1-on-1 specifically, not just any session.
    let hasPaidOneOnOne = col.hasPaidOneOnOne >= 0
      ? String(row[col.hasPaidOneOnOne] || "").trim().toLowerCase() === "y"
      : false;
    if (sessionType === "one-on-one" && col.hasPaidOneOnOne >= 0 && !hasPaidOneOnOne) {
      sheet.getRange(rowIndex + 1, col.hasPaidOneOnOne + 1).setValue("Y");
      hasPaidOneOnOne = true;
    }

    maybeApplyReferralBonus_(sheet, col, rowIndex + 1, paidSessionsCount, sessionType, hasPaidOneOnOne);
    markReferralCounted_(sheet, rowIndex + 1, paidSessionsCount);
  }

  return jsonResponse_({
    status: "success",
    sessionsRemaining: newSessions,
    totalAttended: totalAttended,
    freeSession: freeSession,
  });
}

/**
 * Public sign-up form submission (join.html). Adds a new row to a
 * dedicated "Leads" tab — Name/Phone/Email, today's date, and Referred By
 * — kept entirely separate from Sessions Remaining, which stays paying
 * clients only. A lead with Referred By filled in is owed a free 1-on-1
 * in person; Max delivers that, then manually creates their real row in
 * Sessions Remaining afterward (typing Referred By in himself at that
 * point), same as any other new member.
 *
 */
function handleSignup_(payload) {
  // Honeypot: a real visitor never fills this (it's not a visible field
  // in join.html). A bot filling every field blind will. Pretend success
  // so it doesn't learn to try something else.
  if (payload.website) {
    return jsonResponse_({ status: "success" });
  }

  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();
  const email = String(payload.email || "").trim();
  const goals = String(payload.goals || "").trim();
  const referralCode = String(payload.referralCode || "").trim();

  if (!name || (!phone && !email)) {
    return jsonResponse_({ status: "error", message: "Missing name and contact details." });
  }

  const leadsSheet = getSheetByGid_(LEADS_SHEET_GID);
  const leadsHeader = leadsSheet.getRange(1, 1, 1, leadsSheet.getLastColumn()).getValues()[0];
  const col = {
    name: findColumn_(leadsHeader, "Name"),
    phone: findColumn_(leadsHeader, "Phone"),
    email: findColumn_(leadsHeader, "Email"),
    signupDate: findColumn_(leadsHeader, "Sign-up Date"),
    referredBy: findColumn_(leadsHeader, "Referred By"),
    goals: findColumn_(leadsHeader, "Goals / Notes"),
  };

  // Duplicate check spans both Leads and Sessions Remaining, so someone
  // who's already a client (or already enquired) doesn't get a second
  // lead entry just because a friend sent them the link too.
  if (email && isEmailAlreadyPresent_(leadsSheet, col.email, email)) {
    return jsonResponse_({ status: "duplicate" });
  }
  if (email) {
    const sessionsSheet = getSheetByGid_(SESSIONS_SHEET_GID);
    const sessionsHeader = sessionsSheet.getRange(1, 1, 1, sessionsSheet.getLastColumn()).getValues()[0];
    const sessionsEmailCol = findColumn_(sessionsHeader, "Email");
    if (isEmailAlreadyPresent_(sessionsSheet, sessionsEmailCol, email)) {
      return jsonResponse_({ status: "duplicate" });
    }
  }

  let referrerName = "";
  if (referralCode && REFERRALS_SHEET_GID) {
    const refSheet = getSheetByGid_(REFERRALS_SHEET_GID);
    const refData = refSheet.getDataRange().getValues();
    const refHeader = refData[0];
    const rCol = {
      friendName: findColumn_(refHeader, "Friend Name"),
      code: findColumn_(refHeader, "Referral Code"),
    };
    if (rCol.code >= 0) {
      for (let i = 1; i < refData.length; i++) {
        if (String(refData[i][rCol.code] || "").trim().toLowerCase() === referralCode.toLowerCase()) {
          referrerName = String(refData[i][rCol.friendName] || "").trim();
          break;
        }
      }
    }
  }

  const today = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  const newRow = new Array(leadsHeader.length).fill("");
  if (col.name >= 0) newRow[col.name] = name;
  if (col.phone >= 0) newRow[col.phone] = phone;
  if (col.email >= 0) newRow[col.email] = email;
  if (col.signupDate >= 0) newRow[col.signupDate] = today;
  if (col.referredBy >= 0) newRow[col.referredBy] = referrerName;
  if (col.goals >= 0) newRow[col.goals] = goals;
  leadsSheet.appendRow(newRow);

  notifyNewLead_({ name, phone, email, goals, referrerName });

  return jsonResponse_({ status: "success", referrerName: referrerName });
}

/**
 * Emails Max the moment someone signs up, so a new lead shows up as a phone
 * notification instead of something he only discovers next time he happens
 * to open the sheet. Uses MailApp (no setup, no API keys — it's just his own
 * Google account sending itself mail) rather than a paid SMS service.
 *
 * Wrapped so a failure here (quota, transient error) never blocks the
 * actual sign-up from succeeding — worst case, he misses the notification
 * but the lead is still safely in the sheet.
 */
function notifyNewLead_(lead) {
  const NOTIFY_EMAIL = "max.french28@gmail.com";
  try {
    const lines = [
      "New sign-up on maxfit.now:",
      "",
      "Name: " + lead.name,
    ];
    if (lead.phone) lines.push("Phone: " + lead.phone);
    if (lead.email) lines.push("Email: " + lead.email);
    if (lead.referrerName) lines.push("Referred by: " + lead.referrerName);
    if (lead.goals) lines.push("Goals: " + lead.goals);

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: "New MaxFit lead: " + lead.name,
      body: lines.join("\n"),
    });
  } catch (err) {
    // Never let a notification failure break the actual sign-up.
  }
}

function isEmailAlreadyPresent_(sheet, emailCol, email) {
  if (emailCol < 0) return false;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const values = sheet.getRange(2, emailCol + 1, lastRow - 1, 1).getValues().flat();
  return values.some((v) => String(v || "").trim().toLowerCase() === email.toLowerCase());
}

/**
 * Referral payout — runs as part of check-in itself (handleCheckIn_ calls
 * this after bumping "Paid Sessions" and "Has Paid 1-on-1"), not as a
 * separate manual step. Every qualifying check-in re-evaluates the payout;
 * nothing here needs a one-time "already applied" guard because it keys
 * off paidSessionsCount, which only ever increases by exactly 1 per real
 * check-in, so each threshold below is only ever crossed once.
 *
 * "Clients Referred" ticks up once, the moment the referred client hits
 * their 3rd paid session — regardless of which reward type below applies.
 *
 * Two reward types, depending on the referrer:
 *
 * - Referrer is a client marked "Paid In Classes" (Y) — paid in free group
 *   classes instead of tokens. The first class requires their friend to
 *   have paid for a 1-on-1 specifically (not just any session type); after
 *   that, every 2 more paid sessions of any type earns 1 more free class
 *   (3 paid -> 2 classes, 5 paid -> 3 classes, ...).
 * - Any other referrer (a client not marked "Paid In Classes", or a friend
 *   who isn't a client at all) — paid in tokens: 20 the moment their
 *   friend hits 3 paid sessions, then +5 for every paid 1-on-1 after that
 *   (group sessions after the milestone don't earn anything further).
 *   Stored on the referrer's own "Tokens Owed" cell if they're a client,
 *   or in the Referrals tab if they're not.
 *
 * Who the referrer is comes from referrerNameFor_ below: whatever's typed in
 * the client's "Referred By" cell (a name, the referrer's Referral Code, or
 * a client's unique check-in code), or — if that's blank — the referrer whose
 * row lists this client's own unique code under "Referred Clients".
 */
function maybeApplyReferralBonus_(sheet, col, row, paidSessionsCount, sessionType, hasPaidOneOnOne) {
  const referredBy = referrerNameFor_(sheet, col, row);
  if (!referredBy) return;

  const lastRow = sheet.getLastRow();
  const names = col.name >= 0 && lastRow >= 2
    ? sheet.getRange(2, col.name + 1, lastRow - 1, 1).getValues().flat()
    : [];
  const referrerRowOffset = names.findIndex(
    (n) => String(n || "").trim().toLowerCase() === referredBy.toLowerCase()
  );
  const referrerIsClient = referrerRowOffset >= 0;
  const referrerRow = referrerIsClient ? referrerRowOffset + 2 : -1;

  if (paidSessionsCount === 3 && REFERRALS_SHEET_GID) {
    incrementClientsReferred_(referredBy);
  }

  const starred = referrerIsClient && col.paidInClasses >= 0
    ? String(sheet.getRange(referrerRow, col.paidInClasses + 1).getValue() || "").trim().toLowerCase() === "y"
    : false;

  if (starred) {
    if (hasPaidOneOnOne && paidSessionsCount % 2 === 1 && col.groupSessions >= 0) {
      const cell = sheet.getRange(referrerRow, col.groupSessions + 1);
      cell.setValue((Number(cell.getValue()) || 0) + 1);
    }
    return;
  }

  let tokensEarned = 0;
  if (paidSessionsCount === 3) tokensEarned = 20;
  else if (paidSessionsCount > 3 && sessionType === "one-on-one") tokensEarned = 5;
  if (tokensEarned <= 0) return;

  if (referrerIsClient && col.tokensOwed >= 0) {
    const cell = sheet.getRange(referrerRow, col.tokensOwed + 1);
    cell.setValue((Number(cell.getValue()) || 0) + tokensEarned);
  } else if (!referrerIsClient && REFERRALS_SHEET_GID) {
    creditReferralTokens_(referredBy, tokensEarned);
  }
}

/** Finds a friend's row in the Referrals tab. Returns null if the tab, the friend, or a needed column isn't there. */
function findReferralsRow_(friendName, columnNames) {
  // A missing or renamed Refferals tab shouldn't stop a client referrer being paid.
  let refSheet;
  try {
    refSheet = getSheetByGid_(REFERRALS_SHEET_GID);
  } catch (err) {
    return null;
  }
  const refHeader = refSheet.getRange(1, 1, 1, refSheet.getLastColumn()).getValues()[0];
  const rCol = { friendName: findColumn_(refHeader, "Friend Name") };
  for (const name of columnNames) rCol[name] = findColumn_(refHeader, name);
  if (rCol.friendName < 0) return null;

  const lastRow = refSheet.getLastRow();
  if (lastRow < 2) return null;
  const names = refSheet.getRange(2, rCol.friendName + 1, lastRow - 1, 1).getValues().flat();
  const idx = names.findIndex((n) => String(n || "").trim().toLowerCase() === friendName.toLowerCase());
  if (idx < 0) return null;

  return { sheet: refSheet, col: rCol, row: idx + 2 };
}

// ---- Referral payout when Paid Sessions is edited BY HAND ------------------
//
// The payout above used to run only inside a check-in scan. These let it
// happen off a hand-typed Paid Sessions number too, so a client who was
// marked up by hand (or never scanned) still earns their referrer the same
// tokens. Two helper columns are involved, both created on demand:
//   "Referral Sessions Counted" (Sessions Remaining) — the highest paid-session
//     count already run through the payout for that client. It's what stops
//     any session being paid for twice: correcting 5 -> 4 -> 5 by hand, or a
//     check-in followed by a manual edit, only ever pays for counts above it.
//   "Referred Clients" (Refferals tab, and optionally Sessions Remaining) — a
//     referrer's row can list the unique codes of the clients they referred.

const REFERRAL_COUNTER_COLUMN = "Referral Sessions Counted";
const REFERRED_CLIENTS_COLUMN = "Referred Clients";

// A hand edit that raises Paid Sessions by more than this in one go is far
// more likely a typo (30 for 3) than a real catch-up, and paying 155 tokens
// for a slip of the finger isn't something to do silently.
const MAX_MANUAL_CATCH_UP = 10;

function sessionsReferralColumns_(header) {
  return {
    name: findColumn_(header, "Name"),
    paidSessions: findColumn_(header, "Paid Sessions"),
    hasPaidOneOnOne: findColumn_(header, "Has Paid 1-on-1"),
    referredBy: findColumn_(header, "Referred By"),
    groupSessions: findColumn_(header, "Group Sessions Remaining"),
    paidInClasses: findColumn_(header, "Paid In Classes"),
    tokensOwed: findColumn_(header, "Tokens Owed"),
    checkInToken: findColumn_(header, "Check-in Token"),
    counter: findColumn_(header, REFERRAL_COUNTER_COLUMN),
  };
}

/** A cell's value as a whole number of sessions — blank, text and negatives all count as 0. */
function toSessionCount_(value) {
  const n = Number(String(value == null ? "" : value).trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Runs by itself whenever the spreadsheet is edited by hand — a "simple
 * trigger", so there's nothing to set up: it works as soon as this code is
 * saved in the Apps Script project. (It does not fire for changes the
 * check-in script itself makes, which already run the payout directly.)
 *
 * Only a single-cell edit to Paid Sessions on Sessions Remaining does
 * anything. Pastes and fills across several cells are ignored on purpose —
 * with no per-cell "before" value there's no safe way to tell what changed.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const range = e.range;
    const sheet = range.getSheet();
    if (sheet.getSheetId() !== SESSIONS_SHEET_GID) return;
    if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) return;
    const row = range.getRow();
    if (row < 2) return;

    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const paidCol = findColumn_(header, "Paid Sessions");
    if (paidCol < 0 || range.getColumn() - 1 !== paidCol) return;

    const oldCount = toSessionCount_(e.oldValue);
    const newCount = toSessionCount_(range.getValue());

    // Take the same lock check-ins use, so a hand edit can't interleave with a
    // scan. If a lock isn't available to a simple trigger (or is busy for 10s),
    // carry on without one — a missed payout is worse than a tiny race.
    let lock = null;
    let locked = false;
    try {
      lock = LockService.getScriptLock();
      lock.waitLock(10000);
      locked = true;
    } catch (err) {
      locked = false;
    }
    try {
      applyPaidSessionsEdit_(sheet, row, oldCount, newCount, range);
    } finally {
      if (locked) {
        try {
          lock.releaseLock();
        } catch (err) {
          // Already released — nothing to do.
        }
      }
    }
  } catch (err) {
    Logger.log("Referral payout after a manual edit failed: " + err);
  }
}

/**
 * Pays the referrer for every paid session above what's already been counted
 * for this client, one session at a time so each threshold (the 3rd = 20
 * tokens, every later one = 5) lands exactly once — the same rules as a
 * check-in. A hand edit can't say whether a session was a group class or a
 * 1-on-1, so each one past the 3rd is treated as earning the 5.
 *
 * The first time a client is seen here their counter is blank; it's taken to
 * be whatever the cell held BEFORE this edit, on the basis that everything up
 * to then was already handled by check-ins. That's what keeps clients who
 * already have paid sessions from being paid for them all over again.
 */
function applyPaidSessionsEdit_(sheet, row, oldCount, newCount, editedRange) {
  const header = ensureColumns_(sheet, [REFERRAL_COUNTER_COLUMN]);
  const col = sessionsReferralColumns_(header);
  const counterCell = sheet.getRange(row, col.counter + 1);
  const rawValue = counterCell.getValue();
  const rawCounter = rawValue === "" || rawValue == null ? "" : String(rawValue).trim();
  const counted = rawCounter !== "" && Number.isFinite(Number(rawCounter)) ? Number(rawCounter) : oldCount;

  if (newCount > counted) {
    if (newCount - counted > MAX_MANUAL_CATCH_UP) {
      // Pay nothing. A blank counter is pinned to the value from BEFORE this
      // edit, otherwise the correction that follows (30 -> 3) would be measured
      // against the typo and never pay. A counter that already has a value is
      // left alone, so the corrected number picks up from where it should.
      if (rawCounter === "") counterCell.setValue(counted);
      if (editedRange && editedRange.setNote) {
        editedRange.setNote("Referral payout skipped: Paid Sessions jumped by more than " + MAX_MANUAL_CATCH_UP
          + " in one edit, which looks like a typo. Fix the number, or set '" + REFERRAL_COUNTER_COLUMN + "' by hand if it's right.");
      }
      return;
    }
    const hasPaidOneOnOne = col.hasPaidOneOnOne >= 0
      && String(sheet.getRange(row, col.hasPaidOneOnOne + 1).getValue() || "").trim().toLowerCase() === "y";
    for (let k = counted + 1; k <= newCount; k++) {
      maybeApplyReferralBonus_(sheet, col, row, k, "one-on-one", hasPaidOneOnOne);
    }
  }

  const target = Math.max(counted, newCount);
  if (rawCounter === "" || target !== counted) counterCell.setValue(target);
}

/** Called after a check-in has run the payout, so a later manual edit only pays for sessions beyond this one. */
function markReferralCounted_(sheet, row, count) {
  const header = ensureColumns_(sheet, [REFERRAL_COUNTER_COLUMN]);
  const counterCol = findColumn_(header, REFERRAL_COUNTER_COLUMN);
  const cell = sheet.getRange(row, counterCol + 1);
  const raw = cell.getValue();
  const current = raw === "" || raw == null ? 0 : Number(raw);
  if (!Number.isFinite(current) || count > current) cell.setValue(count);
}

/**
 * Works out WHO referred the client on `row`, as a name the payout can look
 * up (a client's Name, or a friend's name on the Refferals tab):
 *   1. Whatever's typed in the client's "Referred By" — a name as before, or
 *      the referrer's Referral Code, or a client's own unique check-in code.
 *   2. If that's blank: the referrer whose row lists this client's unique
 *      code under "Referred Clients".
 */
function referrerNameFor_(sheet, col, row) {
  const typed = col.referredBy >= 0
    ? String(sheet.getRange(row, col.referredBy + 1).getValue() || "").trim()
    : "";
  if (typed) return resolveReferrerText_(sheet, col, typed);

  const token = col.checkInToken >= 0
    ? String(sheet.getRange(row, col.checkInToken + 1).getValue() || "").trim()
    : "";
  return token ? findReferrerListingCode_(token) : "";
}

/** Turns what was typed in "Referred By" into a referrer's name. Anything that isn't a recognised code is assumed to be a name already. */
function resolveReferrerText_(sheet, col, text) {
  const wanted = text.toLowerCase();
  const lastRow = sheet.getLastRow();
  const names = col.name >= 0 && lastRow >= 2
    ? sheet.getRange(2, col.name + 1, lastRow - 1, 1).getValues().flat()
    : [];

  // A client's name — the way it has always worked.
  if (names.some((n) => String(n || "").trim().toLowerCase() === wanted)) return text;

  // A Referral Code from the Refferals tab.
  const byCode = findReferrerNameByCode_(text);
  if (byCode) return byCode;

  // A client's own unique code.
  if (col.checkInToken >= 0 && lastRow >= 2) {
    const tokens = sheet.getRange(2, col.checkInToken + 1, lastRow - 1, 1).getValues().flat();
    const idx = tokens.findIndex((t) => String(t || "").trim().toLowerCase() === wanted);
    if (idx >= 0 && String(names[idx] || "").trim()) return String(names[idx]).trim();
  }
  return text;
}

/** The friend on the Refferals tab whose Referral Code is `code`, or "". */
function findReferrerNameByCode_(code) {
  let refSheet;
  try {
    refSheet = getSheetByGid_(REFERRALS_SHEET_GID);
  } catch (err) {
    return "";
  }
  const lastRow = refSheet.getLastRow();
  const lastCol = refSheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return "";
  const header = refSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const codeCol = findColumn_(header, "Referral Code");
  const nameCol = findColumn_(header, "Friend Name");
  if (codeCol < 0 || nameCol < 0) return "";

  const wanted = code.toLowerCase();
  const values = refSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (const r of values) {
    if (String(r[codeCol] || "").trim().toLowerCase() === wanted) return String(r[nameCol] || "").trim();
  }
  return "";
}

/** The referrer (on the Refferals tab, else Sessions Remaining) whose "Referred Clients" cell contains this unique code, or "". */
function findReferrerListingCode_(code) {
  if (code.length < 8) return ""; // a fragment this short could match by accident
  const wanted = code.toLowerCase();
  const candidates = [];
  try {
    candidates.push([getSheetByGid_(REFERRALS_SHEET_GID), "Friend Name"]);
  } catch (err) {
    // No Refferals tab — Sessions Remaining is still checked below.
  }
  try {
    candidates.push([getSheetByGid_(SESSIONS_SHEET_GID), "Name"]);
  } catch (err) {
    // Nothing else to check.
  }

  for (const [sheet, nameHeader] of candidates) {
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;
    const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const listCol = findColumn_(header, REFERRED_CLIENTS_COLUMN);
    const nameCol = findColumn_(header, nameHeader);
    if (listCol < 0 || nameCol < 0) continue;

    const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (const r of values) {
      if (String(r[listCol] || "").toLowerCase().indexOf(wanted) >= 0) {
        const name = String(r[nameCol] || "").trim();
        if (name) return name;
      }
    }
  }
  return "";
}

/**
 * Optional one-time helper — run manually from the Apps Script editor. Adds
 * the helper columns the manual referral payout uses ("Referral Sessions
 * Counted" on Sessions Remaining; "Referred Clients" on the Refferals tab and
 * on Sessions Remaining) and sets every existing client's counter to their
 * current Paid Sessions, so nothing already handled can ever be paid twice.
 * The payout works without running this — it creates what it needs the first
 * time it fires — but this is the way to get the "Referred Clients" column
 * to exist so you can start pasting codes into it. Safe to re-run.
 */
function setupReferralTracking() {
  const sessions = getSheetByGid_(SESSIONS_SHEET_GID);
  const header = ensureColumns_(sessions, [REFERRAL_COUNTER_COLUMN, REFERRED_CLIENTS_COLUMN]);
  const col = sessionsReferralColumns_(header);
  const lastRow = sessions.getLastRow();
  if (lastRow >= 2 && col.paidSessions >= 0) {
    const paid = sessions.getRange(2, col.paidSessions + 1, lastRow - 1, 1).getValues();
    const counters = sessions.getRange(2, col.counter + 1, lastRow - 1, 1).getValues();
    const filled = counters.map((c, i) => (c[0] === "" || c[0] == null ? [toSessionCount_(paid[i][0])] : [c[0]]));
    sessions.getRange(2, col.counter + 1, lastRow - 1, 1).setValues(filled);
  }
  try {
    ensureColumns_(getSheetByGid_(REFERRALS_SHEET_GID), [REFERRED_CLIENTS_COLUMN]);
  } catch (err) {
    Logger.log("No Refferals tab found — skipped its Referred Clients column.");
  }
  Logger.log("Referral tracking ready.");
}

/**
 * Coach builder (workout/builder.html) saving one named workout for a
 * client — e.g. a client on a push/pull/legs split has three separate rows
 * of these, "Push", "Pull", "Legs", each with its own exercise list. Keyed
 * on (client, workout name) together, so saving "Push" never touches that
 * same client's "Pull" or "Legs" rows — only replaces the one named
 * workout being edited, outright rather than versioning it.
 *
 * PIN-gated — this is the one write path in the whole workout feature that
 * isn't link-only, since it can rewrite any client's assigned exercises.
 */
function handleAssignWorkout_(payload) {
  if (!checkPin_(payload.pin)) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const clientSlug = String(payload.clientSlug || "").trim().toLowerCase();
  const workoutName = String(payload.workoutName || "").trim();
  const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];
  const days = Array.isArray(payload.days) ? payload.days.map((d) => String(d).trim()).filter(Boolean) : [];
  const workoutNote = cleanNote_(payload.workoutNote, 1000);
  if (!clientSlug || !workoutName || !exercises.length) {
    return jsonResponse_({ status: "error", message: "Missing client, workout name, or exercises." });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WORKOUT_EXERCISES_SHEET_NAME);
  if (!sheet) {
    return jsonResponse_({ status: "error", message: "Run setupWorkoutSheets first." });
  }

  const lastRow = sheet.getLastRow();
  const header = ensureWorkoutExercisesColumns_(sheet);
  const col = {
    client: findColumn_(header, "Client"),
    workoutName: findColumn_(header, "Workout Name"),
    order: findColumn_(header, "Order"),
    exercise: findColumn_(header, "Exercise"),
    sets: findColumn_(header, "Target Sets"),
    reps: findColumn_(header, "Target Reps"),
    days: findColumn_(header, "Days"),
    workoutOrder: findColumn_(header, "Workout Order"),
    exerciseNotes: findColumn_(header, "Exercise Notes"),
    workoutNotes: findColumn_(header, "Workout Notes"),
  };

  // A resave keeps this workout's existing position in the chip/picker
  // order; a genuinely new workout goes on the end (one past whatever the
  // client's highest workout order currently is), rather than defaulting
  // to 0 and jumping to the front.
  let existingWorkoutOrder = null;
  let maxWorkoutOrder = -1;
  if (col.workoutOrder >= 0 && lastRow >= 2) {
    const allRows = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
    for (const r of allRows) {
      if (String(r[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
      const orderVal = Number(r[col.workoutOrder]);
      if (Number.isFinite(orderVal) && orderVal > maxWorkoutOrder) maxWorkoutOrder = orderVal;
      if (existingWorkoutOrder === null && Number.isFinite(orderVal) && String(r[col.workoutName] || "").trim() === workoutName) {
        existingWorkoutOrder = orderVal;
      }
    }
  }
  const workoutOrderValue = existingWorkoutOrder !== null ? existingWorkoutOrder : maxWorkoutOrder + 1;

  deleteMatchingRows_(sheet, lastRow, col.client, clientSlug, col.workoutName, workoutName);

  // The same Days/Workout Order values are repeated on every exercise row
  // of this workout — matches the existing pattern (Workout Name is
  // repeated the same way) rather than needing a separate one-row-per-
  // workout summary tab.
  const daysStr = days.join(",");

  const newRows = exercises.map((ex, i) => {
    const row = new Array(header.length).fill("");
    row[col.client] = clientSlug;
    row[col.workoutName] = workoutName;
    row[col.order] = i + 1;
    row[col.exercise] = String((ex && ex.name) || "").trim();
    row[col.sets] = Number(ex && ex.sets) || 0;
    row[col.reps] = String((ex && ex.reps) || "").trim();
    if (col.days >= 0) row[col.days] = daysStr;
    if (col.workoutOrder >= 0) row[col.workoutOrder] = workoutOrderValue;
    // The workout-level note is repeated on every row, same as Days.
    row[col.exerciseNotes] = cleanNote_(ex && ex.note, 300);
    row[col.workoutNotes] = workoutNote;
    return row;
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, header.length).setValues(newRows);

  // notesSupported lets the builder tell a deployment that stored the tips
  // from an older one that would have quietly ignored them.
  return jsonResponse_({ status: "success", notesSupported: true });
}

/**
 * Persists the order the coach dragged a client's workout chips into —
 * every row of each named workout gets that workout's new index written
 * to "Workout Order", so the client card and picker (and the builder's own
 * chips, next time they're loaded) all show them in the same order.
 */
function handleReorderWorkouts_(payload) {
  if (!checkPin_(payload.pin)) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const clientSlug = String(payload.clientSlug || "").trim().toLowerCase();
  const order = Array.isArray(payload.order) ? payload.order.map((n) => String(n).trim()).filter(Boolean) : [];
  if (!clientSlug || !order.length) {
    return jsonResponse_({ status: "error", message: "Missing client or order." });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WORKOUT_EXERCISES_SHEET_NAME);
  if (!sheet) {
    return jsonResponse_({ status: "error", message: "Run setupWorkoutSheets first." });
  }

  const lastRow = sheet.getLastRow();
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = {
    client: findColumn_(header, "Client"),
    workoutName: findColumn_(header, "Workout Name"),
    workoutOrder: findColumn_(header, "Workout Order"),
  };
  if (col.workoutOrder < 0) {
    return jsonResponse_({ status: "error", message: "Run addWorkoutOrderColumnToWorkoutExercises first." });
  }
  if (lastRow < 2) {
    return jsonResponse_({ status: "success" });
  }

  const orderIndex = {};
  order.forEach((name, i) => {
    orderIndex[name.toLowerCase()] = i;
  });

  const values = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (String(row[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
    const idx = orderIndex[String(row[col.workoutName] || "").trim().toLowerCase()];
    if (idx === undefined) continue;
    sheet.getRange(i + 2, col.workoutOrder + 1).setValue(idx);
  }

  return jsonResponse_({ status: "success" });
}

/**
 * Deletes the given 1-based sheet rows (ascending order). Every Sheets call
 * is its own round trip and that's what makes a save slow — deleting a
 * 25-set session one row at a time was ~25 of them — so each contiguous run
 * of rows goes in a single deleteRows call instead. Bottom-up, so removing a
 * run never shifts the row numbers of the runs still waiting above it.
 */
function deleteRowNumbers_(sheet, rowNumbers) {
  let runEnd = rowNumbers.length - 1;
  while (runEnd >= 0) {
    let runStart = runEnd;
    while (runStart > 0 && rowNumbers[runStart - 1] === rowNumbers[runStart] - 1) runStart--;
    const firstRow = rowNumbers[runStart];
    const count = runEnd - runStart + 1;
    try {
      sheet.deleteRows(firstRow, count);
    } catch (err) {
      // Sheets refuses to delete every non-frozen row on a tab (these tabs
      // freeze their header). That only happens when the rows being removed
      // are ALL the data there is, so blanking them is equivalent — the
      // next append reuses the space, and readers skip rows with no client.
      sheet.getRange(firstRow, 1, count, sheet.getMaxColumns()).clearContent();
    }
    runEnd = runStart - 1;
  }
}

/**
 * Deletes every row where column `matchCol` equals `matchValue` (case-
 * insensitive) and, if `matchCol2` >= 0, column `matchCol2` also equals
 * `matchValue2`.
 */
function deleteMatchingRows_(sheet, lastRow, matchCol, matchValue, matchCol2, matchValue2) {
  if (lastRow < 2) return;
  const numCols = sheet.getLastColumn();
  const values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const matchingRows = [];
  for (let i = 0; i < values.length; i++) {
    const matches1 = String(values[i][matchCol] || "").trim().toLowerCase() === matchValue;
    const matches2 = matchCol2 < 0 || String(values[i][matchCol2] || "").trim().toLowerCase() === matchValue2.toLowerCase();
    if (matches1 && matches2) matchingRows.push(i + 2);
  }
  deleteRowNumbers_(sheet, matchingRows);
}

/**
 * Removes one named workout entirely — the builder's "Delete this workout"
 * button. PIN-gated for the same reason as assigning one.
 */
function handleDeleteWorkout_(payload) {
  if (!checkPin_(payload.pin)) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const clientSlug = String(payload.clientSlug || "").trim().toLowerCase();
  const workoutName = String(payload.workoutName || "").trim();
  if (!clientSlug || !workoutName) {
    return jsonResponse_({ status: "error", message: "Missing client or workout name." });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WORKOUT_EXERCISES_SHEET_NAME);
  if (!sheet) {
    return jsonResponse_({ status: "error", message: "Run setupWorkoutSheets first." });
  }

  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = {
    client: findColumn_(header, "Client"),
    workoutName: findColumn_(header, "Workout Name"),
  };
  deleteMatchingRows_(sheet, sheet.getLastRow(), col.client, clientSlug, col.workoutName, workoutName);

  return jsonResponse_({ status: "success" });
}

/**
 * Makes sure the Logged Sets tab has every column the current code reads and
 * writes, adding any that are missing at the end of the header (everything
 * looks columns up by NAME, so where they sit doesn't matter).
 *
 * The live tab was created before "Workout Name" and "Notes" existed, and
 * setupWorkoutSheets only creates a tab that's missing entirely — it never
 * adds columns to one that's already there. Without them, every save
 * silently dropped the session notes, and there was no workout name on any
 * row to tell one workout's sets from another's, so replacing a session
 * could never find the rows it was meant to replace. Doing this on demand
 * means no manual migration step to remember.
 */
function ensureLoggedSetsColumns_(sheet) {
  return ensureColumns_(sheet, ["Workout Name", "Notes"]);
}

/**
 * Same idea for the Workout Exercises tab: the coach's per-exercise tips
 * ("Exercise Notes") and the note shown at the top of a workout ("Workout
 * Notes"). Older tabs don't have them, so they're added the first time a
 * workout is saved rather than needing a manual migration.
 */
function ensureWorkoutExercisesColumns_(sheet) {
  return ensureColumns_(sheet, ["Exercise Notes", "Workout Notes"]);
}

/** Adds any of `names` that are missing from the sheet's header row (at the end — everything looks columns up by NAME, so position doesn't matter) and returns the up-to-date header. */
function ensureColumns_(sheet, names) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (const name of names) {
    if (findColumn_(header, name) >= 0) continue;
    if (sheet.getMaxColumns() < header.length + 1) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), header.length + 1 - sheet.getMaxColumns());
    }
    sheet.getRange(1, header.length + 1).setValue(name);
    header.push(name);
  }
  return header;
}

/**
 * Coach-typed text (an exercise tip, a workout note) made safe to store in a
 * cell: line endings normalised, trimmed, capped at maxLen. Sheets reads
 * anything starting with = + - or @ as a formula rather than text, so those
 * get a leading apostrophe, which forces plain text (and isn't stored).
 */
function cleanNote_(value, maxLen) {
  const text = String(value == null ? "" : value).replace(/\r\n?/g, "\n").trim().slice(0, maxLen);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

/**
 * A "Date" cell as "yyyy-MM-dd". The column holds real dates, not text —
 * Sheets turns "2026-09-16" into a date the moment it's written — so
 * getValues() hands back Date objects, and comparing String(thatDate) to
 * "2026-09-16" can never be equal. That mismatch is why a re-save used to
 * pile a second copy of the session on top of the first instead of
 * replacing it. Date cells are read in the spreadsheet's own time zone,
 * which is what they were interpreted in when written.
 */
function dateCellToString_(value, spreadsheetTimeZone) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, spreadsheetTimeZone, "yyyy-MM-dd");
  }
  const text = String(value || "").trim();
  const m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : text;
}

/**
 * The workout logger saving a session — "Log Workout" on workout/index.html —
 * and also the endpoint the workout-history editor (calendar.html) uses to
 * auto-save edits to a PAST day: same shape, plus an explicit `date`.
 * Deliberately no PIN, same link-only trust model as the rest of the
 * client-facing card.
 *
 * Replaces the whole saved session for this (client, workout, date) rather
 * than patching individual rows: the caller always submits the complete
 * current state, so swapping whatever was there for a fresh copy is both
 * simpler and far faster than hunting down and rewriting matching rows one
 * at a time. `sets` may legitimately be empty — that's how the history
 * editor clears a day down to nothing (e.g. removing its last exercise).
 * Other days/workouts are never touched. Rows logged before the Workout
 * Name column existed have it blank; there's no telling which workout they
 * were, so they count as part of whichever session is replacing that day.
 *
 * The new rows are appended BEFORE the old ones are deleted, so a failure
 * part-way through leaves a duplicate that the next save cleans up, rather
 * than a session that has vanished.
 *
 * The lookup for "does this day's row already exist" only scans the last
 * MAX_SCAN_ROWS of the sheet when saving TODAY — since new saves are always
 * appended at the bottom, today's own rows (if any exist from an earlier
 * save today) are always near the current end, no matter how many months
 * of history sit above them. That bound would be wrong for an edit to an
 * OLDER date though — those rows are NOT near the end, they're wherever
 * they were originally appended — so a historical edit (date != today)
 * scans the whole sheet instead. Slower, but correctness matters more than
 * speed for what's a rare, manual action, and skipping the bound entirely
 * for a past-date edit would otherwise leave the original rows in place
 * untouched while the "edit" just appends a duplicate copy alongside them.
 */
function handleSaveWorkoutSession_(payload) {
  const clientSlug = String(payload.clientSlug || "").trim().toLowerCase();
  const workoutName = String(payload.workoutName || "").trim();
  const sets = Array.isArray(payload.sets) ? payload.sets : [];
  const notes = String(payload.notes || "").trim();
  if (!clientSlug || !workoutName) {
    return jsonResponse_({ status: "error", message: "Missing client or workout name." });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(LOGGED_SETS_SHEET_NAME);
  if (!sheet) {
    return jsonResponse_({ status: "error", message: "Run setupWorkoutSheets first." });
  }

  const header = ensureLoggedSetsColumns_(sheet);
  const col = {
    client: findColumn_(header, "Client"),
    workoutName: findColumn_(header, "Workout Name"),
    exercise: findColumn_(header, "Exercise"),
    setNumber: findColumn_(header, "Set Number"),
    weight: findColumn_(header, "Weight (kg)"),
    reps: findColumn_(header, "Reps"),
    date: findColumn_(header, "Date"),
    timestamp: findColumn_(header, "Timestamp"),
    notes: findColumn_(header, "Notes"),
  };

  const now = new Date();
  const todayStr = Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd");
  const requestedDate = String(payload.date || "").trim();
  const isPastDateEdit = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate !== todayStr;
  const targetDateStr = isPastDateEdit ? requestedDate : todayStr;

  const lastRow = sheet.getLastRow();
  let scanStart, scanCount;
  if (isPastDateEdit) {
    scanStart = 2;
    scanCount = Math.max(lastRow - 1, 0);
  } else {
    const MAX_SCAN_ROWS = 1000;
    scanCount = Math.min(lastRow - 1, MAX_SCAN_ROWS);
    scanStart = lastRow - scanCount + 1;
  }
  const existing = scanCount > 0 ? sheet.getRange(scanStart, 1, scanCount, header.length).getValues() : [];

  const spreadsheetTimeZone = ss.getSpreadsheetTimeZone();
  const wantedWorkout = workoutName.toLowerCase();
  const oldRows = [];
  for (let i = 0; i < existing.length; i++) {
    const r = existing[i];
    if (dateCellToString_(r[col.date], spreadsheetTimeZone) !== targetDateStr) continue;
    if (String(r[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
    const rowWorkout = String(r[col.workoutName] || "").trim().toLowerCase();
    if (rowWorkout && rowWorkout !== wantedWorkout) continue;
    oldRows.push(scanStart + i);
  }

  const newRows = [];
  for (const s of sets) {
    const exercise = String(s.exercise || "").trim();
    const setNumber = Number(s.setNumber);
    const weight = Number(s.weight);
    const reps = Number(s.reps);
    if (!exercise || !Number.isFinite(setNumber) || !Number.isFinite(weight) || !Number.isFinite(reps)) continue;

    const rowValues = new Array(header.length).fill("");
    rowValues[col.client] = clientSlug;
    rowValues[col.workoutName] = workoutName;
    rowValues[col.exercise] = exercise;
    rowValues[col.setNumber] = setNumber;
    rowValues[col.weight] = weight;
    rowValues[col.reps] = reps;
    rowValues[col.date] = targetDateStr;
    rowValues[col.timestamp] = now;
    // Repeated on every row of this save, same as Workout Name — a session
    // note isn't per-set, but there's no separate per-session tab, so it
    // rides along on each of that session's own rows instead.
    rowValues[col.notes] = notes;
    newRows.push(rowValues);
  }

  if (newRows.length) {
    sheet.getRange(lastRow + 1, 1, newRows.length, header.length).setValues(newRows);
  }
  deleteRowNumbers_(sheet, oldRows);

  return jsonResponse_({ status: "success" });
}

function handleCheckGroceryCode_(payload) {
  if (!checkGroceryCode_(payload.code)) {
    return jsonResponse_({ status: "unauthorized" });
  }
  return jsonResponse_({ status: "success" });
}

function handleAddGroceryItem_(payload) {
  if (!checkGroceryCode_(payload.code)) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const surname = String(payload.surname || "").trim();
  const item = String(payload.item || "").trim();
  if (!surname || !item) {
    return jsonResponse_({ status: "error", message: "Missing surname or item." });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GROCERY_SHEET_NAME);
  if (!sheet) {
    return jsonResponse_({ status: "error", message: "Run setupGrocerySheet first." });
  }

  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = {
    id: findColumn_(header, "ID"),
    surname: findColumn_(header, "Surname"),
    item: findColumn_(header, "Item"),
    addedAt: findColumn_(header, "Added At"),
  };

  const id = Utilities.getUuid();
  const newRow = new Array(header.length).fill("");
  if (col.id >= 0) newRow[col.id] = id;
  if (col.surname >= 0) newRow[col.surname] = surname;
  if (col.item >= 0) newRow[col.item] = item;
  if (col.addedAt >= 0) newRow[col.addedAt] = new Date();
  sheet.appendRow(newRow);

  return jsonResponse_({ status: "success", id });
}

/** Double-tap/double-click removal on the client side lands here — deletes the row outright rather than marking it done, matching the brief. */
function handleDeleteGroceryItem_(payload) {
  if (!checkGroceryCode_(payload.code)) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const id = String(payload.id || "").trim().toLowerCase();
  if (!id) {
    return jsonResponse_({ status: "error", message: "Missing id." });
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GROCERY_SHEET_NAME);
  if (!sheet) {
    return jsonResponse_({ status: "error", message: "Run setupGrocerySheet first." });
  }

  const lastRow = sheet.getLastRow();
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idCol = findColumn_(header, "ID");
  deleteMatchingRows_(sheet, lastRow, idCol, id, -1, "");

  return jsonResponse_({ status: "success" });
}

function creditReferralTokens_(friendName, amount) {
  const found = findReferralsRow_(friendName, ["Tokens Owed"]);
  if (!found || found.col["Tokens Owed"] < 0) return;

  const cell = found.sheet.getRange(found.row, found.col["Tokens Owed"] + 1);
  const current = Number(String(cell.getValue() || "").replace(/[^0-9.]/g, "")) || 0;
  cell.setValue(current + amount);
}

function incrementClientsReferred_(friendName) {
  const found = findReferralsRow_(friendName, ["Clients Referred"]);
  if (!found || found.col["Clients Referred"] < 0) return;

  const cell = found.sheet.getRange(found.row, found.col["Clients Referred"] + 1);
  const current = Number(cell.getValue()) || 0;
  cell.setValue(current + 1);
}

// ===========================================================================
// 1-ON-1 BOOKING — clients book from their membership card (card/book.html)
// ===========================================================================
//
// The bookings live in a SEPARATE, PRIVATE Google Sheet ("MaxFit Bookings")
// that setupBooking() creates — not in the CRM. The CRM is shared "Anyone with
// the link" and the pages read it directly, so a Bookings tab there would show
// every client's name and session times to anyone holding the sheet id (which
// is in this public repo). The card never reads the booking sheet: it asks this
// script, which only ever hands a client their OWN bookings plus anonymous free
// times.
//
// Tabs in that sheet:
//   Availability  Max's weekly 1-on-1 hours. Edited by hand.
//   Time Off      Days Max is away. Edited by hand.
//   Settings      Notice and cancellation rules, who gets emailed, how clients
//                 message Max, and whether a booking code is required.
//   Clients       Each client's personal booking code, with a ready-made text
//                 to send them. issueBookingCodes() fills it in.
//   Bookings      One row per booking. This script writes it; Max can change a
//                 Status to Cancelled to free a slot.
//   Upcoming      A read-only list of what's coming up (a formula).
//
// A time is only offered if it sits on the grid an Availability row generates,
// isn't inside Time Off, isn't too soon or too far ahead, and doesn't overlap an
// active booking. Booking re-checks all of that under the script lock, so two
// people can't take the same time. Booking doesn't use up a session — that still
// happens at check-in — but a client can't hold more bookings than they have
// sessions left (Settings can switch that off).
//
// WHO IS ASKING. A client's slug and Check-in Token are both readable in the
// public CRM, so they prove nothing. Instead each client gets a personal
// booking code that lives only in the private Clients tab; Max texts it to
// them and they type it once per phone. Five wrong codes for one slug locks
// that slug out for 15 minutes (CacheService). Settings > "Require booking
// code" = No goes back to slug + Check-in Token for anyone who wants that.

const BOOKING_SHEET_ID_PROPERTY = "BOOKING_SHEET_ID";
const BOOKING_SELFTEST_SHEET_ID_PROPERTY = "BOOKING_SELFTEST_SHEET_ID";
const BOOKING_SHEET_TITLE = "MaxFit Bookings";
const BOOKING_NOTIFY_DEFAULT = "max.french28@gmail.com";
const BOOKING_DEFAULT_MINUTES = 45;

// No I, L, O, 0 or 1, so a code is easy to read out and to type.
const BOOKING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const BOOKING_CODE_LENGTH = 6;
const BOOKING_MAX_WRONG_CODES = 5;
const BOOKING_LOCKOUT_SECONDS = 900;

const BOOKING_TABS = {
  availability: "Availability",
  timeOff: "Time Off",
  settings: "Settings",
  clients: "Clients",
  bookings: "Bookings",
  upcoming: "Upcoming",
};
const BOOKING_AVAILABILITY_HEADER = ["On", "Day", "Start", "End", "Session Minutes", "Buffer Minutes"];
const BOOKING_TIME_OFF_HEADER = ["From", "To", "Note"];
const BOOKING_SETTINGS_HEADER = ["Setting", "Value", "What it does"];
const BOOKING_CLIENTS_HEADER = ["Name", "Slug", "Booking Code", "Text to send"];
const BOOKINGS_HEADER = ["Booking ID", "Date", "Start", "End", "Minutes", "Client", "Client Slug", "Status", "Booked At", "Cancelled At"];
const BOOKING_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// The Settings tab starts with these rows; a re-run of setupBooking() adds any that are missing.
const BOOKING_SETTING_DEFAULTS = [
  ["Notify email", BOOKING_NOTIFY_DEFAULT, "Who is emailed for every booking and cancellation. Leave blank for no emails."],
  ["Min notice hours", 12, "Clients can't book a time closer than this."],
  ["Book ahead days", 28, "How far ahead clients can book."],
  ["Cancel notice hours", 24, "Clients can cancel up to this many hours before. After that they have to message you."],
  ["Require session left", "Yes", "Yes: a client needs a 1-on-1 session left (not already booked) to book. No: anyone can book."],
  ["Max active bookings", 6, "The most upcoming bookings one client can hold at once."],
  ["Require booking code", "Yes", "Yes: a client types their personal code (Clients tab) once per phone. No: anyone with a client's card link can book as them."],
  ["Contact link", "", "How clients message you. Put {message} where the ready-typed message goes. WhatsApp: https://wa.me/61400000000?text={message}   Text: sms:+61400000000?&body={message}. Leave blank to hide the Message Max buttons."],
];

// Set only by bookingSelfTest(), and only for that one run: every run of the
// script starts with a fresh copy of this file's globals, so the self-test
// pointing at its scratch sheet can never redirect a real client's request.
let bookingSheetOverride_ = null;

/**
 * One-time helper — run it from the Apps Script editor (pick setupBooking in
 * the toolbar dropdown, then Run). Creates the private "MaxFit Bookings"
 * sheet with its tabs and remembers it, and emails Max the link. Safe to
 * re-run: it only adds what's missing and never touches existing rows.
 */
function setupBooking() {
  let ss = bookingBook_();
  let created = false;
  if (!ss) {
    ss = SpreadsheetApp.create(BOOKING_SHEET_TITLE);
    PropertiesService.getScriptProperties().setProperty(BOOKING_SHEET_ID_PROPERTY, ss.getId());
    ss.getSheets()[0].setName(BOOKING_TABS.availability); // a new sheet starts with one empty tab
    created = true;
  }
  ss.setSpreadsheetTimeZone(TIMEZONE);

  const yesNo = SpreadsheetApp.newDataValidation().requireValueInList(["Yes", "No"], true).setAllowInvalid(true).build();
  const weekdays = SpreadsheetApp.newDataValidation().requireValueInList(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], true).setAllowInvalid(true).build();

  // Every example row starts switched OFF, so nothing is offered to clients
  // until Max has set his real hours and turned rows on.
  const availability = bookingEnsureTab_(ss, BOOKING_TABS.availability, BOOKING_AVAILABILITY_HEADER, [
    ["No", "Mon", "16:00", "19:00", 45, 0],
    ["No", "Tue", "06:00", "09:00", 45, 0],
    ["No", "Wed", "16:00", "19:00", 45, 0],
    ["No", "Thu", "16:00", "19:00", 45, 0],
    ["No", "Sat", "09:00", "11:00", 45, 0],
  ], ["Start", "End"]);
  if (availability.isNew) {
    availability.sheet.getRange(2, 1, 60, 1).setDataValidation(yesNo);
    availability.sheet.getRange(2, 2, 60, 1).setDataValidation(weekdays);
    availability.sheet.setColumnWidth(8, 560);
    availability.sheet.getRange(1, 8, 6, 1).setValues([
      ["How this tab works"],
      ["One row per block of time you take 1-on-1s. Set On to Yes to offer a row to clients (the examples are all No)."],
      ["Day is Mon, Tue, Wed... Start and End can be typed 06:00 or 6:00 AM. Clients can book any slot inside the block."],
      ["Session Minutes is how long each session is (45 if you leave it blank). Buffer Minutes is an optional gap after each one."],
      ["Turn a row off any time by setting On to No. Delete a row to remove it."],
      ["Days you're away go on the Time Off tab."],
    ]);
  }

  const timeOff = bookingEnsureTab_(ss, BOOKING_TABS.timeOff, BOOKING_TIME_OFF_HEADER, [
    ["2026-12-25", "2026-12-26", "Example: Christmas. Change or delete this row."],
  ], ["From", "To"]);
  if (timeOff.isNew) {
    timeOff.sheet.getRange(1, 1).setNote("Type dates like 2026-12-25. Leave To blank for a single day. Clients can't book these days.");
    timeOff.sheet.setColumnWidth(3, 320);
  }

  const settings = bookingEnsureTab_(ss, BOOKING_TABS.settings, BOOKING_SETTINGS_HEADER, BOOKING_SETTING_DEFAULTS, []);
  if (settings.isNew) {
    settings.sheet.setColumnWidth(1, 190);
    settings.sheet.setColumnWidth(2, 220);
    settings.sheet.setColumnWidth(3, 620);
  } else {
    bookingEnsureSettingRows_(settings.sheet); // settings added in a later version
  }

  const clients = bookingEnsureTab_(ss, BOOKING_TABS.clients, BOOKING_CLIENTS_HEADER, [], ["Slug", "Booking Code"]);
  if (clients.isNew) {
    clients.sheet.getRange(1, 3).setNote("Each client's personal booking code. Text it to them: they type it once on each phone. To give someone a new code, clear their cell and run issueBookingCodes.");
    clients.sheet.setColumnWidth(1, 200);
    clients.sheet.setColumnWidth(2, 170);
    clients.sheet.setColumnWidth(3, 120);
    clients.sheet.setColumnWidth(4, 620);
  }

  const bookings = bookingEnsureTab_(ss, BOOKING_TABS.bookings, BOOKINGS_HEADER, [], ["Date", "Start", "End", "Minutes", "Booked At", "Cancelled At"]);
  if (bookings.isNew) {
    bookings.sheet.getRange(1, 8).setNote("Booked = holds the slot. To cancel one yourself, change this to Cancelled. To block a slot, add a row with Status Booked. Keep the first ten columns in this order (the Upcoming tab reads them).");
    bookings.sheet.setColumnWidth(6, 180);
  }

  const upcoming = bookingEnsureTab_(ss, BOOKING_TABS.upcoming, ["Date", "Start", "End", "Minutes", "Client"], [], []);
  if (upcoming.isNew) {
    upcoming.sheet.getRange("A2").setFormula('=IFNA(SORT(FILTER(Bookings!B2:F, Bookings!H2:H="Booked", Bookings!B2:B>=TEXT(TODAY(),"yyyy-mm-dd")), 1, TRUE, 2, TRUE), "Nothing booked yet")');
    upcoming.sheet.setColumnWidth(5, 180);
  }

  // Every client in the CRM gets a personal booking code (existing ones are left alone).
  const codes = issueBookingCodes();

  if (created) {
    try {
      MailApp.sendEmail({
        to: BOOKING_NOTIFY_DEFAULT,
        subject: "Your MaxFit booking sheet is ready",
        body: [
          "Your private booking sheet is ready:",
          ss.getUrl(),
          "",
          "1. Availability tab: set your real 1-on-1 hours, then change On to Yes on the rows you want to offer.",
          "2. Time Off tab: add any days you're away.",
          "3. Settings tab: check the rules, and put your Contact link in so clients can message you from the page.",
          "4. Clients tab: every client has a personal booking code and a ready-made text. Send each client theirs. They type it once on each phone.",
          "5. Back in Apps Script, run bookingSelfTest once. It tries the whole booking flow on real Google and emails you the result.",
          "",
          "Bookings and the Upcoming list fill in here as clients book from their card.",
        ].join("\n"),
      });
    } catch (err) {
      // The link is in the log below either way.
    }
  }
  Logger.log((created ? "Created the booking sheet: " : "Booking sheet is already set up: ") + ss.getUrl());
  Logger.log("Booking codes: " + codes.added + " new, " + codes.filled + " filled in. Next: run bookingSelfTest.");
}

/** Adds any setting from BOOKING_SETTING_DEFAULTS that isn't on the Settings tab yet (matched by name), leaving everything Max has edited alone. */
function bookingEnsureSettingRows_(sheet) {
  const table = bookingTable_(sheet);
  const keyCol = findColumn_(table.header, "Setting");
  if (keyCol < 0) return;
  const have = {};
  table.rows.forEach(function (r) { have[String(r[keyCol]).trim().toLowerCase()] = true; });
  BOOKING_SETTING_DEFAULTS.forEach(function (row) {
    if (have[row[0].toLowerCase()]) return;
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  });
}

/** Gets (or creates) a tab. A NEW tab gets its header, example rows and plain-text columns; an existing one only gets any missing header columns. */
function bookingEnsureTab_(ss, name, header, seedRows, textColumns) {
  let sheet = ss.getSheetByName(name);
  let isNew = false;
  if (!sheet) {
    sheet = ss.insertSheet(name);
    isNew = true;
  } else if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
    isNew = true;
  }
  if (isNew) {
    // Plain text first, so "06:00" and "2026-12-25" stay exactly as written
    // instead of turning into time and date values.
    textColumns.forEach(function (h) {
      const i = header.indexOf(h);
      if (i >= 0) sheet.getRange(2, i + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat("@");
    });
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    if (seedRows.length) sheet.getRange(2, 1, seedRows.length, header.length).setValues(seedRows);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, header.length).setFontWeight("bold");
  } else {
    ensureColumns_(sheet, header);
  }
  return { sheet: sheet, isNew: isNew };
}

/** The private booking spreadsheet, or null if setupBooking() hasn't run (or the sheet was deleted). */
function bookingBook_() {
  if (bookingSheetOverride_) return bookingSheetOverride_;
  const id = PropertiesService.getScriptProperties().getProperty(BOOKING_SHEET_ID_PROPERTY);
  if (!id) return null;
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    return null;
  }
}

// ---- Small pure helpers (no Sheets calls) ---------------------------------

function slugify_(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "Mon", "monday", "TUES" -> 0-6 (Sunday = 0), or -1. */
function bookingParseDay_(text) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(String(text || "").trim().slice(0, 3).toLowerCase());
}

/** "06:00", "6:00 AM", "6am", "18:30", "6:00:00 PM" -> minutes after midnight, or -1. */
function bookingParseTime_(text) {
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\.?m?\.?$/i.exec(String(text == null ? "" : text).trim());
  if (!m) return -1;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const meridiem = (m[3] || "").toLowerCase();
  if (minute > 59) return -1;
  if (meridiem) {
    if (hour < 1 || hour > 12) return -1;
    hour = (hour % 12) + (meridiem === "p" ? 12 : 0);
  } else if (hour > 23) {
    return -1;
  }
  return hour * 60 + minute;
}

/** Minutes after midnight -> "06:30" (how times are stored and sent). */
function bookingFormatMinutes_(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
}

/** Minutes after midnight -> "6:30 AM" (for emails). */
function bookingClock12_(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return ((h % 12) || 12) + ":" + (m < 10 ? "0" : "") + m + " " + (h < 12 ? "AM" : "PM");
}

/** A date typed or displayed in a cell -> "yyyy-MM-dd", or "" if it can't be read. d/M/yyyy is read day-first (Australia). */
function bookingParseDateKey_(text) {
  const s = String(text == null ? "" : text).trim();
  let y;
  let m;
  let d;
  let hit;
  if ((hit = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s))) {
    y = Number(hit[1]); m = Number(hit[2]); d = Number(hit[3]);
  } else if ((hit = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s))) {
    d = Number(hit[1]); m = Number(hit[2]); y = Number(hit[3]);
  } else if ((hit = /^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(s))) {
    d = Number(hit[1]); m = BOOKING_MONTHS.indexOf(hit[2].slice(0, 3).toLowerCase()) + 1; y = Number(hit[3]);
  } else if ((hit = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) {
    m = BOOKING_MONTHS.indexOf(hit[1].slice(0, 3).toLowerCase()) + 1; d = Number(hit[2]); y = Number(hit[3]);
  } else {
    return "";
  }
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return "";
  if (new Date(Date.UTC(y, m - 1, d)).getUTCMonth() !== m - 1) return ""; // 31 Feb and friends
  return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
}

// Calendar-date arithmetic done in UTC, so daylight saving can never shift a date.
function bookingKeyToUtc_(key) {
  const p = key.split("-");
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function bookingAddDays_(key, days) {
  const d = new Date(bookingKeyToUtc_(key) + days * 86400000);
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return d.getUTCFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
}

function bookingWeekday_(key) {
  return new Date(bookingKeyToUtc_(key)).getUTCDay();
}

/** "Tue 30 Sep, 6:30 AM" */
function bookingLabel_(dateKey, startMinutes) {
  const d = new Date(bookingKeyToUtc_(dateKey));
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return dows[d.getUTCDay()] + " " + d.getUTCDate() + " " + months[d.getUTCMonth()] + ", " + bookingClock12_(startMinutes);
}

function bookingNumber_(raw, fallback, min, max) {
  const text = String(raw == null ? "" : raw).trim();
  const n = Number(text);
  if (text === "" || !isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bookingIsNo_(raw) {
  return /^(no|n|false|off|0)$/i.test(String(raw == null ? "" : raw).trim());
}

/** Sydney "now": the instant, today's date, and a timestamp for the Bookings tab. */
function bookingNow_() {
  const now = new Date();
  return {
    ms: now.getTime(),
    dateKey: Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd"),
    stamp: Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd HH:mm"),
  };
}

/** The real instant a Sydney wall-clock date + time falls on. */
function bookingStartMs_(dateKey, startMinutes) {
  return Utilities.parseDate(dateKey + " " + bookingFormatMinutes_(startMinutes), TIMEZONE, "yyyy-MM-dd HH:mm").getTime();
}

// ---- Reading the booking sheet --------------------------------------------

/** A tab as { header, rows } of displayed text, so nothing depends on how Sheets decided to type a cell. */
function bookingTable_(sheet) {
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return { header: [], rows: [] };
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues();
  return { header: values[0], rows: values.slice(1) };
}

function bookingSettings_(ss) {
  const s = { notifyEmail: BOOKING_NOTIFY_DEFAULT, minNoticeHours: 12, bookAheadDays: 28, cancelNoticeHours: 24, requireSession: true, maxActive: 6, requireCode: true, contactLink: "" };
  const table = bookingTable_(ss.getSheetByName(BOOKING_TABS.settings));
  const keyCol = findColumn_(table.header, "Setting");
  const valueCol = findColumn_(table.header, "Value");
  if (keyCol < 0 || valueCol < 0) return s;
  const map = {};
  table.rows.forEach(function (r) {
    const key = String(r[keyCol]).trim().toLowerCase();
    if (key) map[key] = String(r[valueCol]).trim();
  });
  if (map["notify email"] !== undefined) s.notifyEmail = map["notify email"]; // blank on purpose = no emails
  s.minNoticeHours = bookingNumber_(map["min notice hours"], s.minNoticeHours, 0, 1440);
  s.bookAheadDays = Math.floor(bookingNumber_(map["book ahead days"], s.bookAheadDays, 1, 120));
  s.cancelNoticeHours = bookingNumber_(map["cancel notice hours"], s.cancelNoticeHours, 0, 1440);
  if (map["require session left"]) s.requireSession = !bookingIsNo_(map["require session left"]);
  s.maxActive = Math.floor(bookingNumber_(map["max active bookings"], s.maxActive, 1, 50));
  if (map["require booking code"]) s.requireCode = !bookingIsNo_(map["require booking code"]);
  s.contactLink = bookingSafeLink_(map["contact link"]);
  return s;
}

/** A contact link Max typed, or "" if it isn't a web, text, phone or email link (so a typo can never become a script link). */
function bookingSafeLink_(text) {
  const link = String(text == null ? "" : text).trim();
  return link.length <= 400 && /^(https:\/\/|sms:|tel:|mailto:)/i.test(link) ? link : "";
}

/** Max's weekly hours as { day, start, end, minutes, buffer } blocks. Rows that are off, or that can't be read, are skipped. */
function bookingWindows_(ss) {
  const table = bookingTable_(ss.getSheetByName(BOOKING_TABS.availability));
  const c = {
    on: findColumn_(table.header, "On"),
    day: findColumn_(table.header, "Day"),
    start: findColumn_(table.header, "Start"),
    end: findColumn_(table.header, "End"),
    minutes: findColumn_(table.header, "Session Minutes"),
    buffer: findColumn_(table.header, "Buffer Minutes"),
  };
  if (c.day < 0 || c.start < 0 || c.end < 0) return [];
  const out = [];
  table.rows.forEach(function (r) {
    if (c.on >= 0 && bookingIsNo_(r[c.on])) return;
    const day = bookingParseDay_(r[c.day]);
    const start = bookingParseTime_(r[c.start]);
    const end = bookingParseTime_(r[c.end]);
    const minutesText = c.minutes >= 0 ? String(r[c.minutes]).trim() : "";
    const minutes = minutesText === "" ? BOOKING_DEFAULT_MINUTES : Number(minutesText);
    let buffer = c.buffer >= 0 && String(r[c.buffer]).trim() !== "" ? Number(r[c.buffer]) : 0;
    if (day < 0 || start < 0 || end <= start) return;
    if (!isFinite(minutes) || minutes < 5 || minutes > 240) return;
    if (!isFinite(buffer) || buffer < 0 || buffer > 120) buffer = 0;
    out.push({ day: day, start: start, end: end, minutes: minutes, buffer: buffer });
  });
  return out;
}

function bookingTimeOff_(ss) {
  const table = bookingTable_(ss.getSheetByName(BOOKING_TABS.timeOff));
  const fromCol = findColumn_(table.header, "From");
  const toCol = findColumn_(table.header, "To");
  if (fromCol < 0) return [];
  const out = [];
  table.rows.forEach(function (r) {
    const from = bookingParseDateKey_(r[fromCol]);
    if (!from) return;
    let to = toCol >= 0 ? bookingParseDateKey_(r[toCol]) : "";
    if (!to || to < from) to = from;
    out.push({ from: from, to: to });
  });
  return out;
}

/** Every row of the Bookings tab that has a readable date and start time. `active` means Status is "Booked". */
function bookingRows_(ss) {
  const sheet = ss.getSheetByName(BOOKING_TABS.bookings);
  const table = bookingTable_(sheet);
  const c = bookingColumns_(table.header);
  const out = [];
  table.rows.forEach(function (r, i) {
    const date = bookingParseDateKey_(r[c.date]);
    const startMin = bookingParseTime_(r[c.start]);
    if (!date || startMin < 0) return;
    let endMin = bookingParseTime_(r[c.end]);
    const minutes = Number(r[c.minutes]);
    if (endMin <= startMin) endMin = startMin + (isFinite(minutes) && minutes > 0 ? minutes : BOOKING_DEFAULT_MINUTES);
    const status = String(r[c.status]).trim();
    out.push({
      row: i + 2,
      id: String(r[c.id]).trim(),
      date: date,
      startMin: startMin,
      endMin: endMin,
      minutes: endMin - startMin,
      client: String(r[c.client]).trim(),
      slug: String(r[c.slug]).trim().toLowerCase(),
      active: status.toLowerCase() === "booked",
    });
  });
  return out;
}

/** Column positions in the Bookings tab, found by header NAME so reordering or adding columns can't make a write land in the wrong cell. */
function bookingColumns_(header) {
  const c = {
    id: findColumn_(header, "Booking ID"),
    date: findColumn_(header, "Date"),
    start: findColumn_(header, "Start"),
    end: findColumn_(header, "End"),
    minutes: findColumn_(header, "Minutes"),
    client: findColumn_(header, "Client"),
    slug: findColumn_(header, "Client Slug"),
    status: findColumn_(header, "Status"),
    bookedAt: findColumn_(header, "Booked At"),
    cancelledAt: findColumn_(header, "Cancelled At"),
  };
  Object.keys(c).forEach(function (k) {
    if (c[k] < 0) throw new Error("The Bookings tab is missing a column (" + k + "). Run setupBooking to repair it.");
  });
  return c;
}

// ---- Working out which times to offer -------------------------------------

/**
 * Every slot the Availability blocks would offer from today to the booking
 * horizon, each flagged tooSoon and/or taken. Pure: everything it needs is
 * passed in. Sessions run back to back inside a block (plus any buffer), and
 * only ones that finish before the block ends are made.
 */
function bookingCandidates_(windows, timeOff, activeBookings, settings, now) {
  const out = [];
  const seen = {};
  const noticeDays = Math.ceil(settings.minNoticeHours / 24) + 1;
  for (let i = 0; i <= settings.bookAheadDays; i++) {
    const date = bookingAddDays_(now.dateKey, i);
    if (timeOff.some(function (t) { return date >= t.from && date <= t.to; })) continue;
    const weekday = bookingWeekday_(date);
    const dayBookings = activeBookings.filter(function (b) { return b.date === date; });
    windows.forEach(function (w) {
      if (w.day !== weekday) return;
      for (let t = w.start; t + w.minutes <= w.end; t += w.minutes + w.buffer) {
        const key = date + "|" + t;
        if (seen[key]) continue; // two blocks covering the same start time
        seen[key] = true;
        const end = t + w.minutes;
        out.push({
          date: date,
          startMin: t,
          endMin: end,
          minutes: w.minutes,
          tooSoon: i <= noticeDays && bookingStartMs_(date, t) - now.ms < settings.minNoticeHours * 3600000,
          taken: dayBookings.some(function (b) { return b.startMin < end && t < b.endMin; }),
        });
      }
    });
  }
  out.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin;
  });
  return out;
}

function bookingPublicSlot_(c) {
  return { date: c.date, start: bookingFormatMinutes_(c.startMin), end: bookingFormatMinutes_(c.endMin), minutes: c.minutes };
}

/** The client's own upcoming bookings, soonest first, each with whether they can still cancel it. */
function bookingMine_(rows, member, settings, now) {
  return rows
    .filter(function (b) { return b.active && b.slug === member.slug && b.date >= now.dateKey; })
    .map(function (b) { return { b: b, ms: bookingStartMs_(b.date, b.startMin) }; })
    .filter(function (x) { return x.ms > now.ms; })
    .sort(function (a, b) { return a.ms - b.ms; })
    .map(function (x) {
      return {
        id: x.b.id,
        date: x.b.date,
        start: bookingFormatMinutes_(x.b.startMin),
        end: bookingFormatMinutes_(x.b.endMin),
        minutes: x.b.minutes,
        canCancel: (x.ms - now.ms) / 3600000 >= settings.cancelNoticeHours,
      };
    });
}

/** Whether this client may hold another booking right now, and if not, a friendly reason. */
function bookingEligibility_(member, settings, upcomingCount) {
  if (settings.requireSession && !member.unlimited) {
    if (member.sessionsLeft === null || member.sessionsLeft <= 0) {
      return { canBook: false, code: "no-sessions", message: "You don't have any 1-on-1 sessions left. Message Max to top up." };
    }
    if (upcomingCount >= member.sessionsLeft) {
      return { canBook: false, code: "all-booked", message: "All of your remaining 1-on-1 sessions are already booked." };
    }
  }
  if (upcomingCount >= settings.maxActive) {
    return { canBook: false, code: "too-many", message: "You already have " + upcomingCount + " sessions booked. Once one is done you can book another." };
  }
  return { canBook: true, code: "", message: "" };
}

/** A client's row in Sessions Remaining: name, Check-in Token, 1-on-1 sessions left and plan, or null if there's no such client. */
function bookingCrmMember_(slug) {
  if (!slug) return null;
  const data = getSheetByGid_(SESSIONS_SHEET_GID).getDataRange().getValues();
  const header = data[0];
  const col = {
    name: findColumn_(header, "Name"),
    token: findColumn_(header, "Check-in Token"),
    package: findColumn_(header, "Package Type"),
    oneOnOne: findColumn_(header, "1 on 1 Remaining"),
  };
  if (col.name < 0) return null;
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][col.name] || "").trim();
    if (!name || slugify_(name) !== slug) continue;
    const raw = col.oneOnOne >= 0 ? String(data[i][col.oneOnOne] || "").trim() : "";
    const n = Number(raw);
    const packageType = col.package >= 0 ? String(data[i][col.package] || "").toLowerCase() : "";
    return {
      name: name,
      slug: slug,
      rowToken: col.token >= 0 ? String(data[i][col.token] || "").trim() : "",
      sessionsLeft: raw !== "" && isFinite(n) ? n : null,
      unlimited: packageType.indexOf("unlimited") >= 0,
    };
  }
  return null;
}

// ---- Personal booking codes -----------------------------------------------

/** A code as typed: upper case, letters and digits only ("k7m-4qx " -> "K7M4QX"). */
function bookingNormalizeCode_(text) {
  return String(text == null ? "" : text).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A new random code. Bytes come from Utilities.getUuid(), which is backed by a secure random generator. */
function bookingNewCode_() {
  const hex = Utilities.getUuid().replace(/-/g, "");
  let code = "";
  for (let i = 0; i < BOOKING_CODE_LENGTH; i++) {
    code += BOOKING_CODE_ALPHABET.charAt(parseInt(hex.substr(i * 2, 2), 16) % BOOKING_CODE_ALPHABET.length);
  }
  return code;
}

/** Wrong-code attempts against one slug in the last 15 minutes. Kept in the script cache, which expires by itself. */
function bookingWrongCodes_(slug) {
  return Number(CacheService.getScriptCache().get("bookfail:" + slug)) || 0;
}

function bookingNoteWrongCode_(slug) {
  CacheService.getScriptCache().put("bookfail:" + slug, String(bookingWrongCodes_(slug) + 1), BOOKING_LOCKOUT_SECONDS);
}

function bookingClearWrongCodes_(slug) {
  CacheService.getScriptCache().remove("bookfail:" + slug);
}

/** The client's code from the private Clients tab, normalised, or "" if they have none yet. */
function bookingStoredCode_(ss, slug) {
  const table = bookingTable_(ss.getSheetByName(BOOKING_TABS.clients));
  const slugCol = findColumn_(table.header, "Slug");
  const codeCol = findColumn_(table.header, "Booking Code");
  if (slugCol < 0 || codeCol < 0) return "";
  for (let i = 0; i < table.rows.length; i++) {
    if (slugify_(table.rows[i][slugCol]) === slug) return bookingNormalizeCode_(table.rows[i][codeCol]);
  }
  return "";
}

/**
 * Gives every client in the CRM a personal booking code, on the private Clients
 * tab, next to a ready-made text to send them. Run from the Apps Script editor
 * whenever a new client joins (setupBooking runs it too). Existing codes are
 * never changed. To give someone a new code, clear their Booking Code cell and
 * run this again.
 */
function issueBookingCodes() {
  const ss = bookingBook_();
  if (!ss) throw new Error("Run setupBooking first.");
  const sheet = ss.getSheetByName(BOOKING_TABS.clients) || bookingEnsureTab_(ss, BOOKING_TABS.clients, BOOKING_CLIENTS_HEADER, [], ["Slug", "Booking Code"]).sheet;
  const table = bookingTable_(sheet);
  const c = {
    name: findColumn_(table.header, "Name"),
    slug: findColumn_(table.header, "Slug"),
    code: findColumn_(table.header, "Booking Code"),
    text: findColumn_(table.header, "Text to send"),
  };
  if (c.slug < 0 || c.code < 0) throw new Error("The Clients tab is missing its Slug or Booking Code column.");

  const rowBySlug = {};
  const taken = {};
  table.rows.forEach(function (r, i) {
    const slug = slugify_(r[c.slug]);
    if (slug) rowBySlug[slug] = i + 2;
    const code = bookingNormalizeCode_(r[c.code]);
    if (code) taken[code] = true;
  });

  const crm = getSheetByGid_(SESSIONS_SHEET_GID).getDataRange().getValues();
  const nameCol = findColumn_(crm[0], "Name");
  if (nameCol < 0) throw new Error('The Sessions Remaining tab has no "Name" column.');

  const textFor = function (name, code) {
    return "Hi " + name.split(" ")[0] + ", you can now book 1-on-1 sessions from your MaxFit card. Tap Book a session and enter this code the first time: " + code + ". It only needs entering once on each phone.";
  };
  const newUniqueCode = function () {
    let code = bookingNewCode_();
    while (taken[code]) code = bookingNewCode_();
    taken[code] = true;
    return code;
  };

  let added = 0;
  let filled = 0;
  const seen = {};
  for (let i = 1; i < crm.length; i++) {
    const name = String(crm[i][nameCol] || "").trim();
    const slug = slugify_(name);
    if (!slug || seen[slug]) continue;
    seen[slug] = true;
    const row = rowBySlug[slug];
    if (!row) {
      const code = newUniqueCode();
      const values = table.header.map(function () { return ""; });
      if (c.name >= 0) values[c.name] = cleanNote_(name, 80);
      values[c.slug] = slug;
      values[c.code] = code;
      if (c.text >= 0) values[c.text] = textFor(name, code);
      const target = sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length);
      target.setNumberFormat("@");
      target.setValues([values]);
      added++;
    } else if (!bookingNormalizeCode_(sheet.getRange(row, c.code + 1).getDisplayValue())) {
      const code = newUniqueCode();
      sheet.getRange(row, c.code + 1).setNumberFormat("@").setValue(code);
      if (c.text >= 0) sheet.getRange(row, c.text + 1).setValue(textFor(name, code));
      filled++;
    }
  }
  SpreadsheetApp.flush();
  return { added: added, filled: filled };
}

/**
 * Who is asking, or why not. Returns { member } or { error: { code, message } }.
 *
 * Booking code required (the default): the slug must be a real client, and the
 * code must match the one on the Clients tab. Wrong codes are counted per slug,
 * and five of them lock that slug out for 15 minutes (the count comes off by
 * itself; a right code clears it). Otherwise it's the old slug + Check-in
 * Token check.
 */
function bookingAuthenticate_(ss, settings, payload) {
  const slug = slugify_(payload.clientSlug);
  if (!slug) return { error: { code: "unknown-member", message: "We couldn't match your membership. Open booking from your card." } };

  if (!settings.requireCode) {
    const crm = bookingCrmMember_(slug);
    const token = String(payload.token || "").trim();
    // A row with no token yet is identified by the slug, which is what the card puts in its QR code then.
    if (crm && token && (crm.rowToken ? crm.rowToken === token : token === slug)) return { member: crm };
    return { error: { code: "unknown-member", message: "We couldn't match your membership. Open booking from your card." } };
  }

  if (bookingWrongCodes_(slug) >= BOOKING_MAX_WRONG_CODES) {
    return { error: { code: "locked", message: "Too many wrong codes. Please wait 15 minutes and try again, or message Max." } };
  }
  const given = bookingNormalizeCode_(payload.code);
  if (!given) return { error: { code: "code-required", message: "Enter your booking code to continue." } };

  const crm = bookingCrmMember_(slug);
  if (!crm) {
    bookingNoteWrongCode_(slug);
    return { error: { code: "unknown-member", message: "We couldn't match your membership. Open booking from your card." } };
  }
  const stored = bookingStoredCode_(ss, slug);
  if (!stored) return { error: { code: "no-code", message: "You don't have a booking code yet. Message Max and he'll send it." } };
  if (stored !== given) {
    bookingNoteWrongCode_(slug);
    return { error: { code: "bad-code", message: "That code isn't right. Check it and try again." } };
  }
  bookingClearWrongCodes_(slug);
  return { member: crm };
}

/** Everything a booking request needs, or { error } holding the response to send back. */
function bookingContext_(payload) {
  const ss = bookingBook_();
  if (!ss) {
    return { error: { status: "error", code: "not-set-up", message: "Booking isn't switched on yet. Please message Max." } };
  }
  const settings = bookingSettings_(ss);
  const auth = bookingAuthenticate_(ss, settings, payload);
  if (auth.error) {
    return { error: { status: "error", code: auth.error.code, message: auth.error.message } };
  }
  return { ss: ss, member: auth.member, settings: settings, now: bookingNow_() };
}

function bookingFail_(code, message) {
  return jsonResponse_({ status: "error", code: code, message: message });
}

function bookingServerError_(what, err) {
  Logger.log("Booking " + what + " failed: " + err);
  return bookingFail_("server", "Something went wrong on our side. Please try again in a moment.");
}

/** Emails Max. A failure here (quota, bad address) never blocks the booking itself. */
function bookingNotify_(settings, subject, lines) {
  if (!settings.notifyEmail) return;
  try {
    MailApp.sendEmail({ to: settings.notifyEmail, subject: subject, body: lines.join("\n") });
  } catch (err) {
    Logger.log("Booking email failed: " + err);
  }
}

// ---- The three actions ----------------------------------------------------

/** What the Book page needs in one go: the client's own bookings, whether they can book, and the times on offer. Read-only. */
function handleBookingInfo_(payload) {
  try {
    const ctx = bookingContext_(payload);
    if (ctx.error) return jsonResponse_(ctx.error);
    const rows = bookingRows_(ctx.ss);
    const mine = bookingMine_(rows, ctx.member, ctx.settings, ctx.now);
    const eligibility = bookingEligibility_(ctx.member, ctx.settings, mine.length);

    let slots = [];
    if (eligibility.canBook) {
      const active = rows.filter(function (b) { return b.active && b.date >= ctx.now.dateKey; });
      slots = bookingCandidates_(bookingWindows_(ctx.ss), bookingTimeOff_(ctx.ss), active, ctx.settings, ctx.now)
        .filter(function (c) { return !c.tooSoon && !c.taken; })
        .map(bookingPublicSlot_);
    }
    return jsonResponse_({
      status: "success",
      client: {
        name: ctx.member.name,
        sessionsLeft: ctx.member.unlimited ? null : ctx.member.sessionsLeft,
        unlimited: ctx.member.unlimited,
        canBook: eligibility.canBook,
        reason: eligibility.code,
        message: eligibility.message,
      },
      policy: { cancelHours: ctx.settings.cancelNoticeHours, minNoticeHours: ctx.settings.minNoticeHours, bookAheadDays: ctx.settings.bookAheadDays },
      today: ctx.now.dateKey,
      // Only handed to someone who has proved who they are, so Max's number isn't given to anyone who asks.
      contact: ctx.settings.contactLink,
      bookings: mine,
      slots: slots,
    });
  } catch (err) {
    return bookingServerError_("info", err);
  }
}

/** Books one slot. Runs under the script lock, and re-checks everything, because the page's list may be a few seconds old. */
function handleBookSession_(payload) {
  try {
    const ctx = bookingContext_(payload);
    if (ctx.error) return jsonResponse_(ctx.error);
    const date = bookingParseDateKey_(payload.date);
    const startMin = bookingParseTime_(payload.start);
    if (!date || startMin < 0) return bookingFail_("bad-request", "That time isn't valid. Please pick another.");

    const rows = bookingRows_(ctx.ss);
    const mine = bookingMine_(rows, ctx.member, ctx.settings, ctx.now);

    // The same booking asked for twice (a double tap, or a retry after the
    // connection dropped) is one booking, not an error.
    const startText = bookingFormatMinutes_(startMin);
    const existing = mine.filter(function (b) { return b.date === date && b.start === startText; })[0];
    if (existing) return jsonResponse_({ status: "success", booking: existing, already: true });

    const eligibility = bookingEligibility_(ctx.member, ctx.settings, mine.length);
    if (!eligibility.canBook) return bookingFail_(eligibility.code, eligibility.message);

    const active = rows.filter(function (b) { return b.active && b.date >= ctx.now.dateKey; });
    const candidate = bookingCandidates_(bookingWindows_(ctx.ss), bookingTimeOff_(ctx.ss), active, ctx.settings, ctx.now)
      .filter(function (c) { return c.date === date && c.startMin === startMin; })[0];
    if (!candidate) return bookingFail_("unavailable", "That time isn't available any more. Please pick another.");
    if (candidate.tooSoon) {
      return bookingFail_("too-soon", "Bookings need at least " + ctx.settings.minNoticeHours + " hours' notice. Please pick a later time.");
    }
    if (candidate.taken) return bookingFail_("taken", "Someone just took that time. Please pick another.");

    const sheet = ctx.ss.getSheetByName(BOOKING_TABS.bookings);
    const table = bookingTable_(sheet);
    const c = bookingColumns_(table.header);
    const id = "B" + Utilities.getUuid().replace(/-/g, "").slice(0, 8).toUpperCase();
    const endText = bookingFormatMinutes_(candidate.endMin);
    const row = table.header.map(function () { return ""; });
    row[c.id] = id;
    row[c.date] = date;
    row[c.start] = startText;
    row[c.end] = endText;
    row[c.minutes] = String(candidate.minutes);
    row[c.client] = cleanNote_(ctx.member.name, 80);
    row[c.slug] = ctx.member.slug;
    row[c.status] = "Booked";
    row[c.bookedAt] = ctx.now.stamp;
    const target = sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length);
    target.setNumberFormat("@");
    target.setValues([row]);
    SpreadsheetApp.flush(); // commit before the lock is released, or the next request could still read the slot as free

    const when = bookingLabel_(date, candidate.startMin);
    bookingNotify_(ctx.settings, "New booking: " + ctx.member.name + " — " + when, [
      ctx.member.name + " booked a 1-on-1 session.",
      "",
      "When: " + when + " to " + bookingClock12_(candidate.endMin) + " (" + candidate.minutes + " min)",
      ctx.member.unlimited ? "Plan: unlimited" : "1-on-1 sessions left: " + (ctx.member.sessionsLeft === null ? "not set" : ctx.member.sessionsLeft),
      "",
      "To cancel it yourself, change its Status to Cancelled in the Bookings tab:",
      ctx.ss.getUrl(),
    ]);

    return jsonResponse_({
      status: "success",
      booking: {
        id: id,
        date: date,
        start: startText,
        end: endText,
        minutes: candidate.minutes,
        canCancel: (bookingStartMs_(date, startMin) - ctx.now.ms) / 3600000 >= ctx.settings.cancelNoticeHours,
      },
    });
  } catch (err) {
    return bookingServerError_("book", err);
  }
}

/** Cancels the client's own booking, if it's far enough away. */
function handleCancelBooking_(payload) {
  try {
    const ctx = bookingContext_(payload);
    if (ctx.error) return jsonResponse_(ctx.error);
    const id = String(payload.id || "").trim();
    if (!id) return bookingFail_("bad-request", "Which booking? Please try again.");

    const rows = bookingRows_(ctx.ss);
    const target = rows.filter(function (b) { return b.id === id && b.slug === ctx.member.slug; })[0];
    if (!target) return bookingFail_("not-found", "We couldn't find that booking. It may already be cancelled.");
    if (!target.active) return jsonResponse_({ status: "success", already: true });

    const hoursAway = (bookingStartMs_(target.date, target.startMin) - ctx.now.ms) / 3600000;
    if (hoursAway < ctx.settings.cancelNoticeHours) {
      return bookingFail_("too-late", "That session is less than " + ctx.settings.cancelNoticeHours + " hours away, so it can't be cancelled here. Please message Max.");
    }

    const sheet = ctx.ss.getSheetByName(BOOKING_TABS.bookings);
    const c = bookingColumns_(bookingTable_(sheet).header);
    sheet.getRange(target.row, c.status + 1).setValue("Cancelled");
    sheet.getRange(target.row, c.cancelledAt + 1).setNumberFormat("@").setValue(ctx.now.stamp);
    SpreadsheetApp.flush();

    const when = bookingLabel_(target.date, target.startMin);
    bookingNotify_(ctx.settings, "Cancelled: " + ctx.member.name + " — " + when, [
      ctx.member.name + " cancelled their 1-on-1 session.",
      "",
      "Was: " + when + " to " + bookingClock12_(target.endMin) + " (" + target.minutes + " min)",
      "That time is open again.",
      "",
      ctx.ss.getUrl(),
    ]);
    return jsonResponse_({ status: "success" });
  } catch (err) {
    return bookingServerError_("cancel", err);
  }
}

// ---- Self-test ------------------------------------------------------------

/**
 * Run this once from the Apps Script editor after setupBooking (pick
 * bookingSelfTest in the toolbar dropdown, then Run). It tries the whole
 * booking flow on REAL Google — building the tabs, typing hours into them,
 * booking, cancelling, wrong codes, the Upcoming formula — in a scratch
 * spreadsheet of its own. Nothing in your real booking sheet, your CRM or a
 * client's card is changed: a real client's row is only READ. Then it emails
 * you PASSED or FAILED with the details. If anything fails, send that email
 * back.
 *
 * The scratch spreadsheet is called "MaxFit booking self-test (safe to delete)".
 * It's reused on later runs, so there is only ever one.
 */
function bookingSelfTest() {
  const results = [];
  const step = function (label, fn) {
    try {
      const detail = fn();
      results.push({ label: label, ok: true, detail: detail ? String(detail) : "" });
    } catch (err) {
      results.push({ label: label, ok: false, detail: String(err && err.message ? err.message : err) });
    }
  };
  const call = function (payload) {
    return JSON.parse(doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
  };
  const expect = function (cond, message) {
    if (!cond) throw new Error(message);
  };

  const state = {};
  let scratch = null;
  try {
    step("Open or create the scratch spreadsheet", function () {
      scratch = bookingScratchBook_();
      state.keep = bookingResetScratch_(scratch);
      bookingSheetOverride_ = scratch; // this run only: a real client's request never sees it
      return scratch.getUrl();
    });

    if (scratch) {
      step("setupBooking builds every tab", function () {
        setupBooking();
        scratch.deleteSheet(state.keep);
        const have = scratch.getSheets().map(function (s) { return s.getName(); });
        [BOOKING_TABS.availability, BOOKING_TABS.timeOff, BOOKING_TABS.settings, BOOKING_TABS.clients, BOOKING_TABS.bookings, BOOKING_TABS.upcoming].forEach(function (n) {
          expect(have.indexOf(n) >= 0, "the " + n + " tab is missing");
        });
        const start = scratch.getSheetByName(BOOKING_TABS.availability).getRange(2, 3);
        expect(typeof start.getValue() === "string" && start.getDisplayValue() === "16:00", 'the example Start "16:00" came back as ' + typeof start.getValue() + " " + start.getDisplayValue() + " instead of plain text");
        const formula = scratch.getSheetByName(BOOKING_TABS.upcoming).getRange("A2").getFormula();
        expect(/IFNA\(SORT\(FILTER/.test(formula), "the Upcoming formula wasn't saved");
        return have.join(", ");
      });

      step("Every client gets a code, and a second run changes nothing", function () {
        const table = bookingTable_(scratch.getSheetByName(BOOKING_TABS.clients));
        expect(table.rows.length > 0, "no client got a code (is Sessions Remaining empty?)");
        const c = { name: findColumn_(table.header, "Name"), slug: findColumn_(table.header, "Slug"), code: findColumn_(table.header, "Booking Code") };
        const shape = new RegExp("^[" + BOOKING_CODE_ALPHABET + "]{" + BOOKING_CODE_LENGTH + "}$");
        table.rows.forEach(function (r) { expect(shape.test(r[c.code]), "a code looks wrong: " + r[c.code]); });
        state.member = { name: table.rows[0][c.name], slug: table.rows[0][c.slug], code: table.rows[0][c.code] };
        const again = issueBookingCodes();
        expect(again.added === 0 && again.filled === 0, "running it again changed " + (again.added + again.filled) + " rows");
        return table.rows.length + " clients have codes";
      });

      step("Hours, days off and settings typed into real cells are read correctly", function () {
        const now = bookingNow_();
        const timeOff = bookingTimeOff_(scratch);
        let offset = 3;
        while (offset < 12 && timeOff.some(function (t) { const d = bookingAddDays_(now.dateKey, offset); return d >= t.from && d <= t.to; })) offset++;
        state.date = bookingAddDays_(now.dateKey, offset);
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        scratch.getSheetByName(BOOKING_TABS.availability).getRange(2, 1, 1, 6).setValues([["Yes", dayNames[bookingWeekday_(state.date)], "06:00", "09:00", 45, 0]]);
        bookingSetSetting_(scratch, "Notify email", "");
        bookingSetSetting_(scratch, "Require session left", "No");
        const windows = bookingWindows_(scratch);
        expect(windows.length === 1 && windows[0].start === 360 && windows[0].end === 540 && windows[0].minutes === 45, "the availability row was read as " + JSON.stringify(windows));
        expect(timeOff.length >= 1 && timeOff[0].from === "2026-12-25", "the example Time Off row was read as " + JSON.stringify(timeOff));
        expect(bookingSettings_(scratch).requireSession === false && bookingSettings_(scratch).notifyEmail === "", "the Settings changes weren't read back");
        return state.date + " (" + dayNames[bookingWeekday_(state.date)] + ") 06:00-09:00";
      });

      step("A wrong code is refused, and doesn't count against a real client", function () {
        const r = call({ action: "bookingInfo", clientSlug: state.member.slug, code: "000000" });
        bookingClearWrongCodes_(state.member.slug);
        expect(r.status === "error" && r.code === "bad-code", "expected bad-code, got " + r.status + "/" + r.code);
        const none = call({ action: "bookingInfo", clientSlug: state.member.slug });
        expect(none.code === "code-required", "expected code-required with no code, got " + none.code);
      });

      step("Five wrong codes lock a slug out", function () {
        const slug = "selftestlockout"; // made up, so no real client is ever locked
        try {
          for (let i = 0; i < BOOKING_MAX_WRONG_CODES; i++) call({ action: "bookingInfo", clientSlug: slug, code: "000000" });
          const r = call({ action: "bookingInfo", clientSlug: slug, code: "000000" });
          expect(r.code === "locked", "expected locked on the next try, got " + r.code);
        } finally {
          bookingClearWrongCodes_(slug);
        }
      });

      step("The right code shows the times", function () {
        const r = call({ action: "bookingInfo", clientSlug: state.member.slug, code: state.member.code });
        expect(r.status === "success", "expected success, got " + r.status + "/" + r.code + " " + (r.message || ""));
        const onDay = r.slots.filter(function (s) { return s.date === state.date; });
        expect(onDay.length === 4 && onDay[0].start === "06:00", "expected 4 slots on " + state.date + " from 06:00, got " + JSON.stringify(onDay));
        state.first = onDay[0];
        return r.slots.length + " times on offer";
      });

      step("Booking a time works and writes plain text", function () {
        const r = call({ action: "bookSession", clientSlug: state.member.slug, code: state.member.code, date: state.date, start: state.first.start });
        expect(r.status === "success", "expected success, got " + r.status + "/" + r.code + " " + (r.message || ""));
        state.bookingId = r.booking.id;
        const sheet = scratch.getSheetByName(BOOKING_TABS.bookings);
        expect(typeof sheet.getRange(2, 2).getValue() === "string" && sheet.getRange(2, 2).getDisplayValue() === state.date, "the Date cell came back as " + typeof sheet.getRange(2, 2).getValue());
        const rows = bookingRows_(scratch).filter(function (b) { return b.active; });
        expect(rows.length === 1 && rows[0].date === state.date && rows[0].startMin === 360, "the Bookings tab holds " + JSON.stringify(rows));
      });

      step("The booked time is no longer offered", function () {
        const r = call({ action: "bookingInfo", clientSlug: state.member.slug, code: state.member.code });
        expect(r.bookings.length === 1, "expected 1 booking, got " + r.bookings.length);
        expect(!r.slots.some(function (s) { return s.date === state.date && s.start === state.first.start; }), "the booked time is still on offer");
      });

      step("The Upcoming tab shows the booking", function () {
        const row = bookingUpcomingRow_(scratch, function (r) { return r[0] === state.date; });
        expect(row[0] === state.date && row[1] === "06:00" && String(row[4]).replace(/^'/, "") === state.member.name, "Upcoming shows " + JSON.stringify(row));
        return row.join(" | ");
      });

      step("Cancelling works and the time comes back", function () {
        const r = call({ action: "cancelBooking", clientSlug: state.member.slug, code: state.member.code, id: state.bookingId });
        expect(r.status === "success", "expected success, got " + r.status + "/" + r.code + " " + (r.message || ""));
        expect(bookingRows_(scratch).filter(function (b) { return b.active; }).length === 0, "the booking is still active");
        const info = call({ action: "bookingInfo", clientSlug: state.member.slug, code: state.member.code });
        expect(info.slots.some(function (s) { return s.date === state.date && s.start === state.first.start; }), "the time didn't come back");
      });

      step("The Upcoming tab empties again", function () {
        const row = bookingUpcomingRow_(scratch, function (r) { return r[0] === "Nothing booked yet"; });
        expect(row[0] === "Nothing booked yet", "Upcoming shows " + JSON.stringify(row));
      });

      step("The Message Max link is passed on, and only if it's safe", function () {
        bookingSetSetting_(scratch, "Contact link", "https://wa.me/61400000000?text={message}");
        const ok = call({ action: "bookingInfo", clientSlug: state.member.slug, code: state.member.code });
        expect(ok.contact === "https://wa.me/61400000000?text={message}", "the link came back as " + ok.contact);
        bookingSetSetting_(scratch, "Contact link", "javascript:alert(1)");
        const bad = call({ action: "bookingInfo", clientSlug: state.member.slug, code: state.member.code });
        expect(bad.contact === "", "an unsafe link was passed on: " + bad.contact);
        bookingSetSetting_(scratch, "Contact link", "");
      });
    }
  } catch (err) {
    results.push({ label: "The self-test itself crashed", ok: false, detail: String(err && err.stack ? err.stack : err) });
  } finally {
    bookingSheetOverride_ = null;
  }

  const failed = results.filter(function (r) { return !r.ok; });
  const summary = failed.length ? "FAILED (" + failed.length + " of " + results.length + " checks)" : "PASSED (all " + results.length + " checks)";
  const lines = results.map(function (r) { return (r.ok ? "PASS  " : "FAIL  ") + r.label + (r.detail ? "  -  " + r.detail : ""); });
  Logger.log("Booking self-test " + summary);
  lines.forEach(function (l) { Logger.log(l); });
  try {
    MailApp.sendEmail({
      to: BOOKING_NOTIFY_DEFAULT,
      subject: "MaxFit booking self-test: " + summary,
      body: [
        "Booking self-test " + summary,
        "",
        lines.join("\n"),
        "",
        failed.length ? "Send this email back and it can be fixed." : "Booking works on real Google. Nothing in your real booking sheet or CRM was changed.",
        scratch ? "The scratch spreadsheet it used (safe to delete): " + scratch.getUrl() : "",
      ].join("\n"),
    });
  } catch (err) {
    Logger.log("Couldn't email the result: " + err);
  }
  return summary;
}

/** The one scratch spreadsheet the self-test uses, created the first time and reused after. */
function bookingScratchBook_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(BOOKING_SELFTEST_SHEET_ID_PROPERTY);
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (err) {
      // It was deleted from Drive; make a new one below.
    }
  }
  const ss = SpreadsheetApp.create("MaxFit booking self-test (safe to delete)");
  props.setProperty(BOOKING_SELFTEST_SHEET_ID_PROPERTY, ss.getId());
  return ss;
}

/** Empties the scratch spreadsheet down to one blank tab (a spreadsheet must keep one) and returns that tab. */
function bookingResetScratch_(ss) {
  const keep = ss.insertSheet("reset-" + new Date().getTime());
  ss.getSheets().forEach(function (s) {
    if (s.getSheetId() !== keep.getSheetId()) ss.deleteSheet(s);
  });
  return keep;
}

function bookingSetSetting_(ss, key, value) {
  const sheet = ss.getSheetByName(BOOKING_TABS.settings);
  const table = bookingTable_(sheet);
  const keyCol = findColumn_(table.header, "Setting");
  const valueCol = findColumn_(table.header, "Value");
  for (let i = 0; i < table.rows.length; i++) {
    if (String(table.rows[i][keyCol]).trim().toLowerCase() === key.toLowerCase()) {
      sheet.getRange(i + 2, valueCol + 1).setValue(value);
      return;
    }
  }
  throw new Error("no setting called " + key);
}

/** The first row on the Upcoming tab, re-read for a few seconds because a formula can take a moment to catch up with an edit. */
function bookingUpcomingRow_(ss, isWanted) {
  const sheet = ss.getSheetByName(BOOKING_TABS.upcoming);
  let row = [];
  for (let i = 0; i < 6; i++) {
    SpreadsheetApp.flush();
    row = sheet.getRange("A2:E2").getDisplayValues()[0];
    if (isWanted(row)) break;
    Utilities.sleep(800);
  }
  return row;
}
