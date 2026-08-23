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
          sessions: findColumn(header, "Sessions Remaining"),
          amountOwing: findColumn(header, "Amount Owing"),
          programType: findColumn(header, "Program Type"),
          class: findColumn(header, "Class"),
          programDoc: findColumn(header, "Program Doc"),
          checkInToken: findColumn(header, "Check-in Token"),
        };
        return { rows, col };
      });
  }
  return sheetPromise;
}
