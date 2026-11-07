/*
 * MaxFit coach workout builder (Max-only).
 *
 * PIN-gated the same way checkin.html is — same Script Property, same
 * localStorage key even, so a PIN typed on either page is remembered for
 * both. The PIN is only actually verified server-side (see checkPin_ in
 * Code.gs) when Save or Delete is tapped; there's nothing sensitive to
 * protect just by loading this page, only by writing to it.
 *
 * A client can have several named workouts (a push/pull/legs split, say),
 * each edited independently — picking a client shows chips for their
 * existing workout names; picking one loads its exercises for editing,
 * typing a brand-new name starts a new one from blank. Saving only ever
 * replaces the one named workout being edited, never a client's other ones.
 */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";
const STAFF_PIN_STORAGE_KEY = "maxfitStaffPin"; // shared with checkin.js, book-staff.js, coach.js and people.js

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The symbol on each exercise row: a tight crop of Max's own figure with the
// muscles it mainly works in red, so a workout can be read without reading.
// Built from just the figure's outlines (the full figure is 50KB per copy, far
// too much to repeat on every row), and only ever measured once per view.
const muscleSymbolViews_ = {};

function muscleSymbolView_(name) {
  if (muscleSymbolViews_[name]) return muscleSymbolViews_[name];
  const host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  host.setAttribute("viewBox", "0 0 200 460");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:200px;height:460px;visibility:hidden";
  host.innerHTML = name === "back" ? MUSCLE_BACK_SVG_ : MUSCLE_FRONT_SVG_;
  document.body.appendChild(host); // getBBox only answers for something on the page
  const view = {
    outline: Array.from(host.querySelectorAll(".silhouette path")).map((p) => p.getAttribute("d")),
    shapes: Array.from(host.querySelectorAll("path[data-muscle]")).map((p) => {
      const box = p.getBBox();
      return { d: p.getAttribute("d"), muscle: p.getAttribute("data-muscle"), group: p.getAttribute("data-group"), x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height, area: box.width * box.height };
    }),
  };
  host.remove();
  muscleSymbolViews_[name] = view;
  return view;
}

/** SVG markup for these muscle keys (fine or broad), from whichever side of the body shows more of them; "" if none has a shape. */
function muscleSymbolSvg_(keys) {
  const isLit = (shape) => keys.includes(shape.muscle) || keys.includes(shape.group);
  const litArea = (view) => view.shapes.filter(isLit).reduce((sum, shape) => sum + shape.area, 0);
  const front = muscleSymbolView_("front");
  const back = muscleSymbolView_("back");
  const view = litArea(back) > litArea(front) ? back : front;
  const lit = view.shapes.filter(isLit);
  if (!lit.length) return "";

  const left = Math.min(...lit.map((s) => s.x));
  const top = Math.min(...lit.map((s) => s.y));
  const right = Math.max(...lit.map((s) => s.right));
  const bottom = Math.max(...lit.map((s) => s.bottom));
  // Square, with enough of the body around a small muscle to tell where it is.
  const size = Math.max(right - left, bottom - top, 46) + 16;
  const x = (left + right) / 2 - size / 2;
  const y = (top + bottom) / 2 - size / 2;
  const paths = (list, fill) => list.map((d) => `<path d="${d}" fill="${fill}"/>`).join("");
  return (
    `<svg viewBox="${x.toFixed(1)} ${y.toFixed(1)} ${size.toFixed(1)} ${size.toFixed(1)}" aria-hidden="true">` +
    `<g stroke="${MUSCLE_GAP_STROKE_COLOR}" stroke-width="1" stroke-linejoin="round">` +
    paths(view.outline, "#3a3a3a") +
    paths(view.shapes.filter((s) => !isLit(s)).map((s) => s.d), "#4a4a4a") +
    paths(lit.map((s) => s.d), MUSCLE_PRIMARY_COLOR) +
    "</g></svg>"
  );
}

const els = {
  clientSelect: document.getElementById("clientSelect"),
  workoutNameInput: document.getElementById("workoutNameInput"),
  workoutNameOptions: document.getElementById("workoutNameOptions"),
  chips: document.getElementById("existingWorkoutChips"),
  daysPicker: document.getElementById("daysPicker"),
  rows: document.getElementById("exerciseRows"),
  addButton: document.getElementById("addExerciseButton"),
  pinRow: document.getElementById("pinRow"),
  pinInput: document.getElementById("pinInput"),
  saveButton: document.getElementById("saveButton"),
  deleteButton: document.getElementById("deleteButton"),
  error: document.getElementById("builderError"),
  success: document.getElementById("builderSuccess"),
  sideFigs: document.getElementById("builderSideFigs"),
  sideHeatList: document.getElementById("builderSideHeatList"),
};

// This client's existing workouts, keyed by lowercased name — refreshed
// every time the client selection changes, and consulted whenever the
// workout name field changes so typing an existing name (or picking its
// chip) loads that workout's exercises for editing.
let clientWorkouts = {};

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
  els.success.hidden = true;
}

function currentPin() {
  try {
    const remembered = localStorage.getItem(STAFF_PIN_STORAGE_KEY);
    if (remembered) return remembered;
  } catch (err) {
    // Fall through to whatever's typed in the field.
  }
  return els.pinInput.value.trim();
}

/**
 * The visible exercise control — a button, not a text input, so the only
 * way to set a name is to pick one from ExercisePicker (or add a new one
 * through it). That's what guarantees "Bench Press" is spelled the same
 * way every time it's assigned, so its logged history is never split by a
 * typo. The actual name travels in nameValueInput (a hidden input, read by
 * the save handler below) so the picked name survives the same as any
 * other field even though it isn't typed.
 *
 * No per-row muscle chip list any more (2026-10-05) — that detail used to
 * be spelled out on every single row ("Mid Chest, Lower Chest, Front
 * Delt..."), which made a long workout very tall for little reason once
 * the side "Muscles Worked" panel shows the same thing once, aggregated,
 * for the whole workout. The picked primary/secondary keys still travel
 * with the row (on wrap.dataset) so refreshMuscleLoadPanel_ can read them.
 *
 * A row with a name but no primary AND no secondary muscles — whether its
 * name never resolved in the Exercises catalog at all, or it resolved to a
 * real row that just has no muscle data set yet — shows a small warning
 * (2026-10-09) rather than silently contributing nothing to the panel with
 * no explanation. Tapping that row opens "what does it work?" for its name
 * (ExercisePicker.chooseMuscles, 2026-10-10) rather than the normal picker.
 */
function buildExerciseControl(exercise) {
  const wrap = document.createElement("button");
  wrap.type = "button";
  wrap.className = "builder__row-exercise";

  const top = document.createElement("span");
  top.className = "builder__row-exercise-top";

  const symbol = document.createElement("span");
  symbol.className = "builder__row-symbol";
  symbol.hidden = true;

  const label = document.createElement("span");
  label.className = "builder__row-exercise-label";

  const warning = document.createElement("span");
  warning.className = "builder__row-exercise-warning";
  warning.textContent = "⚠ No muscle data — won't count. Tap to choose its muscles.";
  warning.hidden = true;

  const nameValueInput = document.createElement("input");
  nameValueInput.type = "hidden";
  nameValueInput.className = "builder__row-name-value";

  function setChosen(name, movement, bodyPart, primaryMuscles, secondaryMuscles, muscleWeights) {
    nameValueInput.value = name || "";
    wrap.dataset.exerciseName = name || "";
    wrap.dataset.movement = movement || "";
    wrap.dataset.bodyPart = bodyPart || "";
    wrap.dataset.primaryMuscles = (primaryMuscles || []).join(",");
    wrap.dataset.secondaryMuscles = (secondaryMuscles || []).join(",");
    wrap.dataset.muscleWeights = muscleWeights || "";
    const symbolKeys = (primaryMuscles && primaryMuscles.length ? primaryMuscles : secondaryMuscles) || [];
    symbol.innerHTML = name && symbolKeys.length ? muscleSymbolSvg_(symbolKeys) : "";
    symbol.hidden = !symbol.innerHTML;
    symbol.title = symbol.hidden ? "" : symbolKeys.map(muscleLabel_).join(", ");
    warning.hidden = !name || Boolean((primaryMuscles && primaryMuscles.length) || (secondaryMuscles && secondaryMuscles.length) || muscleWeights);
    if (name) {
      label.textContent = name;
      wrap.classList.remove("builder__row-exercise--empty");
    } else {
      label.textContent = "Choose exercise";
      wrap.classList.add("builder__row-exercise--empty");
    }
  }

  setChosen(
    (exercise && exercise.name) || "",
    exercise && exercise.movement,
    exercise && exercise.bodyPart,
    exercise && exercise.primaryMuscles,
    exercise && exercise.secondaryMuscles,
    exercise && exercise.muscleWeights
  );

  const onChoose = (picked) => {
    setChosen(picked.name, picked.movement, picked.bodyPart, picked.primaryMuscles, picked.secondaryMuscles, picked.muscleWeights);
    // Muscles just chosen for a name: any other row of it with none gets them too.
    if (picked.primaryMuscles && picked.primaryMuscles.length) {
      els.rows.querySelectorAll(".builder__row-exercise").forEach((other) => {
        const same = other !== wrap && (other.dataset.exerciseName || "").toLowerCase() === picked.name.toLowerCase();
        if (same && !other.dataset.primaryMuscles && !other.dataset.secondaryMuscles && other.setChosen) {
          other.setChosen(picked.name, picked.movement, picked.bodyPart, picked.primaryMuscles, picked.secondaryMuscles, "");
        }
      });
      exerciseIndexPromise_ = null; // re-read the library next time, with the new muscles in it
    }
    refreshMuscleLoadPanel_();
  };
  wrap.setChosen = setChosen;

  // A row with no muscle data opens straight on "what does it work?"
  // (2026-10-10); any other row opens the normal picker to change it.
  wrap.addEventListener("click", () => {
    if (!warning.hidden) {
      ExercisePicker.chooseMuscles({ name: wrap.dataset.exerciseName, movement: wrap.dataset.movement, bodyPart: wrap.dataset.bodyPart, onChoose });
    } else {
      ExercisePicker.open({ onChoose });
    }
  });

  top.appendChild(symbol);
  top.appendChild(label);
  wrap.appendChild(top);
  wrap.appendChild(warning);
  return { control: wrap, nameValueInput };
}

