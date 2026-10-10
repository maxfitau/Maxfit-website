/*
 * The Muscles tab (workout/library.html) — three states, one page:
 *   heat   — the default: a Muscle Heatmap of the client's own logged sets,
 *            Today or This Week (workout/heatmap.js does the counting,
 *            card/muscle-map.js's paintMuscleHeat does the colouring). Max's
 *            framing: this is so a client can see what a workout trains,
 *            not a static reference (2026-10-03).
 *   list   — every exercise from the Exercises sheet, reached via "Browse
 *            all exercises" from heat, grouped by movement/body part.
 *   detail — the "Anatomy Lab": one exercise's own real muscle figure
 *            (front + back) and an Add to Today's Workout button.
 * Kept as one page / three shown-hidden sections, not three page loads, so
 * jumping between exercises via the chip row (and back out to heat) is
 * instant.
 *
 * Link-only, like the rest of the client-facing card — no PIN.
 */
const libParams = new URLSearchParams(window.location.search);
const libMemberId = libParams.get("id") || (function () {
  try {
    return localStorage.getItem("maxfitMemberId") || "";
  } catch (err) {
    return "";
  }
})();

const libEls = {
  heat: document.getElementById("libHeat"),
  heatToggle: document.querySelectorAll(".lib-heat-toggle__btn"),
  heatFigures: document.getElementById("heatFigures"),
  heatBreakdown: document.getElementById("heatBreakdown"),
  heatEmpty: document.getElementById("heatEmpty"),
  heatUnmatched: document.getElementById("heatUnmatched"),
  heatBrowse: document.getElementById("heatBrowse"),
  list: document.getElementById("libList"),
  listBack: document.getElementById("listBack"),
  groups: document.getElementById("libGroups"),
  detail: document.getElementById("libDetail"),
  detailBack: document.getElementById("detailBack"),
  detailName: document.getElementById("detailName"),
  detailChips: document.getElementById("detailChips"),
  detailFigures: document.getElementById("detailFigures"),
  detailPrimary: document.getElementById("detailPrimary"),
  detailSecondary: document.getElementById("detailSecondary"),
  detailAdd: document.getElementById("detailAdd"),
  detailAddNote: document.getElementById("detailAddNote"),
  error: document.getElementById("libError"),
};

