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
 * `weighted` ({ key: primary*1 + secondary*0.5 }) for `memberId` over
 * `range` ("today" | "week") — unchanged, still what the heat figure paints
 * from (secondary counts for less since it's along for the ride, not the
 * muscle actually being trained). `primaryCount`/`secondaryCount` (2026-10-04)
 * are plain, unweighted tallies of how many sets actually hit each muscle
 * each way — what the This Week breakdown list's red/orange bar shows,
 * since that list is meant to read as literal set counts ("3 direct sets,
 * plus 4 more where it was a secondary mover"), not an intensity score.
 *
 * Keyed by whatever the exercise data actually says (2026-10-05) — a fine
 * key ("delts-front") if the exercise has one, a broad one ("delts") if it
 * doesn't — not pre-collapsed to the broad group any more. Max's own ask:
 * he wants to see front vs side vs rear delt separately, not folded into
 * one "Shoulders" row, and the figure already has a separate shape for
 * each (card/muscle-map.js) — so there's nothing to lose by keeping the
 * real precision the exercise data already has.
 * Unknown exercises (not in the Exercises sheet, or no muscle data yet) are
 * silently skipped — same "don't blow up on gaps" approach as the rest of
 * the muscle-data integration.
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
  const primaryCount = {};
  const secondaryCount = {};
  let setsCounted = 0;
  setRows.forEach((row) => {
    if (String(setCol.client >= 0 ? row[setCol.client] : "").trim().toLowerCase() !== clientSlug) return;
    const key = setCol.date >= 0 ? heatDateSortKey_(row[setCol.date]) : NaN;
    if (!Number.isFinite(key) || key < fromKey || key > toKey) return;
    const exName = String(setCol.exercise >= 0 ? row[setCol.exercise] : "").trim().toLowerCase();
    const muscles = muscleByExercise[exName];
    if (!muscles) return;
    setsCounted++;
    // De-duplicated against the raw key list, not one increment per array
    // entry — belt and suspenders against the data itself ever listing the
    // same key twice; harmless either way.
    new Set(muscles.primary).forEach((k) => {
      weighted[k] = (weighted[k] || 0) + 1;
      primaryCount[k] = (primaryCount[k] || 0) + 1;
    });
    new Set(muscles.secondary).forEach((k) => {
      weighted[k] = (weighted[k] || 0) + 0.5;
      secondaryCount[k] = (secondaryCount[k] || 0) + 1;
    });
  });

  return { weighted, primaryCount, secondaryCount, setsCounted };
}