/**
 * Supersets in the builder. A link is stored on the row as "this exercise and
 * whichever one is right after it are done back to back", so it travels with
 * drag-reordering and the up/down buttons, and there's no separate named group
 * to go stale. Everything you see (A1/A2, the bracket, the group's header) is
 * worked out from those links by refreshSupersets_, which runs after any add,
 * remove, reorder, join or split. Rows stay flat children of els.rows.
 */
const LINK_ICON_ = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/></svg>';
const SUPERSET_REST_DEFAULT_ = 90;

/** A link to nothing doesn't count: the last row has no next exercise. */
function rowLinksToNext_(row) {
  // A boxing block (2026-11-07) can never join a superset, in either
  // direction — it never has a "join" toggle itself (dataset.superset stays
  // "false"), and this stops a normal row right before one from sweeping
  // it into a chain.
  return row.dataset.superset === "true" && Boolean(row.nextElementSibling) && row.nextElementSibling.dataset.blockType !== "rounds";
}

function toggleRowLink_(row) {
  row.dataset.superset = rowLinksToNext_(row) ? "false" : "true";
  closeRowMenus_();
  refreshSupersets_();
}

function closeRowMenus_() {
  els.rows.querySelectorAll(".builder__row-menu").forEach((menu) => {
    menu.hidden = true;
  });
}
document.addEventListener("click", (event) => {
  if (!event.target.closest(".builder__row-more")) closeRowMenus_();
});

/** The small link icon under a row: tap to join it to the next exercise, or split them. */
function buildSupersetLink_(row) {
  const wrap = document.createElement("div");
  wrap.className = "builder__ss-link";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "builder__ss-link-btn";
  btn.innerHTML = `<span>${LINK_ICON_}</span>`;
  btn.addEventListener("click", () => toggleRowLink_(row));
  wrap.appendChild(btn);
  return wrap;
}

/** The ⋯ menu on a row, holding "Superset with next". */
function buildRowMoreMenu_(row) {
  const wrap = document.createElement("div");
  wrap.className = "builder__row-more";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "builder__row-more-btn";
  btn.textContent = "⋯";
  btn.setAttribute("aria-label", "More options");
  const menu = document.createElement("div");
  menu.className = "builder__row-menu";
  menu.hidden = true;
  const item = document.createElement("button");
  item.type = "button";
  item.className = "builder__row-menu-item";
  item.addEventListener("click", () => toggleRowLink_(row));
  menu.appendChild(item);
  btn.addEventListener("click", () => {
    const wasOpen = !menu.hidden;
    closeRowMenus_();
    menu.hidden = wasOpen;
  });
  wrap.append(btn, menu);
  return wrap;
}

/** The header on a group's first row: its name, its rest time, and a note if the set counts differ. */
function fillSupersetHead_(head, members, letter) {
  head.replaceChildren();
  const top = document.createElement("div");
  top.className = "builder__ss-top";
  const pill = document.createElement("span");
  pill.className = "builder__ss-pill";
  pill.textContent = `${members.length >= 3 ? "Circuit" : "Superset"} ${letter}`;
  top.appendChild(pill);

  const rest = document.createElement("div");
  rest.className = "builder__ss-rest";
  const restLabel = document.createElement("span");
  restLabel.textContent = "Rest after each round";
  const restValue = document.createElement("span");
  restValue.className = "builder__ss-rest-value";
  restValue.textContent = `${members[0].dataset.supersetRest}s`;
  const stepper = (text, label, change) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "builder__ss-step";
    btn.textContent = text;
    btn.setAttribute("aria-label", label);
    btn.addEventListener("click", () => {
      const next = Math.max(15, Math.min(600, Number(members[0].dataset.supersetRest) + change));
      members.forEach((row) => {
        row.dataset.supersetRest = String(next);
      });
      restValue.textContent = `${next}s`;
    });
    return btn;
  };
  rest.append(restLabel, stepper("−", "15 seconds less rest", -15), restValue, stepper("+", "15 seconds more rest", 15));
  top.appendChild(rest);
  head.appendChild(top);

  const setInputs = members.map((row) => row.querySelector("input"));
  const counts = setInputs.map((input) => Number(input.value)).filter((n) => Number.isFinite(n) && n > 0);
  if (counts.length === members.length && new Set(counts).size > 1) {
    const most = Math.max(...counts);
    const note = document.createElement("div");
    note.className = "builder__ss-note";
    const text = document.createElement("span");
    text.textContent = `${counts.map((n, i) => `${letter}${i + 1} has ${n}${i === 0 ? " sets" : ""}`).join(", ")}. The extra sets will go at the end of the last round.`;
    const match = document.createElement("button");
    match.type = "button";
    match.className = "builder__ss-match";
    match.textContent = `Make them match (${most} sets)`;
    match.addEventListener("click", () => {
      setInputs.forEach((input) => {
        input.value = String(most);
      });
      refreshSupersets_();
      refreshMuscleLoadPanel_();
    });
    note.append(text, match);
    head.appendChild(note);
  }
}

/** Redraws everything superset-related from the rows' links. */
function refreshSupersets_() {
  const rows = Array.from(els.rows.children);
  let groups = 0;
  for (let i = 0; i < rows.length; ) {
    let end = i;
    while (rowLinksToNext_(rows[end])) end++;
    const members = rows.slice(i, end + 1);
    const grouped = members.length > 1;
    const letter = grouped ? String.fromCharCode(65 + groups++ % 26) : "";
    // A group has one rest time. The first one set among its rows wins (joining two groups keeps the upper one's).
    const setRest = members.map((row) => Number(row.dataset.supersetRest)).find((n) => n >= 15 && n <= 600);
    members.forEach((row, n) => {
      // A boxing block (2026-11-07) has none of the superset DOM below —
      // rowLinksToNext_ already guarantees it's always solo here (grouped
      // is always false for it), so there's nothing to do.
      if (row.dataset.blockType === "rounds") return;
      // Rows load one at a time, so a row on its own here may be about to join its group: keep its value.
      if (grouped) row.dataset.supersetRest = String(setRest || SUPERSET_REST_DEFAULT_);
      row.classList.toggle("builder__row--ss", grouped);
      row.classList.toggle("builder__row--ss-start", grouped && n === 0);
      row.classList.toggle("builder__row--ss-end", grouped && n === members.length - 1);

      let badge = row.querySelector(".builder__ss-letter");
      if (grouped && !badge) {
        badge = document.createElement("span");
        badge.className = "builder__ss-letter";
        row.querySelector(".builder__row-exercise-top").prepend(badge);
      } else if (!grouped && badge) {
        badge.remove();
      }
      if (grouped) badge.textContent = `${letter}${n + 1}`;

      const head = row.querySelector(".builder__ss-head");
      const isHead = grouped && n === 0;
      head.hidden = !isHead;
      if (isHead) fillSupersetHead_(head, members, letter);
      else head.replaceChildren();
    });
    i = end + 1;
  }

  rows.forEach((row, i) => {
    if (row.dataset.blockType === "rounds") return; // no join/more-menu controls on a boxing row
    const isLast = i === rows.length - 1;
    const beforeBoxing = Boolean(rows[i + 1] && rows[i + 1].dataset.blockType === "rounds");
    const linked = rowLinksToNext_(row);
    row.querySelector(".builder__ss-link").hidden = isLast || beforeBoxing;
    row.querySelector(".builder__row-more").hidden = isLast || beforeBoxing;
    const btn = row.querySelector(".builder__ss-link-btn");
    btn.setAttribute("aria-pressed", String(linked));
    btn.setAttribute("aria-label", linked ? "Split this exercise from the next one" : "Join this exercise to the next one");
    btn.title = linked ? "Split" : "Join as a superset";
    row.querySelector(".builder__row-menu-item").textContent = linked ? "Split from next" : "Superset with next";
  });
}

