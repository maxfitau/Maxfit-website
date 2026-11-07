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

/**
 * A date as the sheet shows it, to "yyyy-mm-dd" ("" if it isn't one). The live
 * tab mixes styles: 2026-11-03, 3/11/26 and 25/08/2026, all day-first.
 */
function parseSheetDate(raw) {
  const t = String(raw || "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  else return "";
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

/** True when Max has marked this row Client = Yes (blank, No or no column all mean app member). */
function isClientRow(row, col) {
  return col.client >= 0 && String(row[col.client] || "").trim().toLowerCase() === "yes";
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
          duoSessions: findColumn(header, "Duo Remaining"), // -1 until the sheet has the column
          programType: findColumn(header, "Program Type"),
          class: findColumn(header, "Class"),
          programDoc: findColumn(header, "Program Doc"),
          checkInToken: findColumn(header, "Check-in Token"),
          totalAttended: findColumn(header, "Total Classes Attended"),
          // Bonus punches on the loyalty card: FUEL adds one per week of 5
          // green days, the check-in script adds one for every session a
          // referred friend pays for, and one for every session Max adds by
          // hand to a client's own Paid Sessions. "Free Session Owed" is "Y"
          // when a bonus punch completed a card.
          nutritionPunches: findColumn(header, "Nutrition Punches"),
          referralPunches: findColumn(header, "Referral Punches"),
          manualPunches: findColumn(header, "Manual Session Punches"),
          freeOwed: findColumn(header, "Free Session Owed"),
          // Clients vs app members (2026-11-05). "Client" is Yes for people Max
          // trains in person; -1 until setupClientStatus() has added the column.
          client: findColumn(header, "Client"),
          joinedVia: findColumn(header, "Joined Via"),
          signupDate: findColumn(header, "Sign-up Date"),
          lastAttended: findColumn(header, "Last Attended"),
          referredBy: findColumn(header, "Referred By"),
          phone: findColumn(header, "Phone"),
        };
        return { rows, col };
      });
  }
  return sheetPromise;
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
          movement: findColumn(header, "Movement"),
          bodyPart: findColumn(header, "Body Part"),
          startingWeight: findColumn(header, "Default Starting Weight (kg)"),
          equipment: findColumn(header, "Equipment"),
          primaryMuscles: findColumn(header, "Primary Muscles"),
          secondaryMuscles: findColumn(header, "Secondary Muscles"),
          bestView: findColumn(header, "Best View"),
          aliases: findColumn(header, "Aliases"),
          muscleWeights: findColumn(header, "Muscle Weights"),
        };
        return { rows, col };
      });
  }
  return exercisesPromise;
}

/** Forget the cached Exercises tab, so the next fetchExercises() reads the sheet again (the builder calls this after adding an exercise). */
function resetExercisesCache() {
  exercisesPromise = undefined;
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
          workoutOrder: findColumn(header, "Workout Order"),
          notes: findColumn(header, "Exercise Notes"), // the coach's tip for one exercise
          workoutNotes: findColumn(header, "Workout Notes"), // a note for the whole workout (repeated on each of its rows)
          superset: findColumn(header, "Superset"), // "Y" = this exercise + the next one (by Order) are done back-to-back
          supersetRest: findColumn(header, "Superset Rest"), // seconds of rest after each round, on the superset's first exercise; blank = 90
          // Boxing rounds (2026-11-07): Block Type "Rounds" marks a block; Target Sets above doubles as its round count.
          blockType: findColumn(header, "Block Type"),
          workSeconds: findColumn(header, "Work Seconds"),
          restSeconds: findColumn(header, "Rest Seconds"),
          combos: findColumn(header, "Combos"), // one combo per round, separated by " | " — a single value means every round
          runBy: findColumn(header, "Run By"), // "Client" or "Coach"
          easierOption: findColumn(header, "Easier Option"), // "Y" = offer shadow boxing if no bag is free
        };
        return { rows, col };
      });
  }
  return workoutExercisesPromise;
}