function libEsc(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

let libExercises = []; // [{ name, movement, bodyPart, primaryMuscles, secondaryMuscles, bestView }]
let libHeatRange = "today";

// Per-group expanded/collapsed state for the heat breakdown's collapsible
// sections (2026-10-09) — try/catch per Max's own spec wording, since
// localStorage can throw (private browsing, storage disabled) and a
// remembered UI preference is never worth crashing the page over. Unset
// (first visit, or storage unavailable) defaults to OPEN, matching how the
// old flat list showed everything at once with nothing to expand.
const LIB_GROUP_STATE_PREFIX_ = "maxfitMuscleGroupOpen:";
function libGroupIsOpen_(groupName) {
  try {
    const v = localStorage.getItem(LIB_GROUP_STATE_PREFIX_ + groupName);
    return v === null ? true : v === "1";
  } catch (err) {
    return true;
  }
}
function libSetGroupOpen_(groupName, open) {
  try {
    localStorage.setItem(LIB_GROUP_STATE_PREFIX_ + groupName, open ? "1" : "0");
  } catch (err) {
    // Not remembered next time, but the toggle still works for this view.
  }
}

function showLibHeat() {
  libEls.heat.hidden = false;
  libEls.list.hidden = true;
  libEls.detail.hidden = true;
  history.replaceState(null, "", window.location.pathname + window.location.search.replace(/[?&]ex=[^&]*/, "").replace(/^&/, "?"));
}

function showLibList() {
  libEls.heat.hidden = true;
  libEls.detail.hidden = true;
  libEls.list.hidden = false;
  history.replaceState(null, "", window.location.pathname + window.location.search.replace(/[?&]ex=[^&]*/, "").replace(/^&/, "?"));
}

function showLibDetail(exercise) {
  libEls.heat.hidden = true;
  libEls.list.hidden = true;
  libEls.detail.hidden = false;
  libEls.detailAddNote.hidden = true;
  libEls.detailName.textContent = exercise.name;

  const siblings = libExercises.filter((e) => e.bodyPart === exercise.bodyPart && e.name !== exercise.name).slice(0, 12);
  libEls.detailChips.innerHTML = [exercise, ...siblings]
    .map((e) => `<button class="lib-chip${e.name === exercise.name ? " is-active" : ""}" type="button" data-name="${libEsc(e.name)}">${libEsc(e.name)}</button>`)
    .join("");
  libEls.detailChips.querySelectorAll("[data-name]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = libExercises.find((e) => e.name === btn.dataset.name);
      if (next) showLibDetail(next);
    });
  });

  const frontSvg = muscleFigureSvg("front", "libFigFrontTitle");
  const backSvg = muscleFigureSvg("back", "libFigBackTitle");
  libEls.detailFigures.innerHTML =
    `<div><div class="lib-fig-wrap">${frontSvg}</div><span class="muscle-figure-caption">Front</span></div>` +
    `<div><div class="lib-fig-wrap">${backSvg}</div><span class="muscle-figure-caption">Back</span></div>`;
  const svgs = libEls.detailFigures.querySelectorAll("svg.muscle-figure");
  paintMuscleFigure(svgs[0], exercise.primaryMuscles, exercise.secondaryMuscles);
  paintMuscleFigure(svgs[1], exercise.primaryMuscles, exercise.secondaryMuscles);

  libEls.detailPrimary.textContent = exercise.primaryMuscles.length ? exercise.primaryMuscles.map(muscleLabel_).join(", ") : "—";
  libEls.detailSecondary.textContent = exercise.secondaryMuscles.length ? exercise.secondaryMuscles.map(muscleLabel_).join(", ") : "—";

  libEls.detailAdd.onclick = () => {
    const qs = new URLSearchParams();
    if (libMemberId) qs.set("id", libMemberId);
    qs.set("addExercise", exercise.name);
    window.location.href = `./${qs.toString() ? "?" + qs.toString() : ""}`;
  };

  const url = new URL(window.location.href);
  url.searchParams.set("ex", exercise.name);
  history.replaceState(null, "", url.toString());
}

const LIB_CHEVRON_SVG_ =
  '<svg class="lib-movement__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

function libBodyPartGroup_(bodyPart, list) {
  const color = typeof ExercisePicker !== "undefined" ? ExercisePicker.colorFor(bodyPart) : "#999";
  return (
    `<div class="lib-group">` +
    `<span class="lib-group__head"><span class="lib-group__dot" style="background:${color}"></span>${libEsc(bodyPart)}</span>` +
    list.map((ex) => `<button class="lib-row" type="button" data-name="${libEsc(ex.name)}">${libEsc(ex.name)}</button>`).join("") +
    "</div>"
  );
}

/**
 * Two levels so the list doesn't just run off the bottom of the screen:
 * Movement (Push/Pull/Legs/Core/Conditioning) as a collapsed `<details>`,
 * Body Part as a plain sub-heading once it's open — e.g. tap Push, see
 * Chest/Shoulders/Triceps/Traps each with their own exercises underneath.
 * Order and grouping come from ExercisePicker's own tables so this always
 * matches the builder's categories; any exercise whose movement/body part
 * isn't in those tables (shouldn't happen — Code.gs uses the same list)
 * still shows up, grouped at the end rather than silently dropped.
 */