/**
 * The side panel's live "Muscles Worked" summary — every row's own
 * primary/secondary muscles (stashed on wrap.dataset by setChosen above),
 * weighted by that row's own Sets value and summed across the whole
 * workout currently being built. Pure client side, no network call, same
 * as every other muscle-map computation in this app. Call after anything
 * that changes which exercises are in the workout or how many sets they
 * have: addRow, a row's remove button, a Sets edit, and an exercise being
 * (re)picked (see the onChoose handler above).
 */
// Which muscles (Quads, Hamstrings...) are open in the side panel's list,
// kept across the rebuild that every Sets keystroke triggers.
const builderOpenFamilies_ = new Set();

function refreshMuscleLoadPanel_() {
  const weighted = {};
  const primaryCount = {};
  const secondaryCount = {};
  // The same tally per muscle (Quads, not each quad head): a row's sets
  // count once for a muscle, as primary if any of its heads is primary.
  const familyPrimary = {};
  const familySecondary = {};
  // Per muscle, how much each exercise NAME in this workout contributes —
  // the figure tooltip's "top 3 contributing exercises" (Goal 4, 2026-10-09).
  const contributionsByMuscle = {};

  Array.from(els.rows.children).forEach((row) => {
    const control = row.querySelector(".builder__row-exercise");
    const setsInput = row.querySelector("input");
    const sets = setsInput ? Number(setsInput.value) : NaN;
    if (!control || !Number.isFinite(sets) || sets <= 0) return;

    const primary = (control.dataset.primaryMuscles || "").split(",").filter(Boolean);
    const secondary = (control.dataset.secondaryMuscles || "").split(",").filter(Boolean);
    const muscleWeights = control.dataset.muscleWeights || "";
    const exerciseName = control.dataset.exerciseName || "";
    // Effective-sets model (2026-10-09) — same engine the Muscles tab's
    // weekly heatmap and the live Train panel use, so a planned workout
    // previews exactly what logging it will actually score. Caps a single
    // set's contribution to any muscle GROUP at 1.0 even when the exercise
    // lists more than one fine head for it, then scales by how many sets
    // this row plans. primaryCount/secondaryCount stay the plain
    // catalog-role tally the red/orange segments show.
    const perSet = effectiveSetsPerSet_({ catalogName: exerciseName, primary, secondary, muscleWeights });
    Object.keys(perSet).forEach((k) => {
      const contribution = perSet[k] * sets;
      weighted[k] = (weighted[k] || 0) + contribution;
      const byExercise = (contributionsByMuscle[k] = contributionsByMuscle[k] || {});
      byExercise[exerciseName] = (byExercise[exerciseName] || 0) + contribution;
    });
    new Set(primary).forEach((k) => {
      primaryCount[k] = (primaryCount[k] || 0) + sets;
    });
    new Set(secondary).forEach((k) => {
      secondaryCount[k] = (secondaryCount[k] || 0) + sets;
    });
    const famP = new Set(primary.map(muscleFamilyName_));
    new Set(secondary.map(muscleFamilyName_)).forEach((f) => {
      if (!famP.has(f)) familySecondary[f] = (familySecondary[f] || 0) + sets;
    });
    famP.forEach((f) => {
      familyPrimary[f] = (familyPrimary[f] || 0) + sets;
    });
  });

  // Any open tooltip is anchored to a shape from the figure we're about to
  // throw away below (muscleFigureSvg builds fresh DOM every call).
  muscleTooltipHide_();

  const frontSvg = muscleFigureSvg("front", "builderSideFrontTitle");
  const backSvg = muscleFigureSvg("back", "builderSideBackTitle");
  els.sideFigs.innerHTML =
    `<div class="builder__side-fig-col">${frontSvg}<span class="builder__side-fig-caption">Front</span></div>` +
    `<div class="builder__side-fig-col">${backSvg}<span class="builder__side-fig-caption">Back</span></div>`;
  const sideSvgs = els.sideFigs.querySelectorAll("svg.muscle-figure");
  // Relative to this workout's busiest muscle, not a fixed set count (2026-10-13).
  sideSvgs.forEach((svg) => paintMuscleHeat(svg, weighted));

  // Goal 4 (2026-10-09): hover/tap a shape for its own breakdown. No weekly
  // target here (a single planned workout, not a week) and no group list to
  // expand (this panel is a flat list), so just the value/split/exercises.
  sideSvgs.forEach((svg) =>
    wireMuscleTooltips_(svg, (key) => {
      if (!weighted[key] || weighted[key] <= 0) return null;
      return muscleTooltipContentHtml_(key, weighted[key], primaryCount[key], secondaryCount[key], muscleTopContributions_(contributionsByMuscle[key]), null);
    })
  );

  // Muscles (Quads, Hamstrings...), busiest first, each opening to its
  // heads (2026-10-10, Max: the flat list of every head was too long).
  const families = muscleTree_(Object.keys(weighted).filter((k) => weighted[k] > 0))
    .flatMap((s) => s.families)
    .sort((a, b) => (familyPrimary[b.name] || 0) - (familyPrimary[a.name] || 0) || (familySecondary[b.name] || 0) - (familySecondary[a.name] || 0));
  // Bars are relative too: the busiest muscle's sets fill its bar.
  const scale = Math.max(1, ...families.map((f) => (familyPrimary[f.name] || 0) + (familySecondary[f.name] || 0)));
  els.sideHeatList.innerHTML = families.length
    ? families.map((f) => builderFamilyHtml_(f, familyPrimary[f.name] || 0, familySecondary[f.name] || 0, primaryCount, secondaryCount, weighted, scale)).join("")
    : '<p class="builder__side-empty">Add exercises to see what this workout trains</p>';
  els.sideHeatList.querySelectorAll("details[data-family]").forEach((el) => {
    el.addEventListener("toggle", () => (el.open ? builderOpenFamilies_.add(el.dataset.family) : builderOpenFamilies_.delete(el.dataset.family)));
  });
}

/** One muscle in the side panel: a plain row, or a dropdown row that opens to its heads. */
function builderFamilyHtml_(f, primaryN, secondaryN, primaryCount, secondaryCount, weighted, scale) {
  const head = builderHeatRowHtml_(f.name, primaryN, secondaryN, scale);
  if (f.plain) return head;
  const heads = f.keys
    .slice()
    .sort((a, b) => weighted[b] - weighted[a])
    .map((k) => builderHeatRowHtml_(muscleLabel_(k), primaryCount[k] || 0, secondaryCount[k] || 0, scale))
    .join("");
  const open = builderOpenFamilies_.has(f.name) ? " open" : "";
  return (
    `<details class="builder__side-fam"${open} data-family="${f.name}">` +
    `<summary class="builder__side-fam-head">${head}<svg class="builder__side-fam-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>` +
    `<div class="builder__side-fam-body">${heads}</div>` +
    "</details>"
  );
}

/**
 * One row of the side panel's breakdown list — the same red/orange
 * "primary + secondary set count" shape the Muscles tab's weekly list used
 * before it moved to a single red bar (heatRowHtml_, workout/library.js) —
 * this panel stays a direct-count view, scoped to just this one workout. Each count sits
 * directly under its own segment (2026-10-05, was a
 * combined "3+5" off to the side) so it's unambiguous which number is
 * which. A zero-count side renders no number — an empty segment already
 * shows zero.
 */
function builderHeatRowHtml_(label, primaryN, secondaryN, scale) {
  const primaryPct = Math.max(0, Math.min(100, (primaryN / scale) * 100));
  const secondaryPct = Math.max(0, Math.min(100 - primaryPct, (secondaryN / scale) * 100));
  return `
    <div class="builder__side-heat-row">
      <span class="builder__side-heat-row__name">${label}</span>
      <span class="builder__side-heat-row__bar">
        <span class="builder__side-heat-row__track">
          <span class="builder__side-heat-row__fill--primary" style="width:${primaryPct}%"></span>
          <span class="builder__side-heat-row__fill--secondary" style="width:${secondaryPct}%"></span>
        </span>
        <span class="builder__side-heat-row__nums">
          ${primaryN > 0 ? `<span class="builder__side-heat-row__segnum--primary" style="width:${primaryPct}%">${primaryN}</span>` : ""}
          ${secondaryN > 0 ? `<span class="builder__side-heat-row__segnum--secondary" style="width:${secondaryPct}%">${secondaryN}</span>` : ""}
        </span>
      </span>
    </div>`;
}

