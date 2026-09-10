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

// The workout tabs don't have a fixed gid the way the tabs above do — they
// only exist once setupWorkoutSheets() creates them in Apps Script, so
// there's no id to hardcode ahead of time. The gviz endpoint below reads a
// tab by its NAME instead of its gid, which is the one export URL Google
// Sheets offers that works that way.
function gvizCsvUrl_(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

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

/** Fetches + parses the "Referrals" tab once per page load, for join.html and referrer.html. */
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
          clientsReferred: findColumn(header, "Clients Referred"),
          tokensOwed: findColumn(header, "Tokens Owed"),
        };
        return { rows, col };
      });
  }
  return referralsPromise;
}

let exercisesPromise;

/** Fetches + parses the "Exercises" tab — the coach builder's autocomplete list, and the fallback starting weight when a client has no logged history yet. */
function fetchExercises() {
  if (!exercisesPromise) {
    exercisesPromise = fetch(gvizCsvUrl_("Exercises"), { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("exercises fetch failed");
        return res.text();
      })
      .then((text) => {
        const [header, ...rows] = parseCSV(text);
        const col = {
          name: findColumn(header, "Name"),
          startingWeight: findColumn(header, "Default Starting Weight (kg)"),
        };
        return { rows, col };
      });
  }
  return exercisesPromise;
}

let workoutExercisesPromise;

/** Fetches + parses the "Workout Exercises" tab — every client's currently assigned workout lives in here, one row per exercise. */
function fetchWorkoutExercises() {
  if (!workoutExercisesPromise) {
    workoutExercisesPromise = fetch(gvizCsvUrl_("Workout Exercises"), { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("workout exercises fetch failed");
        return res.text();
      })
      .then((text) => {
        const [header, ...rows] = parseCSV(text);
        const col = {
          client: findColumn(header, "Client"),
          workoutName: findColumn(header, "Workout Name"),
          order: findColumn(header, "Order"),
          exercise: findColumn(header, "Exercise"),
          sets: findColumn(header, "Target Sets"),
          reps: findColumn(header, "Target Reps"),
          days: findColumn(header, "Days"),
        };
        return { rows, col };
      });
  }
  return workoutExercisesPromise;
}

let loggedSetsPromise;

/** Fetches + parses the "Logged Sets" tab — full history, every set every client has ever logged. This is what the weight-prefill logic looks back through. */
function fetchLoggedSets() {
  if (!loggedSetsPromise) {
    loggedSetsPromise = fetch(gvizCsvUrl_("Logged Sets"), { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("logged sets fetch failed");
        return res.text();
      })
      .then((text) => {
        const [header, ...rows] = parseCSV(text);
        const col = {
          client: findColumn(header, "Client"),
          workoutName: findColumn(header, "Workout Name"),
          exercise: findColumn(header, "Exercise"),
          setNumber: findColumn(header, "Set Number"),
          weight: findColumn(header, "Weight (kg)"),
          reps: findColumn(header, "Reps"),
          date: findColumn(header, "Date"),
          timestamp: findColumn(header, "Timestamp"),
        };
        return { rows, col };
      });
  }
  return loggedSetsPromise;
}

/**
 * Fetches + parses the "Grocery Items" tab — deliberately NOT memoized like
 * the functions above, since several family members can be adding/removing
 * items around the same time and every open of the list should show the
 * current state, not whatever was cached on first load.
 */
function fetchGroceryItems() {
  return fetch(gvizCsvUrl_("Grocery Items"), { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error("grocery items fetch failed");
      return res.text();
    })
    .then((text) => {
      const [header, ...rows] = parseCSV(text);
      const col = {
        id: findColumn(header, "ID"),
        surname: findColumn(header, "Surname"),
        item: findColumn(header, "Item"),
        addedBy: findColumn(header, "Added By"),
        addedAt: findColumn(header, "Added At"),
      };
      return { rows, col };
    });
}