let mixItUpPromise;

/**
 * Fetches + parses the "Mix It Up" tab (2026-11-09): Max's surprise HIIT
 * workouts, one row per exercise. A sheet with no such tab makes Google send
 * back the FIRST tab instead of an error, so a reply without a "Block Type"
 * and "Workout" header is treated as "no tab yet" (empty list).
 */
function fetchMixItUp() {
  if (!mixItUpPromise) {
    mixItUpPromise = fetch(gvizCsvUrl_("Mix It Up"), { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("mix it up fetch failed");
        return res.text();
      })
      .then((text) => {
        const [header, ...rows] = parseCSV(text);
        const col = {
          on: findColumn(header, "On"),
          workout: findColumn(header, "Workout"),
          style: findColumn(header, "Style"),
          equipment: findColumn(header, "Equipment"),
          minutes: findColumn(header, "Minutes"),
          blockOrder: findColumn(header, "Block Order"),
          blockType: findColumn(header, "Block Type"),
          blockName: findColumn(header, "Block Name"),
          rounds: findColumn(header, "Rounds"),
          workSeconds: findColumn(header, "Work Seconds"),
          restSeconds: findColumn(header, "Rest Seconds"),
          restBetween: findColumn(header, "Rest Between Rounds"),
          blockMinutes: findColumn(header, "Block Minutes"),
          exerciseOrder: findColumn(header, "Exercise Order"),
          exercise: findColumn(header, "Exercise"),
          easier: findColumn(header, "Easier"),
          reps: findColumn(header, "Target Reps"),
          combos: findColumn(header, "Combos"),
        };
        if (col.workout < 0 || col.blockType < 0 || col.exercise < 0) return { rows: [], col };
        return { rows, col };
      });
  }
  return mixItUpPromise;
}

const loggedSetsPromises = {};

/**
 * Fetches + parses the "Logged Sets" tab — full history, every set every
 * client has ever logged. This is what the weight-prefill logic looks back
 * through.
 *
 * Pass a client's slug to get only their rows (2026-10-29): the tab grows
 * every session, and a client page only ever uses its own client's sets, so
 * Google filters it before sending (a query on the Client column, column A)
 * instead of every page downloading everyone's history. If the Client
 * column ever moves, the reply's header won't start with "Client" and this
 * falls back to the whole tab, so nothing breaks. No slug (the coach page)
 * still gets every client.
 */
function fetchLoggedSets(clientSlug) {
  const slug = String(clientSlug || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!loggedSetsPromises[slug]) {
    const parse = (text) => {
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
        notes: findColumn(header, "Notes"),
        // Boxing rounds (2026-11-07): Weight/Reps above are always 0 on these
        // rows. Type "round" (client-run, counts on the muscle map) or
        // "pads" (coach-run, session history only) — blank is every normal
        // set. Duration is the seconds actually done.
        duration: findColumn(header, "Duration (s)"),
        type: findColumn(header, "Type"),
        // "Log something else" (2026-11-08): a run/walk row's Type is "run"/
        // "walk" (Weight/Reps still 0), with its own Distance — Duration
        // above is still what carries the time.
        distance: findColumn(header, "Distance (km)"),
      };
      return { header, rows, col };
    };
    const get = (url) =>
      fetch(url, { cache: "no-store" }).then((res) => {
        if (!res.ok) throw new Error("logged sets fetch failed");
        return res.text();
      });
    const all = () => get(gvizCsvUrl_("Logged Sets")).then(parse);
    loggedSetsPromises[slug] = (
      slug
        ? get(gvizCsvUrl_("Logged Sets") + "&tq=" + encodeURIComponent(`select * where lower(A) = '${slug}'`))
            .then(parse)
            .then((r) => (String(r.header[0] || "").trim().toLowerCase() === "client" ? r : all()))
            .catch(() => all())
        : all()
    ).then(({ rows, col }) => ({ rows, col }));
  }
  return loggedSetsPromises[slug];
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
