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
const REFERRALS_SHEET_GID = 0; // *** PASTE THE "Referrals" TAB'S GID HERE ***
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
    return handleSignup_(payload);
  }
  return handleCheckIn_(payload);
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

  return jsonResponse_({
    status: "success",
    sessionsRemaining: newSessions,
    totalAttended: totalAttended,
    freeSession: freeSession,
  });
}

/**
 * Public sign-up form submission (join.html). Adds a new row to Sessions
 * Remaining with just the basics — Name/Phone/Email, today's date, and
 * "Enquiry" as the Payment Status — so it lands as a lead in the same
 * sheet Max already reviews, not a separate list to reconcile later. Max
 * still finishes onboarding by hand (Package Type, sessions, etc.) same
 * as any other new member.
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
  const referralCode = String(payload.referralCode || "").trim();

  if (!name || (!phone && !email)) {
    return jsonResponse_({ status: "error", message: "Missing name and contact details." });
  }

  const sheet = getSheetByGid_(SESSIONS_SHEET_GID);
  const data = sheet.getDataRange().getValues();
  const header = data[0];
  const col = {
    name: findColumn_(header, "Name"),
    phone: findColumn_(header, "Phone"),
    email: findColumn_(header, "Email"),
    signupDate: findColumn_(header, "Sign-up Date"),
    paymentStatus: findColumn_(header, "Payment Status"),
    referredBy: findColumn_(header, "Referred By"),
  };

  if (email && col.email >= 0) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][col.email] || "").trim().toLowerCase() === email.toLowerCase()) {
        return jsonResponse_({ status: "duplicate" });
      }
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
  const newRow = new Array(header.length).fill("");
  if (col.name >= 0) newRow[col.name] = name;
  if (col.phone >= 0) newRow[col.phone] = phone;
  if (col.email >= 0) newRow[col.email] = email;
  if (col.signupDate >= 0) newRow[col.signupDate] = today;
  if (col.paymentStatus >= 0) newRow[col.paymentStatus] = "Enquiry";
  if (col.referredBy >= 0) newRow[col.referredBy] = referrerName;
  sheet.appendRow(newRow);

  return jsonResponse_({ status: "success", referrerName: referrerName });
}

/**
 * Referral payout — runs automatically as a Google Sheets "simple trigger"
 * (any function literally named onEdit is auto-installed by Sheets itself,
 * no separate deployment or authorization step needed). Fires on every
 * manual edit to the Sessions Remaining sheet; only acts when the edit
 * touches Payment Status and sets it to "Paid".
 *
 * One-time per referred client, guarded by "Referral Bonus Applied" (Y once
 * paid out) so re-saving the same cell, or editing something else on the
 * row later, doesn't pay a friend twice for the same referral.
 *
 * - Referrer is an existing client (their name matches a row in this same
 *   sheet) -> +1 Group Session on their own row (a free class, redeemed
 *   whenever/whichever they like via the normal check-in flow).
 * - Referrer isn't a client -> +$5 added to their "Bonus Owed" in the
 *   Referrals tab.
 */
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getSheetId() !== SESSIONS_SHEET_GID) return;

    const lastCol = sheet.getLastColumn();
    const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const col = {
      name: findColumn_(header, "Name"),
      paymentStatus: findColumn_(header, "Payment Status"),
      referredBy: findColumn_(header, "Referred By"),
      bonusApplied: findColumn_(header, "Referral Bonus Applied"),
      groupSessions: findColumn_(header, "Group Sessions Remaining"),
    };
    if (col.paymentStatus < 0) return;

    const paymentStatusCol1 = col.paymentStatus + 1; // 1-indexed for Range APIs
    const editedFirstCol = e.range.getColumn();
    const editedLastCol = editedFirstCol + e.range.getNumColumns() - 1;
    if (paymentStatusCol1 < editedFirstCol || paymentStatusCol1 > editedLastCol) return;

    const firstRow = e.range.getRow();
    const numRows = e.range.getNumRows();
    for (let row = firstRow; row < firstRow + numRows; row++) {
      if (row === 1) continue; // header
      maybeApplyReferralBonus_(sheet, col, row);
    }
  } catch (err) {
    // Never let a trigger error block the actual edit someone just made.
  }
}

function maybeApplyReferralBonus_(sheet, col, row) {
  const status = String(sheet.getRange(row, col.paymentStatus + 1).getValue() || "").trim().toLowerCase();
  if (status !== "paid") return;

  if (col.bonusApplied >= 0) {
    const already = sheet.getRange(row, col.bonusApplied + 1).getValue();
    if (already) return;
  }

  const referredBy = col.referredBy >= 0
    ? String(sheet.getRange(row, col.referredBy + 1).getValue() || "").trim()
    : "";
  if (!referredBy) return;

  const lastRow = sheet.getLastRow();
  const names = col.name >= 0 && lastRow >= 2
    ? sheet.getRange(2, col.name + 1, lastRow - 1, 1).getValues().flat()
    : [];
  const referrerRowOffset = names.findIndex(
    (n) => String(n || "").trim().toLowerCase() === referredBy.toLowerCase()
  );

  if (referrerRowOffset >= 0 && col.groupSessions >= 0) {
    // Referrer is an existing client — give them one free group class.
    const cell = sheet.getRange(referrerRowOffset + 2, col.groupSessions + 1);
    const current = Number(cell.getValue()) || 0;
    cell.setValue(current + 1);
  } else if (referrerRowOffset < 0 && REFERRALS_SHEET_GID) {
    // Referrer isn't a client — credit a one-off $5 in the Referrals tab.
    creditReferralCash_(referredBy);
  }

  if (col.bonusApplied >= 0) {
    sheet.getRange(row, col.bonusApplied + 1).setValue("Y");
  }
}

function creditReferralCash_(friendName) {
  const refSheet = getSheetByGid_(REFERRALS_SHEET_GID);
  const refHeader = refSheet.getRange(1, 1, 1, refSheet.getLastColumn()).getValues()[0];
  const rCol = {
    friendName: findColumn_(refHeader, "Friend Name"),
    bonusOwed: findColumn_(refHeader, "Bonus Owed"),
  };
  if (rCol.friendName < 0 || rCol.bonusOwed < 0) return;

  const lastRow = refSheet.getLastRow();
  if (lastRow < 2) return;
  const names = refSheet.getRange(2, rCol.friendName + 1, lastRow - 1, 1).getValues().flat();
  const idx = names.findIndex((n) => String(n || "").trim().toLowerCase() === friendName.toLowerCase());
  if (idx < 0) return;

  const cell = refSheet.getRange(idx + 2, rCol.bonusOwed + 1);
  const current = Number(String(cell.getValue() || "").replace(/[^0-9.]/g, "")) || 0;
  cell.setValue("$" + (current + 5));
}