function renderLibList() {
  const byMovement = {}; // movement -> { bodyPart -> exercises[] }
  libExercises.forEach((ex) => {
    if (!ex.movement || !ex.bodyPart) return;
    (byMovement[ex.movement] = byMovement[ex.movement] || {});
    (byMovement[ex.movement][ex.bodyPart] = byMovement[ex.movement][ex.bodyPart] || []).push(ex);
  });

  const knownMovements = typeof ExercisePicker !== "undefined" ? ExercisePicker.MOVEMENTS : Object.keys(byMovement).sort();
  const bodyPartsByMovement = typeof ExercisePicker !== "undefined" ? ExercisePicker.BODY_PARTS_BY_MOVEMENT : {};
  const extraMovements = Object.keys(byMovement)
    .filter((m) => !knownMovements.includes(m))
    .sort();

  libEls.groups.innerHTML = knownMovements
    .concat(extraMovements)
    .map((movement) => {
      const bodyParts = byMovement[movement];
      if (!bodyParts) return "";
      const knownBodyParts = bodyPartsByMovement[movement] || [];
      const extraBodyParts = Object.keys(bodyParts)
        .filter((bp) => !knownBodyParts.includes(bp))
        .sort();
      const orderedBodyParts = knownBodyParts.concat(extraBodyParts).filter((bp) => bodyParts[bp]);
      const count = orderedBodyParts.reduce((n, bp) => n + bodyParts[bp].length, 0);
      return (
        `<details class="lib-movement">` +
        `<summary class="lib-movement__head"><span>${libEsc(movement)}</span><span class="lib-movement__count">${count}</span>${LIB_CHEVRON_SVG_}</summary>` +
        `<div class="lib-movement__body">${orderedBodyParts.map((bp) => libBodyPartGroup_(bp, bodyParts[bp])).join("")}</div>` +
        "</details>"
      );
    })
    .join("");

  libEls.groups.querySelectorAll("[data-name]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ex = libExercises.find((e) => e.name === btn.dataset.name);
      if (ex) showLibDetail(ex);
    });
  });
}

libEls.detailBack.addEventListener("click", showLibList);
libEls.listBack.addEventListener("click", showLibHeat);
libEls.heatBrowse.addEventListener("click", showLibList);
libEls.heatToggle.forEach((btn) => {
  btn.addEventListener("click", () => loadHeat(btn.dataset.range));
});

/**
 * Paints the heat figures + the per-muscle breakdown list for `range`
 * ("today" | "week") from the client's real logged sets (workout/heatmap.js).
 * Max's framing: this is so a client can see what a workout trains, not a
 * static reference — always real data, never a worked example.
 */
// The 4 abs sub-regions (plus the bare coarse "abs" a Conditioning exercise
// can carry straight from the sheet) merge into one "Rectus Abdominis" row
// in the grouped list — Max's own request, scoped to abs only; every other
// fine key (front/side/rear delt included) keeps its own row.
const LIB_ABS_MERGE_KEYS_ = ["abs-upper", "abs-mid", "abs-lower", "abs-infra", "abs"];

/**
 * The flat per-key maps with the abs sub-regions merged into one
 * "abs-rectus" entry — shared by the grouped list, the This Week figure's
 * status colouring, and the tooltip (Goal 4), so the list, the figure and
 * the tooltip all agree on one combined abs number rather than computing
 * the merge three times and risking them drifting apart. `contributionsByMuscle`
 * (optional — heatmapMuscleData's own) merges the same way: each target's
 * per-exercise contributions are summed in, so tapping any of the 4 ab
 * shapes shows exercises across all of them, matching the single merged row.
 */
function libMergedWeighted_(weighted, primaryCount, secondaryCount, contributionsByMuscle) {
  const merged = {};
  function add(key, w, p, s, contrib) {
    if (!merged[key]) merged[key] = { weighted: 0, primaryCount: 0, secondaryCount: 0, contributions: {} };
    merged[key].weighted += w || 0;
    merged[key].primaryCount += p || 0;
    merged[key].secondaryCount += s || 0;
    Object.keys(contrib || {}).forEach((name) => {
      merged[key].contributions[name] = (merged[key].contributions[name] || 0) + contrib[name];
    });
  }
  Object.keys(weighted).forEach((key) => {
    const target = LIB_ABS_MERGE_KEYS_.includes(key) ? "abs-rectus" : key;
    add(target, weighted[key], (primaryCount || {})[key], (secondaryCount || {})[key], (contributionsByMuscle || {})[key]);
  });
  return merged;
}

