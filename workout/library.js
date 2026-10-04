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
async function loadHeat(range) {
  libHeatRange = range;
  libEls.heatToggle.forEach((btn) => {
    const on = btn.dataset.range === range;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });

  const frontSvg = muscleFigureSvg("front", "heatFigFrontTitle");
  const backSvg = muscleFigureSvg("back", "heatFigBackTitle");
  libEls.heatFigures.innerHTML =
    `<div><div class="lib-fig-wrap">${frontSvg}</div><span class="muscle-figure-caption">Front</span></div>` +
    `<div><div class="lib-fig-wrap">${backSvg}</div><span class="muscle-figure-caption">Back</span></div>`;
  const svgs = libEls.heatFigures.querySelectorAll("svg.muscle-figure");

  let weighted = {};
  let weightedPrimary = {};
  let weightedSecondary = {};
  let setsCounted = 0;
  try {
    const data = await heatmapMuscleData(libMemberId, range);
    weighted = data.weighted;
    weightedPrimary = data.weightedPrimary;
    weightedSecondary = data.weightedSecondary;
    setsCounted = data.setsCounted;
  } catch (err) {
    // A quiet, all-grey figure beats a crash — the breakdown list below
    // staying empty already says nothing was found.
  }

  svgs.forEach((svg) => paintMuscleHeat(svg, weighted));

  libEls.heatEmpty.hidden = setsCounted > 0;
  const entries = Object.keys(weighted)
    .filter((k) => weighted[k] > 0)
    .sort((a, b) => weighted[b] - weighted[a]);
  libEls.heatBreakdown.innerHTML = entries
    .map((k) => range === "week" ? heatWeekRowHtml_(k, weightedPrimary[k] || 0, weightedSecondary[k] || 0) : heatTodayRowHtml_(k, weighted[k]))
    .join("");
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

// How many weighted sets (primary counts 1, secondary counts 0.5 — same
// weighting as everywhere else this app counts a set) reads as "hit your
// target" for a muscle's week. One number for every muscle, not a table of
// per-muscle research targets — Max's own example number, easy to retune
// here if he wants it different later.
const HEAT_WEEKLY_TARGET_ = 11;

/**
 * This Week: a stacked bar against HEAT_WEEKLY_TARGET_ — red = primary sets,
 * orange = secondary sets (both as a fraction of the target), yellow = the
 * gap still left to reach it. Hitting or passing the target just fills the
 * bar red+orange with no yellow, capped at 100% width so a big week doesn't
 * overflow the row.
 */
function heatWeekRowHtml_(key, primaryN, secondaryN) {
  const total = primaryN + secondaryN * 0.5;
  const pct = (n) => Math.max(0, Math.min(100, (n / HEAT_WEEKLY_TARGET_) * 100));
  const primaryPct = pct(primaryN);
  const secondaryPct = pct(primaryN + secondaryN * 0.5) - primaryPct;
  const gapPct = Math.max(0, 100 - primaryPct - secondaryPct);
  const fmt = (n) => (n % 1 === 0 ? n : n.toFixed(1));
  return `
    <div class="lib-heat-row">
      <span class="lib-heat-row__name">${libEsc(muscleLabel_(key))}</span>
      <span class="lib-heat-row__track">
        <span class="lib-heat-row__fill lib-heat-row__fill--primary" style="width:${primaryPct}%"></span>
        <span class="lib-heat-row__fill lib-heat-row__fill--secondary" style="width:${secondaryPct}%"></span>
        <span class="lib-heat-row__fill lib-heat-row__fill--gap" style="width:${gapPct}%"></span>
      </span>
      <span class="lib-heat-row__num">${fmt(total)}/${HEAT_WEEKLY_TARGET_}</span>
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