function addRow(exercise) {
  const row = document.createElement("div");
  row.className = "builder__row";

  const { control: nameControl, nameValueInput } = buildExerciseControl(exercise);

  const setsInput = document.createElement("input");
  setsInput.type = "number";
  setsInput.inputMode = "numeric";
  setsInput.placeholder = "Sets";
  setsInput.value = exercise && exercise.sets ? exercise.sets : "";
  setsInput.addEventListener("input", refreshMuscleLoadPanel_);
  setsInput.addEventListener("input", refreshSupersets_);

  const repsInput = document.createElement("input");
  repsInput.type = "text";
  repsInput.placeholder = "Reps";
  repsInput.value = (exercise && exercise.reps) || "";

  // An optional coaching cue shown to the client under this exercise. Added to
  // the row LAST, so the name/sets/reps inputs stay the first three inputs.
  const tipInput = document.createElement("input");
  tipInput.type = "text";
  tipInput.className = "builder__row-tip";
  tipInput.placeholder = "Tip for the client (optional) — e.g. keep your elbows tucked";
  tipInput.maxLength = 300;
  tipInput.value = (exercise && exercise.note) || "";

  const handle = document.createElement("div");
  handle.className = "builder__row-handle";
  handle.textContent = "⠿";
  handle.setAttribute("aria-label", "Drag to reorder");
  makeRowDraggable(row, handle);

  // Belt-and-suspenders alongside the drag handle — a precise, unambiguous
  // way to move a row by exactly one spot, for whenever a drag feels
  // fiddly (or just isn't landing right on a given device).
  const moveWrap = document.createElement("div");
  moveWrap.className = "builder__row-move";

  const upButton = document.createElement("button");
  upButton.type = "button";
  upButton.className = "builder__row-move-btn";
  upButton.textContent = "▲";
  upButton.setAttribute("aria-label", "Move exercise up");
  upButton.addEventListener("click", () => {
    const prev = row.previousElementSibling;
    if (prev) els.rows.insertBefore(row, prev);
    refreshSupersets_();
  });

  const downButton = document.createElement("button");
  downButton.type = "button";
  downButton.className = "builder__row-move-btn";
  downButton.textContent = "▼";
  downButton.setAttribute("aria-label", "Move exercise down");
  downButton.addEventListener("click", () => {
    const next = row.nextElementSibling;
    if (next) els.rows.insertBefore(next, row);
    refreshSupersets_();
  });

  moveWrap.appendChild(upButton);
  moveWrap.appendChild(downButton);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "builder__row-remove";
  removeButton.textContent = "×";
  removeButton.setAttribute("aria-label", "Remove exercise");
  removeButton.addEventListener("click", () => {
    row.remove();
    refreshSupersets_();
    refreshMuscleLoadPanel_();
  });

  row.dataset.superset = exercise && exercise.superset ? "true" : "false";
  row.dataset.supersetRest = (exercise && exercise.supersetRest) || "";
  const supersetHead = document.createElement("div");
  supersetHead.className = "builder__ss-head";
  supersetHead.hidden = true;

  row.appendChild(nameControl);
  row.appendChild(setsInput);
  row.appendChild(repsInput);
  row.appendChild(handle);
  row.appendChild(moveWrap);
  row.appendChild(removeButton);
  row.appendChild(tipInput);
  row.appendChild(buildSupersetLink_(row));
  row.appendChild(buildRowMoreMenu_(row));
  row.appendChild(supersetHead);
  // Last, and hidden — keeps the elements above in the exact DOM order the
  // CSS's nth-child row layout (builder.css) already expects, and keeps
  // the picked name out of the save handler's positional input lookup below.
  row.appendChild(nameValueInput);
  els.rows.appendChild(row);
  refreshSupersets_();
  refreshMuscleLoadPanel_();
}

// ---- Boxing rounds (built 2026-11-07) -------------------------------------
//
// A block is one exercise row in Workout Exercises (Block Type "Rounds",
// Target Sets = round count), but unlike a normal exercise it's never
// edited inline — the row is just a summary + Edit, and all its setup
// (rounds/work/rest/combos/who runs it/easier option) lives in a block
// editor dialog, opened fresh each time. It can never join a superset
// (rowLinksToNext_/refreshSupersets_ above both guard this).

const BOXING_EXERCISE_OPTIONS_ = ["Heavy Bag", "Shadow Boxing", "Pad Work", "Skipping"];
const BOXING_COMBO_CHIPS_ = [
  { label: "1 Jab", insert: "1" },
  { label: "2 Cross", insert: "2" },
  { label: "3 Lead hook", insert: "3" },
  { label: "4 Rear hook", insert: "4" },
  { label: "5 Lead upper", insert: "5" },
  { label: "6 Rear upper", insert: "6" },
  { label: "Slip", insert: "slip" },
  { label: "Roll", insert: "roll" },
];

function defaultBoxingBlock_() {
  return {
    name: "Heavy Bag",
    rounds: 3,
    workSeconds: 120,
    restSeconds: 60,
    sameEveryRound: false, // "Different each round" is the default
    combos: ["", "", ""],
    runBy: "Client",
    easierOption: true,
  };
}