/**
 * Buckets an already-merged map (libMergedWeighted_) into Max's 6
 * top-level sections (muscleUiGroupOf_, card/muscle-map.js). Returns
 * [{ group, rows }] in MUSCLE_UI_GROUPS_ order, each rows list sorted by
 * weighted desc; a group with nothing trained in range is left out
 * entirely — same "don't show empty" rule the old flat list already had.
 */
function libGroupedHeatEntries_(merged) {
  const byGroup = {};
  Object.keys(merged).forEach((key) => {
    if (merged[key].weighted <= 0) return;
    const group = muscleUiGroupOf_(key);
    (byGroup[group] = byGroup[group] || []).push(Object.assign({ key }, merged[key]));
  });

  return MUSCLE_UI_GROUPS_.filter((g) => byGroup[g] && byGroup[g].length).map((group) => ({
    group,
    rows: byGroup[group].sort((a, b) => b.weighted - a.weighted),
  }));
}

/**
 * One collapsible section of the heat breakdown — same visual language as
 * the exercise list's Movement <details> below (lib-movement family),
 * reused directly rather than duplicated, since both are "tap a heading to
 * expand a body-region" on the same page. Open/closed state is read here
 * and written back by loadHeat's toggle listener. This Week shows each
 * muscle's weighted total against its weekly target (Goal 3, 2026-10-09);
 * Today keeps the older plain count — a single day isn't comparable to a
 * weekly target.
 */
function libMuscleGroupHtml_(group, rows, range) {
  const open = libGroupIsOpen_(group) ? " open" : "";
  const rowsHtml = rows
    .map((r) => (range === "week" ? heatWeekTargetRowHtml_(r.key, r.weighted) : heatTodayRowHtml_(r.key, r.weighted)))
    .join("");
  return (
    `<details class="lib-movement"${open} data-group="${libEsc(group)}">` +
    `<summary class="lib-movement__head"><span>${libEsc(group)}</span><span class="lib-movement__count">${rows.length}</span>${LIB_CHEVRON_SVG_}</summary>` +
    `<div class="lib-movement__body">${rowsHtml}</div>` +
    "</details>"
  );
}

/**
 * Tapping a muscle shape on the figure expands/highlights its group in the
 * breakdown list below (Goal 4, 2026-10-09) — opens it if it was collapsed
 * (persisted the same way a manual tap on the header would be), scrolls it
 * into view, and gives it a brief highlight so it's obvious which section
 * just responded to the tap. A muscle whose group isn't currently rendered
 * (shouldn't happen — wireMuscleTooltips_ only calls this for a shape that
 * already has a tooltip, which means it has real data, which means
 * libGroupedHeatEntries_ included its group) is a harmless no-op.
 */
function libExpandGroupFor_(key) {
  const group = muscleUiGroupOf_(key);
  const details = libEls.heatBreakdown.querySelector(`details[data-group="${CSS.escape(group)}"]`);
  if (!details) return;
  if (!details.open) {
    details.open = true;
    libSetGroupOpen_(group, true);
  }
  details.scrollIntoView({ behavior: "smooth", block: "nearest" });
  // The class is added instantly (nothing to transition FROM yet) and
  // removed on a timer — library.css's transition then animates that
  // removal (the fade back to transparent), so re-tapping mid-fade just
  // restarts the clock rather than fighting an in-progress animation.
  clearTimeout(details.dataset.pulseTimer ? Number(details.dataset.pulseTimer) : undefined);
  details.classList.add("lib-movement--pulse");
  const timer = setTimeout(() => details.classList.remove("lib-movement--pulse"), 600);
  details.dataset.pulseTimer = String(timer);
}

