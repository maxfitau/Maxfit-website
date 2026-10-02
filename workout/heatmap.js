/*
 * Muscle Heatmap data (workout/library.html's #libHeat) — how much a
 * client has actually trained each muscle, from their real logged sets
 * (card/sheet.js's fetchLoggedSets), not the static per-exercise figure
 * the library/detail screen uses. Max's own framing: this is so a client
 * can see what a workout trains, not just browse a list (2026-10-03).
 *
 * Weighting matches his original spec: a set of an exercise where a
 * muscle is PRIMARY counts 1, SECONDARY counts 0.5 — summed per muscle
 * key over whatever date range is asked for (today, or this week).
 */

/** Monday of the week containing `ymd` ("2026-10-03" -> "2026-09-29"), Monday-start like Fuel's week. */
function heatMondayOf(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0 Sun .. 6 Sat
  const back = day === 0 ? 6 : day - 1;
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}

function heatTodayYmd_() {
  const tz = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" });
  return tz.format(new Date()); // en-CA gives YYYY-MM-DD directly
}

/** "2026-10-03" -> 20261003, comparable, for a date column that may come back in other shapes. Same approach as workout/app.js's dateSortKey, copied rather than shared since library.html doesn't load app.js. */
function heatDateSortKey_(raw) {
  const parts = String(raw || "").trim().split("-");
  if (parts.length !== 3) return NaN;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if (!y || !m || !d) return NaN;
  return y * 10000 + m * 100 + d;
}

/**
 * { key: weightedSets } for `memberId` over `range` ("today" | "week").
 * Unknown exercises (not in the Exercises sheet, or no muscle data yet)
 * are silently skipped — same "don't blow up on gaps" approach as the
 * rest of the muscle-data integration.
 */
async function heatmapMuscleData(memberId, range) {
  const clientSlug = slugify(String(memberId || ""));
  const [{ rows: setRows, col: setCol }, { rows: exRows, col: exCol }] = await Promise.all([fetchLoggedSets(), fetchExercises()]);

  const muscleByExercise = {};
  exRows.forEach((r) => {
    const name = String(exCol.name >= 0 ? r[exCol.name] : "").trim().toLowerCase();
    if (!name) return;
    muscleByExercise[name] = {
      primary: exCol.primaryMuscles >= 0 ? parseMuscleKeys(r[exCol.primaryMuscles]) : [],
      secondary: exCol.secondaryMuscles >= 0 ? parseMuscleKeys(r[exCol.secondaryMuscles]) : [],
    };
  });

  const today = heatTodayYmd_();
  const fromYmd = range === "week" ? heatMondayOf(today) : today;
  const fromKey = heatDateSortKey_(fromYmd);
  const toKey = heatDateSortKey_(today);

  const weighted = {};
  let setsCounted = 0;
  setRows.forEach((row) => {
    if (String(setCol.client >= 0 ? row[setCol.client] : "").trim().toLowerCase() !== clientSlug) return;
    const key = setCol.date >= 0 ? heatDateSortKey_(row[setCol.date]) : NaN;
    if (!Number.isFinite(key) || key < fromKey || key > toKey) return;
    const exName = String(setCol.exercise >= 0 ? row[setCol.exercise] : "").trim().toLowerCase();
    const muscles = muscleByExercise[exName];
    if (!muscles) return;
    setsCounted++;
    muscles.primary.forEach((m) => {
      weighted[m] = (weighted[m] || 0) + 1;
    });
    muscles.secondary.forEach((m) => {
      weighted[m] = (weighted[m] || 0) + 0.5;
    });
  });

  return { weighted, setsCounted };
}
