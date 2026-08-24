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
const TIMEZONE = "Australia/Sydney";

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

/** Visiting the deployed URL directly in a browser hits this — confirms the deployment is live. */
function doGet(e) {
  return jsonResponse_({ status: "ok", message: "MaxFit check-in API is running." });
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

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ status: "error", message: "Bad request." });
  }

  if (!checkPin_(payload.pin)) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const token = String(payload.token || "").trim();
  const sessionType = String(payload.sessionType || "").trim();
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
  if (!isUnlimited && hasNumericSessions) {
    if (sessionsNum <= 0) {
      return jsonResponse_({ status: "no-sessions" });
    }
    newSessions = sessionsNum - 1;
    sheet.getRange(rowIndex + 1, col.sessions + 1).setValue(newSessions);
  }
  // Unlimited plan or blank for this session type: skip the decrement,
  // still log the visit below.

  if (col.lastAttended >= 0) {
    sheet.getRange(rowIndex + 1, col.lastAttended + 1).setValue(today);
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
  if (aCol.notes >= 0) newRow[aCol.notes] = SESSION_TYPE_NOTES[sessionType];
  attendanceSheet.appendRow(newRow);

  return jsonResponse_({ status: "success", sessionsRemaining: newSessions });
}