function boxingSecondsText_(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function boxingSummaryText_(block) {
  const runText = block.runBy === "Coach" ? "with you" : `${block.rounds} × ${boxingSecondsText_(block.workSeconds)}`;
  return `${block.name} · ${block.runBy === "Coach" ? runText : `${runText} · rest ${boxingSecondsText_(block.restSeconds)}`}`;
}

/** The block row in the exercise list — a summary + Edit, nothing inline. Shares the drag handle / move / remove controls every other row has. */
function addBoxingRow(block) {
  const row = document.createElement("div");
  row.className = "builder__row builder__row--boxing";
  row.dataset.blockType = "rounds";
  row.dataset.superset = "false";
  row._boxing = block || defaultBoxingBlock_();

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "builder__boxing-summary";
  summary.addEventListener("click", () => openBoxingEditor_(row));
  row.appendChild(summary);

  function refreshSummary() {
    summary.innerHTML = `<span class="builder__boxing-summary-tag">${row._boxing.runBy === "Coach" ? "Pads" : "Boxing"}</span><span class="builder__boxing-summary-text"><span class="builder__boxing-summary-name">${row._boxing.name}</span><span class="builder__boxing-summary-meta">${boxingSummaryText_(row._boxing)}</span></span>`;
  }
  row._refreshBoxingSummary = refreshSummary;
  refreshSummary();

  const handle = document.createElement("div");
  handle.className = "builder__row-handle";
  handle.textContent = "⠿";
  handle.setAttribute("aria-label", "Drag to reorder");
  makeRowDraggable(row, handle);

  const moveWrap = document.createElement("div");
  moveWrap.className = "builder__row-move";
  const upButton = document.createElement("button");
  upButton.type = "button";
  upButton.className = "builder__row-move-btn";
  upButton.textContent = "▲";
  upButton.setAttribute("aria-label", "Move up");
  upButton.addEventListener("click", () => {
    const prev = row.previousElementSibling;
    if (prev) els.rows.insertBefore(row, prev);
    refreshSupersets_();
  });
  const downButton = document.createElement("button");
  downButton.type = "button";
  downButton.className = "builder__row-move-btn";
  downButton.textContent = "▼";
  downButton.setAttribute("aria-label", "Move down");
  downButton.addEventListener("click", () => {
    const next = row.nextElementSibling;
    if (next) els.rows.insertBefore(next, row);
    refreshSupersets_();
  });
  moveWrap.append(upButton, downButton);
  row.appendChild(moveWrap);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "builder__row-remove";
  removeButton.textContent = "×";
  removeButton.setAttribute("aria-label", "Remove this block");
  removeButton.addEventListener("click", () => {
    row.remove();
    refreshSupersets_();
    refreshMuscleLoadPanel_();
  });
  row.appendChild(removeButton);

  els.rows.appendChild(row);
  refreshSupersets_();
  refreshMuscleLoadPanel_();
  return row;
}

let boxingModalEl_ = null;

function closeBoxingEditor_() {
  if (boxingModalEl_) boxingModalEl_.hidden = true;
}

/** Opens the block editor on a fresh default block (new) or an existing row's block (edit in place). */
function openBoxingEditor_(existingRow) {
  const editing = Boolean(existingRow);
  // A working copy — only written back to the row's own _boxing on "Add to workout", so Cancel truly discards changes.
  const draft = JSON.parse(JSON.stringify(editing ? existingRow._boxing : defaultBoxingBlock_()));
  if (!Array.isArray(draft.combos) || draft.combos.length !== draft.rounds) {
    draft.combos = Array.from({ length: draft.rounds }, (_, i) => draft.combos[i] || "");
  }

  if (!boxingModalEl_) {
    boxingModalEl_ = document.createElement("div");
    boxingModalEl_.className = "builder__boxing-modal";
    boxingModalEl_.hidden = true;
    document.body.appendChild(boxingModalEl_);
  }
  boxingModalEl_.innerHTML = "";
  boxingModalEl_.hidden = false;

  const backdrop = document.createElement("div");
  backdrop.className = "builder__boxing-modal-backdrop";
  backdrop.addEventListener("click", closeBoxingEditor_);
  boxingModalEl_.appendChild(backdrop);

  const panel = document.createElement("div");
  panel.className = "builder__boxing-modal-panel";
  boxingModalEl_.appendChild(panel);

  const title = document.createElement("h2");
  title.className = "builder__boxing-modal-title";
  title.textContent = editing ? "Edit boxing rounds" : "Add boxing rounds";
  panel.appendChild(title);

  // Exercise
  const exField = document.createElement("div");
  exField.className = "builder__boxing-field";
  exField.innerHTML = '<span class="card__label">Exercise</span>';
  const exSelect = document.createElement("select");
  exSelect.className = "builder__boxing-select";
  BOXING_EXERCISE_OPTIONS_.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === draft.name) opt.selected = true;
    exSelect.appendChild(opt);
  });
  exSelect.addEventListener("change", () => {
    draft.name = exSelect.value;
    if (draft.name === "Pad Work") setRunBy("Coach");
  });
  exField.appendChild(exSelect);
  panel.appendChild(exField);

  // Who runs it
  const runField = document.createElement("div");
  runField.className = "builder__boxing-field";
  runField.innerHTML = '<span class="card__label">Who runs it</span>';
  const runSeg = document.createElement("div");
  runSeg.className = "builder__boxing-segmented";
  const clientBtn = document.createElement("button");
  clientBtn.type = "button";
  clientBtn.className = "builder__boxing-segmented-btn";
  clientBtn.textContent = "On their own";
  const coachBtn = document.createElement("button");
  coachBtn.type = "button";
  coachBtn.className = "builder__boxing-segmented-btn";
  coachBtn.textContent = "With me (pads)";
  function setRunBy(value) {
    draft.runBy = value;
    clientBtn.setAttribute("aria-pressed", String(value === "Client"));
    coachBtn.setAttribute("aria-pressed", String(value === "Coach"));
    shadowRow.hidden = value === "Coach";
  }
  clientBtn.addEventListener("click", () => setRunBy("Client"));
  coachBtn.addEventListener("click", () => setRunBy("Coach"));
  runSeg.append(clientBtn, coachBtn);
  runField.appendChild(runSeg);
  panel.appendChild(runField);

  // Steppers: rounds / work / rest
  const steppers = document.createElement("div");
  steppers.className = "builder__boxing-steppers";
  function stepper(label, get, set, min, max, step, format) {
    const wrap = document.createElement("div");
    wrap.className = "builder__boxing-stepper";
    const lab = document.createElement("span");
    lab.className = "builder__boxing-stepper-label";
    lab.textContent = label;
    const row = document.createElement("div");
    row.className = "builder__boxing-stepper-row";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "builder__boxing-step-btn";
    minus.textContent = "−";
    const value = document.createElement("span");
    value.className = "builder__boxing-step-value";
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "builder__boxing-step-btn";
    plus.textContent = "+";
    function paint() {
      value.textContent = format(get());
    }
    minus.addEventListener("click", () => {
      set(Math.max(min, get() - step));
      paint();
    });
    plus.addEventListener("click", () => {
      set(Math.min(max, get() + step));
      paint();
    });
    paint();
    row.append(minus, value, plus);
    wrap.append(lab, row);
    return wrap;
  }
  steppers.appendChild(stepper("Rounds", () => draft.rounds, (v) => {
    const delta = v - draft.rounds;
    draft.rounds = v;
    if (delta > 0) for (let i = 0; i < delta; i++) draft.combos.push("");
    else if (delta < 0) draft.combos.length = draft.rounds;
    renderRoundsList();
  }, 1, 12, 1, (v) => String(v)));
  steppers.appendChild(stepper("Work", () => draft.workSeconds, (v) => (draft.workSeconds = v), 30, 300, 15, boxingSecondsText_));
  steppers.appendChild(stepper("Rest", () => draft.restSeconds, (v) => (draft.restSeconds = v), 15, 180, 15, boxingSecondsText_));
  panel.appendChild(steppers);

  // Combos
  const comboField = document.createElement("div");
  comboField.className = "builder__boxing-field";
  comboField.innerHTML = '<span class="card__label">Combos</span>';
  const comboSeg = document.createElement("div");
  comboSeg.className = "builder__boxing-segmented";
  const sameBtn = document.createElement("button");
  sameBtn.type = "button";
  sameBtn.className = "builder__boxing-segmented-btn";
  sameBtn.textContent = "Same every round";
  const diffBtn = document.createElement("button");
  diffBtn.type = "button";
  diffBtn.className = "builder__boxing-segmented-btn";
  diffBtn.textContent = "Different each round";
  function setComboMode(same) {
    draft.sameEveryRound = same;
    sameBtn.setAttribute("aria-pressed", String(same));
    diffBtn.setAttribute("aria-pressed", String(!same));
    renderRoundsList();
  }
  sameBtn.addEventListener("click", () => setComboMode(true));
  diffBtn.addEventListener("click", () => setComboMode(false));
  comboSeg.append(sameBtn, diffBtn);
  comboField.appendChild(comboSeg);

  const chips = document.createElement("div");
  chips.className = "builder__boxing-chips";
  let activeRoundInput = null;
  BOXING_COMBO_CHIPS_.forEach((c) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "builder__boxing-chip";
    chip.textContent = c.label;
    chip.addEventListener("click", () => {
      const input = activeRoundInput || roundsList.querySelector(".builder__boxing-round-input");
      if (!input) return;
      const isNumber = /^[1-6]$/.test(c.insert);
      const sep = input.value.trim() ? (isNumber ? "-" : ", ") : "";
      input.value = input.value.trim() + sep + c.insert;
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
    chips.appendChild(chip);
  });
  comboField.appendChild(chips);

  const roundsList = document.createElement("div");
  roundsList.className = "builder__boxing-rounds-list";
  comboField.appendChild(roundsList);
  panel.appendChild(comboField);

  function renderRoundsList() {
    roundsList.innerHTML = "";
    const count = draft.sameEveryRound ? 1 : draft.rounds;
    for (let i = 0; i < count; i++) {
      const row = document.createElement("div");
      row.className = "builder__boxing-round-row";
      const num = document.createElement("span");
      num.className = "builder__boxing-round-num";
      num.textContent = draft.sameEveryRound ? "All" : `R${i + 1}`;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "builder__boxing-round-input";
      input.placeholder = "e.g. 1-2-3, slip (blank = freestyle)";
      input.value = draft.combos[i] || "";
      input.addEventListener("focus", () => {
        roundsList.querySelectorAll(".builder__boxing-round-input").forEach((el) => el.classList.remove("builder__boxing-round-input--active"));
        input.classList.add("builder__boxing-round-input--active");
        activeRoundInput = input;
      });
      input.addEventListener("input", () => {
        if (draft.sameEveryRound) draft.combos = Array.from({ length: draft.rounds }, () => input.value);
        else draft.combos[i] = input.value;
      });
      row.append(num, input);
      roundsList.appendChild(row);
    }
    activeRoundInput = roundsList.querySelector(".builder__boxing-round-input");
  }

  // Easier option
  const shadowRow = document.createElement("div");
  shadowRow.className = "builder__boxing-switch-row";
  const shadowLabel = document.createElement("span");
  shadowLabel.className = "builder__boxing-switch-label";
  shadowLabel.textContent = "Offer shadow boxing if no bag is free";
  const shadowSwitch = document.createElement("button");
  shadowSwitch.type = "button";
  shadowSwitch.className = "builder__boxing-switch";
  shadowSwitch.innerHTML = '<span class="builder__boxing-switch-knob"></span>';
  shadowSwitch.setAttribute("aria-pressed", String(draft.easierOption));
  shadowSwitch.addEventListener("click", () => {
    draft.easierOption = !draft.easierOption;
    shadowSwitch.setAttribute("aria-pressed", String(draft.easierOption));
  });
  shadowRow.append(shadowLabel, shadowSwitch);
  panel.appendChild(shadowRow);

  // Initial paint of the run-by segmented control and combo-mode segmented control.
  setRunBy(draft.runBy);
  setComboMode(draft.sameEveryRound);

  const actions = document.createElement("div");
  actions.className = "builder__boxing-modal-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "builder__boxing-modal-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", closeBoxingEditor_);
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "builder__boxing-modal-confirm";
  confirmBtn.textContent = "Add to workout";
  confirmBtn.addEventListener("click", () => {
    closeBoxingEditor_();
    if (editing) {
      existingRow._boxing = draft;
      existingRow._refreshBoxingSummary();
      refreshSupersets_();
    } else {
      addBoxingRow(draft);
    }
  });
  actions.append(cancelBtn, confirmBtn);
  panel.appendChild(actions);
}

els.addBoxingButton = document.getElementById("addBoxingButton");
if (els.addBoxingButton) els.addBoxingButton.addEventListener("click", () => openBoxingEditor_(null));