async function loadHeat(range) {
  libHeatRange = range;
  libEls.heatToggle.forEach((btn) => {
    const on = btn.dataset.range === range;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });

  // Any open tooltip is anchored to a shape from the FIGURE we're about to
  // throw away below (muscleFigureSvg builds fresh DOM every call) — close
  // it first rather than leaving it pointing at a detached element.
  muscleTooltipHide_();

  const frontSvg = muscleFigureSvg("front", "heatFigFrontTitle");
  const backSvg = muscleFigureSvg("back", "heatFigBackTitle");
  libEls.heatFigures.innerHTML =
    `<div><div class="lib-fig-wrap">${frontSvg}</div><span class="muscle-figure-caption">Front</span></div>` +
    `<div><div class="lib-fig-wrap">${backSvg}</div><span class="muscle-figure-caption">Back</span></div>`;
  const svgs = libEls.heatFigures.querySelectorAll("svg.muscle-figure");

  let weighted = {};
  let primaryCount = {};
  let secondaryCount = {};
  let contributionsByMuscle = {};
  let setsCounted = 0;
  let unmatchedByName = {};
  let unmatchedSetsCount = 0;
  try {
    const data = await heatmapMuscleData(libMemberId, range);
    weighted = data.weighted;
    primaryCount = data.primaryCount;
    secondaryCount = data.secondaryCount;
    contributionsByMuscle = data.contributionsByMuscle || {};
    setsCounted = data.setsCounted;
    unmatchedByName = data.unmatchedByName || {};
    unmatchedSetsCount = data.unmatchedSetsCount || 0;
  } catch (err) {
    // A quiet, all-grey figure beats a crash — the breakdown list below
    // staying empty already says nothing was found.
  }

  // This Week colours by target status (Goal 3) — a weekly target isn't
  // comparable to a single day, so Today keeps the older relative scaling.
  const merged = libMergedWeighted_(weighted, primaryCount, secondaryCount, contributionsByMuscle);
  // paintMuscleHeatByStatus_ wants a flat { key: number }, same shape as
  // paintMuscleHeat's own `weighted` — merged's values are the richer
  // { weighted, primaryCount, secondaryCount, contributions } the grouped
  // LIST and the tooltip need, so pull just the number back out here rather
  // than changing that shape.
  const mergedWeightedOnly = {};
  Object.keys(merged).forEach((k) => (mergedWeightedOnly[k] = merged[k].weighted));
  svgs.forEach((svg) => (range === "week" ? paintMuscleHeatByStatus_(svg, mergedWeightedOnly) : paintMuscleHeat(svg, weighted)));

  // Goal 4 (2026-10-09): hover/tap a shape for its own breakdown. Today has
  // no weekly target to show; This Week does. Tapping a shape also
  // expands/highlights its group in the list below.
  svgs.forEach((svg) =>
    wireMuscleTooltips_(
      svg,
      (rawKey) => {
        const key = muscleAbsDisplayKey_(rawKey);
        const m = merged[key];
        if (!m || m.weighted <= 0) return null;
        const target = range === "week" ? muscleWeeklyTarget_(key) : null;
        return muscleTooltipContentHtml_(key, m.weighted, m.primaryCount, m.secondaryCount, muscleTopContributions_(m.contributions), target);
      },
      (key) => libExpandGroupFor_(key)
    )
  );

  libEls.heatEmpty.hidden = setsCounted > 0;
  const groups = libGroupedHeatEntries_(merged);
  libEls.heatBreakdown.innerHTML = groups.map((g) => libMuscleGroupHtml_(g.group, g.rows, range)).join("");
  libEls.heatBreakdown.querySelectorAll("details[data-group]").forEach((el) => {
    el.addEventListener("toggle", () => libSetGroupOpen_(el.dataset.group, el.open));
  });

  // Sets whose exercise name doesn't resolve to the Exercises catalog never
  // silently vanish from the total any more (2026-10-09) — named here so a
  // client/coach can see exactly what's missing and why the numbers above
  // might look lower than expected, instead of a gap with no explanation.
  const unmatchedNames = Object.keys(unmatchedByName).sort((a, b) => unmatchedByName[b] - unmatchedByName[a]);
  libEls.heatUnmatched.hidden = !unmatchedSetsCount;
  if (unmatchedSetsCount) {
    const list = unmatchedNames.map((n) => `${libEsc(n)} (${unmatchedByName[n]})`).join(", ");
    libEls.heatUnmatched.textContent = `${unmatchedSetsCount} set${unmatchedSetsCount === 1 ? "" : "s"} not counted — exercise name${unmatchedNames.length === 1 ? "" : "s"} not in the library: ${list}`;
  }
}

