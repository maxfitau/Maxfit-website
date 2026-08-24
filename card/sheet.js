/*
 * Shared Google Sheet access — used by both the membership card (card/app.js)
 * and the check-in page (checkin.html) so there's one copy of the fetch/parse
 * logic instead of two drifting independently.
 *
 * Reads live from the "Sessions Remaining" tab of the Google Sheet CRM
 * (docs.google.com/spreadsheets/d/1dGQyIoJ2_XrkbvvPvM2JAY0xdeYQfsCnYHal8WZojUg,
 * gid 1169726169). The sheet must stay shared as "Anyone with the link —
 * Viewer" for this fetch to work (no login, no API key involved).
 */

const SHEET_ID = "1dGQyIoJ2_XrkbvvPvM2JAY0xdeYQfsCnYHal8WZojUg";
const SHEET_GID = "1169726169"; // "Sessions Remaining" tab
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

const REFERRALS_GID = "1148655449"; // "Refferals"
const REFERRALS_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${REFERRALS_GID}`;

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Minimal RFC4180 CSV parser — handles quoted fields with commas inside. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Case/whitespace-insensitive header lookup — sheet column naming won't always match exactly. */
function findColumn(header, name) {
  return header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
}

/**
 * Parses a "sessions remaining" cell: a plain number stays a number: blank
 * or non-numeric text (e.g. "unlimited") falls back to fallback instead —
 * Number("") is 0 in JS, not NaN, so that blank-vs-zero distinction has to
 * be checked explicitly rather than trusting Number.isFinite() alone.
 */
function parseSessions(raw, fallback) {
  const trimmed = (raw || "").trim();
  const num = Number(trimmed);
  return trimmed !== "" && Number.isFinite(num) ? num : fallback;
}

let sheetPromise;

/** Fetches + parses the sheet once per page load; every caller shares the same result. */
function fetchSheet() {
  if (!sheetPromise) {
    sheetPromise = fetch(SHEET_CSV_URL, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("sheet fetch failed");
        return res.text();
      })
      .then((text) => {
        const [header, ...rows] = parseCSV(text);
        const col = {
          name: findColumn(header, "Name"),
          package: findColumn(header, "Package Type"),
          groupSessions: findColumn(header, "Group Sessions Remaining"),
          oneOnOneSessions: findColumn(header, "1 on 1 Remaining"),
          amountOwing: findColumn(header, "Amount Owing"),
          programType: findColumn(header, "Program Type"),
          class: findColumn(header, "Class"),
          programDoc: findColumn(header, "Program Doc"),
          checkInToken: findColumn(header, "Check-in Token"),
          totalAttended: findColumn(header, "Total Classes Attended"),
        };
        return { rows, col };
      });
  }
  return sheetPromise;
}

let referralsPromise;

/** Fetches + parses the "Referrals" tab once per page load, for join.html. */
function fetchReferrals() {
  if (!referralsPromise) {
    referralsPromise = fetch(REFERRALS_CSV_URL, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("referrals fetch failed");
        return res.text();
      })
      .then((text) => {
        const [header, ...rows] = parseCSV(text);
        const col = {
          friendName: findColumn(header, "Friend Name"),
          code: findColumn(header, "Referral Code"),
          discount: findColumn(header, "Discount"),
        };
        return { rows, col };
      });
  }
  return referralsPromise;
}
