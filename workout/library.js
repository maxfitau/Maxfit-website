/*
 * Exercise Library + Anatomy Lab (workout/library.html) — browse every
 * exercise from the Exercises sheet, tap one to see the real muscle
 * figure (card/muscle-map.js) front and back, and add it straight into
 * today's workout. One page, two states (list / detail) rather than two
 * page loads, so jumping between exercises via the chip row is instant.
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
  list: document.getElementById("libList"),
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

function showLibList() {
  libEls.detail.hidden = true;
  libEls.list.hidden = false;
  history.replaceState(null, "", window.location.pathname + window.location.search.replace(/[?&]ex=[^&]*/, "").replace(/^&/, "?"));
}

function showLibDetail(exercise) {
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

initLibrary();