/** Today: unchanged from before v2 — one red fill, just "how much", no weekly target. */
function heatTodayRowHtml_(key, n) {
  return `
    <div class="lib-heat-row">
      <span class="lib-heat-row__name">${libEsc(muscleLabel_(key))}</span>
      <span class="lib-heat-row__track"><span class="lib-heat-row__fill lib-heat-row__fill--primary" style="width:${Math.min(100, (n / 10) * 100)}%"></span></span>
      <span class="lib-heat-row__num">${n % 1 === 0 ? n : n.toFixed(1)}</span>
    </div>`;
}

/**
 * This Week (Goal 3, 2026-10-09): a single bar coloured by status against
 * the muscle's weekly target range (muscleTargetStatus_/muscleWeeklyTarget_,
 * card/muscle-map.js) — grey under target, red in range, amber above —
 * instead of the old primary/secondary direct-vs-indirect split. "x.x /
 * min–max" to one decimal, per Max's own spec. The direct/indirect detail
 * this replaced moves to the per-muscle tooltip instead (Goal 4, not yet
 * built), not lost, just no longer the headline number.
 *
 * The bar's track represents target.max * 1.5, not just target.max, so an
 * "above" muscle still shows visibly more fill rather than every
 * over-target muscle instantly pegging at 100% — the number next to it
 * carries the exact value regardless of how full the bar looks.
 */
function heatWeekTargetRowHtml_(key, value) {
  const target = muscleWeeklyTarget_(key);
  const status = muscleTargetStatus_(value, target);
  const ceiling = target.max * 1.5;
  const pct = Math.max(0, Math.min(100, (value / ceiling) * 100));
  return `
    <div class="lib-heat-row lib-heat-row--target">
      <span class="lib-heat-row__name">${libEsc(muscleLabel_(key))}</span>
      <span class="lib-heat-row__track"><span class="lib-heat-row__fill lib-heat-row__fill--${status}" style="width:${pct}%"></span></span>
      <span class="lib-heat-row__target-num lib-heat-row__target-num--${status}">${value.toFixed(1)}<span class="lib-heat-row__target-range"> / ${target.min}–${target.max}</span></span>
    </div>`;
}

async function initLibrary() {
  try {
    const { rows, col } = await fetchExercises();
    if (col.name < 0) throw new Error("no Name column");
    libExercises = rows
      .map((r) => ({
        name: String(r[col.name] || "").trim(),
        movement: col.movement >= 0 ? String(r[col.movement] || "").trim() : "",
        bodyPart: col.bodyPart >= 0 ? String(r[col.bodyPart] || "").trim() : "",
        primaryMuscles: col.primaryMuscles >= 0 ? parseMuscleKeys(r[col.primaryMuscles]) : [],
        secondaryMuscles: col.secondaryMuscles >= 0 ? parseMuscleKeys(r[col.secondaryMuscles]) : [],
      }))
      .filter((ex) => ex.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    libEls.error.hidden = false;
    return;
  }

  renderLibList();

  const exParam = libParams.get("ex");
  const preset = exParam ? libExercises.find((e) => e.name === exParam) : null;
  if (preset) showLibDetail(preset);
}

// Heat is the default landing view (already the only un-hidden section in
// the markup) — loads independently of the exercise list below, which
// only matters once someone taps into Browse or a deep link asks for one
// exercise's own detail screen.
loadHeat("today");
initLibrary();