/**
 * Press-and-drag on the grip handle to reorder exercise rows — driven by
 * Pointer Events (not native HTML5 drag-and-drop) so it works the same on
 * touch and mouse. The row visually follows the cursor (via a CSS
 * transform) so it actually reads as a drag rather than just silently
 * reordering once you happen to cross into a neighbor — pointer-events is
 * turned off on it while dragging so elementFromPoint can "see through" it
 * to whichever row is really underneath the cursor.
 */
function makeRowDraggable(row, handle) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;

    row.classList.add("builder__row--dragging");
    row.style.pointerEvents = "none";

    function onMove(moveEvent) {
      row.style.transform = `translate(${moveEvent.clientX - startX}px, ${moveEvent.clientY - startY}px)`;

      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest(".builder__row");
      if (!target || target === row || target.parentElement !== els.rows) return;
      const rect = target.getBoundingClientRect();
      const before = moveEvent.clientY < rect.top + rect.height / 2;
      els.rows.insertBefore(row, before ? target : target.nextSibling);
    }

    function onUp() {
      row.classList.remove("builder__row--dragging");
      row.style.pointerEvents = "";
      row.style.transform = "";
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      refreshSupersets_();
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

function clearRows() {
  els.rows.innerHTML = "";
  refreshMuscleLoadPanel_();
}

/**
 * The note shown at the top of the client's workout ("warm up 5 min first,
 * rest 60–90 sec"). Created here rather than in builder.html so this script
 * never depends on markup an older cached copy of the page might not have.
 */
function buildWorkoutNoteField() {
  const field = document.createElement("div");
  field.className = "builder__field";

  const label = document.createElement("span");
  label.className = "card__label";
  label.textContent = "Workout note for the client (optional)";
  field.appendChild(label);

  const textarea = document.createElement("textarea");
  textarea.className = "picker__input builder__note";
  textarea.rows = 2;
  textarea.maxLength = 1000;
  textarea.placeholder = "Shown at the top of their workout — e.g. warm up for 5 minutes first, rest 60–90 seconds between sets.";
  field.appendChild(textarea);

  els.daysPicker.parentElement.insertAdjacentElement("afterend", field);
  els.workoutNote = textarea;
}

function workoutNoteValue() {
  return els.workoutNote ? els.workoutNote.value.trim() : "";
}

function setWorkoutNote(text) {
  if (els.workoutNote) els.workoutNote.value = text || "";
}

/** One toggle chip per weekday, built once — schedules which day(s) this named workout is meant for, so the card can name it instead of just saying "tap to choose". Entirely optional: a workout with no days selected still works exactly as before. */
function buildDaysPicker() {
  els.daysPicker.innerHTML = "";
  for (const day of DAY_ABBR) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "builder__day";
    chip.textContent = day[0];
    chip.setAttribute("aria-label", day);
    chip.dataset.day = day;
    chip.addEventListener("click", () => chip.classList.toggle("builder__day--active"));
    els.daysPicker.appendChild(chip);
  }
}

function getSelectedDays() {
  return Array.from(els.daysPicker.querySelectorAll(".builder__day--active")).map((chip) => chip.dataset.day);
}

function setSelectedDays(days) {
  const wanted = new Set(days || []);
  els.daysPicker.querySelectorAll(".builder__day").forEach((chip) => {
    chip.classList.toggle("builder__day--active", wanted.has(chip.dataset.day));
  });
}

