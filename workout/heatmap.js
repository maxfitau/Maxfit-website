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
 *
 * Exercise names are matched to the Exercises catalog through the shared
 * resolver (buildExerciseIndex_/resolveExerciseMuscles_, card/muscle-map.js)
 * rather than a plain exact-lowercase lookup — found 2026-10-08 that the
 * old exact-only matching was silently dropping 65% of all logged sets
 * ("Bicep Curls" never matched "Barbell Curl", "Pull-ups" never matched
 * "Pull-Up", etc). A set whose exercise still doesn't resolve is tallied
 * into unmatchedByName/unmatchedSetsCount instead of just vanishing.
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
  const exerciseIndex = buildExerciseIndex_(exRows, exCol);

  const today = heatTodayYmd_();
  const fromYmd = range === "week" ? heatMondayOf(today) : today;
  const fromKey = heatDateSortKey_(fromYmd);
  const toKey = heatDateSortKey_(today);

  const weighted = {};
  const primaryCount = {};
  const secondaryCount = {};
  // Per muscle key, how much each DISTINCT exercise name contributed in
  // range, summed across however many sets of it were logged — the body
  // figure's tooltip (Goal 4, 2026-10-09) shows the top 3 per muscle, so
  // "why is this muscle high this week" has a real answer, not just a
  // number. Keyed by the exercise's own catalog name (resolved.catalogName),
  // not whatever raw spelling was logged, so "Pull-ups" and "Pull-Up" merge
  // into one line instead of splitting credit across two.
  const contributionsByMuscle = {};
  let setsCounted = 0;
  // Every exercise name in range that DIDN'T resolve, with how many sets —
  // shown as "N sets not counted" (workout/library.js) rather than silently
  // vanishing from the total the way a missing entry used to (2026-10-09).
  const unmatchedByName = {};
  let unmatchedSetsCount = 0;
  setRows.forEach((row) => {
    if (String(setCol.client >= 0 ? row[setCol.client] : "").trim().toLowerCase() !== clientSlug) return;
    const key = setCol.date >= 0 ? heatDateSortKey_(row[setCol.date]) : NaN;
    if (!Number.isFinite(key) || key < fromKey || key > toKey) return;
    const exName = String(setCol.exercise >= 0 ? row[setCol.exercise] : "").trim();
    if (!exName) return;
    const resolved = resolveExerciseMuscles_(exName, exerciseIndex);
    if (!resolved.matched) {
      unmatchedByName[exName] = (unmatchedByName[exName] || 0) + 1;
      unmatchedSetsCount++;
      return;
    }
    setsCounted++;
    // Effective-sets model (2026-10-09) — effectiveSetsPerSet_ already
    // caps any single set's contribution to a muscle GROUP at 1.0, even
    // when an exercise lists more than one fine head for it (the old
    // Hanging-Leg-Raise-style double count). The scale hook is a no-op
    // today (Logged Sets has no RIR/RPE column) but keeps the real set row
    // in reach for when one gets added.
    const scale = effortScaleForSet_(row, setCol);
    const perSet = effectiveSetsPerSet_(resolved);
    Object.keys(perSet).forEach((k) => {
      const contribution = perSet[k] * scale;
      weighted[k] = (weighted[k] || 0) + contribution;
      const byExercise = (contributionsByMuscle[k] = contributionsByMuscle[k] || {});
      byExercise[resolved.catalogName] = (byExercise[resolved.catalogName] || 0) + contribution;
    });
    // primaryCount/secondaryCount stay a plain, literal tally of the
    // catalog's primary/secondary ROLE per set — unrelated to the weighted
    // effective-sets number above, and still what the red/orange segment
    // counts in the breakdown list show.
    new Set(resolved.primary).forEach((k) => {
      primaryCount[k] = (primaryCount[k] || 0) + 1;
    });
    new Set(resolved.secondary).forEach((k) => {
      secondaryCount[k] = (secondaryCount[k] || 0) + 1;
    });
  });

  return { weighted, primaryCount, secondaryCount, contributionsByMuscle, setsCounted, unmatchedByName, unmatchedSetsCount };
}