async function loadClientList() {
  try {
    const { rows, col } = await fetchSheet();
    const names = rows
      .map((r) => (col.name >= 0 ? String(r[col.name] || "").trim() : ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    els.clientSelect.innerHTML = '<option value="">Choose a client…</option>';
    for (const name of names) {
      const option = document.createElement("option");
      option.value = slugify(name);
      option.textContent = name;
      els.clientSelect.appendChild(option);
    }
  } catch (err) {
    els.clientSelect.innerHTML = '<option value="">Couldn\'t load clients</option>';
  }
}

// The Workout Exercises tab only stores an exercise's NAME against a
// client, not its category or muscles, so re-opening a saved workout needs
// a name -> {movement, bodyPart, primary, secondary, matched} lookup to
// show the same muscle symbol and data a freshly-picked exercise gets.
// Built via the shared resolver (buildExerciseIndex_/resolveExerciseMuscles_,
// card/muscle-map.js) — the same one workout/heatmap.js uses — rather than
// this file's own plain exact-lowercase lookup (2026-10-09 fix; see that
// file's header comment for why the old exact-only matching mattered).
//
// Cached as the in-flight PROMISE, not the (eventually-built) index itself
// (2026-10-05 fix, still needed — orthogonal to the matching-logic fix
// above) — loadClientWorkouts below calls exerciseCategoryFor_ for every
// exercise in the workout at once, via Promise.all, so all of them run
// their first synchronous line before any of them finish loading. Caching
// the plain object meant only the very first caller actually waited for
// fetchExercises(): every other exercise in the SAME workout saw a cache
// that already existed but was still empty. Caching the promise itself
// means every concurrent caller awaits the exact same fetch and sees the
// real, fully-built index.
let exerciseIndexPromise_ = null;

function loadExerciseIndex_() {
  if (!exerciseIndexPromise_) {
    exerciseIndexPromise_ = fetchExercises()
      .then(({ rows, col }) => buildExerciseIndex_(rows, col))
      .catch(() => ({ byExact: {}, byNormalized: {} })); // rows just render without a symbol or muscle data
  }
  return exerciseIndexPromise_;
}

async function exerciseCategoryFor_(name) {
  const index = await loadExerciseIndex_();
  return resolveExerciseMuscles_(name, index);
}

/** Loads every workout name this client already has, grouped into { lowercaseName: { name, exercises } }. */
async function loadClientWorkouts(clientSlug) {
  clientWorkouts = {};
  if (!clientSlug) return;

  try {
    const { rows, col } = await fetchWorkoutExercises();
    const clientRows = await Promise.all(
      rows
        .filter((r) => String(r[col.client] || "").trim().toLowerCase() === clientSlug)
        .map(async (r) => {
          const name = (r[col.exercise] || "").trim();
          const category = await exerciseCategoryFor_(name);
          return {
            workoutName: (col.workoutName >= 0 ? r[col.workoutName] : "") || "",
            name,
            movement: category.movement,
            bodyPart: category.bodyPart,
            primaryMuscles: category.primary,
            secondaryMuscles: category.secondary,
            muscleWeights: category.muscleWeights,
            sets: parseSessions(r[col.sets], ""),
            reps: (r[col.reps] || "").trim(),
            order: parseSessions(r[col.order], 0),
            days: (col.days >= 0 ? String(r[col.days] || "") : "").split(",").map((d) => d.trim()).filter(Boolean),
            workoutOrder: col.workoutOrder >= 0 ? Number(r[col.workoutOrder]) : NaN,
            note: col.notes >= 0 ? String(r[col.notes] || "").trim() : "",
            workoutNote: col.workoutNotes >= 0 ? String(r[col.workoutNotes] || "").trim() : "",
            superset: col.superset >= 0 && String(r[col.superset] || "").trim().toUpperCase() === "Y",
            supersetRest: col.supersetRest >= 0 ? Number(r[col.supersetRest]) || "" : "",
            blockType: col.blockType >= 0 ? String(r[col.blockType] || "").trim() : "",
            workSeconds: col.workSeconds >= 0 ? Number(r[col.workSeconds]) || 120 : 120,
            restSeconds: col.restSeconds >= 0 ? Number(r[col.restSeconds]) || 60 : 60,
            combos: col.combos >= 0 ? String(r[col.combos] || "").split(" | ").map((c) => c.trim()) : [],
            runBy: col.runBy >= 0 && String(r[col.runBy] || "").trim() === "Coach" ? "Coach" : "Client",
            easierOption: col.easierOption >= 0 && String(r[col.easierOption] || "").trim().toUpperCase() === "Y",
          };
        })
    );
    const validRows = clientRows.filter((ex) => ex.name && ex.workoutName);

    for (const ex of validRows) {
      const key = ex.workoutName.toLowerCase();
      if (!clientWorkouts[key]) {
        clientWorkouts[key] = { name: ex.workoutName, exercises: [], days: ex.days, order: ex.workoutOrder, note: "" };
      }
      if (!clientWorkouts[key].note && ex.workoutNote) clientWorkouts[key].note = ex.workoutNote;
      clientWorkouts[key].exercises.push(ex);
    }
    for (const key of Object.keys(clientWorkouts)) {
      clientWorkouts[key].exercises.sort((a, b) => a.order - b.order);
    }
  } catch (err) {
    // Couldn't check for existing workouts — fine, builder just starts blank.
  }
}

// fetchWorkoutExercises() (card/sheet.js) reads the tab once per page and keeps
// that copy, so loadClientWorkouts above would bring back the old rows after a
// save, a delete or a drag. Each write below therefore makes the same change to
// the page's copy that Code.gs just made to the sheet. It's deliberately not a
// fresh read: Google's CSV can lag a few seconds behind a write, so re-reading
// could return the old rows anyway, and Save from there would overwrite the edit.
async function editWorkoutRowsCopy_(edit) {
  try {
    edit(await fetchWorkoutExercises());
  } catch (err) {
    // The tab never loaded on this page, so there's no copy to correct.
  }
}

/** In the page's copy: what handleDeleteWorkout_ does in Code.gs. */
function removeWorkoutFromCopy_({ rows, col }, clientSlug, workoutName) {
  const name = workoutName.toLowerCase();
  for (let i = rows.length - 1; i >= 0; i--) {
    const isClient = String(rows[i][col.client] || "").trim().toLowerCase() === clientSlug;
    const isWorkout = col.workoutName < 0 || String(rows[i][col.workoutName] || "").trim().toLowerCase() === name;
    if (isClient && isWorkout) rows.splice(i, 1);
  }
}

/** In the page's copy: what handleAssignWorkout_ does in Code.gs. Cells are text, as parseCSV gives them. */
function saveWorkoutToCopy_(copy, clientSlug, workoutName, exercises, days, workoutNote) {
  const { rows, col } = copy;

  // Saving adds these columns to the sheet if they're missing, so a tab read
  // before that has no place for them yet (Superset Rest, for one).
  let width = Math.max(0, ...rows.map((r) => r.length), ...Object.values(col).map((c) => c + 1));
  for (const key of ["notes", "workoutNotes", "superset", "supersetRest", "blockType", "workSeconds", "restSeconds", "combos", "runBy", "easierOption"]) {
    if (col[key] < 0) col[key] = width++;
  }

  // A resave keeps its place in the order, a new workout goes on the end.
  let existingOrder = null;
  let maxOrder = -1;
  if (col.workoutOrder >= 0) {
    for (const r of rows) {
      if (String(r[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
      const order = Number(r[col.workoutOrder]);
      if (Number.isFinite(order) && order > maxOrder) maxOrder = order;
      if (existingOrder === null && Number.isFinite(order) && String(r[col.workoutName] || "").trim() === workoutName) {
        existingOrder = order;
      }
    }
  }
  const workoutOrder = existingOrder !== null ? existingOrder : maxOrder + 1;

  removeWorkoutFromCopy_(copy, clientSlug, workoutName);

  exercises.forEach((ex, i) => {
    const row = new Array(width).fill("");
    const put = (column, value) => {
      if (column >= 0) row[column] = String(value);
    };
    put(col.client, clientSlug);
    put(col.workoutName, workoutName);
    put(col.order, i + 1);
    put(col.exercise, ex.name);
    put(col.sets, ex.sets);
    put(col.reps, ex.reps);
    put(col.days, days.join(","));
    put(col.workoutOrder, workoutOrder);
    put(col.notes, ex.note);
    put(col.workoutNotes, workoutNote);
    put(col.superset, ex.superset ? "Y" : "");
    put(col.supersetRest, ex.supersetRest >= 15 && ex.supersetRest <= 600 ? ex.supersetRest : "");
    if (ex.blockType === "Rounds") {
      put(col.blockType, "Rounds");
      put(col.workSeconds, ex.workSeconds);
      put(col.restSeconds, ex.restSeconds);
      put(col.combos, (ex.combos || []).join(" | "));
      put(col.runBy, ex.runBy === "Coach" ? "Coach" : "Client");
      put(col.easierOption, ex.easierOption ? "Y" : "");
    }
    rows.push(row);
  });
}

/** In the page's copy: what handleReorderWorkouts_ does in Code.gs. */
function reorderWorkoutsInCopy_({ rows, col }, clientSlug, order) {
  if (col.workoutOrder < 0) return;
  const position = {};
  order.forEach((name, i) => {
    position[name.toLowerCase()] = i;
  });
  for (const r of rows) {
    if (String(r[col.client] || "").trim().toLowerCase() !== clientSlug) continue;
    const place = position[String(r[col.workoutName] || "").trim().toLowerCase()];
    if (place !== undefined) r[col.workoutOrder] = String(place);
  }
}

function renderChipsAndOptions() {
  els.chips.innerHTML = "";
  els.workoutNameOptions.innerHTML = "";

  const currentName = els.workoutNameInput.value.trim().toLowerCase();
  // Infinity - Infinity is NaN, an invalid sort comparator result — a
  // large finite fallback keeps unordered workouts tied (and stable)
  // instead of relying on how a given engine happens to handle NaN here.
  const UNORDERED = Number.MAX_SAFE_INTEGER;
  const sortedKeys = Object.keys(clientWorkouts).sort(
    (a, b) => (Number.isFinite(clientWorkouts[a].order) ? clientWorkouts[a].order : UNORDERED)
      - (Number.isFinite(clientWorkouts[b].order) ? clientWorkouts[b].order : UNORDERED)
  );

  for (const key of sortedKeys) {
    const workout = clientWorkouts[key];

    const option = document.createElement("option");
    option.value = workout.name;
    els.workoutNameOptions.appendChild(option);

    els.chips.appendChild(buildChip(workout, key === currentName));
  }
}

/**
 * One workout-name chip — tap to load it for editing, or press-and-drag to
 * reorder it among the client's other workouts (same pointer-driven
 * dragging as the exercise rows below). A drag that never moves past a
 * small threshold is treated as a plain tap so the two don't conflict.
 */
function buildChip(workout, isActive) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "builder__chip";
  if (isActive) chip.classList.add("builder__chip--active");
  chip.textContent = workout.name;
  chip.dataset.workoutName = workout.name;

  const DRAG_THRESHOLD = 6;

  chip.addEventListener("pointerdown", (event) => {
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    chip.setPointerCapture(event.pointerId);

    function onMove(moveEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        chip.classList.add("builder__chip--dragging");
        chip.style.pointerEvents = "none";
      }
      // Visually follows the cursor so this actually reads as a drag,
      // rather than only silently swapping once you cross into a
      // neighboring chip with no feedback in between.
      chip.style.transform = `translate(${dx}px, ${dy}px)`;

      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest(".builder__chip");
      if (!target || target === chip || target.parentElement !== els.chips) return;
      const rect = target.getBoundingClientRect();
      const before = moveEvent.clientX < rect.left + rect.width / 2;
      els.chips.insertBefore(chip, before ? target : target.nextSibling);
    }

    function onUp() {
      chip.removeEventListener("pointermove", onMove);
      chip.removeEventListener("pointerup", onUp);
      chip.removeEventListener("pointercancel", onUp);
      if (dragging) {
        chip.classList.remove("builder__chip--dragging");
        chip.style.pointerEvents = "";
        chip.style.transform = "";
        persistChipOrder_();
      } else {
        els.workoutNameInput.value = workout.name;
        loadNamedWorkoutIntoRows(workout.name);
      }
    }

    chip.addEventListener("pointermove", onMove);
    chip.addEventListener("pointerup", onUp);
    chip.addEventListener("pointercancel", onUp);
  });

  return chip;
}

async function persistChipOrder_() {
  const clientSlug = els.clientSelect.value;
  if (!clientSlug) return;

  const order = Array.from(els.chips.querySelectorAll(".builder__chip")).map((chip) => chip.dataset.workoutName);
  const pin = currentPin();

  let result;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "reorderWorkouts", pin, clientSlug, order }),
    });
    result = await res.json();
  } catch (err) {
    showError("Couldn't reach the server — check your connection and try again.");
    return;
  }

  if (result.status === "unauthorized") {
    handleUnauthorized_();
    return;
  }
  if (result.status !== "success") {
    showError(result.message || "Couldn't save the new order — try again.");
    return;
  }

  rememberPin_(pin);
  await editWorkoutRowsCopy_((copy) => reorderWorkoutsInCopy_(copy, clientSlug, order));
  // Keep clientWorkouts' own order values in sync with what's now on the
  // sheet, so a later renderChipsAndOptions() (e.g. after saving an edit)
  // doesn't undo the drag by re-sorting on stale data.
  order.forEach((name, i) => {
    const key = name.toLowerCase();
    if (clientWorkouts[key]) clientWorkouts[key].order = i;
  });
}

function loadNamedWorkoutIntoRows(workoutName) {
  const key = workoutName.trim().toLowerCase();
  const workout = clientWorkouts[key];
  clearRows();
  if (workout && workout.exercises.length) {
    workout.exercises.forEach((exercise) => {
      if (exercise.blockType === "Rounds") {
        addBoxingRow({
          name: exercise.name,
          rounds: Number(exercise.sets) || 3,
          workSeconds: exercise.workSeconds,
          restSeconds: exercise.restSeconds,
          sameEveryRound: exercise.combos.length <= 1,
          combos: exercise.combos.length ? exercise.combos : [""],
          runBy: exercise.runBy,
          easierOption: exercise.easierOption,
        });
      } else {
        addRow(exercise);
      }
    });
    setSelectedDays(workout.days);
    setWorkoutNote(workout.note);
    els.deleteButton.hidden = false;
  } else {
    addRow();
    setSelectedDays([]);
    setWorkoutNote("");
    els.deleteButton.hidden = true;
  }
  renderChipsAndOptions();
}

els.clientSelect.addEventListener("change", async () => {
  els.workoutNameInput.value = "";
  clearRows();
  setSelectedDays([]);
  setWorkoutNote("");
  els.deleteButton.hidden = true;
  els.chips.innerHTML = "";
  await loadClientWorkouts(els.clientSelect.value);
  renderChipsAndOptions();
  addRow();
});

els.workoutNameInput.addEventListener("change", () => {
  if (!els.clientSelect.value) return;
  loadNamedWorkoutIntoRows(els.workoutNameInput.value);
});

els.addButton.addEventListener("click", () => addRow());

els.saveButton.addEventListener("click", async () => {
  const clientSlug = els.clientSelect.value;
  const workoutName = els.workoutNameInput.value.trim();

  if (!clientSlug) {
    showError("Pick a client first.");
    return;
  }
  if (!workoutName) {
    showError("Give this workout a name (e.g. Push, Pull, Legs).");
    return;
  }

  // The row's only 4 <input>s now, in DOM order: sets, reps, tip, then the
  // hidden exercise-name value (see addRow — its visible control is a
  // button, not an input, precisely so it's skipped here and picked up by
  // name below instead).
  const exercises = Array.from(els.rows.children)
    .map((row) => {
      // A boxing block (2026-11-07) has no sets/reps/tip inputs at all — its
      // whole setup lives on row._boxing (the block editor), not positional
      // inputs, so it's read on a completely separate path from the generic
      // exercise-row destructure below.
      if (row.dataset.blockType === "rounds") {
        const b = row._boxing;
        return {
          name: b.name,
          sets: b.rounds, // Target Sets doubles as the round count
          reps: "",
          note: "",
          superset: false,
          supersetRest: "",
          blockType: "Rounds",
          workSeconds: b.workSeconds,
          restSeconds: b.restSeconds,
          combos: b.sameEveryRound ? [b.combos[0] || ""] : b.combos.slice(),
          runBy: b.runBy,
          easierOption: b.easierOption,
        };
      }
      const [setsInput, repsInput, tipInput, nameInput] = row.querySelectorAll("input");
      return {
        name: nameInput.value.trim(),
        sets: Number(setsInput.value),
        reps: repsInput.value.trim(),
        note: tipInput ? tipInput.value.trim() : "",
        superset: rowLinksToNext_(row),
        supersetRest: Number(row.dataset.supersetRest) || "",
      };
    })
    .filter((ex) => ex.name);

  // A superset's rest is saved on its first exercise only. (Filtering out a
  // blank row can leave the last exercise linked to nothing, so unlink it.)
  exercises.forEach((ex, i) => {
    if (i === exercises.length - 1) ex.superset = false;
    const prevLinks = i > 0 && exercises[i - 1].superset;
    if (!ex.superset || prevLinks) ex.supersetRest = "";
  });

  if (!exercises.length) {
    showError("Add at least one exercise.");
    return;
  }
  if (exercises.some((ex) => !Number.isFinite(ex.sets) || ex.sets < 1)) {
    showError("Every exercise needs a target number of sets.");
    return;
  }

  const days = getSelectedDays();
  const workoutNote = workoutNoteValue();
  const hasNotes = Boolean(workoutNote) || exercises.some((ex) => ex.note);
  const hasCustomRest = exercises.some((ex) => ex.supersetRest && ex.supersetRest !== SUPERSET_REST_DEFAULT_);
  const hasBoxing = exercises.some((ex) => ex.blockType === "Rounds");
  const pin = currentPin();
  els.saveButton.disabled = true;
  els.saveButton.textContent = "Saving…";
  els.error.hidden = true;
  els.success.hidden = true;

  let result;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify({ action: "assignWorkout", pin, clientSlug, workoutName, exercises, days, workoutNote }),
    });
    result = await res.json();
  } catch (err) {
    showError("Couldn't reach the server — check your connection and try again.");
    els.saveButton.disabled = false;
    els.saveButton.textContent = "Save Workout";
    return;
  }

  if (result.status === "unauthorized") {
    handleUnauthorized_();
    els.saveButton.disabled = false;
    els.saveButton.textContent = "Save Workout";
    return;
  }

  if (result.status !== "success") {
    showError(result.message || "Something went wrong — try again.");
    els.saveButton.disabled = false;
    els.saveButton.textContent = "Save Workout";
    return;
  }

  rememberPin_(pin);
  els.pinRow.hidden = true;
  els.success.hidden = false;
  els.saveButton.disabled = false;
  els.saveButton.textContent = "Save Workout";
  els.deleteButton.hidden = false;
  await editWorkoutRowsCopy_((copy) => saveWorkoutToCopy_(copy, clientSlug, workoutName, exercises, days, workoutNote));
  await loadClientWorkouts(clientSlug);
  renderChipsAndOptions();

  // An Apps Script deployment from before tips existed saves the exercises but
  // silently throws the tips away — say so, rather than let "Saved" imply they're there.
  if (hasNotes && !result.notesSupported) {
    showError("Saved the exercises, but the tips and notes were NOT stored — the Apps Script on Google is out of date. Redeploy it (Deploy → Manage deployments → New version), then Save again.");
  } else if (hasCustomRest && !result.supersetRestSupported) {
    showError("Saved the workout, but the superset rest times were NOT stored, so clients will get 90s — the Apps Script on Google is out of date. Paste the new Code.gs, deploy a new version, then Save again.");
  } else if (hasBoxing && !result.boxingSupported) {
    showError("Saved the workout, but the boxing block's rounds/work/rest/combos were NOT stored — the Apps Script on Google is out of date. Paste the new Code.gs, deploy a new version, then Save again.");
  }
});

els.deleteButton.addEventListener("click", async () => {
  const clientSlug = els.clientSelect.value;
  const workoutName = els.workoutNameInput.value.trim();
  if (!clientSlug || !workoutName) return;
  if (!window.confirm(`Delete "${workoutName}" for this client? This can't be undone.`)) return;

  const pin = currentPin();
  els.deleteButton.disabled = true;
  els.deleteButton.textContent = "Deleting…";
  els.error.hidden = true;
  els.success.hidden = true;

  let result;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "deleteWorkout", pin, clientSlug, workoutName }),
    });
    result = await res.json();
  } catch (err) {
    showError("Couldn't reach the server — check your connection and try again.");
    els.deleteButton.disabled = false;
    els.deleteButton.textContent = "Delete This Workout";
    return;
  }

  if (result.status === "unauthorized") {
    handleUnauthorized_();
    els.deleteButton.disabled = false;
    els.deleteButton.textContent = "Delete This Workout";
    return;
  }

  if (result.status !== "success") {
    showError(result.message || "Something went wrong — try again.");
    els.deleteButton.disabled = false;
    els.deleteButton.textContent = "Delete This Workout";
    return;
  }

  rememberPin_(pin);
  els.deleteButton.disabled = false;
  els.deleteButton.textContent = "Delete This Workout";
  els.deleteButton.hidden = true;
  els.workoutNameInput.value = "";
  clearRows();
  setSelectedDays([]);
  setWorkoutNote("");
  addRow();
  await editWorkoutRowsCopy_((copy) => removeWorkoutFromCopy_(copy, clientSlug, workoutName));
  await loadClientWorkouts(clientSlug);
  renderChipsAndOptions();
});

function handleUnauthorized_() {
  try {
    localStorage.removeItem(STAFF_PIN_STORAGE_KEY);
  } catch (err) {
    // Ignore — worst case they retype an already-wrong PIN once more.
  }
  els.pinRow.hidden = false;
  els.pinInput.value = "";
  els.pinInput.focus();
  showError("Incorrect PIN.");
}

function rememberPin_(pin) {
  if (!pin) return;
  try {
    localStorage.setItem(STAFF_PIN_STORAGE_KEY, pin);
  } catch (err) {
    // Ignore — this device just asks for the PIN again next time.
  }
}

// The Exercises tab (exercise-manager.js) has added or filled in an exercise:
// forget the cached name -> muscles lookup so rows and pickers see it.
document.addEventListener("maxfit:exercises-changed", () => {
  exerciseIndexPromise_ = null;
});

(function init() {
  let rememberedPin = "";
  try {
    rememberedPin = localStorage.getItem(STAFF_PIN_STORAGE_KEY) || "";
  } catch (err) {
    // Ignore — pin row just shows as normal.
  }
  els.pinRow.hidden = Boolean(rememberedPin);

  buildDaysPicker();
  buildWorkoutNoteField();
  loadClientList();
  addRow();
})();
